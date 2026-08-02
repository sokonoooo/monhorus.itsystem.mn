// The service-request conclusion, device by device.
//
// The editor is the only place a per-equipment finding is authored on mobile, and the
// payload it produces is the whole point: `objectAssessments` must carry a SEPARATE score
// per object, never one visit-level figure copied across them. That is asserted directly.
//
// No network anywhere: the repository and the two picker reads are overridden.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/media/photo_capture.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/work/data/models/work_report_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/conclusion_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/conclusion_editor_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';

const String kRequestId = 'r1';
const String kBuildingId = 'b1';

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
  String? conclusion,
  String? recommendation,
}) {
  return <String, dynamic>{
    'id': 'rep1',
    'serviceRequestId': kRequestId,
    'status': status,
    'conclusion': conclusion,
    'recommendation': recommendation,
    'beforePhotos': <dynamic>[],
    'afterPhotos': <dynamic>[],
    'objects': objects,
    'objectAssessments': assessments,
    'missing': <dynamic>[],
    'isComplete': false,
  };
}

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
  }) : report = initial ?? _report();

  Map<String, dynamic> report;
  final Failure? saveFailure;

  final List<SaveWorkReportRequest> saved = <SaveWorkReportRequest>[];
  int submits = 0;
  int reads = 0;

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
    return Success<WorkReportModel>(
      WorkReportModel.fromJson(<String, dynamic>{...report, 'status': 'SUBMITTED'}),
    );
  }

  @override
  Future<ApiResult<WorkReportPhotoModel>> uploadWorkReportPhoto(CapturedPhoto photo) async {
    return Success<WorkReportPhotoModel>(
      WorkReportPhotoModel.fromJson(<String, dynamic>{'id': 'p1', 'name': 'a.jpg'}),
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
}) =>
    ObjectListItemModel.fromJson(<String, dynamic>{
      'id': id,
      'code': code,
      'name': name,
      'customerId': 'c1',
      'status': status,
      'floorId': 'f1',
      'floorName': '2-р давхар',
    });

Future<void> _pumpEditor(
  WidgetTester tester, {
  required WorkRepository repository,
  AppUser user = _author,
  List<FloorModel> floors = const <FloorModel>[],
  List<ObjectListItemModel> equipment = const <ObjectListItemModel>[],
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 1400));
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
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[currentUserProvider.overrideWithValue(_author)],
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
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[currentUserProvider.overrideWithValue(_reader)],
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

    final Finder scores = find.widgetWithText(TextField, '0-100');
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
    await tester.enterText(find.widgetWithText(TextField, '0-100').at(0), '77');
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
    await tester.enterText(find.widgetWithText(TextField, '0-100').first, '50');
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
    await tester.enterText(find.widgetWithText(TextField, '0-100').first, '80');
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
    await tester.enterText(find.widgetWithText(TextField, '0-100').first, '64');
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
