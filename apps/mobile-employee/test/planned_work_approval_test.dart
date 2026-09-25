// The approval gate, as this app has to see it.
//
// Three separate silences are asserted here, and every one of them looked like an
// empty screen rather than an error:
//
//   * `PLANNED_WORK_ACTIONS` carries eight actions and this app knew six, so
//     `fromWire` answered null for APPROVE and REJECT and the server's own
//     `availableActions` were dropped on the floor without a word.
//   * `OVERSIGHT_PERMISSIONS` carries seven keys and this app mirrored six. A
//     PENDING_APPROVAL work has an empty crew by construction, so a caller treated as
//     scoped can never match one: a dedicated approver held the permission, saw
//     nothing, and got no error.
//   * The home tab's planned-work vocabulary had eight of ten statuses, so a work
//     sitting in PENDING_APPROVAL or REJECTED rendered as nothing at all there.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/work/data/models/inspection_report_model.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/planned_work_detail_screen.dart';
import 'package:monhorus_employee/features/employee/home/domain/entities/work_enums.dart'
    as home;
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart'
    as work;

/// Every planned-work status the backend can put on the wire.
///
/// Transcribed from `PLANNED_WORK_EFFECTIVE_STATUSES` rather than from either Dart
/// enum, so a value missing from both copies is still caught.
const List<String> _everyStatus = <String>[
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'PLANNED',
  'STARTED',
  'PAUSED',
  'OVERDUE',
  'COMPLETED',
  'ARCHIVED',
  'CANCELLED',
];

void main() {
  group('the lifecycle actions the server can offer', () {
    test('APPROVE and REJECT survive fromWire instead of being dropped', () {
      expect(work.PlannedWorkAction.fromWire('APPROVE'), isNotNull);
      expect(work.PlannedWorkAction.fromWire('REJECT'), isNotNull);
    });

    test('both answer to planned_work.approve, not to change_status', () {
      expect(
        work.PlannedWorkAction.fromWire('APPROVE')!.permission,
        PermissionKeys.plannedWorkApprove,
      );
      expect(
        work.PlannedWorkAction.fromWire('REJECT')!.permission,
        PermissionKeys.plannedWorkApprove,
      );
    });

    test('APPROVE is marked as the one action that also names the crew', () {
      // `PLANNED_WORK_ACTION_RULES.APPROVE.assignsCrew` is true and nothing else
      // carries it. This app has no crew picker, so the flag is what keeps a button
      // that could only ever be refused off the screen.
      expect(work.PlannedWorkAction.fromWire('APPROVE')!.assignsCrew, isTrue);
      expect(work.PlannedWorkAction.fromWire('REJECT')!.assignsCrew, isFalse);
      for (final work.PlannedWorkAction action in work.PlannedWorkAction.values) {
        if (action == work.PlannedWorkAction.approve) continue;
        expect(action.assignsCrew, isFalse, reason: action.wireValue);
      }
    });
  });

  group('a dedicated approver is treated as oversight', () {
    test('planned_work.approve alone lifts the assignment scope', () {
      const WorkGrants approver =
          WorkGrants(<String>{PermissionKeys.plannedWorkApprove});

      expect(approver.hasPlannedWorkOversight, isTrue);
    });

    test('the read-only oversight keys still do not', () {
      // `READ_OVERSIGHT_PERMISSIONS` widens what an account may SEE. Mirroring it here
      // would draw buttons whose only outcome is a 403.
      for (final String key in <String>[
        'invoice.view',
        'report.view',
        'dispatch.view',
      ]) {
        expect(
          WorkGrants(<String>{key}).hasPlannedWorkOversight,
          isFalse,
          reason: key,
        );
      }
    });

    test('the four keys the field tier holds still do not', () {
      for (final String key in <String>[
        PermissionKeys.plannedWorkView,
        PermissionKeys.plannedWorkChangeStatus,
        PermissionKeys.plannedWorkRecordProgress,
        PermissionKeys.plannedWorkSubmitReport,
      ]) {
        expect(
          WorkGrants(<String>{key}).hasPlannedWorkOversight,
          isFalse,
          reason: key,
        );
      }
    });
  });

  group('one planned-work vocabulary, not two that disagree', () {
    test('every status the server can send is known on both tabs', () {
      for (final String wire in _everyStatus) {
        expect(home.PlannedWorkStatus.fromWire(wire), isNotNull, reason: wire);
        expect(
          work.PlannedWorkEffectiveStatus.fromWire(wire)?.wireValue,
          wire,
          reason: wire,
        );
      }
    });

    test('isFinished agrees across both copies, CANCELLED included', () {
      for (final String wire in _everyStatus) {
        expect(
          home.PlannedWorkStatus.fromWire(wire)!.isFinished,
          work.PlannedWorkEffectiveStatus.fromWire(wire)!.isFinished,
          reason: wire,
        );
      }

      // And the definition itself: called-off work is not work the day still owes.
      expect(home.PlannedWorkStatus.fromWire('CANCELLED')!.isFinished, isTrue);
      expect(home.PlannedWorkStatus.fromWire('PENDING_APPROVAL')!.isFinished, isFalse);
      expect(home.PlannedWorkStatus.fromWire('REJECTED')!.isFinished, isFalse);
    });

    test('isOutstanding agrees across both copies', () {
      for (final String wire in _everyStatus) {
        expect(
          home.PlannedWorkStatus.fromWire(wire)!.isOutstanding,
          work.PlannedWorkEffectiveStatus.fromWire(wire)!.isOpen,
          reason: wire,
        );
      }
    });
  });

  group('the approval gate on the detail screen', () {
    testWidgets('REJECT is a button and APPROVE is a sentence',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            currentUserProvider.overrideWithValue(_approver),
            workIdentityProvider
                .overrideWith((Ref ref) async => _someoneElse),
            plannedWorkDetailProvider.overrideWith(_PendingApproval.new),
            // The detail screen's second read. Stubbed for the same reason the render
            // checks stub it: a hermetic test has no server for it to reach.
            inspectionReportProvider.overrideWith(_NoInspectionReport.new),
          ],
          child: const MaterialApp(
            home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // REJECT needs nothing this app cannot collect: the key, and a reason the
      // transition sheet already prompts for.
      expect(find.text('Буцаах'), findsOneWidget);

      // APPROVE assigns the crew and this app has no crew picker, so the button that
      // could only ever return the server's refusal is not drawn — and the reader is
      // told where the decision is actually made rather than being shown nothing.
      // Nowhere on the screen is the word offered as a control. The banner's own title
      // is «Батлахдаа гүйцэтгэгчээ сонгоно», which is a different string, so an exact
      // match here catches a button drawn from the server's own «Батлах» label.
      expect(find.text('Батлах'), findsNothing);
      expect(find.text('Батлахдаа гүйцэтгэгчээ сонгоно'), findsOneWidget);
      expect(find.textContaining('вэб системээс'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('a caller without the key is offered neither and told nothing',
        (WidgetTester tester) async {
      await tester.binding.setSurfaceSize(const Size(390, 1600));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            currentUserProvider.overrideWithValue(_technician),
            workIdentityProvider
                .overrideWith((Ref ref) async => _someoneElse),
            plannedWorkDetailProvider.overrideWith(_PendingApproval.new),
            // The detail screen's second read. Stubbed for the same reason the render
            // checks stub it: a hermetic test has no server for it to reach.
            inspectionReportProvider.overrideWith(_NoInspectionReport.new),
          ],
          child: const MaterialApp(
            home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The permission gate is unchanged and comes first: an explanation of where
      // approval happens is only useful to somebody who may approve.
      expect(find.text('Буцаах'), findsNothing);
      expect(find.text('Батлахдаа гүйцэтгэгчээ сонгоно'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });
}

/// A work waiting on an approver, with the two actions the server offers on it.
///
/// The crew is EMPTY, which is not an omission in the fixture: `PLANNED_WORK_ACTION_RULES`
/// makes APPROVE the act that assigns one, so a PENDING_APPROVAL record has no assignee by
/// construction. That is exactly why the app must treat a caller holding
/// `planned_work.approve` as unscoped — see the oversight group above.
Map<String, dynamic> _pendingWork() => <String, dynamic>{
      'id': 'w1',
      'workNumber': 'PW-202609-0042',
      'title': 'Гэрэлтүүлгийн шугам солих',
      'lifecycleStatus': 'PENDING_APPROVAL',
      'effectiveStatus': 'PENDING_APPROVAL',
      'plannedEndDate': '2026-09-30T10:00:00.000Z',
      'totalQuantity': 10,
      'completedQuantity': 0,
      'remainingQuantity': 10,
      'taskCount': 0,
      'assignedEmployees': <dynamic>[],
      'availableActions': <dynamic>[
        <String, dynamic>{
          'action': 'APPROVE',
          'label': 'Батлах',
          'requiresReason': false,
          'targetStatus': 'PLANNED',
        },
        <String, dynamic>{
          'action': 'REJECT',
          'label': 'Буцаах',
          'requiresReason': true,
          'targetStatus': 'REJECTED',
        },
      ],
      'tasks': <dynamic>[],
    };

class _NoInspectionReport extends InspectionReportNotifier {
  @override
  Future<InspectionReportState> build(String plannedWorkId) async =>
      const InspectionReportState(
        report: null,
        readiness: InspectionReportReadinessModel(
          canGenerate: false,
          blockers: <InspectionReportBlocker>[
            InspectionReportBlocker.tasksIncomplete,
          ],
          outstandingTaskTitles: <String>[],
        ),
      );
}

class _PendingApproval extends PlannedWorkDetailNotifier {
  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async =>
      PlannedWorkModel.fromJson(_pendingWork());
}

/// Holds `planned_work.approve` and nothing that would have made them unscoped anyway —
/// the dedicated approver role the backend's own comment says nobody had built yet.
const AppUser _approver = AppUser(
  id: '6a6a1dc9cf308958351efe02',
  fullName: 'Бат Дорж',
  email: 'b.dorj@monhorus.mn',
  // A custom RBAC role, which is where a dedicated approver would come from: the tier
  // describes how an account was provisioned and never what it may do, which is why every
  // gate in this app is a capability test.
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    PermissionKeys.plannedWorkView,
    PermissionKeys.plannedWorkApprove,
  },
);

/// The seeded field tier: may look at the work, may not decide it.
const AppUser _technician = AppUser(
  id: '6a6a1dc9cf308958351efe03',
  fullName: 'Сараа Пүрэв',
  email: 'p.saraa@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    PermissionKeys.plannedWorkView,
    PermissionKeys.plannedWorkChangeStatus,
  },
);

/// An employee the record does not name — which every employee is, on a work whose crew
/// has not been chosen yet.
const ResolvedWorkIdentity _someoneElse = ResolvedWorkIdentity(
  employeeId: 'e9',
  employeeCode: 'EMP-0009',
  fullName: 'Бат Дорж',
);
