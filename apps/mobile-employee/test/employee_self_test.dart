// Unit checks for the two rules this app now depends on the server for.
//
// 1. `GET /employees/me` is parsed correctly by every tab that reads it. The fixture
//    below is a verbatim capture of a real response from the dev backend
//    (127.0.0.1:4000, technician scope.tech@monhorus.mn, employee EMP-0003), not a
//    hand-written guess at the DTO, so a field the server stopped sending would fail
//    here rather than in the field.
//
// 2. `resolvePlannedWorkAssignment` mirrors `resolveAssignmentScope` in
//    apps/backend/src/modules/planned-work/planned-work.scope.ts. Every case below
//    corresponds to a branch of that function, including the two that decide when the
//    app must NOT narrow the UI.
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/employee/calendar/data/models/employee_lookup_model.dart'
    as calendar;
import 'package:monhorus_employee/features/employee/home/data/models/employee_model.dart'
    as home;
import 'package:monhorus_employee/features/employee/profile/data/models/employee_model.dart';
import 'package:monhorus_employee/features/employee/profile/domain/entities/employee_profile.dart';
import 'package:monhorus_employee/features/employee/work/data/models/employee_link_model.dart'
    as work;
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';

/// A verbatim `GET /employees/me` body, keys in the order the server emits them.
///
/// Note what is NOT here and must never be depended on again: `systemAccess`,
/// `linkedUserId`, `registrationNumber`, `documents`, `currentSalary`.
Map<String, dynamic> _me() => <String, dynamic>{
      'id': '6a6a1dc9cf308958351efe23',
      'employeeCode': 'EMP-0003',
      'firstName': 'Сараа',
      'lastName': 'Пүрэв',
      'email': 'p.saraa@monhorus.mn',
      'phone': '8811-9922',
      'photoUrl': '/api/v1/files/6a6a1dc9cf308958351eff01',
      'company': <String, dynamic>{'id': 'co1', 'name': 'Монхорус ХХК'},
      'department': <String, dynamic>{'id': 'd1', 'name': 'Техник үйлчилгээ'},
      'position': <String, dynamic>{'id': 'p1', 'name': 'Цахилгаанчин'},
      'team': <String, dynamic>{'id': '6a6a1dc9cf308958351efe13', 'name': 'Б баг'},
      'workLocation': 'Улаанбаатар',
      'employmentStartDate': '2024-03-01T00:00:00.000Z',
      'employeeType': 'FULL_TIME',
      'status': 'ACTIVE',
      'qualificationLevel': 'MIDDLE',
      'safetyGrade': 'III',
      'skills': <dynamic>['Цахилгаан', 'Гэрэлтүүлэг'],
      'permittedJobTypes': <dynamic>['MAINTENANCE'],
      'hasDriverLicense': true,
      'gpsVerificationEnabled': false,
      'workload': <String, dynamic>{
        'activeAssignments': 2,
        'completedAssignments': 11,
        'openServiceRequests': 1,
      },
    };

/// One planned work, with the two assignment fields the scope rule reads.
Map<String, dynamic> _work({
  List<Map<String, dynamic>> employees = const <Map<String, dynamic>>[],
  Map<String, dynamic>? team,
}) =>
    <String, dynamic>{
      'id': 'w1',
      'workNumber': 'PW-202607-0001',
      'title': 'Цахилгаан самбарын сарын үзлэг',
      'lifecycleStatus': 'STARTED',
      'effectiveStatus': 'STARTED',
      'totalQuantity': 10,
      'completedQuantity': 0,
      'remainingQuantity': 10,
      'progressPercent': 0,
      'taskCount': 0,
      'assignedEmployees': employees,
      if (team != null) 'assignedTeam': team,
      'availableActions': <dynamic>[],
      'tasks': <dynamic>[],
      'materials': <dynamic>[],
      'floorProgress': <dynamic>[],
    };

const String _meId = '6a6a1dc9cf308958351efe23';
const String _myTeam = '6a6a1dc9cf308958351efe13';
const String _otherId = '6a6a1dc9cf308958351efe19';
const String _otherTeam = '6a6a1dc9cf308958351efe0f';

WorkIdentity _identity({String? teamId = _myTeam}) => ResolvedWorkIdentity(
      employeeId: _meId,
      employeeCode: 'EMP-0003',
      fullName: 'Пүрэв Сараа',
      teamId: teamId,
    );

/// The seeded TECHNICIAN set, as the live backend reports it after
/// `migrate:technician-permissions` — four planned-work keys, none of them oversight.
const WorkGrants _technician = WorkGrants(<String>{
  'planned_work.view',
  'planned_work.change_status',
  'planned_work.record_progress',
  'planned_work.submit_report',
});

void main() {
  test('no code path asks for the employee directory', () {
    // A source-level guard, because this is a requirement about what the app does NOT
    // do and no render check can prove an absence. `GET /employees` and
    // `GET /employees/:id` are 403 for a technician on the hardened API — verified
    // live against the dev backend — so a reintroduced call would not fail loudly in
    // a unit test; it would fail in the field, on the one tab a technician opens
    // first.
    final List<String> offenders = <String>[];

    for (final FileSystemEntity entity
        in Directory('lib').listSync(recursive: true)) {
      if (entity is! File || !entity.path.endsWith('.dart')) continue;

      final List<String> lines = entity.readAsLinesSync();
      for (int i = 0; i < lines.length; i++) {
        final String line = lines[i];
        // Doc comments discuss the removed search on purpose; only code counts.
        final String code = line.trimLeft();
        if (code.startsWith('//') || code.startsWith('///')) continue;
        if (!code.contains("'/employees")) continue;
        // The one endpoint that is allowed.
        if (code.contains("'/employees/me'")) continue;
        offenders.add('${entity.path}:${i + 1}: ${line.trim()}');
      }
    }

    expect(
      offenders,
      isEmpty,
      reason: 'only /employees/me may be requested; found: $offenders',
    );
  });

  group('GET /employees/me parses into every tab that reads it', () {
    test('the Профайл model reads the whole card', () {
      final EmployeeProfile profile = EmployeeProfileModel.fromJson(_me());

      expect(profile.id, _meId);
      expect(profile.employeeCode, 'EMP-0003');
      // Surname first, as Mongolian records are read.
      expect(profile.displayName, 'Пүрэв Сараа');
      expect(profile.email, 'p.saraa@monhorus.mn');
      expect(profile.team?.name, 'Б баг');
      expect(profile.position?.name, 'Цахилгаанчин');
      expect(profile.status, EmployeeRecordStatus.active);
      expect(profile.employeeType, EmployeeKind.fullTime);
      expect(profile.qualificationLevel, QualificationLevel.middle);
      expect(profile.safetyGrade, 'III');
      expect(profile.skills, <String>['Цахилгаан', 'Гэрэлтүүлэг']);
      expect(profile.hasDriverLicense, isTrue);
      expect(profile.gpsVerificationEnabled, isFalse);
      expect(profile.workload.activeAssignments, 2);
      expect(profile.workload.completedAssignments, 11);
      expect(profile.workload.openServiceRequests, 1);
      // `photoUrl` is an API path; only the trailing file id is usable, because the
      // bytes are fetched through the Bearer-carrying client.
      expect(profile.photoFileId, '6a6a1dc9cf308958351eff01');
    });

    test('the Ажил model reads the team the assignment scope turns on', () {
      final work.EmployeeDetailModel employee =
          work.EmployeeDetailModel.fromJson(_me());

      expect(employee.id, _meId);
      expect(employee.fullName, 'Пүрэв Сараа');
      expect(employee.teamId, _myTeam);
      expect(employee.teamName, 'Б баг');
      expect(employee.positionName, 'Цахилгаанчин');
    });

    test('the Нүүр model reads the workload the tab scopes to one person', () {
      final home.EmployeeDetailModel employee =
          home.EmployeeDetailModel.fromJson(_me());

      expect(employee.id, _meId);
      expect(employee.displayName, 'Пүрэв Сараа');
      expect(employee.departmentName, 'Техник үйлчилгээ');
      expect(employee.workload?.completedAssignments, 11);
    });

    test('the Хуанли model reads the label it puts on the month', () {
      final calendar.EmployeeDetailModel employee =
          calendar.EmployeeDetailModel.fromJson(_me());

      expect(employee.id, _meId);
      expect(employee.employeeCode, 'EMP-0003');
      expect(employee.displayName, 'Пүрэв Сараа');
    });
  });

  group('assignment scope mirrors the backend rule', () {
    test('a technician named on the work may act', () {
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          employees: <Map<String, dynamic>>[
            <String, dynamic>{'id': _meId, 'name': 'Пүрэв Сараа'},
          ],
        )),
        identity: _identity(),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.assigned);
      expect(decision.blocksWrites, isFalse);
    });

    test('a technician whose team owns the work may act', () {
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          employees: <Map<String, dynamic>>[
            <String, dynamic>{'id': _otherId, 'name': 'Батаа Энхтөр'},
          ],
          team: <String, dynamic>{'id': _myTeam, 'name': 'Б баг'},
        )),
        identity: _identity(),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.assigned);
    });

    test('a technician named nowhere on the work is blocked', () {
      // This is the live case: PW-202607-0001 on the dev backend is assigned to
      // Батаа Энхтөр and Дорж Ganbold with no team, and the server answers a
      // transition from EMP-0003 with 403 FORBIDDEN.
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          employees: <Map<String, dynamic>>[
            <String, dynamic>{'id': _otherId, 'name': 'Батаа Энхтөр'},
          ],
        )),
        identity: _identity(),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.notAssigned);
      expect(decision.blocksWrites, isTrue);
    });

    test('another team owning the work does not admit this technician', () {
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          team: <String, dynamic>{'id': _otherTeam, 'name': 'А баг'},
        )),
        identity: _identity(),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.notAssigned);
    });

    test('two null teams never match', () {
      // The backend is explicit that a work with no team must not admit every
      // teamless technician. A client mirror that compared null to null would offer
      // controls on every unassigned job in the company.
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work()),
        identity: _identity(teamId: null),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.notAssigned);
    });

    test('an account with no employee card is blocked, not waved through', () {
      // Null `employeeId` is "no record", never "any record" — the same reading the
      // backend gives it.
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          employees: <Map<String, dynamic>>[
            <String, dynamic>{'id': _otherId, 'name': 'Батаа Энхтөр'},
          ],
        )),
        identity: const UnresolvedWorkIdentity(WorkIdentityProblem.notLinked),
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.notAssigned);
    });

    test('an oversight permission lifts the scope', () {
      const WorkGrants dispatcher = WorkGrants(<String>{
        PermissionKeys.plannedWorkView,
        PermissionKeys.dispatchAssign,
      });

      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work()),
        identity: const UnresolvedWorkIdentity(WorkIdentityProblem.notLinked),
        grants: dispatcher,
      );

      expect(decision, PlannedWorkAssignment.unrestricted);
      expect(decision.blocksWrites, isFalse);
    });

    test('another *doing* permission does not lift the scope', () {
      // The mirror of the backend's own guard: acquiring a fifth technician key is
      // not a promotion, and must not dissolve the restriction.
      const WorkGrants busyTechnician = WorkGrants(<String>{
        PermissionKeys.plannedWorkView,
        PermissionKeys.plannedWorkChangeStatus,
        PermissionKeys.plannedWorkRecordProgress,
        PermissionKeys.plannedWorkSubmitReport,
        PermissionKeys.objectMasterAssess,
        PermissionKeys.serviceRequestUpdate,
      });

      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work(
          employees: <Map<String, dynamic>>[
            <String, dynamic>{'id': _otherId, 'name': 'Батаа Энхтөр'},
          ],
        )),
        identity: _identity(),
        grants: busyTechnician,
      );

      expect(decision, PlannedWorkAssignment.notAssigned);
    });

    test('an unknown permission set asserts nothing', () {
      // Between login and the first /auth/me the set is empty. Narrowing the UI here
      // would hide controls from a dispatcher for the first frames of a session.
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work()),
        identity: _identity(),
        grants: const WorkGrants(<String>{}),
      );

      expect(decision, PlannedWorkAssignment.unrestricted);
    });

    test('a still-resolving identity asserts nothing', () {
      final PlannedWorkAssignment decision = resolvePlannedWorkAssignment(
        work: PlannedWorkModel.fromJson(_work()),
        identity: null,
        grants: _technician,
      );

      expect(decision, PlannedWorkAssignment.unrestricted);
    });
  });
}
