// On-device checks against a LIVE backend. Not part of `flutter test`.
//
//   cd apps/mobile-employee
//   flutter test integration_test -d <device id>
//
// These exist because the four things they cover cannot be proved by a hermetic
// widget test:
//
//   * the app resolves its own identity through `GET /employees/me`, against a
//     technician whose role genuinely does not hold `employee.view`;
//   * an account with no employee card reaches the amber configuration state rather
//     than an error, over the real 404;
//   * session restore reads the Keychain and re-confirms the account with the server;
//   * the forced password change — the first screen every provisioned technician
//     meets, and the one flow that had never been run against a real server.
//
// WHAT THEY NEED. A backend on 127.0.0.1:4000 with the dev data seeded, the TECHNICIAN
// role converged (`npm run migrate:technician-permissions`), and these three accounts:
//
//   admin@monhorus.mn        / Monhorus2026admin   head_admin, used to provision
//   scope.tech@monhorus.mn   / Monhorus2026field   technician linked to EMP-0003
//   unlinked.tech@monhorus.mn/ Monhorus2026field   technician linked to no employee
//
// To create the two technicians on a fresh dev database (T = an admin access token):
//
//   # linked — CREATE_NEW issues the passcode and sets must_change_password, so sign
//   # in once and replace it with Monhorus2026field before running this suite.
//   POST /employees/<EMP-0003 id>/system-access
//        {"mode":"CREATE_NEW","email":"scope.tech@monhorus.mn",
//         "password":"Monhorus2026temp","role":"technician"}
//
//   # unlinked — a plain account with no employee card behind it
//   POST /users
//        {"fullName":"Холбоогүй Ажилтан","email":"unlinked.tech@monhorus.mn",
//         "password":"Monhorus2026field","role":"technician",
//         "requirePasswordChange":false}
//
// The forced-password-change case resets and restores the passcode itself through the
// admin API, so the suite is re-runnable and leaves the accounts as it found them.
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:monhorus_employee/core/storage/secure_token_storage.dart';
import 'package:monhorus_employee/features/auth/presentation/screens/change_password_screen.dart';
import 'package:monhorus_employee/features/auth/presentation/screens/login_screen.dart';
import 'package:monhorus_employee/features/auth/presentation/widgets/auth_text_field.dart';
import 'package:monhorus_employee/features/employee/presentation/screens/employee_shell_screen.dart';
import 'package:monhorus_employee/main.dart';

const String _api = 'http://127.0.0.1:4000/api/v1';
const String _linked = 'scope.tech@monhorus.mn';
const String _unlinked = 'unlinked.tech@monhorus.mn';
const String _password = 'Monhorus2026field';
const String _temporary = 'Monhorus2026temp';

// Хуанли is not a tab: it is pushed from the calendar button in every tab header.
const List<String> _tabs = <String>['Нүүр', 'Ажил', 'Төсөл', 'Профайл'];

// -- Harness -----------------------------------------------------------------

/// Mounts the app exactly as `main()` does, so the routing authority under test is
/// the real [AuthGate] over the real [AuthController].
Future<void> _launch(WidgetTester tester) async {
  await tester.pumpWidget(const ProviderScope(child: MonhorusEmployeeApp()));
  await _settle(tester);
}

/// Pumps for a while without requiring the tree to go still.
///
/// The shell's tabs hold indefinite loading spinners while their requests are in
/// flight, so `pumpAndSettle` would time out rather than settle. Real network calls
/// also need real time, which is why this pumps in wall-clock slices.
Future<void> _settle(WidgetTester tester, {int seconds = 6}) async {
  for (int i = 0; i < seconds * 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

Finder _field(String label) => find.descendant(
      of: find.byWidgetPredicate(
        (Widget widget) => widget is AuthTextField && widget.label == label,
      ),
      matching: find.byType(TextField),
    );

Future<void> _type(WidgetTester tester, String label, String value) async {
  await tester.enterText(_field(label), value);
  await tester.pump();
}

Future<void> _signIn(
  WidgetTester tester, {
  required String email,
  required String password,
}) async {
  expect(find.byType(LoginScreen), findsOneWidget);
  await _type(tester, 'Имэйл', email);
  await _type(tester, 'Нууц үг', password);
  await tester.tap(find.widgetWithText(FilledButton, 'Нэвтрэх'));
  await _settle(tester);
}

/// Clears the Keychain so each case starts from a known place.
Future<void> _forgetSession() => SecureTokenStorage().clear();

/// Opens one tab and asserts it rendered something rather than throwing.
Future<void> _openTab(WidgetTester tester, String label) async {
  await tester.tap(find.text(label).last);
  await _settle(tester, seconds: 3);
  expect(tester.takeException(), isNull, reason: '$label threw while rendering');
}

// -- Admin API, for the cases that need a server-side state change ------------

final Dio _dio = Dio(BaseOptions(
  baseUrl: _api,
  validateStatus: (int? status) => status != null && status < 500,
));

Future<String> _adminToken() async {
  final Response<dynamic> response = await _dio.post<dynamic>(
    '/auth/login',
    data: <String, String>{
      'email': 'admin@monhorus.mn',
      'password': 'Monhorus2026admin',
    },
  );
  final Map<String, dynamic> body = response.data as Map<String, dynamic>;
  return (body['data']['tokens']['accessToken']) as String;
}

Future<String> _userIdOf(String token, String email) async {
  final Response<dynamic> response = await _dio.get<dynamic>(
    '/users',
    queryParameters: <String, dynamic>{'search': email, 'limit': 10},
    options: Options(headers: <String, String>{'Authorization': 'Bearer $token'}),
  );
  final Map<String, dynamic> body = response.data as Map<String, dynamic>;
  final List<dynamic> items = body['data']['items'] as List<dynamic>;
  final Map<String, dynamic> match = items
      .cast<Map<String, dynamic>>()
      .firstWhere((Map<String, dynamic> user) => user['email'] == email);
  return match['id'] as String;
}

/// `POST /users/:userId/reset-passcode` — the admin action that puts an account back
/// into `must_change_password`, which is the state this app has to route on.
Future<void> _issuePasscode(String token, String userId, String passcode) async {
  final Response<dynamic> response = await _dio.post<dynamic>(
    '/users/$userId/reset-passcode',
    data: <String, String>{
      'newPassword': passcode,
      'reason': 'integration test',
    },
    options: Options(headers: <String, String>{'Authorization': 'Bearer $token'}),
  );
  expect(response.statusCode, 200, reason: '${response.data}');
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  setUp(_forgetSession);

  testWidgets(
    'a linked technician signs in, all four tabs load, and Профайл shows their record',
    (WidgetTester tester) async {
      await _launch(tester);
      await _signIn(tester, email: _linked, password: _password);

      expect(find.byType(EmployeeShellScreen), findsOneWidget);
      for (final String label in _tabs) {
        expect(find.text(label), findsWidgets, reason: '$label is missing from the nav');
      }
      for (final String label in _tabs) {
        await _openTab(tester, label);
      }

      // The Профайл tab is on screen last. Its record comes from GET /employees/me —
      // the only employee endpoint this account may call, since the converged
      // TECHNICIAN role holds no `employee.view` and the directory answers 403.
      expect(find.text('EMP-0003'), findsWidgets);
      expect(
        find.text('МИНИЙ АЧААЛАЛ'),
        findsOneWidget,
        reason: 'the workload strip is the performance data a linked technician gets',
      );
      expect(find.text('Ажилтны карт холбогдоогүй байна'), findsNothing);
    },
  );

  testWidgets('an unlinked account gets the configuration banner, not an error', (
    WidgetTester tester,
  ) async {
    await _launch(tester);
    await _signIn(tester, email: _unlinked, password: _password);

    expect(find.byType(EmployeeShellScreen), findsOneWidget);
    await _openTab(tester, 'Профайл');

    // The real 404 from /employees/me, rendered as the amber configuration state.
    expect(find.text('Ажилтны карт холбогдоогүй байна'), findsOneWidget);
    expect(
      find.textContaining('Системийн админд хандана уу.'),
      findsOneWidget,
      reason: "the server's own sentence names the remedy",
    );
    // Not an error: no retry panel, and the rest of the tab still works.
    expect(find.text('Ажилтны бүртгэл ачаалж чадсангүй'), findsNothing);
  });

  testWidgets('session restore signs the app back in from the Keychain', (
    WidgetTester tester,
  ) async {
    await _launch(tester);
    await _signIn(tester, email: _linked, password: _password);
    expect(find.byType(EmployeeShellScreen), findsOneWidget);

    // A cold start, with the tokens the login above wrote to the Keychain still
    // there. `restoreSession` re-confirms the account with GET /auth/me rather than
    // trusting the cache, which is what makes a suspension or a role change land.
    await _launch(tester);
    await _settle(tester);

    expect(find.byType(LoginScreen), findsNothing);
    expect(find.byType(EmployeeShellScreen), findsOneWidget);
    await _openTab(tester, 'Профайл');
    expect(find.text('EMP-0003'), findsWidgets);
  });

  testWidgets(
    'an admin-issued passcode forces the change screen, and the app recovers',
    (WidgetTester tester) async {
      final String token = await _adminToken();
      final String userId = await _userIdOf(token, _linked);

      // Put the account into exactly the state a newly provisioned technician is in.
      await _issuePasscode(token, userId, _temporary);

      await _launch(tester);
      await _signIn(tester, email: _linked, password: _temporary);

      // The gate routed on the account status, not on anything a screen decided.
      expect(
        find.byType(ChangePasswordScreen),
        findsOneWidget,
        reason: 'must_change_password has to reach ChangePasswordScreen',
      );
      expect(find.byType(EmployeeShellScreen), findsNothing);
      expect(
        find.textContaining('Администратор танд түр нууц үг олгосон байна'),
        findsOneWidget,
      );
      // Forced: there is no way back to a login screen except signing out.
      expect(find.byType(BackButton), findsNothing);

      // Replace it.
      await _type(tester, 'Одоогийн нууц үг', _temporary);
      await _type(tester, 'Шинэ нууц үг', _password);
      await _type(tester, 'Шинэ нууц үг давтах', _password);
      await tester.tap(find.widgetWithText(FilledButton, 'Нууц үг солих'));
      await _settle(tester);

      // The server revoked every session, so the app lands on login — not on a dead
      // form left mounted over it.
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(ChangePasswordScreen), findsNothing);

      // And the new password gets the shell, with the account no longer forced.
      await _signIn(tester, email: _linked, password: _password);
      expect(find.byType(ChangePasswordScreen), findsNothing);
      expect(find.byType(EmployeeShellScreen), findsOneWidget);
      await _openTab(tester, 'Профайл');
      expect(find.text('EMP-0003'), findsWidgets);
    },
  );
}
