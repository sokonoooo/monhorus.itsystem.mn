// Figures the portal must not invent.
//
// Two of them, both of which looked like data and were not:
//
//   * Every request card and the detail header drew a completion rail. Nothing on the
//     wire says how far a request got — `GET /calendar` reports `progressPercent: null`
//     for one, because a request has no quantity to be a percentage of — so the fill
//     was this app's own reading of a status ordering copied from a dispatch board.
//   * The home hero summed `riskSummary` over the first page of buildings and printed
//     the result as the customer's whole estate. Past one page the stair, the headline
//     and the "N БАРИЛГА" line were all short, with nothing saying so.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/customer_home_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/service_request_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/service_request_card.dart';

import 'fakes.dart';

void main() {
  group('no request is drawn with a completion figure', () {
    testWidgets('a card in flight draws no rail', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ServiceRequestCard(
              request: serviceRequestFixture(status: 'IN_PROGRESS'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The card renders — otherwise "no rail" would pass for the wrong reason — and
      // the step is still named. What is gone is the bar that read as a percentage.
      expect(find.text('ГҮЙЦЭТГЭЖ БАЙНА'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
    });

    testWidgets('nor does a cancelled one', (WidgetTester tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: ServiceRequestCard(
              request: serviceRequestFixture(status: 'CANCELLED'),
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('ЦУЦАЛСАН'), findsOneWidget);
      expect(find.byType(LinearProgressIndicator), findsNothing);
    });

    testWidgets('and the detail header carries none either',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        requestDetail: serviceRequestFixture(status: 'IN_PROGRESS'),
      );

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          const ServiceRequestDetailScreen(requestId: '710000000000000000000006'),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.textContaining('SR-202607-0012'), findsWidgets);
      expect(find.byType(LinearProgressIndicator), findsNothing);
    });
  });

  group('the home figures cover every building, not the first page of them', () {
    testWidgets('the count is the server total and the bands sum across pages',
        (WidgetTester tester) async {
      // Three buildings behind an API that serves two at a time — the same shape as
      // 60 buildings behind a page of 50, which is what used to be silently dropped.
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        buildings: <BuildingModel>[
          buildingFixture(
            id: '6b0000000000000000000001',
            name: 'Төв цамхаг',
            normal: 40,
            attention: 0,
            unassessed: 0,
          ),
          buildingFixture(
            id: '6b0000000000000000000002',
            name: 'Хоёрдугаар байр',
            normal: 5,
            attention: 0,
            unassessed: 0,
          ),
          buildingFixture(
            id: '6b0000000000000000000003',
            name: 'Гуравдугаар байр',
            normal: 7,
            attention: 0,
            unassessed: 0,
          ),
        ],
        buildingPageSize: 2,
      );

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      // Read past the first page rather than stopping where `limit` did.
      expect(repository.buildingPagesRequested, containsAllInOrder(<int>[1, 2]));

      // The true count, which is also `total` on the response.
      expect(find.textContaining('3 БАРИЛГА · '), findsOneWidget);

      // 40 + 5 + 7. The first page alone would have shown 45, and nothing on the
      // hero would have hinted that the other building existed.
      expect(find.text('52'), findsOneWidget);
      expect(find.text('45'), findsNothing);

      // Every device across all three is in the normal band, so the sentence that
      // depends on that being true of the whole estate is safe to make.
      expect(find.text('Бүх төхөөрөмж хэвийн ажиллаж байна'), findsOneWidget);
    });

    testWidgets('one page that already covers everything asks for no second one',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      expect(repository.buildingPagesRequested, isNot(contains(2)));
      expect(find.textContaining('1 БАРИЛГА · '), findsOneWidget);
    });
  });
}
