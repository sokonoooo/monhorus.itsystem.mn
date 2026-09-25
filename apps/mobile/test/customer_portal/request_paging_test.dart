// A list that stops is not a list that ended.
//
// The Идэвхтэй / Дууссан / Бүгд tabs read one page of 100 and threw the server's own
// `total` away, so a customer with 150 requests was shown 100 of them with no total, no
// pager and nothing on the screen saying that a third of their history was missing. The
// app already contains the answer — `_allBuildings` page-walks under a ceiling and the
// hero blanks the figure it cannot stand behind — and this is that pattern applied here.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/service_request_list_screen.dart';

import 'fakes.dart';

List<ServiceRequestListItemModel> _requests(int count) {
  return <ServiceRequestListItemModel>[
    for (int i = 0; i < count; i++)
      serviceRequestFixture(
        id: '7100000000000000000${1000 + i}',
        requestNumber: 'SR-202607-${1000 + i}',
      ),
  ];
}

ProviderContainer _container(FakeCustomerPortalRepository repository) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(testCustomer),
      customerPortalRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('a customer with more requests than one page holds', () {
    test('every page is read, and the walk knows it reached the end', () async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requests: _requests(150),
        requestPageSize: 100,
      );

      final CustomerServiceRequests answer =
          await _container(repository).read(customerServiceRequestsProvider.future);

      expect(repository.requestPagesRequested, containsAllInOrder(<int>[1, 2]));
      expect(answer.requests.length, 150);
      expect(answer.total, 150);
      expect(answer.complete, isTrue);
    });

    test('one page that already covers everything asks for no second one', () async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requests: _requests(4),
        requestPageSize: 100,
      );

      final CustomerServiceRequests answer =
          await _container(repository).read(customerServiceRequestsProvider.future);

      expect(repository.requestPagesRequested, isNot(contains(2)));
      expect(answer.complete, isTrue);
      expect(answer.requests.length, 4);
    });

    test('a walk cut short by the ceiling reports itself incomplete', () async {
      // 150 requests served one at a time cannot be walked inside the loop guard, so
      // the read is partial — and says so rather than passing 20 rows off as the lot.
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requests: _requests(150),
        requestPageSize: 1,
      );

      final CustomerServiceRequests answer =
          await _container(repository).read(customerServiceRequestsProvider.future);

      expect(answer.complete, isFalse);
      expect(answer.total, 150);
      expect(answer.requests.length, lessThan(150));
    });

    testWidgets('the list screen shows all 150 and says how many there are',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requests: _requests(150),
        requestPageSize: 100,
      );

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          const ServiceRequestListScreen(),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      expect(repository.requestPagesRequested, containsAllInOrder(<int>[1, 2]));
      expect(find.text('ИДЭВХТЭЙ ХҮСЭЛТҮҮД · 150'), findsOneWidget);
    });

    testWidgets('and when it could not read them all it says that instead',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requests: _requests(150),
        requestPageSize: 1,
      );

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          const ServiceRequestListScreen(),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      // No count in the caption: a partial figure presented as a count is the thing
      // this is fixing.
      expect(find.text('ИДЭВХТЭЙ ХҮСЭЛТҮҮД · 150'), findsNothing);
      expect(
        find.textContaining('жагсаалт бүрэн ачаалагдсангүй'),
        findsOneWidget,
      );
    });
  });
}
