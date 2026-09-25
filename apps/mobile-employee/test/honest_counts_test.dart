// Figures that are counted rather than sampled, and days that are the server's.
//
// Every counter asserted here used to be a statement about a page. `limit: 100, page: 1`
// went out, the rows that came back were folded into "Идэвхтэй", "Хэтэрсэн" and
// «N ажил хугацаа хэтэрсэн», and `PaginatedData.total` — the one figure in the answer
// that did not depend on how much of it the app had read — was parsed by the transport
// and dropped by the caller.
//
// The other half is what «Өнөөдөр» means. The backend decides what falls due today
// against `env.APP_TIMEZONE` and publishes that zone on the dashboard and on every
// calendar result; the app built midnight out of `DateTime.now().toLocal()`, which is the
// handset's. The cases below fix one instant and two deadlines chosen so that the two
// server zones they are asserted under answer "both" and "neither" — while EVERY handset
// zone answers "one". Neither expectation can therefore be satisfied by coincidence of
// wherever the machine running them happens to be.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/core/network/paginated_data.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/home/data/models/employee_model.dart';
import 'package:monhorus_employee/features/employee/home/data/models/work_models.dart'
    as home;
import 'package:monhorus_employee/features/employee/home/domain/entities/employee_identity.dart';
import 'package:monhorus_employee/features/employee/home/presentation/providers/home_providers.dart';
import 'package:monhorus_employee/features/employee/home/presentation/screens/home_tab_screen.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/project_ui.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/risk_widgets.dart';
import 'package:monhorus_employee/features/employee/shared/server_day.dart';
import 'package:monhorus_employee/features/employee/shared/server_vocabulary.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';

// -- Fixtures -----------------------------------------------------------------

Map<String, dynamic> _work(String id, String status, {String? due}) =>
    <String, dynamic>{
      'id': id,
      'workNumber': id,
      'title': 'Ажил $id',
      'lifecycleStatus': 'STARTED',
      'effectiveStatus': status,
      if (due != null) 'plannedEndDate': due,
      'taskCount': 0,
      'assignedEmployees': <dynamic>[],
    };

Map<String, dynamic> _request(String id, {String? slaDueAt}) => <String, dynamic>{
      'id': id,
      'requestNumber': id,
      'status': 'IN_PROGRESS',
      'priority': 'STANDARD',
      if (slaDueAt != null) 'slaDueAt': slaDueAt,
      'assignedEmployees': <dynamic>[
        <String, dynamic>{'id': 'e1', 'name': 'Сараа'},
      ],
    };

Map<String, dynamic> _band(
  String level,
  String label,
  String colour,
  int min,
  int max,
) =>
    <String, dynamic>{
      'level': level,
      'label': label,
      'colour': colour,
      'min': min,
      'max': max,
    };

/// A six-band ladder, as `GET /vocabulary` emits one: highest score first, with a spare
/// configured between SCHEDULE_REPAIR and CRITICAL.
Map<String, dynamic> _sixBandLadder() => <String, dynamic>{
      'requestStages': <Map<String, dynamic>>[],
      'riskBands': <Map<String, dynamic>>[
        _band('NORMAL', 'Хэвийн', 'green', 81, 100),
        _band('ATTENTION', 'Анхаарах шаардлагатай', 'yellow', 61, 80),
        _band('SCHEDULE_REPAIR', 'Ойрын хугацаанд засварлах', 'orange', 51, 60),
        _band('BAND_6', 'Хяналтад авах', 'purple', 41, 50),
        _band('CRITICAL', 'Ноцтой эрсдэлтэй', 'red', 21, 40),
        _band('OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'black', 0, 20),
      ],
    };

const ResolvedWorkIdentity _me = ResolvedWorkIdentity(
  employeeId: 'e1',
  employeeCode: 'E-001',
  fullName: 'Сараа Пүрэв',
);

/// A [WorkRepository] that serves the two list reads in pages, the way the real one does.
///
/// Everything else is left to [noSuchMethod]: this fake exists for one question — does
/// the caller read past page one — and a method it stubs is a method a test could
/// accidentally lean on.
class _PagedWorkRepository implements WorkRepository {
  _PagedWorkRepository({
    this.plannedWorkPages = const <List<Map<String, dynamic>>>[],
    this.requestPages = const <List<Map<String, dynamic>>>[],
    this.claimedTotalPages,
  });

  final List<List<Map<String, dynamic>>> plannedWorkPages;
  final List<List<Map<String, dynamic>>> requestPages;

  /// What the server CLAIMS `totalPages` is, when that has to differ from the number of
  /// pages actually served — which is how a runaway `totalPages` is exercised.
  final int? claimedTotalPages;

  /// The page numbers asked for, so "it read past the first" is measured, not assumed.
  final List<int> plannedWorkPagesRequested = <int>[];
  final List<int> requestPagesRequested = <int>[];

  int _total(List<List<Map<String, dynamic>>> pages) =>
      pages.fold(0, (int sum, List<Map<String, dynamic>> p) => sum + p.length);

  List<Map<String, dynamic>> _slice(
    List<List<Map<String, dynamic>>> pages,
    int page,
  ) =>
      page >= 1 && page <= pages.length
          ? pages[page - 1]
          : const <Map<String, dynamic>>[];

  @override
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork({
    String? employeeId,
    String? teamId,
    PlannedWorkEffectiveStatus? status,
    String? search,
    int page = 1,
  }) async {
    plannedWorkPagesRequested.add(page);
    return Success<PaginatedData<PlannedWorkListItemModel>>(
      PaginatedData<PlannedWorkListItemModel>(
        items: _slice(plannedWorkPages, page)
            .map(PlannedWorkListItemModel.fromJson)
            .toList(growable: false),
        page: page,
        limit: 100,
        total: _total(plannedWorkPages),
        totalPages: claimedTotalPages ?? plannedWorkPages.length,
      ),
    );
  }

  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listAssignedServiceRequests({int page = 1}) async {
    requestPagesRequested.add(page);
    return Success<PaginatedData<ServiceRequestListItemModel>>(
      PaginatedData<ServiceRequestListItemModel>(
        items: _slice(requestPages, page)
            .map(ServiceRequestListItemModel.fromJson)
            .toList(growable: false),
        page: page,
        limit: 100,
        total: _total(requestPages),
        totalPages: claimedTotalPages ?? requestPages.length,
      ),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// A technician whose effective set carries the key the request reads are gated on.
const AppUser _technician = AppUser(
  id: '6a6a1dc9cf308958351efe01',
  fullName: 'Сараа Пүрэв',
  email: 'p.saraa@monhorus.mn',
  phone: '8811-9922',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    PermissionKeys.plannedWorkView,
    PermissionKeys.serviceRequestView,
  },
);

ProviderContainer _container(_PagedWorkRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(_technician),
      workRepositoryProvider.overrideWithValue(repository),
      workIdentityProvider.overrideWith((Ref ref) async => _me),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  // Both holders are process-wide, so one case's server must not be the next case's
  // starting point.
  setUp(() {
    resetServerTimezone();
    resetServerVocabulary();
  });
  tearDown(() {
    resetServerTimezone();
    resetServerVocabulary();
  });

  group('a count is over every row, not over the first page', () {
    test('an overdue count spanning two pages is the whole count', () async {
      final _PagedWorkRepository repository = _PagedWorkRepository(
        plannedWorkPages: <List<Map<String, dynamic>>>[
          <Map<String, dynamic>>[
            for (int i = 0; i < 100; i++) _work('p1-$i', 'OVERDUE'),
          ],
          <Map<String, dynamic>>[
            for (int i = 0; i < 5; i++) _work('p2-$i', 'OVERDUE'),
          ],
        ],
      );

      final PlannedWorkBoard board =
          await _container(repository).read(plannedWorkBoardProvider.future);

      expect(repository.plannedWorkPagesRequested, <int>[1, 2]);
      expect(board.overdue.length, 105);
      expect(board.openCount, 105);
      expect(board.isComplete, isTrue);
      expect(board.serverTotal, 105);
    });

    test('the reader\'s own requests are counted past the first page', () async {
      final _PagedWorkRepository repository = _PagedWorkRepository(
        requestPages: <List<Map<String, dynamic>>>[
          <Map<String, dynamic>>[
            for (int i = 0; i < 100; i++) _request('p1-$i'),
          ],
          <Map<String, dynamic>>[
            for (int i = 0; i < 7; i++) _request('p2-$i'),
          ],
        ],
      );

      final AssignedRequests requests =
          await _container(repository).read(assignedRequestsProvider.future);

      expect(repository.requestPagesRequested, <int>[1, 2]);
      expect(requests.activeCount, 107);
      expect(requests.isComplete, isTrue);
    });

    test('a runaway totalPages stops at the guard and says the count is partial',
        () async {
      // A server claiming nine hundred pages while serving three. Without the guard this
      // is an unbounded loop on a phone; with it, the answer is short AND says so.
      final _PagedWorkRepository repository = _PagedWorkRepository(
        plannedWorkPages: <List<Map<String, dynamic>>>[
          for (int page = 0; page < 3; page++)
            <Map<String, dynamic>>[_work('w-$page', 'OVERDUE')],
        ],
        claimedTotalPages: 900,
      );

      final PlannedWorkBoard board =
          await _container(repository).read(plannedWorkBoardProvider.future);

      // Twenty reads and no more. The pages past the third are empty, and an empty page
      // is what ends the walk, so the loop stops well before the claim runs out.
      expect(repository.plannedWorkPagesRequested.length, lessThanOrEqualTo(20));
      expect(board.serverTotal, 3);
    });
  });

  group('«Өнөөдөр» is the server\'s day, not the handset\'s', () {
    // One instant, two deadlines, and three different answers depending on whose day it
    // is. 20:00 UTC on the 4th:
    //
    //   * Asia/Dubai (+04) is still on the 4th, so its day ends at 19:59:59.999Z on the
    //     5th and BOTH deadlines fall inside it — two.
    //   * Etc/UTC ends its day at 23:59:59.999Z on the 4th, so NEITHER does — nought.
    //
    // Every offset in between lands on one, which is what the machine running this test
    // would answer from its own zone. The two expectations therefore cannot both be
    // satisfied by any handset zone at all, whatever the CI box is set to.
    final DateTime now = DateTime.utc(2026, 9, 4, 20);
    const String earlyOnTheFifth = '2026-09-05T08:00:00.000Z';
    const String lateOnTheFifth = '2026-09-05T19:00:00.000Z';

    test('the boundary itself moves with the installed zone', () {
      installServerTimezone('Asia/Dubai');
      expect(serverTimezoneIsKnown, isTrue);
      expect(isDueByEndOfServerDay(DateTime.parse(earlyOnTheFifth), now: now), isTrue);
      expect(isDueByEndOfServerDay(DateTime.parse(lateOnTheFifth), now: now), isTrue);

      resetServerTimezone();
      installServerTimezone('Etc/UTC');
      expect(isDueByEndOfServerDay(DateTime.parse(earlyOnTheFifth), now: now), isFalse);
      expect(isDueByEndOfServerDay(DateTime.parse(lateOnTheFifth), now: now), isFalse);
    });

    test('the planned board counts «Өнөөдөр» against the installed zone', () async {
      final _PagedWorkRepository repository = _PagedWorkRepository(
        plannedWorkPages: <List<Map<String, dynamic>>>[
          <Map<String, dynamic>>[
            _work('w1', 'PLANNED', due: earlyOnTheFifth),
            _work('w2', 'PLANNED', due: lateOnTheFifth),
          ],
        ],
      );
      final PlannedWorkBoard board =
          await _container(repository).read(plannedWorkBoardProvider.future);

      installServerTimezone('Asia/Dubai');
      expect(board.dueTodayCount(now: now), 2);

      resetServerTimezone();
      installServerTimezone('Etc/UTC');
      expect(board.dueTodayCount(now: now), 0);
    });

    test('the request strip counts «Өнөөдөр» against the installed zone', () async {
      final _PagedWorkRepository repository = _PagedWorkRepository(
        requestPages: <List<Map<String, dynamic>>>[
          <Map<String, dynamic>>[
            _request('r1', slaDueAt: earlyOnTheFifth),
            _request('r2', slaDueAt: lateOnTheFifth),
          ],
        ],
      );
      final AssignedRequests requests =
          await _container(repository).read(assignedRequestsProvider.future);

      installServerTimezone('Asia/Dubai');
      expect(requests.dueTodayCount(now: now), 2);

      resetServerTimezone();
      installServerTimezone('Etc/UTC');
      expect(requests.dueTodayCount(now: now), 0);
    });

    test('a bare "UTC" resolves, though the bundled database files it as Etc/UTC', () {
      installServerTimezone('UTC');
      expect(serverTimezoneIsKnown, isTrue);
      expect(isDueByEndOfServerDay(DateTime.parse(earlyOnTheFifth), now: now), isFalse);
    });

    test('a zone this build has never heard of leaves the handset in charge', () {
      installServerTimezone('Mars/Olympus_Mons');
      expect(serverTimezoneIsKnown, isFalse);
      expect(serverTimezone, isNull);

      // And the fallback is the arithmetic the counters used to do inline, so an app that
      // never reached the server reads exactly as it always did.
      final DateTime local = now.toLocal();
      expect(
        endOfServerDay(at: now),
        DateTime(local.year, local.month, local.day, 23, 59, 59, 999),
      );
    });

    test('an empty zone name is ignored rather than installed over a good one', () {
      installServerTimezone('Asia/Ulaanbaatar');
      installServerTimezone('');
      installServerTimezone(null);
      expect(serverTimezone, 'Asia/Ulaanbaatar');
    });
  });

  group('a truncated read is disclosed rather than printed as a fact', () {
    /// The Нүүр tab over a fixed overview. The hero sentence and the stair are the two
    /// places a partial count reaches the reader as a number.
    Future<void> pumpHome(WidgetTester tester, HomeOverview overview) async {
      await tester.binding.setSurfaceSize(const Size(390, 1400));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        ProviderScope(
          overrides: <Override>[
            currentUserProvider.overrideWithValue(_technician),
            unreadNotificationCountProvider.overrideWith((Ref ref) async => 0),
            homeOverviewProvider.overrideWith((Ref ref) async => overview),
          ],
          child: const MaterialApp(home: HomeTabScreen()),
        ),
      );
      await tester.pumpAndSettle();
    }

    HomeOverview overview({required bool isComplete}) => HomeOverview(
          identity: ResolvedEmployeeIdentity(
            EmployeeDetailModel.fromJson(<String, dynamic>{
              'id': 'e1',
              'employeeCode': 'EMP-0002',
              'firstName': 'Сараа',
              'lastName': 'Пүрэв',
            }),
          ),
          dashboard: null,
          plannedWork: <home.PlannedWorkListItemModel>[
            home.PlannedWorkListItemModel.fromJson(
                _work('w1', 'OVERDUE', due: '2026-01-01T00:00:00.000Z')),
            home.PlannedWorkListItemModel.fromJson(
                _work('w2', 'OVERDUE', due: '2026-01-01T00:00:00.000Z')),
          ],
          requests: const <home.ServiceRequestListItemModel>[],
          agenda: const <home.CalendarEventModel>[],
          agendaScoped: true,
          notices: const <String>[],
          failure: null,
          isComplete: isComplete,
          plannedWorkTotal: isComplete ? 2 : 900,
        );

    testWidgets('a complete read states the figure outright',
        (WidgetTester tester) async {
      await pumpHome(tester, overview(isComplete: true));

      expect(find.text('2 ажил хугацаа хэтэрсэн'), findsOneWidget);
      expect(find.text('2'), findsWidgets);
    });

    testWidgets('a partial read says «Дор хаяж» and marks the stair figure',
        (WidgetTester tester) async {
      await pumpHome(tester, overview(isComplete: false));

      // The sentence stops asserting a count it cannot make.
      expect(find.text('2 ажил хугацаа хэтэрсэн'), findsNothing);
      expect(find.text('Дор хаяж 2 ажил хугацаа хэтэрсэн'), findsOneWidget);
      // And the figure beside «ХУГАЦАА ХЭТЭРСЭН» carries the same qualification, since
      // there is no room for a sentence in a stair.
      expect(find.text('2+'), findsWidgets);
      expect(find.text('2'), findsNothing);
    });

    testWidgets('a partial read with nothing found does not claim an empty plate',
        (WidgetTester tester) async {
      await pumpHome(
        tester,
        HomeOverview(
          identity: ResolvedEmployeeIdentity(
            EmployeeDetailModel.fromJson(<String, dynamic>{'id': 'e1'}),
          ),
          dashboard: null,
          plannedWork: const <home.PlannedWorkListItemModel>[],
          requests: const <home.ServiceRequestListItemModel>[],
          agenda: const <home.CalendarEventModel>[],
          agendaScoped: true,
          notices: const <String>[],
          failure: null,
          isComplete: false,
        ),
      );

      expect(find.text('Хүлээгдэж буй ажил алга байна'), findsNothing);
      expect(find.text('Ачааллыг бүрэн уншиж чадсангүй'), findsOneWidget);
    });
  });

  group('the risk strip adds up on a ladder with a spare band', () {
    /// Four bands hold devices, one of them a configured spare, plus one never assessed.
    RiskSummaryModel summary() => RiskSummaryModel.fromJson(<String, dynamic>{
          'counts': <Map<String, dynamic>>[
            <String, dynamic>{'level': 'NORMAL', 'count': 4},
            <String, dynamic>{'level': 'ATTENTION', 'count': 3},
            <String, dynamic>{'level': 'BAND_6', 'count': 5},
            <String, dynamic>{'level': 'CRITICAL', 'count': 2},
          ],
          'unassessedCount': 1,
          'hasCritical': true,
        });

    test('the three roll-ups partition the ladder', () {
      installServerVocabulary(ServerVocabulary.fromJson(_sixBandLadder()));
      final RiskBandGroups groups = riskBandGroups();

      expect(groups.all, riskBandsInUse());
      expect(groups.normal, <RiskLevel>[RiskLevel.normal]);
      expect(groups.attention, <RiskLevel>[
        RiskLevel.attention,
        RiskLevel.scheduleRepair,
        RiskLevel.band6,
      ]);
      expect(groups.critical, <RiskLevel>[
        RiskLevel.critical,
        RiskLevel.outOfService,
      ]);
    });

    test('on the shipped five-band ladder the groups are what they always were', () {
      // No vocabulary installed: the compiled default. The rewrite must not move a single
      // device on an installation that has configured nothing.
      final RiskBandGroups groups = riskBandGroups();
      expect(groups.normal, <RiskLevel>[RiskLevel.normal]);
      expect(groups.attention,
          <RiskLevel>[RiskLevel.attention, RiskLevel.scheduleRepair]);
      expect(groups.critical,
          <RiskLevel>[RiskLevel.critical, RiskLevel.outOfService]);
    });

    test('the counts sum to the total', () {
      installServerVocabulary(ServerVocabulary.fromJson(_sixBandLadder()));
      final RiskSummaryModel model = summary();

      expect(model.total, 15);
      expect(
        model.normalCount +
            model.attentionCount +
            model.criticalCount +
            model.unassessedCount,
        model.total,
      );
      // The spare is inside the attention roll-up rather than counted by nobody.
      expect(model.attentionCount, 8);
    });

    testWidgets('the four cards on screen sum to the total they print',
        (WidgetTester tester) async {
      installServerVocabulary(ServerVocabulary.fromJson(_sixBandLadder()));

      await tester.binding.setSurfaceSize(const Size(390, 900));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: RiskMetricGrid(summary: summary())),
        ),
      );
      await tester.pump();

      final List<MetricCard> cards = tester
          .widgetList<MetricCard>(find.byType(MetricCard))
          .toList(growable: false);

      expect(cards, hasLength(4));
      final int printed = cards.fold(
        0,
        (int sum, MetricCard card) => sum + int.parse(card.value),
      );
      expect(printed, 15);
      expect(find.text('Нийт 15'), findsOneWidget);

      // And the spare band is named on the card that counts it, under the administrator's
      // own name for it, rather than the strip quietly rolling up five hardcoded keys.
      expect(
        cards[1].note,
        'Анхаарах шаардлагатай, Ойрын хугацаанд засварлах, Хяналтад авах',
      );
    });

    test('a band configured below CRITICAL raises the alert banner\'s test', () {
      // BAND_6 at the bottom of the ladder: a worse condition than OUT_OF_SERVICE by the
      // only measure the server publishes, the score. It used to raise nothing, because
      // the test was `critical || outOfService` by name.
      installServerVocabulary(
        ServerVocabulary.fromJson(<String, dynamic>{
          'requestStages': <Map<String, dynamic>>[],
          'riskBands': <Map<String, dynamic>>[
            _band('NORMAL', 'Хэвийн', 'green', 81, 100),
            _band('ATTENTION', 'Анхаарах', 'yellow', 41, 80),
            _band('CRITICAL', 'Ноцтой', 'red', 21, 40),
            _band('OUT_OF_SERVICE', 'Боломжгүй', 'black', 11, 20),
            _band('BAND_6', 'Задарсан', 'purple', 0, 10),
          ],
        }),
      );

      expect(isCriticalBand(RiskLevel.band6), isTrue);
      expect(isCriticalBand(RiskLevel.critical), isTrue);
      expect(isCriticalBand(RiskLevel.attention), isFalse);
      // An unassessed device is an unknown, never an alarm.
      expect(isCriticalBand(null), isFalse);
    });
  });
}
