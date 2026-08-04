// Hermetic render checks for the Ажил tab: no network, fixed payloads.
//
// The fixtures are transcriptions of real `GET /planned-work/:id` responses from the
// dev backend, including the malformed `assignedEmployeeId` the server emits when it
// populates the relation — that one is asserted on directly, because a regression
// there would send a stringified Mongoose document to an endpoint expecting an id.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/core/network/paginated_data.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/data/datasources/work_remote_data_source.dart';
import 'package:monhorus_employee/features/employee/work/data/models/inspection_report_model.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/planned_work_detail_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/work_tab_screen.dart';

Map<String, dynamic> _work() => <String, dynamic>{
      'id': 'w1',
      'workNumber': 'PW-202607-0001',
      'title': 'Цахилгаан самбарын сарын үзлэг',
      'customer': <String, dynamic>{'id': 'c', 'name': 'Central Tower ХХК'},
      'project': <String, dynamic>{'id': 'p', 'name': 'Урьдчилан сэргийлэх үйлчилгээ'},
      'building': <String, dynamic>{'id': 'b', 'name': 'Төв байр'},
      'lifecycleStatus': 'STARTED',
      'effectiveStatus': 'OVERDUE',
      'plannedStartDate': '2026-07-20T01:00:00.000Z',
      'plannedEndDate': '2026-07-25T10:00:00.000Z',
      'originalPlannedEndDate': '2026-07-22T10:00:00.000Z',
      'actualStartDate': '2026-07-21T02:00:00.000Z',
      'totalQuantity': 37,
      'completedQuantity': 6,
      'remainingQuantity': 31,
      'progressPercent': 16.2,
      'taskCount': 2,
      'completedLate': true,
      'delayMinutes': 145,
      'totalPausedMinutes': 90,
      'assignedEmployees': <dynamic>[
        <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
      ],
      'assignedTeam': <String, dynamic>{'id': 't', 'name': 'А баг'},
      'description': 'Самбарын үзлэг хийж, дүгнэлт тайлан гаргана.',
      'completionBlockers': <dynamic>['"HL-02" биелэлт 0% байна.'],
      'availableActions': <dynamic>[
        <String, dynamic>{
          'action': 'PAUSE',
          'label': 'Түр зогсоох',
          'requiresReason': true,
          'targetStatus': 'PAUSED',
        },
        <String, dynamic>{
          'action': 'CANCEL',
          'label': 'Цуцлах',
          'requiresReason': true,
          'targetStatus': 'CANCELLED',
        },
      ],
      'floorProgress': <dynamic>[
        <String, dynamic>{
          'floorId': 'f1',
          'floorName': '2-р давхар',
          'taskCount': 2,
          'totalQuantity': 21,
          'completedQuantity': 6,
          'remainingQuantity': 15,
          'progressPercent': 28.6,
        },
      ],
      'materials': <dynamic>[
        <String, dynamic>{
          'name': 'Кабель VVG 3x4',
          'quantity': 40,
          'unit': 'METRE',
        },
      ],
      'report': <String, dynamic>{
        'id': 'r',
        'status': 'RETURNED',
        'conclusion': 'Кабелийн тусгаарлагчид халалт илэрсэн.',
        'recommendation': null,
        'createdBy': <String, dynamic>{'id': 'u', 'name': 'Дорж Ganbold', 'at': null},
        'submittedBy': <String, dynamic>{
          'id': 'u',
          'name': 'Дорж Ganbold',
          'at': '2026-07-24T09:00:00.000Z',
        },
        'approvedBy': <String, dynamic>{'id': null, 'name': null, 'at': null},
        'returnedBy': <String, dynamic>{'id': 'a', 'name': 'Админ', 'at': null},
        'returnReason': 'Зөвлөмж дутуу байна.',
        'submissionBlockers': <dynamic>['Зөвлөмж бөглөнө үү.'],
        'canApprove': false,
        'approvalBlockers': <dynamic>[],
        'visibleToCustomer': false,
      },
      'tasks': <dynamic>[
        <String, dynamic>{
          'id': 't1',
          'plannedWorkId': 'w1',
          'floorId': 'f1',
          'floorName': '2-р давхар',
          'title': 'DB-2A самбарын үзлэг',
          'description': 'Distribution board',
          'unit': 'PIECE',
          'totalQuantity': 1,
          'completedQuantity': 1,
          'remainingQuantity': 0,
          'progressPercent': 100,
          'status': 'IN_PROGRESS',
          'note': 'Самбар шалгасан.',
          'conclusion': 'Самбар хэвийн, ашиглалтад тэнцэнэ.',
          // Who signed the verdict and how long the work ran. Both are server-computed:
          // the stamp only moves when the Дүгнэлт text itself changes, and the duration is
          // the wall clock from the first reported start to quantity completion.
          'conclusionById': 'u9',
          'conclusionByName': 'Батаа Энхтөр',
          'conclusionAt': '2026-07-29T06:30:00.000Z',
          'durationMinutes': 150,
          'score': 88,
          'riskLevel': 'NORMAL',
          'recommendation': 'Боолт чангалах.',
          // The equipment the single score above is written onto. The second sub-task
          // deliberately has none, so both branches of the readout are exercised.
          'relatedObjects': <dynamic>[
            <String, dynamic>{'id': 'o1', 'name': 'DB-2A самбар'},
            <String, dynamic>{'id': 'o2', 'name': 'DB-2B самбар'},
          ],
          'beforePhotos': <dynamic>[],
          'afterPhotos': <dynamic>[],
          // The live backend emits a stringified document here when populated.
          'assignedEmployeeId':
              "{\n  _id: new ObjectId('6a6a1dc9cf308958351efe19'),\n}",
          'assignedEmployeeName': 'Батаа Энхтөр',
          'missingEvidence': <dynamic>['Ажлын өмнөх зураг', 'Ажлын дараах зураг'],
        },
        <String, dynamic>{
          'id': 't2',
          'plannedWorkId': 'w1',
          'floorName': '1-р давхар',
          'title': 'HL-02 розетка шугам шалгах',
          'unit': 'PIECE',
          'totalQuantity': 16,
          'completedQuantity': 0,
          'remainingQuantity': 16,
          'progressPercent': 0,
          'status': 'PENDING',
          'beforePhotos': <dynamic>[],
          'afterPhotos': <dynamic>[],
          'missingEvidence': <dynamic>['Тайлбар', 'Үнэлгээ'],
        },
      ],
    };

/// The same record with no consolidated report row and its first sub-task finished.
///
/// This is the state the app spent its whole life in and had no report input for: a job in
/// flight, `report` absent because the backend only created it on COMPLETE. The finished
/// sub-task is here for the second half of the same problem — a DONE card used to be a
/// green bar and nothing else, sealing the note and score it carries.
Map<String, dynamic> _workAwaitingReport() {
  final Map<String, dynamic> json = _work();
  json.remove('report');

  final List<dynamic> tasks = json['tasks'] as List<dynamic>;
  tasks[0] = <String, dynamic>{
    ...tasks[0] as Map<String, dynamic>,
    'status': 'DONE',
    'missingEvidence': <dynamic>[],
  };

  return json;
}

class _StubDetail extends PlannedWorkDetailNotifier {
  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async =>
      PlannedWorkModel.fromJson(_work());
}

class _StubDetailAwaitingReport extends PlannedWorkDetailNotifier {
  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async =>
      PlannedWorkModel.fromJson(_workAwaitingReport());
}

/// Captures the progress request the sheet sends, so its payload can be asserted.
///
/// Overriding the notifier rather than the repository keeps the test hermetic without a
/// Dio stub, and the sheet reads the reply back to decide what it reports — so the reply
/// has to be a real record, not a bare success.
class _StubDetailCapturingProgress extends PlannedWorkDetailNotifier {
  static RecordTaskProgressRequest? lastRequest;

  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async =>
      PlannedWorkModel.fromJson(_workAwaitingReport());

  @override
  Future<ApiResult<PlannedWorkModel>> recordProgress({
    required String taskId,
    required RecordTaskProgressRequest request,
  }) async {
    lastRequest = request;
    return Success<PlannedWorkModel>(
      PlannedWorkModel.fromJson(_workAwaitingReport()),
    );
  }
}

/// Captures what the Дүгнэлт editor sends, without a repository behind it.
///
/// The write matters as much as the absence of an exception: a sheet whose controllers
/// were disposed too early could equally have been "fixed" by reading the fields before
/// the pop and never showing them again, which would pass a no-throw assertion while
/// sending nothing.
class _StubDetailCapturingReport extends PlannedWorkDetailNotifier {
  static String? lastConclusion;
  static String? lastRecommendation;

  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async {
    lastConclusion = null;
    lastRecommendation = null;
    return PlannedWorkModel.fromJson(_work());
  }

  @override
  Future<ApiResult<PlannedWorkModel>> saveReport({
    String? conclusion,
    String? recommendation,
  }) async {
    lastConclusion = conclusion;
    lastRecommendation = recommendation;
    return Success<PlannedWorkModel>(PlannedWorkModel.fromJson(_work()));
  }
}

/// Readiness refused: the fixture's second sub-task is still PENDING.
///
/// The inspection-report card reads on build, so a hermetic test must stub it — otherwise
/// the card sits on a spinner that animates forever and `pumpAndSettle` never returns.
class _StubInspectionBlocked extends InspectionReportNotifier {
  @override
  Future<InspectionReportState> build(String plannedWorkId) async =>
      const InspectionReportState(
        report: null,
        readiness: InspectionReportReadinessModel(
          canGenerate: false,
          blockers: <InspectionReportBlocker>[
            InspectionReportBlocker.tasksIncomplete,
          ],
          outstandingTaskTitles: <String>['HL-02 розетка шугам шалгах'],
        ),
      );
}

/// A generated draft, as `POST .../inspection-report` composes it.
class _StubInspectionDraft extends InspectionReportNotifier {
  @override
  Future<InspectionReportState> build(String plannedWorkId) async =>
      InspectionReportState(
        report: InspectionReportModel.fromJson(<String, dynamic>{
          'id': 'ir1',
          'plannedWorkId': 'w1',
          'status': 'DRAFT',
          'version': 1,
          'actName': 'Цахилгааны үзлэг',
          'overallLevel': 'ATTENTION',
          'overallLabel': 'Анхаарах шаардлагатай',
          'inspectedScope': null,
          'issueSummary': 'Нийт 1 зөрчил илэрлээ.',
          'conclusion': 'Үзлэгт 2 дэд ажил хамрагдсан.',
          'recommendation': 'Дараах арга хэмжээг авах шаардлагатай.',
          'replacementPanels': <dynamic>['2-р давхар - DB-2A самбар'],
          'replacementConnections': <dynamic>[],
          'isAutoDraft': true,
          'createdByName': 'Дорж Ganbold',
          'updatedAt': '2026-07-25T10:00:00.000Z',
        }),
        readiness: const InspectionReportReadinessModel(
          canGenerate: true,
          blockers: <InspectionReportBlocker>[],
          outstandingTaskTitles: <String>[],
          existingReportId: 'ir1',
        ),
      );
}

/// The seeded TECHNICIAN permission set, verbatim from `GET /auth/me` on the dev
/// backend after `migrate:technician-permissions`. `employee.view` is deliberately
/// absent: the role no longer holds it, and the app no longer asks for it.
const AppUser _user = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'planned_work.view',
    'planned_work.record_progress',
    'planned_work.change_status',
    'planned_work.submit_report',
  },
);

/// One row of `GET /service-requests`.
///
/// `assignedEmployees` and `assignedTeam` default to empty, which is exactly what makes
/// a row part of the UNCLAIMED pool — the server's own definition, `{ assignedEmployees:
/// { $size: 0 }, assignedTeam: null }`. Pass either to build a row that somebody holds;
/// the same route answers both kinds in one response, which is the whole reason "Миний"
/// has to subtract one from the other.
Map<String, dynamic> _request({
  required String id,
  required String number,
  required String status,
  bool isUrgent = false,
  String? deviceName,
  String? slaState,
  String? slaDueAt,
  int? slaRemainingMinutes,
  List<Map<String, dynamic>> assignedEmployees = const <Map<String, dynamic>>[],
  Map<String, dynamic>? assignedTeam,
}) =>
    <String, dynamic>{
      'id': id,
      'requestNumber': number,
      'customer': <String, dynamic>{'id': 'c', 'name': 'Central Tower ХХК'},
      'building': <String, dynamic>{'id': 'b', 'name': 'Төв байр'},
      'floor': <String, dynamic>{'id': 'f', 'name': '3-р давхар'},
      if (deviceName != null)
        'device': <String, dynamic>{'id': 'd', 'name': deviceName},
      'requestType': 'REPAIR',
      'isUrgent': isUrgent,
      'status': status,
      'slaState': slaState,
      'slaDueAt': slaDueAt,
      'slaRemainingMinutes': slaRemainingMinutes,
      'assignedEmployees': assignedEmployees,
      if (assignedTeam != null) 'assignedTeam': assignedTeam,
      'createdAt': '2026-07-30T01:00:00.000Z',
    };

/// A technician who also holds `service_request.view`, which the seeded TECHNICIAN
/// default does carry — the pool's read is guarded on that key and nothing else.
const AppUser _userWithRequests = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'planned_work.view',
    'planned_work.record_progress',
    'planned_work.change_status',
    'planned_work.submit_report',
    'service_request.view',
  },
);

/// The identity the fixture's `assignedEmployees` names — id `e1`.
const WorkIdentity _assignedIdentity = ResolvedWorkIdentity(
  employeeId: 'e1',
  employeeCode: 'EMP-0002',
  fullName: 'Дорж Ganbold',
  teamId: 'team-a',
  teamName: 'А баг',
);

/// A technician the fixture names nowhere, in a different team.
///
/// This is the shape of the live case on the dev backend: PW-202607-0001 is assigned
/// to Батаа Энхтөр and Дорж Ganbold with no team, and the server answers EMP-0003's
/// PAUSE, progress and report-submit calls with
/// `403 FORBIDDEN — Танд хуваарилагдаагүй ажил дээр үйлдэл хийх боломжгүй.`
const WorkIdentity _strangerIdentity = ResolvedWorkIdentity(
  employeeId: 'e-other',
  employeeCode: 'EMP-0003',
  fullName: 'Пүрэв Сараа',
  teamId: 'team-b',
  teamName: 'Б баг',
);

void main() {
  testWidgets('list renders', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          plannedWorkBoardProvider.overrideWith((Ref ref) async {
            return PlannedWorkBoard.from(<PlannedWorkListItemModel>[
              PlannedWorkListItemModel.fromJson(_work()),
            ]);
          }),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ажил'), findsOneWidget);
    expect(find.text('Цахилгаан самбарын сарын үзлэг'), findsOneWidget);
    expect(find.text('ХУГАЦАА ХЭТЭРСЭН'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('unavailable scope explains itself', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          plannedWorkBoardProvider.overrideWith((Ref ref) async {
            throw const WorkScopeUnavailable('Тест', detail: 'Тайлбар.');
          }),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Тест'), findsOneWidget);
    expect(find.text('Тайлбар.'), findsOneWidget);
    // No "show me every planned work" escape hatch any more. It used to be offered here,
    // on the premise that an unfiltered `GET /planned-work` was the one thing that would
    // still answer something. The server bounds that list to the caller now, so the
    // button would have re-fetched the very same rows under a heading claiming they were
    // the whole company's.
    expect(find.text('Бүх төлөвлөгөөт ажлыг харах'), findsNothing);
    expect(find.text('Дахин оролдох'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  // -- The account nobody linked ---------------------------------------------
  //
  // `GET /employees/me` 404s when no `Employee.systemUser` points at the account. The
  // server answers such a caller's list with nothing — correctly, since no assignment can
  // name them — and an unexplained empty list reads as "quiet week" rather than as
  // "an administrator has to link your login". These two cover the sentence and the
  // request that produced the empty list.

  testWidgets('an unlinked account is told so, not shown an empty week', (
    WidgetTester tester,
  ) async {
    final _ListRepository repository = _ListRepository();

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workRepositoryProvider.overrideWithValue(repository),
          // Exactly what `GET /employees/me` answering 404 produces.
          workIdentityProvider.overrideWith(
            (Ref ref) async =>
                const UnresolvedWorkIdentity(WorkIdentityProblem.notLinked),
          ),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Ажилтны карт холбогдоогүй байна'), findsOneWidget);
    // Named as the person who has to act, which is the actionable half of the notice.
    expect(find.textContaining('Администратор'), findsOneWidget);

    // The wrong sentence: true about the rows, and about the wrong problem.
    expect(find.text('Танд оноогдсон ажил алга'), findsNothing);

    // And the list was still asked for, with no filter: "Миний" no longer hand-builds a
    // scope the server contradicts.
    expect(repository.calls, <List<String?>>[
      <String?>[null, null],
    ]);
    expect(tester.takeException(), isNull);
  });

  testWidgets('"Миний" asks for no filter and lets the server scope it', (
    WidgetTester tester,
  ) async {
    final _ListRepository repository = _ListRepository(
      items: <PlannedWorkListItemModel>[
        PlannedWorkListItemModel.fromJson(_work()),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workRepositoryProvider.overrideWithValue(repository),
          // A technician on a team, named on nothing individually. Under the old
          // client-built filter this segment sent `employeeId=<me>`, which ANDs with
          // `teamId` server-side — so work assigned to the TEAM never appeared and the
          // technician concluded they had nothing to do.
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(repository.calls, <List<String?>>[
      <String?>[null, null],
    ]);
    expect(find.text('Цахилгаан самбарын сарын үзлэг'), findsOneWidget);
    // Nothing claims this is an unfiltered system-wide list, because it is not one.
    expect(find.text('Шүүгдээгүй жагсаалт'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('"Багийн" still narrows explicitly, by team', (
    WidgetTester tester,
  ) async {
    final _ListRepository repository = _ListRepository();

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workRepositoryProvider.overrideWithValue(repository),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('БАГИЙН'));
    await tester.pumpAndSettle();

    // A narrowing on top of the enforced scope, never a replacement for it.
    expect(repository.calls.last, <String?>[null, 'team-a']);
    expect(tester.takeException(), isNull);
  });

  // -- "Миний" carries requests too ------------------------------------------
  //
  // THE BUG THIS SEGMENT WAS BUILT AROUND: an assigned service request appeared
  // nowhere. `PlannedWorkBoard` holds `PlannedWorkListItemModel` and structurally
  // cannot carry a request, so the moment one was assigned it left the "Нээлттэй" pool
  // and dropped out of the app entirely — correctly assigned server-side, invisible
  // everywhere else.

  testWidgets('"Миний" lists assigned requests beside the planned work', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    final _ListRepository repository = _ListRepository(
      items: <PlannedWorkListItemModel>[
        PlannedWorkListItemModel.fromJson(_work()),
      ],
      // One response, three kinds of row — which is what `GET /service-requests`
      // actually answers, because the read passes `includeUnclaimed: true`.
      requests: <ServiceRequestListItemModel>[
        // Mine, by name.
        ServiceRequestListItemModel.fromJson(
          _request(
            id: 'r-mine',
            number: 'SR-202607-0100',
            status: 'ASSIGNED',
            deviceName: 'Лифт №2',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
            ],
          ),
        ),
        // Mine, through my team and naming nobody. Dropping this row is exactly the
        // mistake the `employeeId` filter used to make on /planned-work.
        ServiceRequestListItemModel.fromJson(
          _request(
            id: 'r-team',
            number: 'SR-202607-0101',
            status: 'ASSIGNED',
            deviceName: 'DB-2A самбар',
            assignedTeam: <String, dynamic>{'id': 'team-a', 'name': 'А баг'},
          ),
        ),
        // Nobody's. It belongs in "Нээлттэй" and must not be counted as mine.
        ServiceRequestListItemModel.fromJson(
          _request(
            id: 'r-open',
            number: 'SR-202607-0044',
            status: 'UNASSIGNED',
            deviceName: 'Гал хамгаалагч',
          ),
        ),
        // Somebody else's, which an oversight caller would also be answered.
        ServiceRequestListItemModel.fromJson(
          _request(
            id: 'r-other',
            number: 'SR-202607-0077',
            status: 'ASSIGNED',
            deviceName: 'Агаар сэлгэгч',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'e-other', 'name': 'Пүрэв Сараа'},
            ],
          ),
        ),
      ],
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_userWithRequests),
          workRepositoryProvider.overrideWithValue(repository),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    // Both record types, under their own headings, in one scroll view.
    expect(find.text('ХҮСЭЛТ'), findsOneWidget);
    expect(find.text('ТӨЛӨВЛӨГӨӨТ АЖИЛ'), findsOneWidget);
    expect(find.text('SR-202607-0100'), findsOneWidget);
    expect(find.text('SR-202607-0101'), findsOneWidget);
    expect(find.text('Цахилгаан самбарын сарын үзлэг'), findsOneWidget);

    // The unclaimed row is NOT here. It is the "Нээлттэй" segment's, and a queue
    // nobody has taken must not be shown as this technician's own work.
    expect(find.text('SR-202607-0044'), findsNothing);
    // Neither is a colleague's.
    expect(find.text('SR-202607-0077'), findsNothing);

    // A row that is already the reader's has nothing to claim.
    expect(find.text('Өөртөө авах'), findsNothing);

    // No `employeeId` on either read: the server bounds both lists itself, and a
    // client-side filter can only subtract from the union it enforces.
    expect(repository.calls, <List<String?>>[
      <String?>[null, null],
    ]);
    expect(repository.requestCalls, 1);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping an assigned request opens its detail screen', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_userWithRequests),
          workRepositoryProvider.overrideWithValue(
            _ListRepository(
              requests: <ServiceRequestListItemModel>[
                ServiceRequestListItemModel.fromJson(
                  _request(
                    id: 'r-mine',
                    number: 'SR-202607-0100',
                    status: 'ASSIGNED',
                    deviceName: 'Лифт №2',
                    assignedEmployees: <Map<String, dynamic>>[
                      <String, dynamic>{'id': 'e1', 'name': 'Дорж Ganbold'},
                    ],
                  ),
                ),
              ],
            ),
          ),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Лифт №2'));
    await tester.pumpAndSettle();

    // The same screen the open pool opens, carrying the row's own facts as the
    // placeholder it opens with while the detail read is in flight.
    expect(find.byType(ServiceRequestDetailScreen), findsOneWidget);
    expect(find.text('SR-202607-0100'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an account with nothing at all is told about both lists', (
    WidgetTester tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_userWithRequests),
          workRepositoryProvider.overrideWithValue(_ListRepository()),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Танд оноогдсон ажил алга'), findsOneWidget);
    // The old sentence spoke only of planned work, which is how a technician holding a
    // service request was told they had nothing to do.
    expect(find.textContaining('үйлчилгээний хүсэлт'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed request read is named, not swallowed', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_userWithRequests),
          plannedWorkBoardProvider.overrideWith(
            (Ref ref) async => PlannedWorkBoard.from(
              <PlannedWorkListItemModel>[
                PlannedWorkListItemModel.fromJson(_work()),
              ],
            ),
          ),
          assignedRequestsProvider.overrideWith(
            (Ref ref) async => const AssignedRequests(
              items: <ServiceRequestListItemModel>[],
              notice: 'Сүлжээнд холбогдож чадсангүй.',
            ),
          ),
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    // The board still drew, and the half that failed says so in the backend's words.
    expect(find.text('Цахилгаан самбарын сарын үзлэг'), findsOneWidget);
    expect(find.text('Үйлчилгээний хүсэлт ачаалагдсангүй'), findsOneWidget);
    expect(find.text('Сүлжээнд холбогдож чадсангүй.'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('detail and progress sheet render', (WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          // The technician the record names. Without this the identity would be
          // resolved over the network, which a hermetic test has no server for.
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('16.2%'), findsOneWidget);
    expect(find.text('Түр зогсоох'), findsOneWidget);
    // CANCEL is on availableActions but the user lacks planned_work.cancel, so the
    // button must not be drawn: the permission gate is the second half of the rule.
    expect(find.text('Цуцлах'), findsNothing);
    expect(tester.takeException(), isNull);

    // The stringified populated relation must not survive parsing.
    final PlannedWorkModel parsed = PlannedWorkModel.fromJson(_work());
    expect(parsed.tasks.first.assignedEmployeeId, isNull);

    // Everything below is off-screen at first paint, so scroll it into view.
    await tester.scrollUntilVisible(
      find.textContaining('Зөвлөмж дутуу байна.'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.textContaining('Зөвлөмж дутуу байна.'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('DB-2A самбарын үзлэг'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('DB-2A самбарын үзлэг'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Өнөөдрийн гүйцэтгэл оруулах'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Өнөөдрийн гүйцэтгэл оруулах').first);
    await tester.pumpAndSettle();
    expect(find.text('Өнөөдрийн гүйцэтгэл оруулах'), findsWidgets);
    expect(find.text('8'), findsOneWidget); // half of the 16 remaining
    expect(tester.takeException(), isNull);

    // The evidence section. t2 has no photos, so both strips are nothing but their
    // capture tile — which is the case that matters: the gate cannot be closed from
    // a screen that only renders photos which already exist.
    // The sheet's own vertical list, not the horizontal strips nested inside it.
    await tester.scrollUntilVisible(
      find.text('НОТЛОХ ЗУРАГ'),
      200,
      scrollable: find
          .descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();

    expect(find.text('АЖЛЫН ӨМНӨХ ЗУРАГ'), findsOneWidget);
    expect(find.text('АЖЛЫН ДАРААХ ЗУРАГ'), findsOneWidget);
    expect(find.text('Нэмэх'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  /// The equipment a sub-task covers, and the Дүгнэлт written onto it.
  ///
  /// `relatedObjects` used to be dropped by the model outright: the server sent it and
  /// the handset threw it away, so a technician typed a score with no way of knowing
  /// which equipment it would land on. The card names it now, and the empty case is
  /// stated rather than left blank, because a sub-task covering nothing records a score
  /// that reaches no equipment record at all.
  testWidgets('a sub-task names the equipment its score will be written onto', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The model must keep what the server sent, not discard it as it once did.
    final PlannedWorkModel parsed = PlannedWorkModel.fromJson(_work());
    expect(
      parsed.tasks.first.relatedObjects.map((NamedRefModel ref) => ref.name),
      <String>['DB-2A самбар', 'DB-2B самбар'],
    );
    expect(parsed.tasks.first.conclusion, 'Самбар хэвийн, ашиглалтад тэнцэнэ.');
    expect(parsed.tasks[1].relatedObjects, isEmpty);

    await tester.scrollUntilVisible(
      find.text('ХАМРАХ ТОНОГЛОЛ (2)'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('· DB-2A самбар'), findsOneWidget);
    expect(find.text('· DB-2B самбар'), findsOneWidget);
    // The recorded verdict is readable on the card beside the note it was drawn from.
    expect(find.text('ДҮГНЭЛТ'), findsWidgets);
    expect(find.text('Самбар хэвийн, ашиглалтад тэнцэнэ.'), findsOneWidget);

    // And it is attributed. Any member of the assigned team can overwrite this field, so an
    // unsigned verdict is indistinguishable from one the reader wrote themselves. The stamp
    // is matched loosely because `formatShortStamp` renders in the device's local zone.
    expect(parsed.tasks.first.conclusionByName, 'Батаа Энхтөр');
    expect(find.textContaining('Батаа Энхтөр ·'), findsOneWidget);

    // 150 minutes through the tab's own `formatMinutes`, never a bare number of minutes.
    expect(parsed.tasks.first.durationMinutes, 150);
    expect(find.text('Гүйцэтгэсэн хугацаа · 2 цаг 30 мин'), findsOneWidget);

    // The unstarted second sub-task carries no duration line at all: a zero there would
    // read as work that finished the instant it began.
    expect(parsed.tasks[1].durationMinutes, isNull);
    expect(find.textContaining('Гүйцэтгэсэн хугацаа'), findsOneWidget);

    // The second sub-task covers nothing, and is told so rather than left silent.
    await tester.scrollUntilVisible(
      find.text('Тоноглол холбоогүй'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('ямар ч тоноглолын түүхэнд бичигдэхгүй'),
      findsOneWidget,
    );

    expect(tester.takeException(), isNull);
  });

  /// Section 10.1 used to keep Дүгнэлт off a sub-task entirely. That left the Дүгнэлт
  /// column of Үзлэг ба дүгнэлт empty for every planned-work row, since those rows ARE
  /// the per-object items fanned out from a sub-task. It is collected here now, and has
  /// to survive the round trip to the request.
  testWidgets('the progress sheet sends the sub-task Дүгнэлт', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    _StubDetailCapturingProgress.lastRequest = null;

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailCapturingProgress.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Тэмдэглэл, үнэлгээ засах'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Тэмдэглэл, үнэлгээ засах'));
    await tester.pumpAndSettle();

    // The sheet names the equipment before anything is typed, so the one Үнэлгээ below
    // is never chosen without knowing where it lands.
    expect(find.text('ҮНЭЛГЭЭ БИЧИГДЭХ ТОНОГЛОЛ (2)'), findsOneWidget);

    final Finder sheetScrollable = find
        .descendant(
          of: find.byType(BottomSheet),
          matching: find.byType(Scrollable),
        )
        .first;
    // Scrolled to by key, not by its label: the card behind the sheet carries a
    // 'ДҮГНЭЛТ' caption of its own and is already on screen, so a text-based scroll
    // would find that one and never move the sheet.
    await tester.scrollUntilVisible(
      find.byKey(const Key('task-conclusion-field')),
      200,
      scrollable: sheetScrollable,
    );
    await tester.pumpAndSettle();

    // Pre-filled from the record, so a correction edits it rather than retyping it.
    final Finder conclusionField = find.descendant(
      of: find.byKey(const Key('task-conclusion-field')),
      matching: find.byType(TextField),
    );
    expect(
      tester.widget<TextField>(conclusionField).controller?.text,
      'Самбар хэвийн, ашиглалтад тэнцэнэ.',
    );
    expect(find.textContaining('2 тоноглол тус бүрд бичигдэнэ'), findsOneWidget);

    await tester.enterText(conclusionField, 'Дахин шалгалт шаардлагагүй.');
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Гүйцэтгэл хадгалах'),
      200,
      scrollable: sheetScrollable,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Гүйцэтгэл хадгалах'));
    await tester.pumpAndSettle();

    final RecordTaskProgressRequest? sent =
        _StubDetailCapturingProgress.lastRequest;
    expect(sent, isNotNull);
    expect(sent!.conclusion, 'Дахин шалгалт шаардлагагүй.');
    expect(sent.toJson()['conclusion'], 'Дахин шалгалт шаардлагагүй.');

    expect(tester.takeException(), isNull);
  });

  testWidgets('an unassigned work is read-only and says why', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _strangerIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The record itself is still fully visible — `planned_work.view` is unscoped and
    // a technician may legitimately read a colleague's job.
    expect(find.text('16.2%'), findsOneWidget);

    // One banner, in the app's own words, above the controls it explains.
    expect(find.text('Танд хуваарилагдаагүй ажил'), findsOneWidget);
    expect(
      find.textContaining('төлөв өөрчлөх, гүйцэтгэл бүртгэх'),
      findsOneWidget,
    );

    // The lifecycle button the caller has both the permission and the record for is
    // withdrawn, because the server would refuse it on scope alone.
    expect(find.text('Түр зогсоох'), findsNothing);

    // The report writes go the same way, replaced by their own sentence.
    await tester.scrollUntilVisible(
      find.textContaining('тайлан бичих, илгээх боломжгүй'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Дүгнэлт, зөвлөмж бичих'), findsNothing);
    expect(find.text('Хянуулахаар илгээх'), findsNothing);

    // And so does the per-task progress entry, with the reason that names the right
    // person to ask — a dispatcher, not an administrator.
    // `.first` because every unfinished task card carries the same sentence.
    await tester.scrollUntilVisible(
      find.textContaining('гүйцэтгэл бүртгэх, зураг хавсаргах боломжгүй').first,
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('гүйцэтгэл бүртгэх, зураг хавсаргах боломжгүй'),
      findsWidgets,
    );
    expect(find.text('Өнөөдрийн гүйцэтгэл оруулах'), findsNothing);
    // The permission wording must NOT appear: this caller holds the grant.
    expect(
      find.textContaining('planned_work.record_progress'),
      findsNothing,
      reason: 'a scope refusal must not be reported as a missing permission',
    );

    expect(tester.takeException(), isNull);
  });

  testWidgets('a job in flight can be written up and a finished task re-opened', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailAwaitingReport.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // THE BUG. `report` is null for the whole of DRAFT..OVERDUE, and this branch used to
    // be prose with no control at all, so the Дүгнэлт had nowhere to be typed.
    await tester.scrollUntilVisible(
      find.text('Тайлан хараахан бичигдээгүй'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Дүгнэлт, зөвлөмж бичих'), findsOneWidget);

    // Tapping it opens the editor that was previously unreachable.
    await tester.tap(find.text('Дүгнэлт, зөвлөмж бичих'));
    await tester.pumpAndSettle();
    expect(find.text('Дүгнэлт тайлан'), findsWidgets);
    expect(find.text('Тайлан хадгалах'), findsOneWidget);
    await tester.tap(find.text('Болих'));
    await tester.pumpAndSettle();

    // The server's assembled write-up is readable from the same card.
    expect(find.text('Тайланг бүтнээр харах'), findsOneWidget);

    // The inspection report names the sub-task that is holding it up.
    await tester.scrollUntilVisible(
      find.text('Үзлэгийн тайлан үүсгэхэд дутуу байгаа'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(
      find.textContaining('HL-02 розетка шугам шалгах'),
      findsWidgets,
    );

    // A DONE sub-task keeps its green bar AND gains a way back into its note.
    await tester.scrollUntilVisible(
      find.text('Тэмдэглэл, үнэлгээ засах'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    expect(find.text('Дууссан'), findsWidgets);
    expect(find.text('Тэмдэглэл, үнэлгээ засах'), findsOneWidget);

    await tester.tap(find.text('Тэмдэглэл, үнэлгээ засах'));
    await tester.pumpAndSettle();
    // The existing sheet, pre-filled: the note is edited rather than retyped, and a
    // text-only save is legal because the cumulative quantity is already complete.
    expect(find.text('Самбар шалгасан.'), findsWidgets);
    expect(find.text('Гүйцэтгэл хадгалах'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('a generated inspection report is readable and authorable', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailAwaitingReport.new),
          inspectionReportProvider.overrideWith(_StubInspectionDraft.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Цахилгааны үзлэг'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    // The derived verdict is displayed, never entered.
    expect(find.text('АНХААРАХ ШААРДЛАГАТАЙ'), findsOneWidget);
    expect(find.textContaining('Нийт 1 зөрчил илэрлээ.'), findsOneWidget);
    expect(find.textContaining('2-р давхар - DB-2A самбар'), findsOneWidget);

    await tester.scrollUntilVisible(
      find.text('Тайлан бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    // DRAFT, so both writes are on offer.
    expect(find.text('Тайлан бичих'), findsOneWidget);
    expect(find.text('Хянуулахаар илгээх'), findsWidgets);

    await tester.tap(find.text('Тайлан бичих'));
    await tester.pumpAndSettle();
    expect(find.text('Үзлэгийн тайлан бичих'), findsOneWidget);
    // `findsWidgets`: the card behind the sheet carries the same caption on its own
    // read-only block, which is the point — the sheet edits what the card shows.
    expect(find.text('ҮЗЛЭГЭЭР ШАЛГАСАН'), findsWidgets);

    // The two replacement lists are below the fold of the sheet's own list.
    await tester.scrollUntilVisible(
      find.text('ШИНЭЧЛЭХ ШААРДЛАГАТАЙ ХОЛБОЛТУУД'),
      200,
      scrollable: find
          .descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();

    expect(find.text('ШИНЭЧЛЭХ ШААРДЛАГАТАЙ САМБАРУУД'), findsOneWidget);
    // Two lists, each with its own add button; the seeded panel line is editable.
    expect(find.text('Мөр нэмэх'), findsNWidgets(2));
    // Two matches: the card's read-only copy behind the sheet, and the editable row the
    // seeded line was loaded into — which is the assertion that matters, because a
    // replacement list that opened empty would silently delete what generation composed.
    expect(find.text('2-р давхар - DB-2A самбар'), findsNWidgets(2));
    expect(tester.takeException(), isNull);
  });

  testWidgets('an oversight permission keeps the controls on someone else\'s job', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 900));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    // A dispatcher: `dispatch.assign` is one of the backend's OVERSIGHT_PERMISSIONS,
    // so the assignment scope does not apply and the app must not invent one.
    const AppUser dispatcher = AppUser(
      id: 'u2',
      fullName: 'Диспетчер',
      email: 'dispatch@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: <String>{
        'planned_work.view',
        'planned_work.change_status',
        'planned_work.record_progress',
        'planned_work.submit_report',
        'dispatch.assign',
      },
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(dispatcher),
          workIdentityProvider.overrideWith((Ref ref) async => _strangerIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Танд хуваарилагдаагүй ажил'), findsNothing);
    expect(find.text('Түр зогсоох'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // -- The "Нээлттэй" segment ------------------------------------------------
  //
  // It used to make no request at all and render a notice claiming no endpoint existed.
  // These three cover what it does instead: the pool, the empty pool, and the one
  // refusal that is real — a caller without `service_request.view`.

  /// Opens the tab and taps through to the third segment.
  ///
  /// `plannedWorkBoardProvider` is overridden in every case because the tab opens on
  /// "Миний": without it the board would resolve the identity over a network these tests
  /// have no server for, before the pool is ever reached.
  Future<void> pumpOpenSegment(
    WidgetTester tester, {
    required AppUser user,
    List<Override> overrides = const <Override>[],
  }) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(user),
          plannedWorkBoardProvider.overrideWith(
            (Ref ref) async => PlannedWorkBoard.from(
              const <PlannedWorkListItemModel>[],
            ),
          ),
          // "Миний" is what the tab opens on and it now reads a second list, which
          // would resolve the identity over a network these tests have no server for
          // before the pool is ever reached.
          assignedRequestsProvider
              .overrideWith((Ref ref) async => AssignedRequests.none),
          ...overrides,
        ],
        child: const MaterialApp(home: WorkTabScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('НЭЭЛТТЭЙ'));
    await tester.pumpAndSettle();
  }

  testWidgets('the open segment lists the unclaimed pool, read-only', (
    WidgetTester tester,
  ) async {
    await pumpOpenSegment(
      tester,
      user: _userWithRequests,
      overrides: <Override>[
        openRequestPoolProvider.overrideWith((Ref ref) async {
          return OpenRequestPool(
            items: <ServiceRequestListItemModel>[
              ServiceRequestListItemModel.fromJson(
                _request(
                  id: 'r1',
                  number: 'SR-202607-0044',
                  status: 'NEW',
                  isUrgent: true,
                  deviceName: 'Лифт №2',
                  slaState: 'BREACHED',
                  slaDueAt: '2026-07-30T02:00:00.000Z',
                  slaRemainingMinutes: -95,
                ),
              ),
              ServiceRequestListItemModel.fromJson(
                _request(
                  id: 'r2',
                  number: 'SR-202607-0051',
                  status: 'UNASSIGNED',
                  deviceName: 'DB-2A самбар',
                  slaState: 'NEAR_BREACH',
                  slaDueAt: '2026-07-30T06:00:00.000Z',
                  slaRemainingMinutes: 140,
                ),
              ),
            ],
            total: 2,
          );
        }),
      ],
    );

    // Both statuses of the pool are on screen, which is the point of querying twice.
    expect(find.text('SR-202607-0044'), findsOneWidget);
    expect(find.text('SR-202607-0051'), findsOneWidget);
    expect(find.text('Лифт №2'), findsOneWidget);
    expect(find.text('ШИНЭ'), findsOneWidget);
    expect(find.text('ХУВААРИЛАГДААГҮЙ'), findsOneWidget);
    expect(find.text('ЯАРАЛТАЙ'), findsOneWidget);

    // The backend's own countdown, not a subtraction done on the device.
    expect(find.text('1 ц 35 мин хоцорсон'), findsOneWidget);
    expect(find.text('2 ц 20 мин үлдсэн'), findsOneWidget);

    expect(find.textContaining('API энэ системд байхгүй'), findsNothing);

    // This user does NOT hold `service_request.claim`, so the action is absent and the
    // notice says why. The absence is a fact about this account's grants, not about the
    // system: see the claim tests below, where the same pool is claimable.
    expect(find.text('Хуваарилалтыг диспетчер хийдэг'), findsOneWidget);
    expect(find.text('Өөртөө авах'), findsNothing);

    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty pool is an empty state, not an error', (
    WidgetTester tester,
  ) async {
    await pumpOpenSegment(
      tester,
      user: _userWithRequests,
      overrides: <Override>[
        openRequestPoolProvider.overrideWith(
          (Ref ref) async => const OpenRequestPool(
            items: <ServiceRequestListItemModel>[],
            total: 0,
          ),
        ),
      ],
    );

    expect(find.text('Нээлттэй дуудлага алга'), findsOneWidget);
    expect(find.textContaining('Шинэ дуудлага бүртгэгдмэгц'), findsOneWidget);
    // Nothing failed, so nothing apologises and nothing offers a retry.
    expect(find.text('Ачаалж чадсангүй'), findsNothing);
    expect(find.text('Дахин оролдох'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('without service_request.view the segment refuses and names the key', (
    WidgetTester tester,
  ) async {
    // The real provider this time — `_user` holds the four planned-work keys and not
    // this one, so the gate must stop it before any request is attempted. A network
    // call here would fail the test by itself: these tests have no server.
    await pumpOpenSegment(tester, user: _user);

    expect(find.text('Нээлттэй дуудлагыг харах эрх байхгүй'), findsOneWidget);
    expect(find.textContaining('service_request.view'), findsOneWidget);
    // An explanation, not an error: no retry, and no "all planned work" escape hatch,
    // which would answer a different question.
    expect(find.text('Дахин оролдох'), findsNothing);
    expect(find.text('Бүх төлөвлөгөөт ажлыг харах'), findsNothing);
    expect(tester.takeException(), isNull);
  });


  testWidgets('a technician holding service_request.claim gets the action', (
    WidgetTester tester,
  ) async {
    await pumpOpenSegment(
      tester,
      user: _userWithClaim,
      overrides: <Override>[
        openRequestPoolProvider.overrideWith(
          (Ref ref) async => OpenRequestPool(
            items: <ServiceRequestListItemModel>[
              ServiceRequestListItemModel.fromJson(
                _request(id: 'r1', number: 'SR-202607-0044', status: 'UNASSIGNED'),
              ),
            ],
            total: 1,
          ),
        ),
      ],
    );

    expect(find.text('Өөртөө авах'), findsOneWidget);
    // The notice changes with the grant: telling a technician who CAN take the job that
    // only a dispatcher can would be the same wrong sentence the segment started with.
    expect(find.text('Ажлыг өөртөө авах боломжтой'), findsOneWidget);
    expect(find.text('Хуваарилалтыг диспетчер хийдэг'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  /// The row itself opens the request, which it could not do at all before.
  ///
  /// `OpenRequestCard` had no tap parameter — only `onClaim` — so the one segment whose
  /// whole purpose is deciding whether to take a job was the one place a technician could
  /// not open it and read the fault description first. Tapping the card and tapping
  /// "Өөртөө авах" are deliberately different acts, which is why this asserts the claim
  /// did NOT fire.
  testWidgets('tapping an open request opens its detail screen', (
    WidgetTester tester,
  ) async {
    final _ClaimRepository repository = _ClaimRepository(const Success<void>(null));

    await pumpOpenSegment(
      tester,
      user: _userWithClaim,
      overrides: <Override>[
        workRepositoryProvider.overrideWithValue(repository),
        openRequestPoolProvider.overrideWith(
          (Ref ref) async => OpenRequestPool(
            items: <ServiceRequestListItemModel>[
              ServiceRequestListItemModel.fromJson(
                _request(
                  id: 'r1',
                  number: 'SR-202607-0044',
                  status: 'UNASSIGNED',
                  deviceName: 'Лифт №2',
                ),
              ),
            ],
            total: 1,
          ),
        ),
      ],
    );

    await tester.tap(find.text('Лифт №2'));
    await tester.pumpAndSettle();

    expect(find.byType(ServiceRequestDetailScreen), findsOneWidget);
    // The row's own facts travel with it, so the screen is never blank on open — and
    // the detail read then fills in what a list row cannot carry.
    expect(find.text('SR-202607-0044'), findsOneWidget);
    expect(find.text('Лифт №2'), findsOneWidget);
    expect(find.textContaining('Төв байр'), findsWidgets);

    // Opening is not taking.
    expect(repository.claimed, isEmpty);
    expect(tester.takeException(), isNull);

    // ...and the whole sequence the segment exists for: come back from the detail
    // screen and take the job. The claim lives on the row rather than on the detail
    // screen, so this is the real path a technician walks, and it has to survive the
    // navigation.
    await tester.pageBack();
    await tester.pumpAndSettle();

    expect(find.byType(ServiceRequestDetailScreen), findsNothing);
    await tester.tap(find.text('Өөртөө авах'));
    await tester.pumpAndSettle();

    expect(repository.claimed, <String>['r1']);
    expect(find.textContaining('өөртөө авлаа'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('tapping the action claims that request', (WidgetTester tester) async {
    final _ClaimRepository repository = _ClaimRepository(const Success<void>(null));

    await pumpOpenSegment(
      tester,
      user: _userWithClaim,
      overrides: <Override>[
        workRepositoryProvider.overrideWithValue(repository),
        openRequestPoolProvider.overrideWith(
          (Ref ref) async => OpenRequestPool(
            items: <ServiceRequestListItemModel>[
              ServiceRequestListItemModel.fromJson(
                _request(id: 'r1', number: 'SR-202607-0044', status: 'UNASSIGNED'),
              ),
            ],
            total: 1,
          ),
        ),
      ],
    );

    await tester.tap(find.text('Өөртөө авах'));
    await tester.pumpAndSettle();

    // The id from the row, and no employee id of any kind: the endpoint resolves the
    // claimer from the session.
    expect(repository.claimed, <String>['r1']);
    expect(find.textContaining('өөртөө авлаа'), findsOneWidget);
  });

  /// A lost race is the concurrency control working, so it must not read as breakage.
  testWidgets('a conflict is reported as somebody else having taken it', (
    WidgetTester tester,
  ) async {
    final _ClaimRepository repository = _ClaimRepository(
      const FailureResult<void>(
        ServerFailure('Энэ ажлыг өөр ажилтан аль хэдийн авсан байна.',
            code: 'DUPLICATE_KEY'),
      ),
    );

    await pumpOpenSegment(
      tester,
      user: _userWithClaim,
      overrides: <Override>[
        workRepositoryProvider.overrideWithValue(repository),
        openRequestPoolProvider.overrideWith(
          (Ref ref) async => OpenRequestPool(
            items: <ServiceRequestListItemModel>[
              ServiceRequestListItemModel.fromJson(
                _request(id: 'r1', number: 'SR-202607-0044', status: 'UNASSIGNED'),
              ),
            ],
            total: 1,
          ),
        ),
      ],
    );

    await tester.tap(find.text('Өөртөө авах'));
    await tester.pumpAndSettle();

    expect(find.textContaining('өөр ажилтан саяхан авчихсан'), findsOneWidget);
    // Not an error state: the list is still a list, not a retry screen.
    expect(find.text('Ачаалж чадсангүй'), findsNothing);
    expect(tester.takeException(), isNull);
  });


  test('the pool is ordered by what will breach first', () {
    ServiceRequestListItemModel row(
      String number, {
      bool isUrgent = false,
      String? due,
    }) =>
        ServiceRequestListItemModel.fromJson(
          _request(
            id: number,
            number: number,
            status: 'UNASSIGNED',
            isUrgent: isUrgent,
            slaDueAt: due,
          ),
        );

    final List<ServiceRequestListItemModel> rows = <ServiceRequestListItemModel>[
      row('SR-4', due: null),
      row('SR-3', due: '2026-07-30T02:00:00.000Z'),
      row('SR-2', due: '2026-07-30T01:00:00.000Z'),
      row('SR-1', isUrgent: true, due: '2026-07-31T23:00:00.000Z'),
    ]..sort(WorkRemoteDataSource.compareByUrgency);

    // Urgent first even with the latest deadline of the four — the Нүүр tab bands the
    // same rows that way — then by deadline, with the row that has none sinking last
    // rather than posing as due now.
    expect(
      rows.map((ServiceRequestListItemModel item) => item.requestNumber).toList(),
      <String>['SR-1', 'SR-2', 'SR-3', 'SR-4'],
    );
  });

  // -- Report editors: the controllers must outlive the pop ------------------
  //
  // `showModalBottomSheet` and `showDialog` complete their future the instant
  // `Navigator.pop` is called, NOT when the route leaves the screen: it is still
  // mounted, still animating out and still rebuilding for a few hundred milliseconds
  // afterwards. Both editors below used to be plain `builder:` closures over
  // controllers the caller owned and disposed from `.whenComplete`, so the pop killed
  // controllers their own live TextFields were still reading — and the very next
  // rebuild threw "A TextEditingController was used after being disposed", left the
  // route half torn down, and tripped `_dependents.isEmpty` in
  // `InheritedElement.debugDeactivated`. The red screen named the framework, not this
  // file.
  //
  // Every case here TYPES FIRST and then tears the whole tree down. Both halves are
  // load-bearing: typing focuses the field, which is what guarantees the rebuild after
  // the pop, and a happy-path render that never unmounts cannot see a disposal-order
  // defect at all.

  testWidgets('the Дүгнэлт editor survives a typed save and the teardown after it', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailCapturingReport.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Дүгнэлт, зөвлөмж бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Дүгнэлт, зөвлөмж бичих'));
    await tester.pumpAndSettle();
    expect(find.text('Дүгнэлт тайлан'), findsOneWidget);

    final Finder fields = find.descendant(
      of: find.byType(BottomSheet),
      matching: find.byType(TextField),
    );
    await tester.enterText(fields.first, 'Кабель солигдсон.');
    await tester.enterText(fields.last, 'Дараагийн үзлэгт дахин хэмжинэ.');
    await tester.pumpAndSettle();

    await tester.tap(find.text('Тайлан хадгалах'));
    await tester.pumpAndSettle();

    // The pop happened, what was typed reached the notifier, and nothing threw while
    // the sheet played itself out.
    expect(find.text('Дүгнэлт тайлан'), findsNothing);
    expect(_StubDetailCapturingReport.lastConclusion, 'Кабель солигдсон.');
    expect(
      _StubDetailCapturingReport.lastRecommendation,
      'Дараагийн үзлэгт дахин хэмжинэ.',
    );
    expect(tester.takeException(), isNull);

    // The disposal step. Replacing the whole tree unmounts the screen, the Navigator
    // and the Overlay in one go, which is where the leaked dependency showed up.
    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the Дүгнэлт editor survives a typed cancel and the teardown after it', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailCapturingReport.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Дүгнэлт, зөвлөмж бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Дүгнэлт, зөвлөмж бичих'));
    await tester.pumpAndSettle();

    await tester.enterText(
      find
          .descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(TextField),
          )
          .first,
      'Хагас бичсэн дүгнэлт',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Болих'));
    await tester.pumpAndSettle();

    // A cancel sends nothing — and, like the save, must not dispose anything early.
    expect(find.text('Дүгнэлт тайлан'), findsNothing);
    expect(_StubDetailCapturingReport.lastConclusion, isNull);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the reason prompt survives a typed dismissal and the teardown after it', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // The reason prompt AUTOFOCUSES its field, so it reaches the dangerous state
    // without anyone typing — this case types anyway, because that is the flow.
    await tester.scrollUntilVisible(
      find.text('Түр зогсоох'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Түр зогсоох'));
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsOneWidget);

    await tester.enterText(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.byType(TextField),
      ),
      'Материал хүрэлцээгүй',
    );
    await tester.pumpAndSettle();

    await tester.tap(
      find.descendant(
        of: find.byType(AlertDialog),
        matching: find.text('Болих'),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byType(AlertDialog), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sub-task progress sheet survives a typed cancel and its teardown', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetail.new),
          inspectionReportProvider.overrideWith(_StubInspectionBlocked.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Өнөөдрийн гүйцэтгэл оруулах'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Өнөөдрийн гүйцэтгэл оруулах').first);
    await tester.pumpAndSettle();

    // Дүгнэлт is the newest of the four controllers this sheet owns, and it sits
    // below the fold of the sheet's own list.
    await tester.scrollUntilVisible(
      find.byKey(const Key('task-conclusion-field')),
      200,
      scrollable: find
          .descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(Scrollable),
          )
          .first,
    );
    await tester.pumpAndSettle();
    await tester.enterText(
      find.descendant(
        of: find.byKey(const Key('task-conclusion-field')),
        matching: find.byType(TextField),
      ),
      'Тоноглол хэвийн.',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Болих'));
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('the inspection report sheet survives a typed cancel and its teardown', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_user),
          workIdentityProvider.overrideWith((Ref ref) async => _assignedIdentity),
          plannedWorkDetailProvider.overrideWith(_StubDetailAwaitingReport.new),
          inspectionReportProvider.overrideWith(_StubInspectionDraft.new),
        ],
        child: const MaterialApp(
          home: PlannedWorkDetailScreen(plannedWorkId: 'w1'),
        ),
      ),
    );
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Тайлан бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Тайлан бичих'));
    await tester.pumpAndSettle();
    expect(find.text('Үзлэгийн тайлан бичих'), findsOneWidget);

    await tester.enterText(
      find
          .descendant(
            of: find.byType(BottomSheet),
            matching: find.byType(TextField),
          )
          .first,
      'Бүх самбарыг хамруулсан.',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Болих'));
    await tester.pumpAndSettle();
    expect(find.text('Үзлэгийн тайлан бичих'), findsNothing);
    expect(tester.takeException(), isNull);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}


// -- Claiming open work ------------------------------------------------------
//
// The pool was read-only until `POST /service-requests/:id/claim` existed. The only
// route onto a request before it was `/assign`, guarded by `dispatch.assign` and taking
// an arbitrary employee id, so a per-row button could only ever have returned 403.

/// A technician who may also claim.
const AppUser _userWithClaim = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'planned_work.view',
    'service_request.view',
    'service_request.claim',
  },
);

/// Answers `claimServiceRequest` and nothing else.
///
/// `noSuchMethod` rather than sixteen stub methods: the pool is supplied by an override,
/// so claiming is the only call this screen makes through the repository, and a stub for
/// each of the others would be fifteen lines asserting nothing.
/// Records what `plannedWorkBoardProvider` asked `GET /planned-work` for.
///
/// The parameters are the assertion, not an implementation detail: "Миний" sending
/// `employeeId` was the bug, because the server ANDs it with `teamId` and the rule it
/// enforces is a union.
class _ListRepository implements WorkRepository {
  _ListRepository({
    this.items = const <PlannedWorkListItemModel>[],
    this.requests = const <ServiceRequestListItemModel>[],
  });

  final List<PlannedWorkListItemModel> items;

  /// What `GET /service-requests` answers — the reader's rows AND the unclaimed queue
  /// together, exactly as the live route does.
  final List<ServiceRequestListItemModel> requests;

  /// One `[employeeId, teamId]` pair per call, in order.
  final List<List<String?>> calls = <List<String?>>[];

  /// How many times the request list was asked for, and with what — nothing, which is
  /// the assertion: an `employeeId` filter ANDs with the server's own predicate.
  int requestCalls = 0;

  @override
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork({
    String? employeeId,
    String? teamId,
    PlannedWorkEffectiveStatus? status,
    String? search,
  }) async {
    calls.add(<String?>[employeeId, teamId]);
    return Success<PaginatedData<PlannedWorkListItemModel>>(
      PaginatedData<PlannedWorkListItemModel>(
        items: items,
        page: 1,
        limit: 20,
        total: items.length,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listAssignedServiceRequests() async {
    requestCalls += 1;
    return Success<PaginatedData<ServiceRequestListItemModel>>(
      PaginatedData<ServiceRequestListItemModel>(
        items: requests,
        page: 1,
        limit: 100,
        total: requests.length,
        totalPages: 1,
      ),
    );
  }

  /// The detail read, answered from the row this stub already holds, so the screen the
  /// navigation lands on carries the SAME number the list showed.
  @override
  Future<ApiResult<ServiceRequestDetailModel?>> getServiceRequestDetail(
    String requestId,
  ) async {
    for (final ServiceRequestListItemModel row in requests) {
      if (row.id == requestId) {
        return Success<ServiceRequestDetailModel?>(
          _detailFor(
            id: row.id,
            number: row.requestNumber,
            deviceName: row.device?.name,
          ),
        );
      }
    }
    return const Success<ServiceRequestDetailModel?>(null);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _ClaimRepository implements WorkRepository {
  _ClaimRepository(this._result);

  final ApiResult<void> _result;
  final List<String> claimed = <String>[];

  @override
  Future<ApiResult<void>> claimServiceRequest(String requestId) async {
    claimed.add(requestId);
    return _result;
  }

  /// The pool's one row, as the detail route answers it. Unclaimed — no employee and no
  /// team — because that is the branch `includeUnclaimed: true` admits, and it is the
  /// whole reason a technician can read a job before deciding to take it.
  @override
  Future<ApiResult<ServiceRequestDetailModel?>> getServiceRequestDetail(
    String requestId,
  ) async =>
      Success<ServiceRequestDetailModel?>(
        _detailFor(
          id: requestId,
          number: 'SR-202607-0044',
          deviceName: 'Лифт №2',
        ),
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The detail read the request screen makes on open.
///
/// Answered by both list stubs because opening a request is a navigation these tests
/// perform, and an unstubbed read would put an error banner on the screen they assert
/// about. What the detail screen does with a full record is
/// `service_request_detail_test.dart`'s subject; here it only has to agree with the row
/// that was tapped.
ServiceRequestDetailModel _detailFor({
  required String id,
  required String number,
  String? deviceName,
}) =>
    ServiceRequestDetailModel.fromJson(<String, dynamic>{
      'id': id,
      'requestNumber': number,
      'customer': <String, dynamic>{'id': 'c', 'name': 'Central Tower ХХК'},
      'building': <String, dynamic>{'id': 'b', 'name': 'Төв байр'},
      if (deviceName != null)
        'device': <String, dynamic>{'id': 'd', 'name': deviceName},
      'requestType': 'REPAIR',
      'status': 'UNASSIGNED',
      'isUrgent': false,
      'description': 'Лифт зогссон.',
      'contactName': 'Бат',
      'contactPhone': '99112233',
      'attachments': <dynamic>[],
    });


