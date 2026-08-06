import 'dart:async';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/core/media/photo_capture.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/object_master_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/create_request_sheet.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/floor_plan_markers.dart';

import 'fakes.dart';

/// A [PortalPhotoPicker] that always yields the same picture, standing in for the
/// camera. `image_picker` has no test binding, so the real picker would come back as
/// [PhotoCaptureFailed] on every tap and the submit path would be unreachable now that
/// a photo is mandatory.
Future<PhotoCaptureResult> fakePick(BuildContext _) async => PhotoCaptured(
      CapturedPhoto(
        bytes: Uint8List.fromList(<int>[1, 2, 3, 4]),
        filename: 'gemtel.png',
        mimeType: 'image/png',
      ),
    );

/// A picker the user backed out of. Must leave no error and no attachment.
Future<PhotoCaptureResult> cancelPick(BuildContext _) async =>
    const PhotoCaptureCancelled();

void main() {
  Future<void> pumpPhone(WidgetTester tester, Widget widget) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();
  }

  /// Adds one picture through the injected picker. The button sits below the fold on
  /// a phone-sized sheet, so it is scrolled into view first.
  Future<void> addPhoto(WidgetTester tester, {String label = 'Зураг нэмэх'}) async {
    final Finder button = find.widgetWithText(OutlinedButton, label);
    await tester.ensureVisible(button);
    await tester.pumpAndSettle();
    await tester.tap(button);
    await tester.pumpAndSettle();
  }

  testWidgets('the sheet refuses a description below the schema minimum',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        const Scaffold(body: CreateRequestSheet(scope: testScope)),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    expect(find.text('Дуудлага илгээх'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField).last, 'ok');
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    // Both the missing building and the short description must block the call.
    expect(find.text('Барилга заавал сонгоно.'), findsOneWidget);
    expect(
      find.textContaining(
        'Тайлбар дор хаяж '
        '${CreateServiceRequestRequestModel.descriptionMinLength}',
      ),
      findsOneWidget,
    );
    expect(repository.created, isEmpty);
  });

  testWidgets('the sheet rejects a phone the shared schema would reject',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    final Finder phoneField = find.byType(TextFormField).at(1);
    await tester.enterText(phoneField, '1234');
    await tester.enterText(
      find.byType(TextFormField).last,
      'Гэрэл асахгүй байна.',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    expect(find.text('Утасны дугаар буруу форматтай байна.'), findsOneWidget);
    expect(repository.created, isEmpty);
  });

  testWidgets('a valid submission sends the scoped customer id and confirms',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            deviceName: 'LDB-2F-02',
            initialUrgent: true,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await tester.enterText(
      find.byType(TextFormField).last,
      'Хэт ачаалал илэрсэн, яаралтай шалгана уу.',
    );
    await tester.pumpAndSettle();

    await addPhoto(tester);
    // The picture goes up first: the create call can only name a file that exists.
    expect(repository.uploadedPhotos, hasLength(1));
    expect(repository.created, isEmpty);

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    expect(repository.created, hasLength(1));
    final CreateServiceRequestRequestModel sent = repository.created.single;
    expect(sent.customerId, testScope.customerId);
    expect(sent.buildingId, buildingFixture().id);
    // Nothing this app holds can populate `deviceId`; see the device-page test below.
    expect(sent.deviceId, isNull);
    expect(sent.isUrgent, isTrue);
    // The urgent switch preselects the urgent call type, matching the SLA the
    // backend applies to it.
    expect(sent.requestType, ServiceRequestType.urgentCall);
    expect(sent.contactPhone, '9911-2233');
    // The id the upload minted, claimed by this request.
    expect(sent.attachmentIds, hasLength(1));
    expect(sent.attachmentIds.single, isNotEmpty);

    expect(find.text('Хүсэлт илгээгдлээ'), findsOneWidget);
    expect(find.text('Хүсэлт харах'), findsOneWidget);
  });

  /// The rule this sheet exists to enforce. A request with no picture is a request a
  /// dispatcher cannot triage, and the shared create schema deliberately does NOT
  /// demand one — the admin web and staff flows post through it and send none — so the
  /// customer flow is the only place the requirement can live.
  testWidgets('the sheet refuses to submit with no image',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    // Everything else is valid, so the picture is the only thing left to refuse on.
    await tester.enterText(
      find.byType(TextFormField).last,
      'Коридорын гэрэл анивчиж байна.',
    );
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    expect(
      find.text('Асуудлыг харуулсан дор хаяж нэг зураг заавал хавсаргана.'),
      findsOneWidget,
    );
    expect(repository.created, isEmpty);
    expect(repository.uploadedPhotos, isEmpty);
  });

  testWidgets('the same form submits once an image is attached',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await tester.enterText(
      find.byType(TextFormField).last,
      'Коридорын гэрэл анивчиж байна.',
    );
    await tester.pumpAndSettle();

    // Refused first, so the pass below is the picture and nothing else.
    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();
    expect(repository.created, isEmpty);

    await addPhoto(tester);
    // The refusal is cleared by the act that answers it, not left on screen.
    expect(
      find.text('Асуудлыг харуулсан дор хаяж нэг зураг заавал хавсаргана.'),
      findsNothing,
    );

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    expect(repository.created, hasLength(1));
    expect(repository.created.single.attachmentIds, hasLength(1));
    expect(find.text('Хүсэлт илгээгдлээ'), findsOneWidget);
  });

  /// Backing out of the camera is the most common outcome of tapping a photo button.
  /// It must leave the form exactly as it was: no error, and nothing uploaded.
  testWidgets('a cancelled pick attaches nothing and reports nothing',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            pickPhoto: cancelPick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await addPhoto(tester);

    expect(repository.uploadedPhotos, isEmpty);
    expect(find.textContaining('алдаа'), findsNothing);
    // Still the empty-state label, so nothing was silently added.
    expect(find.widgetWithText(OutlinedButton, 'Зураг нэмэх'), findsOneWidget);
  });

  /// A failed upload must not be mistaken for an attached picture: the id would never
  /// exist and the create call would be refused by the server for naming it.
  testWidgets('a rejected upload leaves the request unsendable',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
      uploadFailure: const ServerFailure('Файл хэт том байна.', code: 'VALIDATION_ERROR'),
    );

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await tester.enterText(
      find.byType(TextFormField).last,
      'Коридорын гэрэл анивчиж байна.',
    );
    await tester.pumpAndSettle();

    await addPhoto(tester);
    expect(find.text('Файл хэт том байна.'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'Илгээх'));
    await tester.pumpAndSettle();

    expect(repository.created, isEmpty);
  });

  testWidgets('a device with no create permission offers no sticky action',
      (WidgetTester tester) async {
    await pumpPhone(
      tester,
      wrapCustomerScreen(
        const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
        repository: FakeCustomerPortalRepository(),
      ),
    );

    expect(find.byType(CreateRequestSheet), findsNothing);
    expect(find.text('Засварын хүсэлт илгээх'), findsNothing);
  });

  // -- Байршил ---------------------------------------------------------------

  /// The building and floor selectors, in the order the sheet renders them. The
  /// request-type chooser is a `DropdownButtonFormField<ServiceRequestType>` and so is
  /// deliberately not in this list.
  Finder locationDropdowns() => find.byType(DropdownButtonFormField<String>);

  /// Fills the parts of the form that are not what a test is about, attaches the
  /// mandatory picture and sends it.
  Future<void> completeAndSubmit(
    WidgetTester tester, {
    String description = 'Коридорын гэрэл анивчиж байна.',
  }) async {
    await tester.enterText(find.byType(TextFormField).last, description);
    await tester.pumpAndSettle();
    await addPhoto(tester);

    final Finder submit = find.widgetWithText(FilledButton, 'Илгээх');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();
  }

  /// The zone (Өрөө/Бүс) picker this sheet used to carry, now deliberately absent.
  ///
  /// The Өрөө/Бүс register is the administrator's own hierarchy, and a customer
  /// reporting a fault does not think in it — the location they can actually give is the
  /// floor and, when there is a drawing, the spot on it. So the sheet must offer no zone
  /// control at all, and the payload must name no room: a `roomId` still exists on
  /// [CreateServiceRequestRequestModel] because the API contract has one and other
  /// callers may set it, which is exactly why this asserts on what LEAVES the sheet
  /// rather than on the field's existence.
  testWidgets('the sheet offers no zone control and sends no roomId',
      (WidgetTester tester) async {
    final FloorModel floor = floorFixture();
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            initialFloorId: floor.id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    // Building and floor only. A third string dropdown would be the zone picker back.
    expect(locationDropdowns(), findsNWidgets(2));
    expect(find.textContaining('Өрөө/Бүс'), findsNothing);
    // The "unpick" entry the zone list carried, and the sentence a zoneless floor got.
    expect(find.text('Сонгохгүй'), findsNothing);
    expect(find.textContaining('өрөө/бүс бүртгэгдээгүй'), findsNothing);

    await completeAndSubmit(tester);

    expect(repository.created, hasLength(1));
    final CreateServiceRequestRequestModel sent = repository.created.single;
    expect(sent.floorId, floor.id);
    expect(sent.roomId, isNull);
    expect(sent.toJson().containsKey('roomId'), isFalse);
  });

  // -- Планд тэмдэглэх -------------------------------------------------------

  FakeCustomerPortalRepository repositoryWithPlan() =>
      FakeCustomerPortalRepository(
        floorPlan: floorPlanFixture(),
        fileBytes: planPngBytes,
      );

  /// Pumps a sheet whose floor has a drawing, with that drawing already decoded.
  ///
  /// Two facts make this necessary. The PNG is decoded by the real image codec, which
  /// only runs inside [WidgetTester.runAsync]; and until it has, the sheet shows a
  /// spinner, an animation `pumpAndSettle` waits on until it times out. But `runAsync`
  /// cannot be used with the tree already built, because `google_fonts` would then get
  /// a live event loop too and throw on its network fetch.
  ///
  /// So the decode happens BEFORE the first frame and lands in the global image cache.
  /// `MemoryImage` keys on the identity of its byte list, and the fake hands out the
  /// one [planPngBytes] instance, so the widget's own `resolve` is then a cache hit
  /// that reports the size synchronously — the path `_IntrinsicallySizedImage` already
  /// handles — and no spinner is ever built.
  Future<void> pumpPhoneWithPlan(WidgetTester tester, Widget widget) async {
    await tester.runAsync(() async {
      final Completer<void> decoded = Completer<void>();
      MemoryImage(planPngBytes).resolve(ImageConfiguration.empty).addListener(
            ImageStreamListener(
              (ImageInfo _, bool __) {
                if (!decoded.isCompleted) decoded.complete();
              },
              onError: (Object error, StackTrace? _) {
                if (!decoded.isCompleted) decoded.completeError(error);
              },
            ),
          );
      await decoded.future;
    });

    await pumpPhone(tester, widget);
  }

  /// Taps the plan at the given fraction of its painted rectangle.
  ///
  /// The rectangle is read off [FloorPlanPinLayer] itself, which is exactly the drawing
  /// because `AuthenticatedImage.sizedToImage` sized the box from the image — so the
  /// fraction tapped here is the fraction the sheet must send.
  Future<void> tapPlanAt(WidgetTester tester, double fx, double fy) async {
    final Finder layer = find.byType(FloorPlanPinLayer);
    await tester.ensureVisible(layer);
    await tester.pumpAndSettle();

    final Rect rect = tester.getRect(layer);
    await tester.tapAt(
      Offset(rect.left + rect.width * fx, rect.top + rect.height * fy),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('tapping the plan sends the normalised planPosition',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = repositoryWithPlan();

    await pumpPhoneWithPlan(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            initialFloorId: floorFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    expect(find.byType(FaultPin), findsNothing);
    await tapPlanAt(tester, 0.25, 0.5);
    expect(find.byType(FaultPin), findsOneWidget);

    await completeAndSubmit(tester);

    final PlanPositionModel? sent = repository.created.single.planPosition;
    expect(sent, isNotNull);
    // A hair of tolerance for the device-pixel rounding between the tap and the box.
    expect(sent!.x, closeTo(0.25, 0.02));
    expect(sent.y, closeTo(0.5, 0.02));
  });

  testWidgets('a plan the customer never touched sends no planPosition',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = repositoryWithPlan();

    await pumpPhoneWithPlan(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            initialFloorId: floorFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    // The control is there and unused, which must submit exactly as it did before the
    // pin existed.
    expect(find.byType(FloorPlanPinLayer), findsOneWidget);
    expect(find.byType(FaultPin), findsNothing);

    await completeAndSubmit(tester);

    expect(repository.created.single.planPosition, isNull);
    expect(find.text('Хүсэлт илгээгдлээ'), findsOneWidget);
  });

  testWidgets('clearing the mark removes the planPosition again',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = repositoryWithPlan();

    await pumpPhoneWithPlan(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            initialFloorId: floorFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await tapPlanAt(tester, 0.6, 0.3);
    expect(find.byType(FaultPin), findsOneWidget);

    final Finder clear = find.widgetWithText(TextButton, 'Тэмдэглэгээг арилгах');
    await tester.ensureVisible(clear);
    await tester.pumpAndSettle();
    await tester.tap(clear);
    await tester.pumpAndSettle();

    expect(find.byType(FaultPin), findsNothing);

    await completeAndSubmit(tester);
    expect(repository.created.single.planPosition, isNull);
  });

  testWidgets('a floor with no plan image offers no pin control',
      (WidgetTester tester) async {
    // `GET /floors/:floorId/plan` answers `data: null` for a floor with no drawing.
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        Scaffold(
          body: CreateRequestSheet(
            scope: testScope,
            initialBuildingId: buildingFixture().id,
            initialFloorId: floorFixture().id,
            pickPhoto: fakePick,
          ),
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    expect(find.byType(FloorPlanPinLayer), findsNothing);
    expect(
      find.textContaining('Энэ давхарт план зураг ачаалагдаагүй'),
      findsOneWidget,
    );

    await completeAndSubmit(tester);
    expect(repository.created.single.planPosition, isNull);
  });

  // -- The device-page defect ------------------------------------------------

  /// The test the 400 got past.
  ///
  /// `object.id` is an object-MASTER id and `deviceId` names an `ObjectNode`, so every
  /// request raised from a device page was refused with
  /// `{"field":"deviceId","message":"Төхөөрөмж олдсонгүй."}` and a 400 — which is why
  /// all fifteen requests in the development database carry no device. Nothing in the
  /// suite noticed, because the fake repository accepts any id at all. Asserting on
  /// what LEAVES the app is what closes that gap: the payload must carry no device id,
  /// and the device must still be identifiable from the record.
  testWidgets('a request raised from a device page sends no unresolvable deviceId',
      (WidgetTester tester) async {
    final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository();

    await pumpPhone(
      tester,
      wrapCustomerScreen(
        DeviceDetailScreen(
          objectId: objectFixture().id,
          pickPhoto: fakePick,
        ),
        repository: repository,
        user: customerWithCreateRight(),
      ),
    );

    await tester.tap(find.text('Засварын хүсэлт илгээх'));
    await tester.pumpAndSettle();
    expect(find.byType(CreateRequestSheet), findsOneWidget);

    // The description arrives pre-filled with the device's identity, so nothing is
    // typed here: what the sheet opened with is what must reach the server.
    await addPhoto(tester);
    final Finder submit = find.widgetWithText(FilledButton, 'Илгээх');
    await tester.ensureVisible(submit);
    await tester.pumpAndSettle();
    await tester.tap(submit);
    await tester.pumpAndSettle();

    expect(repository.created, hasLength(1));
    final CreateServiceRequestRequestModel sent = repository.created.single;
    expect(sent.deviceId, isNull);
    // Still says which device, in the one field the dispatcher reads.
    expect(sent.description, contains(objectFixture().name));
    expect(sent.description, contains(objectFixture().code));
    // And the assessor's own recommendation is carried through rather than dropped.
    expect(
      sent.description,
      contains('Холбогч хэсгийг яаралтай шалгаж, ачааллыг салгана.'),
    );
  });
}
