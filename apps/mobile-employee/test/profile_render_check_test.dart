// Hermetic render checks for the Профайл tab, driven off the two states
// `GET /employees/me` can produce.
//
// The tab is the one screen whose whole purpose is the employee record, so it is the
// screen where the endpoint swap is most visible: a resolved card, or the amber
// "no employee card" configuration state carrying the server's own sentence. There is
// deliberately no third case any more — the "you lack employee.view" banner went with
// the directory search, because `/employees/me` needs no permission.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/identity/employee_self.dart';
import 'package:monhorus_employee/features/employee/identity/employee_self_provider.dart';
import 'package:monhorus_employee/features/employee/profile/presentation/providers/profile_providers.dart';
import 'package:monhorus_employee/features/employee/profile/presentation/screens/profile_tab_screen.dart';

/// A verbatim `GET /employees/me` body from the dev backend.
Map<String, dynamic> _me() => <String, dynamic>{
      'id': '6a6a1dc9cf308958351efe23',
      'employeeCode': 'EMP-0003',
      'firstName': 'Сараа',
      'lastName': 'Пүрэв',
      'email': 'p.saraa@monhorus.mn',
      'phone': '8811-9922',
      'photoUrl': null,
      'company': <String, dynamic>{'id': 'co1', 'name': 'Монхорус ХХК'},
      'department': <String, dynamic>{'id': 'd1', 'name': 'Техник үйлчилгээ'},
      'position': <String, dynamic>{'id': 'p1', 'name': 'Цахилгаанчин'},
      'team': <String, dynamic>{'id': 't1', 'name': 'Б баг'},
      'workLocation': 'Улаанбаатар',
      'employmentStartDate': '2024-03-01T00:00:00.000Z',
      'employeeType': 'FULL_TIME',
      'status': 'ACTIVE',
      'qualificationLevel': 'MIDDLE',
      'safetyGrade': 'III',
      'skills': <dynamic>['Цахилгаан'],
      'permittedJobTypes': <dynamic>[],
      'hasDriverLicense': true,
      'gpsVerificationEnabled': false,
      'workload': <String, dynamic>{
        'activeAssignments': 2,
        'completedAssignments': 11,
        'openServiceRequests': 1,
      },
    };

const AppUser _user = AppUser(
  id: 'u1',
  fullName: 'Пүрэв Сараа',
  email: 'scope.tech@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'planned_work.view',
    'planned_work.change_status',
    'planned_work.record_progress',
    'planned_work.submit_report',
  },
);

Widget _app(EmployeeSelf self) {
  return ProviderScope(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(_user),
      // The tab awaits this before reading the record; it normally issues one
      // /auth/me, which a hermetic test has no server for.
      profileIdentityRefreshProvider.overrideWith((Ref ref) async {}),
      employeeSelfProvider.overrideWith((Ref ref) async => self),
    ],
    child: const MaterialApp(home: ProfileTabScreen()),
  );
}

void main() {
  testWidgets('a linked technician sees their own card and performance figures', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_app(
      EmployeeSelfResolved(employeeId: 'e1', record: _me()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Пүрэв Сараа'), findsWidgets);
    expect(find.text('EMP-0003'), findsWidgets);

    // The workload strip: the only per-employee performance figures the API exposes,
    // and the thing a technician loses entirely if the identity cannot be resolved.
    // Section captions are drawn upper-cased.
    expect(find.text('МИНИЙ АЧААЛАЛ'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    expect(find.text('11'), findsOneWidget);
    expect(find.text('Дууссан (нийт)'), findsOneWidget);

    // The record card itself, further down the list. `Цахилгаанчин` is not a usable
    // anchor: the position also appears as the identity card's subtitle.
    await tester.scrollUntilVisible(
      find.text('Улаанбаатар'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Улаанбаатар'), findsOneWidget);
    expect(find.text('Б баг'), findsOneWidget);
    expect(find.text('Техник үйлчилгээ'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('an unlinked account gets the amber configuration banner, not an error', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_app(
      // The backend's own 404 body, verbatim.
      const EmployeeSelfUnavailable(
        EmployeeSelfProblem.notLinked,
        serverMessage: 'Таны бүртгэл ажилтны картад холбогдоогүй байна. '
            'Системийн админд хандана уу.',
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Ажилтны карт холбогдоогүй байна'), findsOneWidget);
    expect(
      find.textContaining('Системийн админд хандана уу.'),
      findsOneWidget,
      reason: "the server's own sentence names the remedy and must be shown",
    );

    // It is a configuration state, not a failure: no red retry panel.
    expect(find.text('Дахин оролдох'), findsNothing);
    expect(find.text('Ажилтны бүртгэл ачаалж чадсангүй'), findsNothing);

    // The identity card still renders from the session, so the technician can see who
    // they are signed in as instead of a blank panel.
    expect(find.text('Пүрэв Сараа'), findsWidgets);

    // And the two account actions still work. Both sit below the fold.
    await tester.scrollUntilVisible(
      find.text('Гарах'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Нууц үг солих'), findsOneWidget);
    expect(find.text('Гарах'), findsOneWidget);
    expect(find.text('scope.tech@monhorus.mn'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read is an error with a retry, never "you have no card"', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_app(
      const EmployeeSelfUnavailable(
        EmployeeSelfProblem.lookupFailed,
        serverMessage: 'Сүлжээний холболт алдаатай байна.',
      ),
    ));
    await tester.pumpAndSettle();

    expect(find.text('Ажилтны бүртгэл ачаалж чадсангүй'), findsOneWidget);
    expect(find.textContaining('Сүлжээний холболт алдаатай байна.'), findsOneWidget);
    expect(find.text('Дахин оролдох'), findsOneWidget);
    // Telling someone they have no employee card because the network dropped would
    // state a fact the app does not have.
    expect(find.text('Ажилтны карт холбогдоогүй байна'), findsNothing);

    expect(tester.takeException(), isNull);
  });
}
