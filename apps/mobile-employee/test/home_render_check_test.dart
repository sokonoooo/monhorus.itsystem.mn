// Hermetic checks for the Нүүр tab: no network, fixed payloads.
//
// Two things are pinned here, and both are about the same sentence — "МИНИЙ АЖИЛ".
//
//   * The hero figures count the reader's OWN work. `GET /service-requests` answers a
//     technician with the unclaimed queue as well as their own rows, because the read
//     passes `includeUnclaimed: true` server-side so that the Ажил tab's "Нээлттэй"
//     segment and `POST /:id/claim` have something to work with. Counting that queue
//     as the reader's inflated every figure on the dark band with work nobody had
//     taken.
//   * The schedule CTA under the agenda is gone. It was a third route to a screen the
//     header button reaches from every tab.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/home/data/models/employee_model.dart';
import 'package:monhorus_employee/features/employee/home/data/models/work_models.dart';
import 'package:monhorus_employee/features/employee/home/domain/entities/employee_identity.dart';
import 'package:monhorus_employee/features/employee/home/presentation/providers/home_providers.dart';
import 'package:monhorus_employee/features/employee/home/presentation/screens/home_tab_screen.dart';

/// The reader: employee `e1`, in team `team-a`.
final EmployeeDetailModel _me = EmployeeDetailModel.fromJson(<String, dynamic>{
  'id': 'e1',
  'employeeCode': 'EMP-0002',
  'firstName': 'Дорж',
  'lastName': 'Ganbold',
  'team': <String, dynamic>{'id': 'team-a', 'name': 'А баг'},
  'workload': <String, dynamic>{
    'activeAssignments': 2,
    'completedAssignments': 11,
    'openServiceRequests': 1,
  },
});

const AppUser _user = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'planned_work.view', 'service_request.view'},
);

/// One row of `GET /service-requests`. Unassigned unless told otherwise, which is the
/// server's own definition of the open queue: no employee AND no team.
ServiceRequestListItemModel _request({
  required String id,
  required String status,
  List<Map<String, dynamic>> assignedEmployees = const <Map<String, dynamic>>[],
  Map<String, dynamic>? assignedTeam,
  String? slaState,
}) =>
    ServiceRequestListItemModel.fromJson(<String, dynamic>{
      'id': id,
      'requestNumber': id,
      'requestType': 'REPAIR',
      'isUrgent': false,
      'status': status,
      'slaState': slaState,
      'slaDueAt': '2026-07-30T02:00:00.000Z',
      'slaRemainingMinutes': 60,
      'assignedEmployees': assignedEmployees,
      if (assignedTeam != null) 'assignedTeam': assignedTeam,
      'createdAt': '2026-07-30T01:00:00.000Z',
    });

HomeOverview _overview({
  required List<ServiceRequestListItemModel> requests,
  EmployeeIdentity? identity,
}) =>
    HomeOverview(
      identity: identity ?? ResolvedEmployeeIdentity(_me),
      dashboard: null,
      plannedWork: const <PlannedWorkListItemModel>[],
      requests: requests,
      agenda: const <CalendarEventModel>[],
      agendaScoped: true,
      notices: const <String>[],
      failure: null,
    );

void main() {
  group('the hero figures exclude work nobody has taken', () {
    test('an unclaimed request is not counted as the reader\'s', () {
      final HomeOverview overview = _overview(
        requests: <ServiceRequestListItemModel>[
          // Mine, by name.
          _request(
            id: 'SR-1',
            status: 'IN_PROGRESS',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
            ],
          ),
          // Mine, through my team and naming nobody — the union the server enforces.
          _request(
            id: 'SR-2',
            status: 'ASSIGNED',
            assignedTeam: <String, dynamic>{'id': 'team-a', 'name': 'А баг'},
            slaState: 'BREACHED',
          ),
          // The open queue. Three of them, so an off-by-one cannot pass by accident.
          _request(id: 'SR-3', status: 'NEW', slaState: 'BREACHED'),
          _request(id: 'SR-4', status: 'UNASSIGNED'),
          _request(id: 'SR-5', status: 'NEW'),
          // A colleague's.
          _request(
            id: 'SR-6',
            status: 'IN_PROGRESS',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e-other', 'name': 'Пүрэв Сараа'},
            ],
          ),
        ],
      );

      // Two rows are the reader's; the list holds six.
      expect(overview.assignedRequests.length, 2);
      expect(overview.activeCount, 2);
      expect(overview.inProgressCount, 1);
      // SR-3 is breached too, and belongs to nobody.
      expect(overview.overdueCount, 1);
    });

    test('an unlinked account counts none of them as its own', () {
      final HomeOverview overview = _overview(
        identity: const UnresolvedEmployeeIdentity(
          EmployeeIdentityProblem.notLinked,
        ),
        requests: <ServiceRequestListItemModel>[
          _request(id: 'SR-1', status: 'NEW'),
          _request(
            id: 'SR-2',
            status: 'ASSIGNED',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
            ],
          ),
        ],
      );

      // Nothing to compare against, so nothing is claimed as the reader's — and the
      // screen already says why for this account.
      expect(overview.assignedRequests, isEmpty);
      expect(overview.activeCount, 0);
    });

    test('the urgent section still surfaces the open queue', () {
      final HomeOverview overview = _overview(
        requests: <ServiceRequestListItemModel>[
          _request(id: 'SR-3', status: 'NEW', slaState: 'BREACHED'),
        ],
      );

      // Deliberately not filtered: "Яаралтай анхаарах" does not claim the rows are
      // the reader's, and an unclaimed request past its SLA is the single thing a
      // technician most needs to see. Counting it as theirs is the separate mistake.
      expect(overview.urgentItems, hasLength(1));
      expect(overview.activeCount, 0);
    });
  });

  testWidgets('the home page carries no schedule CTA', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          unreadNotificationCountProvider.overrideWith((Ref ref) async => 0),
          homeOverviewProvider.overrideWith(
            (Ref ref) async =>
                _overview(requests: const <ServiceRequestListItemModel>[]),
          ),
        ],
        child: const MaterialApp(home: HomeTabScreen()),
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 300));

    // The agenda section stays — it is the day itself, not a link to it.
    expect(find.text('ӨНӨӨДРИЙН ХУВААРЬ'), findsOneWidget);

    // The panel under it does not.
    expect(find.text('Өнөөдрийн хуваарь'), findsNothing);
    expect(find.text('Календарь харах'), findsNothing);

    // The way to the schedule is still there, once, in the header.
    expect(find.byTooltip('Миний хуваарь'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
