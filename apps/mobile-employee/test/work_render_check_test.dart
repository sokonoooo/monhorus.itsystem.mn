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
import 'package:monhorus_employee/features/employee/work/data/models/task_material_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/planned_work_enums.dart';
import 'package:monhorus_employee/features/employee/work/presentation/widgets/task_materials_section.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/data/datasources/work_remote_data_source.dart';
import 'package:monhorus_employee/features/employee/work/data/models/inspection_report_model.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/planned_work_detail_screen.dart';
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
          'score': 88,
          'riskLevel': 'NORMAL',
          'recommendation': 'Боолт чангалах.',
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

/// One row of `GET /service-requests`, as the unclaimed pool answers it.
///
/// `assignedEmployees` is empty and stays empty: that is what makes a request part of
/// this pool, and a fixture with somebody in it would be testing a different list.
Map<String, dynamic> _request({
  required String id,
  required String number,
  required String status,
  bool isUrgent = false,
  String? deviceName,
  String? slaState,
  String? slaDueAt,
  int? slaRemainingMinutes,
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
      'assignedEmployees': <dynamic>[],
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
    expect(find.text('Бүх төлөвлөгөөт ажлыг харах'), findsOneWidget);
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


  testWidgets('the materials section lists what the sub-task consumed', (
    WidgetTester tester,
  ) async {
    await _pumpMaterials(
      tester,
      user: _userWithMaterials,
      repository: _MaterialRepository(
        usage: <TaskMaterialUsageModel>[
          TaskMaterialUsageModel.fromJson(<String, dynamic>{
            'id': 'u1',
            'materialItemId': 'm1',
            'materialCode': 'CBL-3X2.5',
            'materialName': 'Кабель 3x2.5',
            'quantity': 12,
            'unit': 'METRE',
            'usedByName': 'Б. Энхтөр',
          }),
        ],
      ),
    );

    expect(find.text('АШИГЛАСАН МАТЕРИАЛ (1)'), findsOneWidget);
    expect(find.text('12.0 метр'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('recording a material posts it against this sub-task', (
    WidgetTester tester,
  ) async {
    final _MaterialRepository repository = _MaterialRepository();
    await _pumpMaterials(tester, user: _userWithMaterials, repository: repository);

    await tester.tap(find.byType(DropdownButtonFormField<MaterialItemModel>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('CBL-3X2.5 · Кабель 3x2.5').last);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField).first, '7');
    await tester.tap(find.text('Материал нэмэх'));
    await tester.pumpAndSettle();

    expect(repository.added, hasLength(1));
    expect(repository.added.first.quantity, 7);
  });

  testWidgets('a finished sub-task keeps its rows but loses the controls', (
    WidgetTester tester,
  ) async {
    await _pumpMaterials(
      tester,
      user: _userWithMaterials,
      editable: false,
      repository: _MaterialRepository(
        usage: <TaskMaterialUsageModel>[
          TaskMaterialUsageModel.fromJson(<String, dynamic>{
            'id': 'u1',
            'materialItemId': 'm1',
            'materialCode': 'CBL-3X2.5',
            'materialName': 'Кабель 3x2.5',
            'quantity': 4,
            'unit': 'METRE',
          }),
        ],
      ),
    );

    expect(find.text('АШИГЛАСАН МАТЕРИАЛ (1)'), findsOneWidget);
    expect(find.text('Материал нэмэх'), findsNothing);
    expect(find.textContaining('Дэд ажил дууссан тул'), findsOneWidget);
  });

  /// Without `material.view` the section contributes nothing at all.
  testWidgets('the materials section is absent without material.view', (
    WidgetTester tester,
  ) async {
    await _pumpMaterials(
      tester,
      user: _userWithClaim,
      repository: _MaterialRepository(),
    );

    expect(find.textContaining('АШИГЛАСАН МАТЕРИАЛ'), findsNothing);
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
class _ClaimRepository implements WorkRepository {
  _ClaimRepository(this._result);

  final ApiResult<void> _result;
  final List<String> claimed = <String>[];

  @override
  Future<ApiResult<void>> claimServiceRequest(String requestId) async {
    claimed.add(requestId);
    return _result;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}


// -- Sub-task materials ------------------------------------------------------
//
// What a sub-task CONSUMED, which is deliberately not the equipment it assesses.

/// A technician who may also read the material catalogue.
const AppUser _userWithMaterials = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'planned_work.view',
    'planned_work.record_progress',
    'material.view',
  },
);

/// Answers only the two material reads and the add.
class _MaterialRepository implements WorkRepository {
  _MaterialRepository({this.usage = const <TaskMaterialUsageModel>[]});

  List<TaskMaterialUsageModel> usage;
  final List<({String materialItemId, double quantity})> added =
      <({String materialItemId, double quantity})>[];

  @override
  Future<ApiResult<PaginatedData<MaterialItemModel>>> listMaterialItems() async {
    return Success<PaginatedData<MaterialItemModel>>(
      PaginatedData<MaterialItemModel>(
        items: <MaterialItemModel>[
          MaterialItemModel.fromJson(<String, dynamic>{
            'id': 'm1',
            'code': 'CBL-3X2.5',
            'name': 'Кабель 3x2.5',
            'defaultUnit': 'METRE',
          }),
        ],
        page: 1,
        limit: 200,
        total: 1,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<List<TaskMaterialUsageModel>>> listTaskMaterials({
    required String plannedWorkId,
    required String taskId,
  }) async {
    return Success<List<TaskMaterialUsageModel>>(usage);
  }

  @override
  Future<ApiResult<TaskMaterialUsageModel>> addTaskMaterial({
    required String plannedWorkId,
    required String taskId,
    required String materialItemId,
    required double quantity,
    required MaterialUnit unit,
    String? note,
  }) async {
    added.add((materialItemId: materialItemId, quantity: quantity));
    return Success<TaskMaterialUsageModel>(
      TaskMaterialUsageModel.fromJson(<String, dynamic>{
        'id': 'u1',
        'materialItemId': materialItemId,
        'materialCode': 'CBL-3X2.5',
        'materialName': 'Кабель 3x2.5',
        'quantity': quantity,
        'unit': unit.wireValue,
      }),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<void> _pumpMaterials(
  WidgetTester tester, {
  required AppUser user,
  required WorkRepository repository,
  bool editable = true,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 1200));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(user),
        workRepositoryProvider.overrideWithValue(repository),
      ],
      child: MaterialApp(
        home: Scaffold(
          body: SingleChildScrollView(
            child: TaskMaterialsSection(
              plannedWorkId: 'w1',
              taskId: 't1',
              editable: editable,
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}
