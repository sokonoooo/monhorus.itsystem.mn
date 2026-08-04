// Hermetic checks for the Нүүр tab: no network, fixed payloads.
//
// Four things are pinned here.
//
//   * The hero figures count the reader's OWN work. `GET /service-requests` answers a
//     technician with the unclaimed queue as well as their own rows, because the read
//     passes `includeUnclaimed: true` server-side so that the Ажил tab's "Нээлттэй"
//     segment and `POST /:id/claim` have something to work with. Counting that queue
//     as the reader's inflated every figure on the dark band with work nobody had
//     taken.
//   * "Яаралтай анхаарах" counts the same way. It used to run over the unfiltered list
//     on the argument that an unclaimed urgent call is what a technician most needs to
//     see; on a personal screen it read as the reader's own, so the pool is now the
//     Ажил tab's "Нээлттэй" segment's business and nothing else's.
//   * "Өнөөдрийн хуваарь" is what is LEFT of the day, so finished entries are struck
//     off — and a day worked through says so rather than claiming nothing was booked.
//   * Every row that names a record opens it, both kinds.
//   * The schedule CTA under the agenda is gone. It was a third route to a screen the
//     header button reaches from every tab.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/home/data/models/employee_model.dart';
import 'package:monhorus_employee/features/employee/home/data/models/work_models.dart';
import 'package:monhorus_employee/features/employee/home/domain/entities/employee_identity.dart';
import 'package:monhorus_employee/features/employee/home/presentation/providers/home_providers.dart';
import 'package:monhorus_employee/features/employee/home/presentation/screens/home_tab_screen.dart';
// `show` because the Ажил tab declares a `PlannedWorkListItemModel` of its own; the
// one this file builds rows from is the Нүүр tab's.
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart'
    show PlannedWorkModel;
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/planned_work_detail_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';

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
  String? deviceName,
}) =>
    ServiceRequestListItemModel.fromJson(<String, dynamic>{
      'id': id,
      'requestNumber': id,
      'requestType': 'REPAIR',
      'isUrgent': false,
      if (deviceName != null)
        'device': <String, dynamic>{'id': 'd-$id', 'name': deviceName},
      'status': status,
      'slaState': slaState,
      'slaDueAt': '2026-07-30T02:00:00.000Z',
      'slaRemainingMinutes': 60,
      'assignedEmployees': assignedEmployees,
      if (assignedTeam != null) 'assignedTeam': assignedTeam,
      'createdAt': '2026-07-30T01:00:00.000Z',
    });

/// One row of `GET /planned-work`, already the reader's: the endpoint bounds itself to
/// the caller's own and their team's work.
PlannedWorkListItemModel _work({
  required String id,
  required String number,
  required String title,
  String status = 'OVERDUE',
}) =>
    PlannedWorkListItemModel.fromJson(<String, dynamic>{
      'id': id,
      'workNumber': number,
      'title': title,
      'effectiveStatus': status,
      'plannedStartDate': '2026-07-29T01:00:00.000Z',
      'plannedEndDate': '2026-07-30T09:00:00.000Z',
      'progressPercent': 20,
      'taskCount': 3,
    });

/// One entry of `GET /calendar`, exactly as the day feed delivers it — `status` and
/// `sourceId` included, which is what the agenda now filters and routes on.
CalendarEventModel _event({
  required String sourceId,
  required String source,
  required String reference,
  required String title,
  required String status,
  String start = '2026-07-30T02:00:00.000Z',
}) =>
    CalendarEventModel.fromJson(<String, dynamic>{
      'id': '$source:$sourceId',
      'source': source,
      'sourceId': sourceId,
      'reference': reference,
      'title': title,
      'start': start,
      'end': '2026-07-30T09:00:00.000Z',
      'status': status,
      'statusLabel': status,
      'isOverdue': false,
      'isUrgent': false,
      'assignedNames': <dynamic>['Дорж Ganbold'],
      'customerName': 'Central Tower ХХК',
      'buildingName': 'Төв байр',
    });

HomeOverview _overview({
  List<ServiceRequestListItemModel> requests =
      const <ServiceRequestListItemModel>[],
  List<PlannedWorkListItemModel> plannedWork =
      const <PlannedWorkListItemModel>[],
  List<CalendarEventModel> agenda = const <CalendarEventModel>[],
  EmployeeIdentity? identity,
}) =>
    HomeOverview(
      identity: identity ?? ResolvedEmployeeIdentity(_me),
      dashboard: null,
      plannedWork: plannedWork,
      requests: requests,
      agenda: agenda,
      agendaScoped: true,
      notices: const <String>[],
      failure: null,
    );

/// Mounts the Нүүр tab over a fixed overview and a repository that answers every
/// detail read with a network failure.
///
/// The failure is the point: these checks are about WHICH screen a tap lands on, and a
/// detail screen that renders its error branch is still unambiguously that screen. It
/// also keeps the tests hermetic — nothing here may reach a Dio client.
Future<void> _pumpHome(WidgetTester tester, HomeOverview overview) async {
  await tester.binding.setSurfaceSize(const Size(390, 1400));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_user),
        unreadNotificationCountProvider.overrideWith((Ref ref) async => 0),
        homeOverviewProvider.overrideWith((Ref ref) async => overview),
        workRepositoryProvider.overrideWithValue(_DetailRepository()),
      ],
      child: const MaterialApp(home: HomeTabScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

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

  });

  group('"Яаралтай анхаарах" lists the reader\'s own work and nobody else\'s', () {
    test('an unclaimed request is left off and a team one is kept', () {
      final HomeOverview overview = _overview(
        requests: <ServiceRequestListItemModel>[
          // The open queue, breached. It used to head this section on every
          // technician's Нүүр; it belongs to the Ажил tab's "Нээлттэй" segment.
          _request(id: 'SR-3', status: 'NEW', slaState: 'BREACHED'),
          // Carried by the reader's team and naming nobody, which is half of the
          // union the server bounds the list with — the half a narrower filter drops.
          _request(
            id: 'SR-2',
            status: 'ASSIGNED',
            assignedTeam: <String, dynamic>{'id': 'team-a', 'name': 'А баг'},
            slaState: 'BREACHED',
          ),
          // A colleague's, and breached. Same read, same page, not this reader's.
          _request(
            id: 'SR-6',
            status: 'IN_PROGRESS',
            slaState: 'BREACHED',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e-other', 'name': 'Пүрэв Сараа'},
            ],
          ),
        ],
      );

      expect(
        overview.urgentItems.map((HomeUrgentItem item) => item.reference),
        <String>['SR-2'],
      );
    });

    test('an unlinked account is shown nobody\'s urgent work, not everybody\'s', () {
      final HomeOverview overview = _overview(
        identity: const UnresolvedEmployeeIdentity(
          EmployeeIdentityProblem.notLinked,
        ),
        requests: <ServiceRequestListItemModel>[
          _request(id: 'SR-3', status: 'NEW', slaState: 'BREACHED'),
        ],
      );

      // Nothing to compare the rows against, so nothing is claimed — the same answer
      // the hero figures give for this account, and the screen already says why.
      expect(overview.urgentItems, isEmpty);
    });
  });

  group('"Өнөөдрийн хуваарь" is what is left of the day', () {
    test('finished entries are struck off and the rest keep their order', () {
      final HomeOverview overview = _overview(
        agenda: <CalendarEventModel>[
          // Planned work, done. `ARCHIVED` is its second terminal state — the report
          // approved — and reads as finished for the same reason `COMPLETED` does.
          _event(
            sourceId: 'w-done',
            source: 'PLANNED_WORK',
            reference: 'PW-0001',
            title: 'Дууссан үзлэг',
            status: 'ARCHIVED',
            start: '2026-07-30T01:00:00.000Z',
          ),
          // A request called off. Not a result, but not remaining work either.
          _event(
            sourceId: 'r-off',
            source: 'SERVICE_REQUEST',
            reference: 'SR-0002',
            title: 'Цуцлагдсан дуудлага',
            status: 'CANCELLED',
            start: '2026-07-30T02:00:00.000Z',
          ),
          // Handed BACK to the technician. Terminal-looking and emphatically not done.
          _event(
            sourceId: 'r-again',
            source: 'SERVICE_REQUEST',
            reference: 'SR-0003',
            title: 'Дахин очих',
            status: 'REVISIT_REQUIRED',
            start: '2026-07-30T06:00:00.000Z',
          ),
          _event(
            sourceId: 'w-live',
            source: 'PLANNED_WORK',
            reference: 'PW-0004',
            title: 'Хэрэгжиж байна',
            status: 'STARTED',
            start: '2026-07-30T04:00:00.000Z',
          ),
        ],
      );

      // Two left, still earliest first: the filter did not cost the sort.
      expect(
        overview.sortedAgenda.map((CalendarEventModel e) => e.reference),
        <String>['PW-0004', 'SR-0003'],
      );
      expect(overview.agendaAllFinished, isFalse);
    });

    test('a day with work left on it is not "all finished"', () {
      expect(_overview().agendaAllFinished, isFalse);
    });

    testWidgets('a day worked through says so, not that nothing was booked', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        _overview(
          agenda: <CalendarEventModel>[
            _event(
              sourceId: 'w1',
              source: 'PLANNED_WORK',
              reference: 'PW-0001',
              title: 'Дууссан үзлэг',
              status: 'COMPLETED',
            ),
            _event(
              sourceId: 'r1',
              source: 'SERVICE_REQUEST',
              reference: 'SR-0002',
              title: 'Дууссан дуудлага',
              status: 'COMPLETED',
            ),
          ],
        ),
      );

      expect(find.text('Өнөөдрийн хуваарь бүрэн дууссан.'), findsOneWidget);
      // The sentence for a blank diary, which this day is not.
      expect(find.text('Өнөөдөр хуваарьт ажил алга байна.'), findsNothing);
      // And neither finished row is still standing in the list.
      expect(find.text('Дууссан үзлэг'), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an empty day still reads as an empty day', (
      WidgetTester tester,
    ) async {
      await _pumpHome(tester, _overview());

      expect(find.text('Өнөөдөр хуваарьт ажил алга байна.'), findsOneWidget);
      expect(find.text('Өнөөдрийн хуваарь бүрэн дууссан.'), findsNothing);
      expect(tester.takeException(), isNull);
    });
  });

  group('every row that names a record opens it', () {
    testWidgets('an urgent service-request row opens the request', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        _overview(
          requests: <ServiceRequestListItemModel>[
            _request(
              id: 'r-mine',
              status: 'ASSIGNED',
              slaState: 'BREACHED',
              deviceName: 'Лифт №2',
              assignedEmployees: <Map<String, dynamic>>[
                <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
              ],
            ),
          ],
        ),
      );

      await tester.tap(find.text('Лифт №2'));
      await tester.pumpAndSettle();

      expect(find.byType(ServiceRequestDetailScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an urgent planned-work row opens the planned work', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        _overview(
          plannedWork: <PlannedWorkListItemModel>[
            _work(
              id: 'w-late',
              number: 'PW-202607-0001',
              title: 'Хугацаа хэтэрсэн үзлэг',
            ),
          ],
        ),
      );

      // The row this section used to draw and then refuse to open.
      await tester.tap(find.text('Хугацаа хэтэрсэн үзлэг'));
      await tester.pumpAndSettle();

      expect(find.byType(PlannedWorkDetailScreen), findsOneWidget);
      expect(find.byType(ServiceRequestDetailScreen), findsNothing);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an agenda row opens the record it is a projection of', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        _overview(
          agenda: <CalendarEventModel>[
            _event(
              sourceId: 'w-agenda',
              source: 'PLANNED_WORK',
              reference: 'PW-202607-0009',
              title: 'Өнөөдрийн ажил',
              status: 'STARTED',
            ),
          ],
        ),
      );

      await tester.tap(find.text('Өнөөдрийн ажил'));
      await tester.pumpAndSettle();

      expect(find.byType(PlannedWorkDetailScreen), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('an agenda row with no source id is not tappable', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        _overview(
          agenda: <CalendarEventModel>[
            _event(
              sourceId: '',
              source: 'PLANNED_WORK',
              reference: 'PW-202607-0009',
              title: 'Ямар нэг ажил',
              status: 'STARTED',
            ),
          ],
        ),
      );

      await tester.tap(find.text('Ямар нэг ажил'));
      await tester.pumpAndSettle();

      // Nowhere to go, so nowhere was gone. The row is still drawn — it is real work,
      // it just carries no id — but it offers no ink and swallows nothing.
      expect(find.byType(PlannedWorkDetailScreen), findsNothing);
      expect(find.text('Ямар нэг ажил'), findsOneWidget);
      expect(tester.takeException(), isNull);
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

/// Answers every detail read with a network failure.
///
/// Standing in for the Ажил tab's repository so nothing in these checks can reach a
/// Dio client. The failure is deliberate: what is under test is which screen a tap
/// lands on, and a detail screen rendering its error branch is still that screen.
class _DetailRepository implements WorkRepository {
  @override
  Future<ApiResult<PlannedWorkModel>> getPlannedWork(String plannedWorkId) async =>
      const FailureResult<PlannedWorkModel>(NetworkFailure());

  @override
  Future<ApiResult<ServiceRequestDetailModel?>> getServiceRequestDetail(
    String requestId,
  ) async =>
      const FailureResult<ServiceRequestDetailModel?>(NetworkFailure());

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
