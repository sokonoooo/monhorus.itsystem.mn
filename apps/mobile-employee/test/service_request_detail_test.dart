// The service-request detail screen — the whole record, not just where it is.
//
// The screen used to make NO fetch at all and render purely from the list row it was
// handed. `ServiceRequestListItemDto` carries no description, no contact name, no contact
// phone and no attachments, so a technician who opened a request saw a location, a status
// and a deadline, and nothing whatever about the fault they had been sent to. These tests
// pin the five things that must now be on the screen, and the two states the read can
// land in that are not a record.
//
// No network anywhere: the detail read and the file read are both overridden.
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_vocabulary.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/widgets/request_attachment_gallery.dart';

const String kRequestId = 'r1';
const String kFileId = 'f1';
const String kEmployeeId = 'emp-1';

/// The permission set the seeded TECHNICIAN role now carries for a service request.
///
/// `service_request.approve_report` is deliberately still in here even though this app no
/// longer has an approve control anywhere: the default account holding the key is exactly
/// what makes the conclusion assertions at the bottom of this file mean something.
const Set<String> _fieldKeys = <String>{
  'service_request.view',
  'service_request.update',
  'service_request.self_progress',
  'service_request.approve_report',
};

const AppUser _technician = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: _fieldKeys,
);

AppUser _userWith(Set<String> permissions) => AppUser(
      id: 'u',
      fullName: 'Дорж Ganbold',
      email: 'd.ganbold@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: permissions,
    );

/// The employee card the assignment mirror compares against.
const ResolvedWorkIdentity _identity = ResolvedWorkIdentity(
  employeeId: kEmployeeId,
  employeeCode: 'E-1',
  fullName: 'Дорж Ganbold',
  positionName: null,
  teamId: null,
  teamName: null,
);

/// The row the detail read reports for a request assigned to the signed-in technician.
Map<String, dynamic> _me() => <String, dynamic>{'id': kEmployeeId, 'name': 'Дорж'};

/// Records what the screen asked the API to do. Nothing else on the contract is answered:
/// a call this fake does not implement is a call the screen should not be making.
class _ActionRepository implements WorkRepository {
  final List<({ServiceRequestStatus status, String? reason})> moves =
      <({ServiceRequestStatus status, String? reason})>[];

  @override
  Future<ApiResult<ServiceRequestDetailModel>> changeServiceRequestStatus({
    required String requestId,
    required ServiceRequestStatus status,
    String? reason,
  }) async {
    moves.add((status: status, reason: reason));
    return Success<ServiceRequestDetailModel>(
      ServiceRequestDetailModel.fromJson(
        _detailJson(assignedEmployees: <Map<String, dynamic>>[_me()])
          ..['status'] = status.wireValue,
      ),
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The detail DTO as the backend sends it.
///
/// `description`, `contactName`, `contactPhone` and `attachments` are the four fields
/// that exist ONLY here — the list DTO has none of them — so every one of them is
/// populated and asserted below.
Map<String, dynamic> _detailJson({
  List<Map<String, dynamic>> assignedEmployees = const <Map<String, dynamic>>[],
  Map<String, dynamic>? assignedTeam,
  String status = 'ASSIGNED',
  List<Map<String, dynamic>> attachments = const <Map<String, dynamic>>[],
}) {
  return <String, dynamic>{
    'id': kRequestId,
    'requestNumber': 'SR-202608-0042',
    'customer': <String, dynamic>{'id': 'c1', 'name': 'Ариг Банк'},
    'building': <String, dynamic>{'id': 'b1', 'name': 'Төв байр'},
    'floor': <String, dynamic>{'id': 'fl1', 'name': '3-р давхар'},
    'room': <String, dynamic>{'id': 'rm1', 'name': '304 тоот'},
    'device': <String, dynamic>{'id': 'd1', 'name': 'Гэрэлтүүлгийн самбар'},
    'requestType': 'REPAIR',
    'isUrgent': false,
    'status': status,
    'slaState': 'STARTED',
    'slaRemainingMinutes': 180,
    'assignedEmployees': assignedEmployees,
    'assignedTeam': assignedTeam,
    'createdAt': '2026-08-01T09:00:00.000Z',
    'description': 'Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.',
    'contactName': 'Батболд',
    'contactPhone': '99112233',
    'attachments': attachments,
    'locationPath': <Map<String, dynamic>>[
      <String, dynamic>{'id': 'b1', 'kind': 'BUILDING', 'name': 'Төв байр'},
      <String, dynamic>{'id': 'fl1', 'kind': 'FLOOR', 'name': '3-р давхар'},
      <String, dynamic>{'id': 'rm1', 'kind': 'ROOM', 'name': '304 тоот'},
    ],
  };
}

Map<String, dynamic> _attachment({
  String id = kFileId,
  String name = 'fault.jpg',
  String mimeType = 'image/jpeg',
}) {
  return <String, dynamic>{
    'id': id,
    'name': name,
    'downloadUrl': '/api/v1/files/$id',
    'mimeType': mimeType,
    'sizeBytes': 1024,
    'uploadedByName': 'Батболд',
    'uploadedAt': '2026-08-01T09:01:00.000Z',
  };
}

/// A 1x1 PNG, so the attachment path runs against bytes a decoder accepts rather than
/// against a stub that would only ever exercise the error branch.
final Uint8List _png = Uint8List.fromList(<int>[
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, //
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82,
]);

/// Opens the screen the way every call site does: with the list row's own facts, and a
/// stubbed detail read behind them.
Future<void> _pump(
  WidgetTester tester, {
  required AsyncValue<ServiceRequestDetailModel?> read,
  AppUser user = _technician,
  WorkIdentity identity = _identity,
  WorkRepository? repository,
}) async {
  await tester.binding.setSurfaceSize(const Size(390, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(user),
        // Always overridden, never left to the real read: `GET /employees/me` decides
        // whether the screen believes this request is the reader's, so leaving it to fail
        // over the network would make every assignment assertion here accidental.
        workIdentityProvider.overrideWith((Ref ref) async => identity),
        if (repository != null)
          workRepositoryProvider.overrideWithValue(repository),
        serviceRequestDetailProvider(kRequestId).overrideWith(
          (Ref ref) async => read.when(
            data: (ServiceRequestDetailModel? detail) => detail,
            loading: () => null,
            error: (Object error, StackTrace stack) =>
                Error.throwWithStackTrace(error, stack),
          ),
        ),
        workFileBytesProvider(kFileId).overrideWith((Ref ref) async => _png),
      ],
      child: const MaterialApp(
        home: ServiceRequestDetailScreen(
          requestId: kRequestId,
          requestNumber: 'SR-202608-0042',
          subject: 'Гэрэлтүүлгийн самбар',
          location: 'Ариг Банк · Төв байр',
          buildingId: 'b1',
          buildingName: 'Төв байр',
          statusLabel: 'Хуваарилагдсан',
          slaLabel: '3 цаг үлдсэн',
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

/// [FieldLabel] renders its text upper-cased, so an assertion on the caption a section
/// was given has to do the same.
Finder _caption(String text) => find.text(text.toUpperCase());

void main() {
  testWidgets('every part of the request is on the screen', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(attachments: <Map<String, dynamic>>[_attachment()]),
        ),
      ),
    );

    // 1 — where. The server's own breadcrumb, not the two names the list row carried.
    expect(
      find.text('Ариг Банк · Төв байр · 3-р давхар · 304 тоот'),
      findsOneWidget,
    );

    // 2 — what kind of job it is.
    expect(find.text('Засвар үйлчилгээ'), findsOneWidget);

    // 3 — who to talk to on site. Both halves: a name with no number is not a contact.
    expect(_caption('Холбоо барих'), findsOneWidget);
    expect(find.text('Батболд'), findsOneWidget);
    expect(find.text('99112233'), findsOneWidget);

    // 4 — the fault, in the customer's words. The single field the old screen's whole
    // "everything is on the row" argument was wrong about.
    expect(_caption('Тайлбар'), findsOneWidget);
    expect(
      find.text('Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.'),
      findsOneWidget,
    );

    // 5 — the photographs, through the authenticated loader. `GET /files/:id` needs the
    // Bearer header, so an `Image.network` here would draw a 401.
    expect(_caption('Хавсралт (1)'), findsOneWidget);
    expect(find.byType(AuthenticatedFileImage), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('a non-image attachment is listed rather than decoded', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            attachments: <Map<String, dynamic>>[
              _attachment(
                id: 'f2',
                name: 'акт.pdf',
                mimeType: 'application/pdf',
              ),
            ],
          ),
        ),
      ),
    );

    expect(find.text('акт.pdf'), findsOneWidget);
    // Nothing pretends to be a preview of a PDF.
    expect(find.byType(AuthenticatedFileImage), findsNothing);
    expect(tester.takeException(), isNull);
  });

  /// `GET /service-requests/:id` is assignment-scoped and answers 404 — not 403 — for a
  /// request that is not the caller's, so that the endpoint cannot be used to probe for
  /// other people's ids. That has to read as a sentence, not as a system error.
  testWidgets('a 404 is a not-found state, not a crash', (
    WidgetTester tester,
  ) async {
    await _pump(tester, read: const AsyncData<ServiceRequestDetailModel?>(null));

    expect(find.text('Хүсэлт олдсонгүй'), findsOneWidget);
    expect(find.textContaining('Өөр ажилтанд шилжсэн'), findsOneWidget);

    // The row's own facts survive it, so the screen is not blank...
    expect(find.text('Гэрэлтүүлгийн самбар'), findsOneWidget);
    expect(find.text('Ариг Банк · Төв байр'), findsOneWidget);
    // ...and the way into the conclusion is still there.
    expect(find.text('Дүгнэлт бичих'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  /// The "Нээлттэй" pool is admitted by the same scope (`includeUnclaimed: true`), which
  /// is the whole reason a technician can read a job before deciding to take it. A row
  /// with no employee AND no team is what the server calls unclaimed.
  testWidgets('an unclaimed request opened from the pool still renders in full', (
    WidgetTester tester,
  ) async {
    final ServiceRequestDetailModel unclaimed =
        ServiceRequestDetailModel.fromJson(
      _detailJson(
        status: 'UNASSIGNED',
        attachments: <Map<String, dynamic>>[_attachment()],
      ),
    );

    expect(unclaimed.assignedEmployees, isEmpty);
    expect(unclaimed.assignedTeam, isNull);

    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(unclaimed),
    );

    expect(find.text('Хүсэлт олдсонгүй'), findsNothing);
    expect(find.text('Хуваарилагдаагүй'), findsOneWidget);
    expect(
      find.text('Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.'),
      findsOneWidget,
    );
    expect(find.text('99112233'), findsOneWidget);
    expect(find.byType(AuthenticatedFileImage), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a failed read explains itself and keeps the row on screen', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: const AsyncValue<ServiceRequestDetailModel?>.error(
        NetworkFailure(),
        StackTrace.empty,
      ),
    );

    expect(find.text('Дэлгэрэнгүйг уншиж чадсангүй'), findsOneWidget);
    expect(find.textContaining('Сүлжээнд холбогдож чадсангүй'), findsOneWidget);
    // Not a 404: the request may well still be the reader's.
    expect(find.text('Хүсэлт олдсонгүй'), findsNothing);
    expect(find.text('Гэрэлтүүлгийн самбар'), findsOneWidget);
    expect(find.text('Дүгнэлт бичих'), findsOneWidget);
  });

  // -- Reporting your own progress -------------------------------------------
  //
  // The technician could not move a request AT ALL before `service_request.self_progress`
  // existed, because the only key that could was the office's whole authority over the
  // workflow. These pin the line that was drawn instead.

  /// THE INTERSECTION, on one status. From ON_SITE the matrix allows IN_PROGRESS, WAITING,
  /// RETURNED and CANCELLED; the last two are the office's. Offering four buttons of which
  /// two answer 403 is the failure mode this asserts against.
  testWidgets('offers only the transitions that are legal AND permitted', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'ON_SITE',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Гүйцэтгэж байна болгох'), findsOneWidget);
    expect(find.text('Түр хүлээгдсэн болгох'), findsOneWidget);

    // Legal from ON_SITE, and outside the self-progress set.
    expect(find.text('Буцаасан болгох'), findsNothing);
    expect(find.text('Цуцалсан болгох'), findsNothing);
    // In the set, and not an edge the graph has from here.
    expect(find.text('Замдаа болгох'), findsNothing);
    expect(find.text('Тайлан илгээсэн болгох'), findsNothing);

    expect(tester.takeException(), isNull);
  });

  testWidgets('sends the tapped transition to the API', (WidgetTester tester) async {
    final _ActionRepository repository = _ActionRepository();

    await _pump(
      tester,
      repository: repository,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'ASSIGNED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    await tester.tap(find.text('Хүлээн авсан болгох'));
    await tester.pumpAndSettle();

    expect(repository.moves, hasLength(1));
    expect(repository.moves.single.status, ServiceRequestStatus.accepted);
    // Nothing invented: ACCEPTED carries no reason requirement, so none is sent.
    expect(repository.moves.single.reason, isNull);
  });

  /// WAITING is the one state a technician can reach that `isReasonRequired` refuses
  /// without a reason. Prompting is not a courtesy — sending the move first would make a
  /// mandatory field something the technician discovers by being refused.
  testWidgets('a reason-requiring transition prompts before anything is sent', (
    WidgetTester tester,
  ) async {
    final _ActionRepository repository = _ActionRepository();

    await _pump(
      tester,
      repository: repository,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'ON_SITE',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    await tester.tap(find.text('Түр хүлээгдсэн болгох'));
    await tester.pumpAndSettle();

    // The sheet is open and NOTHING has been sent yet.
    expect(_caption('Шалтгаан'), findsOneWidget);
    expect(repository.moves, isEmpty);

    // An empty reason is refused here rather than round-tripped into a 400.
    await tester.tap(find.text('Хадгалах'));
    await tester.pumpAndSettle();
    expect(find.text('Шалтгаан заавал бөглөнө.'), findsOneWidget);
    expect(repository.moves, isEmpty);

    await tester.enterText(find.byType(TextField).first, 'Сэлбэг хүлээгдэж байна.');
    await tester.tap(find.text('Хадгалах'));
    await tester.pumpAndSettle();

    expect(repository.moves, hasLength(1));
    expect(repository.moves.single.status, ServiceRequestStatus.waiting);
    expect(repository.moves.single.reason, 'Сэлбэг хүлээгдэж байна.');
  });

  /// The silence that prompted the whole feature. A control that is simply absent looks
  /// like a broken app; the permission has to be NAMED.
  testWidgets('without the key the control is gone and the reason is on screen', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      user: _userWith(<String>{'service_request.view', 'service_request.update'}),
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'ON_SITE',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Гүйцэтгэж байна болгох'), findsNothing);
    expect(find.text('Төлөв өөрчлөх эрх байхгүй'), findsOneWidget);
    expect(find.textContaining('service_request.self_progress'), findsOneWidget);
  });

  /// Assignment is the other half of the server's rule, so the app mirrors it rather than
  /// offering a button whose only outcome is 403. An unclaimed request is READABLE — that
  /// is what makes "Нээлттэй" work — and claiming it is the separate act that makes it
  /// actionable, which the notice says out loud.
  testWidgets('an unclaimed request offers no transition and says to claim it first', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(_detailJson(status: 'UNASSIGNED')),
      ),
    );

    expect(find.text('Хүлээн авсан болгох'), findsNothing);
    expect(find.text('Энэ ажлыг эзэмшээгүй байна'), findsOneWidget);
    expect(find.textContaining('өөртөө авна уу'), findsOneWidget);
  });

  testWidgets("a colleague's request is named as theirs, not as a missing permission", (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'ON_SITE',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'emp-2', 'name': 'Бат'},
            ],
          ),
        ),
      ),
    );

    expect(find.text('Гүйцэтгэж байна болгох'), findsNothing);
    expect(find.text('Танд оногдоогүй ажил'), findsOneWidget);
    expect(find.text('Төлөв өөрчлөх эрх байхгүй'), findsNothing);
  });

  // -- A handed-in conclusion, which this app states and never settles --------
  //
  // "Дүгнэлт батлах" used to live at the bottom of this screen, drawn for the holder of
  // `service_request.approve_report` and replaced by a "Батлах эрх байхгүй" apology for
  // everyone else. Both are gone, and NOT because the permission moved. Approving a
  // conclusion is an OFFICE act performed on the web admin: it is the moment somebody other
  // than the author accepts the work and it lands in the report store. This app is where the
  // conclusion is WRITTEN, so an approve button here let the author sign off their own
  // report from the same screen they wrote it on.
  //
  // The route itself is untouched — `POST /service-requests/:id/report/approve` still exists
  // and the web admin still calls it. What was deleted is this client's whole chain down to
  // the data source. These tests pin the removal by PERMISSION rather than by screenshot:
  // the button must be absent for the accounts that would once have been given it, because
  // "no approving from the field app" is the rule, not "no approving without the key".

  /// The account that would have drawn the button. `_technician` holds
  /// `service_request.approve_report`, exactly as the seeded TECHNICIAN role does.
  testWidgets('the approve key no longer draws an approve control', (
    WidgetTester tester,
  ) async {
    expect(_fieldKeys, contains('service_request.approve_report'));

    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'REPORT_SUBMITTED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт батлах'), findsNothing);
    // Nor the apology that used to stand in for it: nothing on this screen claims a
    // permission is what is missing, because a permission is not what is missing.
    expect(find.text('Батлах эрх байхгүй'), findsNothing);
    expect(find.textContaining('service_request.approve_report'), findsNothing);
  });

  /// THE ACTUAL REQUIREMENT. `service_request.change_status` is the office's entire
  /// authority over a request and a strict superset of the approve key — the one account
  /// that could argue for the button. It does not get one either: the control is absent from
  /// this app for everybody, whatever they hold, because of WHERE approval happens rather
  /// than who may do it. An office user signed into the field app approves on the web.
  testWidgets('not even the office keys draw an approve control', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      user: _userWith(<String>{
        'service_request.view',
        'service_request.update',
        'service_request.self_progress',
        'service_request.approve_report',
        'service_request.change_status',
      }),
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'REPORT_SUBMITTED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт батлах'), findsNothing);
    expect(find.text('Батлах эрх байхгүй'), findsNothing);
    // And it is not a return control in disguise either.
    expect(find.text('Дүгнэлт буцаах'), findsNothing);
  });

  /// What replaced it: one neutral sentence, identical for every reader, saying where the
  /// conclusion has got to and who will settle it. A statement, not a withheld control.
  testWidgets('REPORT_SUBMITTED says the office will approve it', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'REPORT_SUBMITTED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт хянуулахаар илгээгдсэн'), findsOneWidget);
    expect(find.textContaining('оффис хянаж батална'), findsOneWidget);
  });

  /// The same sentence for a reader with nothing but `service_request.view`. Nothing is
  /// written from this section, so there is no grant to gate it on and none is read — the
  /// notice is a fact about the job, not an entitlement.
  testWidgets('the notice does not depend on any permission', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      user: _userWith(<String>{'service_request.view'}),
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'REPORT_SUBMITTED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт хянуулахаар илгээгдсэн'), findsOneWidget);
    expect(find.text('Дүгнэлт батлах'), findsNothing);
  });

  /// Nor on whose job it is. A colleague's request reads the same, for the same reason: the
  /// section makes no write, so there is nothing to withhold from somebody who cannot act.
  testWidgets("a colleague's submitted conclusion carries the same notice", (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'REPORT_SUBMITTED',
            assignedEmployees: <Map<String, dynamic>>[
              <String, dynamic>{'id': 'emp-2', 'name': 'Бат'},
            ],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт хянуулахаар илгээгдсэн'), findsOneWidget);
    expect(find.text('Дүгнэлт батлах'), findsNothing);
  });

  /// Nothing has been handed in yet, so there is nothing to say and no banner about it
  /// either — "waiting for the office" printed on an unwritten job is noise, not context.
  testWidgets('no conclusion notice before the conclusion is submitted', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'IN_PROGRESS',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт хянуулахаар илгээгдсэн'), findsNothing);
    expect(find.textContaining('оффис хянаж батална'), findsNothing);
    expect(find.text('Дүгнэлт батлах'), findsNothing);
    expect(find.text('Батлах эрх байхгүй'), findsNothing);
  });

  /// And not on a job that has been completed either: the sentence is about a conclusion
  /// awaiting the office, so it must not linger once the request has moved past that.
  testWidgets('no conclusion notice once the request has moved on', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      read: AsyncData<ServiceRequestDetailModel?>(
        ServiceRequestDetailModel.fromJson(
          _detailJson(
            status: 'COMPLETED',
            assignedEmployees: <Map<String, dynamic>>[_me()],
          ),
        ),
      ),
    );

    expect(find.text('Дүгнэлт хянуулахаар илгээгдсэн'), findsNothing);
    expect(find.text('Дүгнэлт батлах'), findsNothing);
  });
}
