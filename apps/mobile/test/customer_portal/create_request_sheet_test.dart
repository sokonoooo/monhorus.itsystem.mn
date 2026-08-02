import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/create_request_sheet.dart';

import 'fakes.dart';

void main() {
  Future<void> pumpPhone(WidgetTester tester, Widget widget) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(widget);
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

    expect(find.text('Хүсэлт илгээгдлээ'), findsOneWidget);
    expect(find.text('Хүсэлт харах'), findsOneWidget);
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
