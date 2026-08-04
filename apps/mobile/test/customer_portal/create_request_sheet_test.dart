import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/core/media/photo_capture.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/create_request_sheet.dart';

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
            deviceId: '6e0000000000000000000003',
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
    expect(sent.deviceId, '6e0000000000000000000003');
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
}
