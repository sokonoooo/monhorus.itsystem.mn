// The forced password change, end to end through the real routing authority.
//
// This flow had never been exercised. It is the FIRST thing every provisioned
// technician meets — `POST /employees/:id/system-access [CREATE_NEW]` writes
// `status: 'must_change_password'` unconditionally, so an account issued by an
// administrator cannot reach any other screen until it has been through here — and a
// mistake in it locks the whole workforce out of the app rather than out of one
// feature.
//
// Everything below the fake repository is real: the real [AuthController], the real
// [AuthGate] switch, the real [ChangePasswordScreen] with its own validation. Only
// the transport is stubbed, and it is stubbed to the responses the live dev backend
// actually gave (verified against 127.0.0.1:4000 with a freshly provisioned
// scope.tech@monhorus.mn):
//
//   POST /auth/login            -> 200, user.status = "must_change_password"
//   GET  /employees/me          -> 403 PASSWORD_CHANGE_REQUIRED  (the gate holds)
//   POST /auth/change-password  -> 200, every session revoked
//   POST /auth/login (new pass) -> 200, user.status = "active"
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/auth/presentation/screens/change_password_screen.dart';
import 'package:monhorus_employee/features/auth/presentation/screens/login_screen.dart';
import 'package:monhorus_employee/features/auth/presentation/widgets/auth_text_field.dart';
import 'package:monhorus_employee/features/employee/presentation/screens/employee_shell_screen.dart';
import 'package:monhorus_employee/main.dart';

const String _temporary = 'Monhorus2026temp';
const String _replacement = 'Monhorus2026field';

AppUser _account(AccountStatus status) => AppUser(
      id: '6a6ac5d830ae991c9bedbd39',
      fullName: 'Пүрэв Сараа',
      email: 'scope.tech@monhorus.mn',
      role: UserRole.technician,
      status: status,
      permissions: const <String>{
        'planned_work.view',
        'planned_work.change_status',
        'planned_work.record_progress',
        'planned_work.submit_report',
      },
    );

/// Stands in for the network, and remembers what the screen actually sent.
///
/// It enforces the one server rule the screen has to respect: the CURRENT password
/// must be the admin-issued one. A screen that sent the wrong field would get the
/// backend's 400 here rather than a green path.
class _FakeAuthRepository implements AuthRepository {
  _FakeAuthRepository({required this.startsAs});

  final AccountStatus startsAs;

  bool passwordChanged = false;
  String? sentCurrentPassword;
  String? sentNewPassword;
  int loginCalls = 0;

  /// Set when the account has no live session, which is what a password change
  /// leaves behind: the backend revokes every refresh token.
  bool _signedOut = false;

  @override
  Future<ApiResult<AppUser>> restoreSession() async {
    if (_signedOut) {
      return const FailureResult<AppUser>(
        AuthFailure('Сесс байхгүй.', code: 'NO_SESSION'),
      );
    }
    return Success<AppUser>(_account(startsAs));
  }

  @override
  Future<ApiResult<AppUser>> login({
    required String email,
    required String password,
  }) async {
    loginCalls += 1;
    final String expected = passwordChanged ? _replacement : _temporary;
    if (password != expected) {
      return const FailureResult<AppUser>(
        AuthFailure(
          'Имэйл эсвэл нууц үг буруу байна.',
          code: 'INVALID_CREDENTIALS',
        ),
      );
    }
    _signedOut = false;
    return Success<AppUser>(_account(
      passwordChanged ? AccountStatus.active : AccountStatus.mustChangePassword,
    ));
  }

  @override
  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    sentCurrentPassword = currentPassword;
    sentNewPassword = newPassword;

    if (currentPassword != _temporary) {
      return const FailureResult<void>(
        ServerFailure('Одоогийн нууц үг буруу байна.', code: 'VALIDATION_ERROR'),
      );
    }

    passwordChanged = true;
    // Every session is revoked server-side.
    _signedOut = true;
    return const Success<void>(null);
  }

  /// `GET /auth/me`, which the Нүүр and Профайл tabs both issue on mount.
  ///
  /// It has to agree with [restoreSession] about the account status. It reports the
  /// live record, and the live record is only `active` once the passcode has actually
  /// been replaced — a stub that always answered `must_change_password` would send an
  /// ordinary signed-in technician back to the forced screen one frame after the shell
  /// appeared, which is exactly the bug this suite exists to catch.
  @override
  Future<ApiResult<AppUser>> currentUser() async => Success<AppUser>(
        _account(passwordChanged ? AccountStatus.active : startsAs),
      );

  @override
  Future<ApiResult<void>> logout() async {
    _signedOut = true;
    return const Success<void>(null);
  }
}

/// The [TextField] inside the [AuthTextField] carrying [label].
///
/// The label is a sibling Text in a Column, not a decoration, so it cannot be reached
/// with `find.ancestor`; the widget's own property is the reliable key.
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

/// Pumps enough frames to flush the pending futures without waiting for the tree to
/// go still.
///
/// `pumpAndSettle` cannot be used past the sign-in point: the shell mounts four tabs
/// that immediately fire requests with no server behind them, and their loading
/// spinners are indefinite animations, so settling never happens. This is the same
/// reason employee_shell_smoke_test.dart pumps by hand.
Future<void> _settle(WidgetTester tester) async {
  for (int i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
}

void main() {
  testWidgets(
    'an admin-issued passcode routes to ChangePasswordScreen and cannot be escaped',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final _FakeAuthRepository repository =
          _FakeAuthRepository(startsAs: AccountStatus.mustChangePassword);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(repository),
          ],
          child: const MaterialApp(home: AuthGate()),
        ),
      );
      await _settle(tester);

      // The gate routed on status alone, before any screen could ask it to.
      expect(find.byType(ChangePasswordScreen), findsOneWidget);
      expect(find.byType(EmployeeShellScreen), findsNothing);
      expect(find.byType(LoginScreen), findsNothing);
      expect(
        find.textContaining('Администратор танд түр нууц үг олгосон байна'),
        findsOneWidget,
      );

      // Forced means forced: no back arrow, and the only way out is Гарах.
      expect(find.byType(BackButton), findsNothing);
      expect(find.widgetWithText(TextButton, 'Гарах'), findsOneWidget);
    },
  );

  testWidgets('the screen refuses a weak or mismatched replacement locally', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final _FakeAuthRepository repository =
        _FakeAuthRepository(startsAs: AccountStatus.mustChangePassword);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(repository),
        ],
        child: const MaterialApp(home: AuthGate()),
      ),
    );
    await _settle(tester);

    await _type(tester, 'Одоогийн нууц үг', _temporary);
    await _type(tester, 'Шинэ нууц үг', 'short1');
    await _type(tester, 'Шинэ нууц үг давтах', 'different1');
    await tester.tap(find.widgetWithText(FilledButton, 'Нууц үг солих'));
    await _settle(tester);

    expect(
      find.text('Нууц үг дор хаяж 10 тэмдэгттэй байна.'),
      findsOneWidget,
    );
    expect(find.text('Нууц үг таарахгүй байна.'), findsOneWidget);
    // Nothing went to the server, so no round trip was spent on an obvious miss.
    expect(repository.sentNewPassword, isNull);
    expect(find.byType(ChangePasswordScreen), findsOneWidget);
  });

  testWidgets(
    'changing the password signs the account out, and the new one gets the shell',
    (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final _FakeAuthRepository repository =
          _FakeAuthRepository(startsAs: AccountStatus.mustChangePassword);

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            authRepositoryProvider.overrideWithValue(repository),
          ],
          child: const MaterialApp(home: AuthGate()),
        ),
      );
      await _settle(tester);
      expect(find.byType(ChangePasswordScreen), findsOneWidget);

      await _type(tester, 'Одоогийн нууц үг', _temporary);
      await _type(tester, 'Шинэ нууц үг', _replacement);
      await _type(tester, 'Шинэ нууц үг давтах', _replacement);
      await tester.tap(find.widgetWithText(FilledButton, 'Нууц үг солих'));
      await _settle(tester);

      // The screen sent the admin-issued passcode as `currentPassword`, which is what
      // the backend checks, and the replacement as `newPassword`.
      expect(repository.sentCurrentPassword, _temporary);
      expect(repository.sentNewPassword, _replacement);
      expect(repository.passwordChanged, isTrue);

      // Recovery: the backend revoked every session, so the gate lands on login —
      // not on a dead form over it, and not on the shell.
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.byType(ChangePasswordScreen), findsNothing);

      // The old passcode is dead.
      await _type(tester, 'Имэйл', 'scope.tech@monhorus.mn');
      await _type(tester, 'Нууц үг', _temporary);
      await tester.tap(find.widgetWithText(FilledButton, 'Нэвтрэх'));
      await _settle(tester);
      expect(find.byType(LoginScreen), findsOneWidget);
      expect(find.textContaining('Имэйл эсвэл нууц үг буруу'), findsOneWidget);

      // The new one signs in, and the account is `active` rather than forced again.
      await _type(tester, 'Нууц үг', _replacement);
      await tester.tap(find.widgetWithText(FilledButton, 'Нэвтрэх'));
      await _settle(tester);

      expect(find.byType(ChangePasswordScreen), findsNothing);
      expect(find.byType(EmployeeShellScreen), findsOneWidget);
      // The four tabs of the shell, mounted for a technician who has just recovered.
      for (final String label in <String>[
        'Нүүр',
        'Ажил',
        'Төсөл',
        'Профайл',
      ]) {
        expect(find.text(label), findsWidgets, reason: '$label is missing');
      }
    },
  );

  testWidgets('an already-active session is never sent to the forced screen', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final _FakeAuthRepository repository =
        _FakeAuthRepository(startsAs: AccountStatus.active);

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          authRepositoryProvider.overrideWithValue(repository),
        ],
        child: const MaterialApp(home: AuthGate()),
      ),
    );
    await _settle(tester);

    // Session restore: a cold start with a stored token lands straight in the shell.
    expect(find.byType(EmployeeShellScreen), findsOneWidget);
    expect(find.byType(ChangePasswordScreen), findsNothing);
    expect(repository.loginCalls, 0);
  });
}
