// The service-request conclusion, device by device.
//
// The editor is the only place a per-equipment finding is authored on mobile, and the
// payload it produces is the whole point: `objectAssessments` must carry a SEPARATE score
// per object, never one visit-level figure copied across them. That is asserted directly.
//
// No network anywhere: the repository and the two picker reads are overridden.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/media/photo_capture.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/data/models/work_report_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/conclusion_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/widgets/equipment_assessment_card.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/conclusion_editor_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';

const String kRequestId = 'r1';
const String kBuildingId = 'b1';
const String kEmployeeId = 'emp-1';

/// The employee card the assignment mirror compares the record against.
///
/// Overridden wherever the DETAIL SCREEN is built, never left to the real
/// `GET /employees/me`: that read is what decides whether the screen believes this request
/// is the reader's, so leaving it to fail over the network would make the presence of the
/// conclusion pill accidental.
const ResolvedWorkIdentity _identity = ResolvedWorkIdentity(
  employeeId: kEmployeeId,
  employeeCode: 'E-1',
  fullName: 'Дорж Ganbold',
  positionName: null,
  teamId: null,
  teamName: null,
);

/// A technician who may author a conclusion.
const AppUser _author = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'service_request.view', 'service_request.update'},
);

/// A technician who may only read.
const AppUser _reader = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'service_request.view'},
);

Map<String, dynamic> _report({
  String status = 'DRAFT',
  List<Map<String, dynamic>> objects = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> assessments = const <Map<String, dynamic>>[],
  int? score,
  String? conclusion,
  String? recommendation,
  List<String> beforePhotoIds = const <String>[],
  List<String> afterPhotoIds = const <String>[],
  List<String> missing = const <String>[],
  String? actionTaken,
  // The office's four fields, absent by default so every existing case still describes a
  // report this app authored on its own.
  List<Map<String, dynamic>>? materials,
  bool? repairRequired,
  bool? revisitRequired,
  String? revisitDate,
}) {
  List<Map<String, dynamic>> photos(List<String> ids) => ids
      .map((String id) => <String, dynamic>{'id': id, 'name': '$id.jpg'})
      .toList();

  return <String, dynamic>{
    'id': 'rep1',
    'serviceRequestId': kRequestId,
    'status': status,
    'score': score,
    'conclusion': conclusion,
    'recommendation': recommendation,
    'beforePhotos': photos(beforePhotoIds),
    'afterPhotos': photos(afterPhotoIds),
    'objects': objects,
    'objectAssessments': assessments,
    'missing': missing,
    'isComplete': missing.isEmpty,
    'actionTaken': actionTaken,
    if (materials != null) 'materials': materials,
    if (repairRequired != null) 'repairRequired': repairRequired,
    if (revisitRequired != null) 'revisitRequired': revisitRequired,
    if (revisitDate != null) 'revisitDate': revisitDate,
  };
}

/// The detail read the screen now makes, stubbed.
///
/// These two cases are about the conclusion ACTIONS, not about the record, so the
/// record is the smallest honest one. Overridden rather than left to the real
/// repository because the screen shows a spinner while the read is in flight and
/// `pumpAndSettle` never returns on one.
Override _detailOverride([ServiceRequestDetailModel? detail]) {
  return serviceRequestDetailProvider(kRequestId)
      .overrideWith((Ref ref) async => detail);
}

/// ASSIGNED TO THE READER AND ON SITE, because the way into the editor is now gated on
/// both. `GET /service-requests/:id/report` mints a draft attributed to the caller, so the
/// pill is drawn only for the employee the job actually belongs to, and only once they have
/// reported arriving; a record that was neither — this fixture named nobody and sat in
/// ASSIGNED — no longer draws it at all.
ServiceRequestDetailModel _detail() =>
    ServiceRequestDetailModel.fromJson(<String, dynamic>{
      'id': kRequestId,
      'requestNumber': 'SR-202608-0001',
      'requestType': 'REPAIR',
      'status': 'ON_SITE',
      'assignedEmployees': <Map<String, dynamic>>[
        <String, dynamic>{'id': kEmployeeId, 'name': 'Дорж'},
      ],
      'isUrgent': false,
      'description': 'Гэрэлтүүлэг унтарсан.',
      'contactName': 'Бат',
      'contactPhone': '99112233',
      'attachments': <dynamic>[],
      'building': <String, dynamic>{'id': kBuildingId, 'name': 'Төв байр'},
    });

Map<String, dynamic> _object(String id, String code, String name) => <String, dynamic>{
      'id': id,
      'code': code,
      'name': name,
    };

/// Answers the four conclusion calls and records what was sent.
class _ReportRepository implements WorkRepository {
  _ReportRepository({
    Map<String, dynamic>? initial,
    this.saveFailure,
    this.submitFailure,
  }) : report = initial ?? _report();

  Map<String, dynamic> report;
  final Failure? saveFailure;
  final Failure? submitFailure;

  final List<SaveWorkReportRequest> saved = <SaveWorkReportRequest>[];
  int submits = 0;
  int reads = 0;
  int uploads = 0;

  @override
  Future<ApiResult<WorkReportModel>> getWorkReport(String requestId) async {
    reads += 1;
    return Success<WorkReportModel>(WorkReportModel.fromJson(report));
  }

  @override
  Future<ApiResult<WorkReportModel>> saveWorkReport(
    String requestId,
    SaveWorkReportRequest request,
  ) async {
    saved.add(request);
    final Failure? failure = saveFailure;
    if (failure != null) return FailureResult<WorkReportModel>(failure);
    return Success<WorkReportModel>(WorkReportModel.fromJson(report));
  }

  @override
  Future<ApiResult<WorkReportModel>> submitWorkReport(String requestId) async {
    submits += 1;
    final Failure? failure = submitFailure;
    if (failure != null) return FailureResult<WorkReportModel>(failure);
    return Success<WorkReportModel>(
      WorkReportModel.fromJson(<String, dynamic>{...report, 'status': 'SUBMITTED'}),
    );
  }

  @override
  Future<ApiResult<WorkReportPhotoModel>> uploadWorkReportPhoto(CapturedPhoto photo) async {
    uploads += 1;
    // A distinct id per upload: two strips both receiving "p1" would let a test pass on a
    // payload that had put the same photograph in both slots.
    return Success<WorkReportPhotoModel>(
      WorkReportPhotoModel.fromJson(<String, dynamic>{'id': 'p$uploads', 'name': 'a.jpg'}),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

FloorModel _floor(String id, String name) => FloorModel.fromJson(<String, dynamic>{
      'id': id,
      'name': name,
      'code': name,
      'buildingId': kBuildingId,
    });

ObjectListItemModel _equipment(
  String id,
  String code,
  String name, {
  String status = 'ACTIVE',
  List<Map<String, dynamic>> attributes = const <Map<String, dynamic>>[],
  Map<String, dynamic> attributeValues = const <String, dynamic>{},
}) =>
    ObjectListItemModel.fromJson(<String, dynamic>{
      'id': id,
      'code': code,
      'name': name,
      'customerId': 'c1',
      'status': status,
      'floorId': 'f1',
      'floorName': '2-р давхар',
      // The type's own declared fields ride on the type reference every object row carries,
      // which is what lets a picked card ask them with no extra round trip.
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'code': 'MCB',
        'name': 'Автомат таслуур',
        'icon': 'BREAKER',
        'attributes': attributes,
      },
      'attributeValues': attributeValues,
    });

Future<void> _pumpEditor(
  WidgetTester tester, {
  required WorkRepository repository,
  AppUser user = _author,
  List<FloorModel> floors = const <FloorModel>[],
  List<ObjectListItemModel> equipment = const <ObjectListItemModel>[],
}) async {
  // Tall enough to build the whole form. The editor now also carries the visit's own
  // score and its two mandatory photo strips above the equipment, so a shorter surface
  // leaves the cards' own controls unbuilt — a ListView does not build what is off-screen.
  // Raised from 2200 when each card's score hint became the five band NAMES rather than
  // five numeric ranges: the names wrap one line further, and two expanded cards pushed
  // the save pill past the bottom edge, where it is built but cannot be tapped.
  await tester.binding.setSurfaceSize(const Size(390, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(user),
        workRepositoryProvider.overrideWithValue(repository),
        conclusionFloorsProvider(kBuildingId).overrideWith((Ref ref) async => floors),
        for (final FloorModel floor in floors)
          conclusionEquipmentProvider(floor.id).overrideWith((Ref ref) async => equipment),
      ],
      child: const MaterialApp(
        home: ConclusionEditorScreen(
          requestId: kRequestId,
          requestNumber: 'SR-202608-0001',
          buildingId: kBuildingId,
          buildingName: 'Төв байр',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// [FieldLabel] and [EmployeePill] both render their text upper-cased, so an assertion on the label a widget was
/// given has to do the same. Written as a helper rather than as hard-coded upper-case
/// strings so the test still reads as the words the UI was asked for.
Finder _label(String text) => find.text(text.toUpperCase());

/// The score field of an EQUIPMENT CARD, never the visit's own.
///
/// The editor now carries a visit-level score as well — it is one of the five fields
/// `workReportCompleteness` requires — and it uses the same 0-100 hint, so an unscoped
/// finder would reach it first and these assertions would silently move off the per-object
/// scores they exist to protect.
Finder _cardScores() => find.descendant(
      of: find.byType(EquipmentAssessmentCard),
      matching: find.widgetWithText(TextField, '0-100'),
    );

/// Scrolls the editor to an action and taps it.
///
/// The save and submit pills sit below every equipment card, so on a phone-sized surface
/// they leave the viewport as soon as two cards are expanded — and a ListView does not
/// build what is off-screen, so a plain `tap` finds nothing.
Future<void> _tapAction(WidgetTester tester, String label) async {
  await tester.scrollUntilVisible(
    find.text(label),
    240,
    scrollable: find.byType(Scrollable).first,
  );
  await tester.tap(find.text(label));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('the detail screen offers the editor and does not embed the form', (
    WidgetTester tester,
  ) async {
    // Taller than the 800px default: the screen now carries the description, the site
    // contact and the attachments above this action, so on a default surface the pill
    // is off-screen and a ListView does not build what is not visible.
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_author),
          workIdentityProvider.overrideWith((Ref ref) async => _identity),
          _detailOverride(_detail()),
        ],
        child: const MaterialApp(
          home: ServiceRequestDetailScreen(
            requestId: kRequestId,
            requestNumber: 'SR-202608-0001',
            subject: 'Гэрэлтүүлэг',
            location: 'Төв байр · 2-р давхар',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Дүгнэлт бичих'), findsOneWidget);
    // The form itself must not be here: reading the report CREATES it, so an embedded
    // editor would make every visitor its author.
    expect(_label('Ерөнхий дүгнэлт'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a read-only account is offered viewing rather than authoring', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_reader),
          workIdentityProvider.overrideWith((Ref ref) async => _identity),
          _detailOverride(_detail()),
        ],
        child: const MaterialApp(
          home: ServiceRequestDetailScreen(
            requestId: kRequestId,
            requestNumber: 'SR-202608-0001',
            subject: 'Гэрэлтүүлэг',
            location: 'Төв байр',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Дүгнэлт харах'), findsOneWidget);
    expect(find.textContaining('service_request.update'), findsOneWidget);
  });

  testWidgets('opening the editor reads the report exactly once', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository();
    await _pumpEditor(tester, repository: repository);

    expect(repository.reads, 1);
    expect(_label('Ерөнхий дүгнэлт'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('an empty conclusion says it will not reach the inspection feed', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(tester, repository: _ReportRepository());

    expect(
      find.textContaining('"Үзлэг ба дүгнэлт" хэсэгт харагдахгүй'),
      findsOneWidget,
    );
  });

  testWidgets('floors load for the request building', (WidgetTester tester) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(),
      floors: <FloorModel>[_floor('f1', '2-р давхар')],
    );

    expect(find.text('Төв байр'), findsOneWidget);
    expect(find.text('Давхар сонгоно уу'), findsOneWidget);
  });

  testWidgets('selecting a floor lists its equipment and adds the chosen objects', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(),
      floors: <FloorModel>[_floor('f1', '2-р давхар')],
      equipment: <ObjectListItemModel>[
        _equipment('o1', 'DB-01', 'Самбар 1'),
        _equipment('o2', 'DB-02', 'Самбар 2'),
      ],
    );

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2-р давхар').last);
    await tester.pumpAndSettle();

    await tester.tap(find.text('Тоноглол нэмэх'));
    await tester.pumpAndSettle();

    // Both offered, both selectable.
    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.tap(find.text('DB-02 · Самбар 2'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Сонгосныг нэмэх'));
    await tester.pumpAndSettle();

    expect(_label('Үнэлгээ хийсэн тоноглол (2)'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  /// The heart of it: two objects, two different scores, two assessments on the wire.
  testWidgets('each object carries its own score into the payload', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(
        objects: <Map<String, dynamic>>[
          _object('o1', 'DB-01', 'Самбар 1'),
          _object('o2', 'DB-02', 'Самбар 2'),
        ],
      ),
    );
    await _pumpEditor(tester, repository: repository);

    // Both cards start collapsed because neither says anything yet; opening them is the
    // real interaction and is what puts the score fields on screen.
    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DB-02 · Самбар 2'));
    await tester.pumpAndSettle();

    final Finder scores = _cardScores();
    expect(scores, findsNWidgets(2));

    await tester.enterText(scores.at(0), '95');
    await tester.enterText(scores.at(1), '22');
    await tester.pumpAndSettle();

    await _tapAction(tester, 'Ноорогт хадгалах');

    expect(repository.saved, hasLength(1));
    final SaveWorkReportRequest payload = repository.saved.single;

    expect(payload.objectAssessments, hasLength(2));
    final Map<String, int?> byObject = <String, int?>{
      for (final SaveObjectAssessment entry in payload.objectAssessments)
        entry.objectId: entry.score,
    };
    // Separate, and NOT one shared figure copied across both.
    expect(byObject['o1'], 95);
    expect(byObject['o2'], 22);
    // The visit-level score is not what carries an equipment finding.
    expect(payload.score, isNull);
  });

  testWidgets('values survive collapsing and reopening a card', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(
        objects: <Map<String, dynamic>>[
          _object('o1', 'DB-01', 'Самбар 1'),
          _object('o2', 'DB-02', 'Самбар 2'),
        ],
      ),
    );
    await _pumpEditor(tester, repository: repository);

    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.enterText(_cardScores().at(0), '77');
    await tester.pumpAndSettle();

    // Collapse the first card, then reopen it.
    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();

    await _tapAction(tester, 'Ноорогт хадгалах');

    final Map<String, int?> byObject = <String, int?>{
      for (final SaveObjectAssessment entry in repository.saved.single.objectAssessments)
        entry.objectId: entry.score,
    };
    expect(byObject['o1'], 77);
  });

  testWidgets('an existing report rehydrates its findings', (WidgetTester tester) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(
          conclusion: 'Ерөнхий дүгнэлт бичсэн.',
          recommendation: 'Дахин шалгах.',
          objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')],
          assessments: <Map<String, dynamic>>[
            <String, dynamic>{
              'objectId': 'o1',
              'code': 'DB-01',
              'name': 'Самбар 1',
              'score': 42,
              'observation': 'Хэт халалт',
              'conclusion': 'Засвар',
              'recommendation': 'Ачаалал тэнцвэржүүлэх',
              'photoIds': <dynamic>[],
            },
          ],
        ),
      ),
    );

    expect(find.text('Ерөнхий дүгнэлт бичсэн.'), findsOneWidget);
    expect(find.text('Дахин шалгах.'), findsOneWidget);
    expect(find.text('42'), findsOneWidget);
    expect(find.text('Хэт халалт'), findsOneWidget);
    // A card that already says something opens, rather than hiding the finding.
    expect(_label('Үнэлсэн'), findsOneWidget);
  });

  /// A finding whose equipment has gone away must not be silently discarded.
  testWidgets('an item for unavailable equipment stays visible and read-only', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(
          // Named in the findings but absent from `objects`: the object no longer resolves.
          objects: const <Map<String, dynamic>>[],
          assessments: <Map<String, dynamic>>[
            <String, dynamic>{
              'objectId': 'gone',
              'code': 'DB-99',
              'name': 'Хуучин самбар',
              'score': 30,
              'photoIds': <dynamic>[],
            },
          ],
        ),
      ),
    );

    expect(_label('Олдохгүй'), findsOneWidget);
    expect(find.textContaining('бүртгэлээс хасагдсан'), findsOneWidget);
    // Read-only: no way to drop it and no way to edit it.
    expect(find.text('Энэ тоноглолыг хасах'), findsNothing);
  });

  testWidgets('removing a card with typed data asks first', (WidgetTester tester) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
    );
    await _pumpEditor(tester, repository: repository);

    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.enterText(_cardScores().first, '50');
    await tester.pumpAndSettle();

    await tester.tap(find.text('Энэ тоноглолыг хасах'));
    await tester.pumpAndSettle();

    expect(find.text('Бичсэн үнэлгээ устна'), findsOneWidget);

    // Backing out keeps the card and the value.
    await tester.tap(find.text('Болих'));
    await tester.pumpAndSettle();
    expect(_label('Үнэлгээ хийсэн тоноглол (1)'), findsOneWidget);
  });

  testWidgets('an empty card is removed without a warning', (WidgetTester tester) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
      ),
    );

    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Энэ тоноглолыг хасах'));
    await tester.pumpAndSettle();

    expect(find.text('Бичсэн үнэлгээ устна'), findsNothing);
    expect(_label('Үнэлгээ хийсэн тоноглол (0)'), findsOneWidget);
  });

  /// An object carrying nothing must not become a ReportItem: that would assert a finding
  /// nobody made, and drag the conclusion into the feed on a placeholder.
  testWidgets('an object with no entered data sends no assessment', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
    );
    await _pumpEditor(tester, repository: repository);

    await _tapAction(tester, 'Ноорогт хадгалах');

    final SaveWorkReportRequest payload = repository.saved.single;
    // Still a member, so the selection survives and can be filled in later...
    expect(payload.objectIds, <String>['o1']);
    // ...but no finding is asserted about it.
    expect(payload.objectAssessments, isEmpty);
  });

  testWidgets('submitting saves first, then submits', (WidgetTester tester) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
    );
    await _pumpEditor(tester, repository: repository);

    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.enterText(_cardScores().first, '80');
    await tester.pumpAndSettle();
    await _tapAction(tester, 'Хянуулахаар илгээх');

    // Saved before submitting: submission validates what is STORED, so submitting an
    // unsaved draft would report blockers already fixed on screen.
    expect(repository.saved, hasLength(1));
    expect(repository.submits, 1);
  });

  testWidgets('a submitted report is read-only', (WidgetTester tester) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(initial: _report(status: 'SUBMITTED')),
    );

    expect(find.textContaining('төлөвт байна'), findsOneWidget);
    expect(find.text('Ноорогт хадгалах'), findsNothing);
    expect(find.text('Хянуулахаар илгээх'), findsNothing);
  });

  testWidgets('a reader sees the conclusion but no save controls', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(tester, repository: _ReportRepository(), user: _reader);

    expect(find.text('Зөвхөн харах эрхтэй'), findsOneWidget);
    expect(find.text('Ноорогт хадгалах'), findsNothing);
  });

  /// A refusal must not read as a network problem: the remedies are different.
  testWidgets('a forbidden save is explained as a permission problem', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
        saveFailure: const ServerFailure('Forbidden', code: 'FORBIDDEN'),
      ),
    );

    await _tapAction(tester, 'Ноорогт хадгалах');

    expect(find.textContaining('эрх байхгүй байна'), findsOneWidget);
  });

  testWidgets('a stale conflict is explained as somebody else having changed it', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        saveFailure: const ServerFailure('Conflict', code: 'DUPLICATE_KEY'),
      ),
    );

    await _tapAction(tester, 'Ноорогт хадгалах');

    expect(find.textContaining('өөр хүн саяхан өөрчилсөн'), findsOneWidget);
  });

  testWidgets('a failed load is an error with a retry, not a blank screen', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1200));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          currentUserProvider.overrideWithValue(_author),
          // The load fails at the repository, which is where a real outage would be.
          workRepositoryProvider.overrideWithValue(_FailingRepository()),
        ],
        child: const MaterialApp(
          home: ConclusionEditorScreen(
            requestId: kRequestId,
            requestNumber: 'SR-202608-0001',
            buildingId: kBuildingId,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Дахин оролдох'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  /// Changing floors is a picker change, not a discard: a visit routinely covers two, and
  /// dropping a half-written finding on switching would be the data loss a warning exists
  /// to prevent.
  testWidgets('changing floor keeps already-selected equipment and its values', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
    );
    await _pumpEditor(
      tester,
      repository: repository,
      floors: <FloorModel>[_floor('f1', '2-р давхар'), _floor('f2', '3-р давхар')],
      equipment: <ObjectListItemModel>[_equipment('o9', 'DB-09', 'Самбар 9')],
    );

    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();
    await tester.enterText(_cardScores().first, '64');
    await tester.pumpAndSettle();

    // Switch floors.
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('3-р давхар').last);
    await tester.pumpAndSettle();

    // No confirmation, because nothing was discarded.
    expect(find.text('Бичсэн үнэлгээ устна'), findsNothing);
    expect(_label('Үнэлгээ хийсэн тоноглол (1)'), findsOneWidget);

    await _tapAction(tester, 'Ноорогт хадгалах');
    expect(repository.saved.single.objectAssessments.single.score, 64);
  });

  /// Regression: WorkButton is a full-width pill and cannot lay out as a non-flexed Row
  /// child. Every action on this screen is on its own line, and this pins that.
  testWidgets('the editor lays out with no overflow or unbounded-width exception', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(
          objects: <Map<String, dynamic>>[
            _object('o1', 'DB-01', 'Самбар 1'),
            _object('o2', 'DB-02', 'Самбар 2'),
          ],
        ),
      ),
      floors: <FloorModel>[_floor('f1', '2-р давхар')],
      equipment: <ObjectListItemModel>[_equipment('o3', 'DB-03', 'Самбар 3')],
    );

    expect(find.text('Ноорогт хадгалах'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  // -- What is missing, said out loud ----------------------------------------
  //
  // `workReportCompleteness` refuses a submission over five VISIT-LEVEL fields — score,
  // conclusion, recommendation, one before photo and one after photo — and none of them is
  // satisfied by a filled-in equipment card. The server names every empty one in `missing`
  // and in the `issues` of its refusal; the app parsed both and rendered neither, so a
  // technician who had written up every device was told only "Дүгнэлт дутуу тул илгээх
  // боломжгүй." with nothing to act on. These cases hold the naming.

  testWidgets('a report missing one field names THAT field', (WidgetTester tester) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(missing: <String>['RECOMMENDATION']),
      ),
    );

    expect(find.text('Илгээхэд дутуу байна (1)'), findsOneWidget);
    expect(find.textContaining('• Зөвлөмж'), findsOneWidget);
    // And nothing else is claimed to be missing.
    expect(find.textContaining('• Ерөнхий үнэлгээ'), findsNothing);
    expect(find.textContaining('• Ажлын өмнөх зураг'), findsNothing);
  });

  testWidgets('every missing field is named, including the invisible ones', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(
          missing: <String>['SCORE', 'BEFORE_PHOTO', 'AFTER_PHOTO'],
          objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')],
          assessments: <Map<String, dynamic>>[
            <String, dynamic>{
              'objectId': 'o1',
              'code': 'DB-01',
              'name': 'Самбар 1',
              'score': 90,
              'conclusion': 'Хэвийн.',
              'photoIds': <dynamic>['q1'],
            },
          ],
        ),
      ),
    );

    // A fully written-up device does not satisfy any of the three, and the banner says so
    // in the same Mongolian the web console uses.
    expect(find.text('Илгээхэд дутуу байна (3)'), findsOneWidget);
    expect(find.textContaining('• Ерөнхий үнэлгээ (0-100)'), findsOneWidget);
    expect(find.textContaining('• Ажлын өмнөх зураг'), findsOneWidget);
    expect(find.textContaining('• Ажлын дараах зураг'), findsOneWidget);
  });

  testWidgets('a refused submission repeats the server\'s field list, not "дутуу"', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      submitFailure: const ServerFailure(
        'Дүгнэлт дутуу тул илгээх боломжгүй.',
        code: 'VALIDATION_ERROR',
        fieldErrors: <String, String>{
          'SCORE': 'Заавал бөглөнө.',
          'AFTER_PHOTO': 'Заавал бөглөнө.',
        },
      ),
    );
    await _pumpEditor(tester, repository: repository);

    await _tapAction(tester, 'Хянуулахаар илгээх');

    // The generic sentence on its own was the bug: it restates the refusal instead of
    // naming what to do about it.
    expect(
      find.textContaining('Дутуу байна: Ерөнхий үнэлгээ (0-100), Ажлын дараах зураг'),
      findsOneWidget,
    );
    // And the same two are marked on the form itself.
    expect(find.text('Илгээхэд дутуу байна (2)'), findsOneWidget);
  });

  testWidgets('a requirement refusal is not silently filed against an equipment card', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')]),
      submitFailure: const ServerFailure(
        'Дүгнэлт дутуу тул илгээх боломжгүй.',
        code: 'VALIDATION_ERROR',
        fieldErrors: <String, String>{'SCORE': 'Заавал бөглөнө.'},
      ),
    );
    await _pumpEditor(tester, repository: repository);

    await _tapAction(tester, 'Хянуулахаар илгээх');

    // `itemErrors` is keyed by object id, so a SCORE entry matched no card and vanished.
    // It belongs to the visit, and is now shown there.
    expect(find.textContaining('• Ерөнхий үнэлгээ (0-100)'), findsOneWidget);
  });

  // -- The three fields the app could not send --------------------------------

  /// The equipment type's own declared fields, on the card a technician fills in (4.1).
  ///
  /// Nothing in the app names an attribute: the definitions ride on the picked row's type
  /// reference, so a field added in Тоноглолын төрөл is asked here with no release.
  testWidgets('an equipment card asks its type\'s questions and sends the answers', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(initial: _report());
    await _pumpEditor(
      tester,
      repository: repository,
      floors: <FloorModel>[_floor('f1', '2-р давхар')],
      equipment: <ObjectListItemModel>[
        _equipment(
          'o1',
          'MCB-01',
          'Автомат таслуур 1',
          attributes: <Map<String, dynamic>>[
            <String, dynamic>{
              'key': 'fuse',
              'label': 'Хайлмал хамгаалалт',
              'type': 'SELECT',
              'required': true,
              'options': <Map<String, dynamic>>[
                <String, dynamic>{'value': 'FUSED', 'label': 'Хайлмалтай'},
                <String, dynamic>{'value': 'NOT_FUSED', 'label': 'Хайлмалгүй'},
              ],
            },
          ],
          // Already on record, so the card opens on it rather than blank: these are standing
          // facts about the kit, and a blank draft saved back would clear them.
          attributeValues: <String, dynamic>{'fuse': 'NOT_FUSED'},
        ),
      ],
    );

    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('2-р давхар').last);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Тоноглол нэмэх'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('MCB-01 · Автомат таслуур 1'));
    await tester.pumpAndSettle();
    await tester.tap(find.textContaining('Сонгосныг нэмэх'));
    await tester.pumpAndSettle();

    expect(find.text('ХАЙЛМАЛ ХАМГААЛАЛТ (ЗААВАЛ)'), findsOneWidget);
    expect(find.text('Хайлмалтай'), findsOneWidget);

    await tester.tap(find.text('Хайлмалтай'));
    await tester.pumpAndSettle();
    await _tapAction(tester, 'Ноорогт хадгалах');

    // The answer travels with the finding and the server writes it onto the EQUIPMENT.
    expect(
      repository.saved.single.objectAssessments.single.attributeValues,
      <String, Object?>{'fuse': 'FUSED'},
    );
  });

  testWidgets('the visit score is enterable and reaches the payload', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(missing: <String>['SCORE']),
    );
    await _pumpEditor(tester, repository: repository);

    // No equipment on this report, so the only 0-100 field is the visit's own.
    await tester.enterText(find.widgetWithText(TextField, '0-100'), '88');
    await tester.pumpAndSettle();
    await _tapAction(tester, 'Ноорогт хадгалах');

    // Was hard-coded null, which made SCORE permanently unsatisfiable from this app.
    expect(repository.saved.single.score, 88);
  });

  test('visit photographs are held and sent as the visit\'s, not an object\'s', () async {
    final _ReportRepository repository = _ReportRepository();
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_author),
        workRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);

    const ConclusionRef ref = (requestId: kRequestId, buildingId: kBuildingId);
    await container.read(conclusionEditorProvider(ref).future);
    final ConclusionEditor editor = container.read(conclusionEditorProvider(ref).notifier);

    final CapturedPhoto photo = CapturedPhoto(
      bytes: Uint8List.fromList(<int>[1, 2, 3]),
      filename: 'a.jpg',
      mimeType: 'image/jpeg',
    );
    expect(await editor.attachVisitPhoto(VisitPhotoSlot.before, photo), isNull);
    expect(await editor.attachVisitPhoto(VisitPhotoSlot.after, photo), isNull);
    await editor.save();

    final SaveWorkReportRequest payload = repository.saved.single;
    // Distinct slots, distinct ids — and NOT on any equipment assessment.
    expect(payload.beforePhotoIds, <String>['p1']);
    expect(payload.afterPhotoIds, <String>['p2']);
    expect(payload.objectAssessments, isEmpty);
  });

  test('removing a visit photograph actually removes it from the payload', () async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(beforePhotoIds: <String>['old1', 'old2']),
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_author),
        workRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);

    const ConclusionRef ref = (requestId: kRequestId, buildingId: kBuildingId);
    await container.read(conclusionEditorProvider(ref).future);
    final ConclusionEditor editor = container.read(conclusionEditorProvider(ref).notifier);

    editor.removeVisitPhoto(VisitPhotoSlot.before, 'old1');
    await editor.save();

    // The payload used to echo `report.beforePhotos` back, so a removal here came straight
    // back on the next read.
    expect(repository.saved.single.beforePhotoIds, <String>['old2']);
  });

  // -- The office's own fields -------------------------------------------------
  //
  // `materials`, `repairRequired`, `revisitRequired`, `revisitDate` and `actionTaken` are
  // entered on the web console and this app draws no control for any of them. `PUT
  // .../report` REPLACES the record and the schema defaults every one of them, so the
  // payload used to erase all five — two hard-coded `false`s, a hard-coded `null` and two
  // absent keys — the instant a technician tapped save.

  test('saving from the phone relays the office fields rather than erasing them', () async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(
        actionTaken: 'Автомат таслуур сольсон.',
        materials: <Map<String, dynamic>>[
          <String, dynamic>{'name': 'Кабель 3x2.5', 'quantity': 12.5, 'unit': 'METRE'},
          <String, dynamic>{'name': 'Автомат таслуур', 'quantity': 2, 'unit': 'PIECE'},
        ],
        repairRequired: true,
        revisitRequired: true,
        revisitDate: '2026-09-01T00:00:00.000Z',
      ),
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_author),
        workRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);

    const ConclusionRef ref = (requestId: kRequestId, buildingId: kBuildingId);
    await container.read(conclusionEditorProvider(ref).future);
    final ConclusionEditor editor = container.read(conclusionEditorProvider(ref).notifier);

    // A perfectly ordinary edit on this app: the technician touches the narrative and
    // saves. Nothing they did says anything about materials or the revisit.
    editor.setConclusion('Ажил дууссан.');
    await editor.save();

    // Asserted on the encoded body, not on the object, because it is the JSON the server
    // replaces the record from.
    final Map<String, dynamic> sent = repository.saved.single.toJson();
    expect(sent['conclusion'], 'Ажил дууссан.');
    expect(sent['actionTaken'], 'Автомат таслуур сольсон.');
    expect(sent['repairRequired'], isTrue);
    expect(sent['revisitRequired'], isTrue);
    expect(sent['revisitDate'], '2026-09-01T00:00:00.000Z');
    expect(sent['materials'], <Map<String, dynamic>>[
      <String, dynamic>{'name': 'Кабель 3x2.5', 'quantity': 12.5, 'unit': 'METRE'},
      <String, dynamic>{'name': 'Автомат таслуур', 'quantity': 2, 'unit': 'PIECE'},
    ]);
    // A whole quantity goes back whole: `2.0` is a different body from `2`.
    expect((sent['materials'] as List<dynamic>)[1]['quantity'], isA<int>());
  });

  test('a report with no office fields sends a payload the schema accepts', () async {
    final _ReportRepository repository = _ReportRepository(
      initial: <String, dynamic>{
        ..._report(),
        // Explicit nulls as well as absent keys, and one material row the server's own
        // schema would refuse back (`name` min(1), `quantity` positive) alongside one
        // whose quantity is not a number at all.
        'repairRequired': null,
        'revisitRequired': null,
        'revisitDate': null,
        'materials': <dynamic>[
          <String, dynamic>{'name': '', 'quantity': 3, 'unit': 'PIECE'},
          <String, dynamic>{'name': 'Гагнуурын утас', 'quantity': 0},
          <String, dynamic>{'name': 'Тусгаарлагч тууз', 'quantity': '4'},
          <String, dynamic>{'name': 'Сум', 'quantity': 1},
        ],
      },
    );
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_author),
        workRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);

    const ConclusionRef ref = (requestId: kRequestId, buildingId: kBuildingId);
    await container.read(conclusionEditorProvider(ref).future);
    final ConclusionEditor editor = container.read(conclusionEditorProvider(ref).notifier);

    expect(await editor.save(), isNull);

    final Map<String, dynamic> sent = repository.saved.single.toJson();
    expect(sent['repairRequired'], isFalse);
    expect(sent['revisitRequired'], isFalse);
    expect(sent['revisitDate'], isNull);
    expect(sent['actionTaken'], isNull);
    // Only the one well-formed row survives, and the unit falls back to the schema's own
    // default rather than being dropped.
    expect(sent['materials'], <Map<String, dynamic>>[
      <String, dynamic>{'name': 'Сум', 'quantity': 1, 'unit': 'PIECE'},
    ]);
  });

  testWidgets('both visit photo slots are drawn and labelled', (WidgetTester tester) async {
    await _pumpEditor(tester, repository: _ReportRepository());

    expect(_label('Ажлын өмнөх зураг (0)'), findsOneWidget);
    expect(_label('Ажлын дараах зураг (0)'), findsOneWidget);
    expect(_label('Ерөнхий үнэлгээ (0-100)'), findsOneWidget);
  });

  testWidgets('a complete conclusion submits with nothing reported missing', (
    WidgetTester tester,
  ) async {
    final _ReportRepository repository = _ReportRepository(
      initial: _report(
        score: 84,
        conclusion: 'Ажил дууссан.',
        recommendation: '3 сарын дараа дахин үзэх.',
        beforePhotoIds: <String>['b1'],
        afterPhotoIds: <String>['a1'],
        objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')],
      ),
    );
    await _pumpEditor(tester, repository: repository);

    expect(find.textContaining('Илгээхэд дутуу байна'), findsNothing);

    await _tapAction(tester, 'Хянуулахаар илгээх');

    expect(repository.submits, 1);
    // Every visit-level requirement travels with the save that precedes the submission.
    final SaveWorkReportRequest payload = repository.saved.single;
    expect(payload.score, 84);
    expect(payload.conclusion, 'Ажил дууссан.');
    expect(payload.recommendation, '3 сарын дараа дахин үзэх.');
    expect(payload.beforePhotoIds, <String>['b1']);
    expect(payload.afterPhotoIds, <String>['a1']);
    expect(find.text('Хянуулахаар илгээлээ.'), findsOneWidget);
  });

  /// The band boundaries are runtime-configurable server-side (`riskBandsOf`) and neither
  /// mobile role can read `GET /settings` — `SETTINGS_VIEW` is admin/management/finance
  /// only, so the app gets a 403. The card used to print all five ranges
  /// ("81-100 хэвийн · 61-80 анхаарах · …") under a comment claiming it mirrored the
  /// object assessment sheet, which prints names alone. Numbers this app cannot verify and
  /// the server can silently contradict were being scored against.
  ///
  /// The ABSENCE is the assertion. Checking only that the names are present would pass
  /// just as happily with the ranges printed beside them.
  testWidgets('an equipment card names the risk bands and quotes no score range', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(
      tester,
      repository: _ReportRepository(
        initial: _report(
          objects: <Map<String, dynamic>>[_object('o1', 'DB-01', 'Самбар 1')],
        ),
      ),
    );

    // The scale line lives inside the expanded body, beside the score field it explains.
    await tester.tap(find.text('DB-01 · Самбар 1'));
    await tester.pumpAndSettle();

    final Finder card = find.byType(EquipmentAssessmentCard);

    for (final RiskLevel level in RiskLevel.values) {
      expect(
        find.descendant(of: card, matching: find.textContaining(level.label)),
        findsWidgets,
        reason: '${level.label} must be named on the card',
      );
    }

    // Read back off the tree rather than matched string by string, so a reworded or
    // re-ordered range is caught as surely as the original one.
    final Iterable<String> printed = tester
        .widgetList<Text>(find.descendant(of: card, matching: find.byType(Text)))
        .map((Text text) => text.data ?? text.textSpan?.toPlainText() ?? '');

    final RegExp anyRange = RegExp(r'\d+\s*-\s*\d+');
    for (final String line in printed) {
      // "0-100" is the input domain of the score field itself — the range of a number
      // the technician types, not a band boundary the server owns.
      expect(
        anyRange.hasMatch(line.replaceAll('0-100', '')),
        isFalse,
        reason: 'the card may not print a score band range, but shows: "$line"',
      );
    }

    expect(tester.takeException(), isNull);
  });
}

/// Every read fails, for the error-state check.
class _FailingRepository implements WorkRepository {
  @override
  Future<ApiResult<WorkReportModel>> getWorkReport(String requestId) async {
    return const FailureResult<WorkReportModel>(NetworkFailure());
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
