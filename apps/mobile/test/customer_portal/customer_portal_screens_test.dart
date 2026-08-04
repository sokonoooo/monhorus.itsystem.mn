import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/customer_scope.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/building_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/building_list_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/customer_home_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/customer_profile_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/customer_shell_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/floor_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/service_request_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/service_request_list_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/risk_glyph.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/risk_widgets.dart';

import 'fakes.dart';

void main() {
  // A phone-shaped surface, since every screen in this flow is laid out for one.
  Future<void> pumpPhone(WidgetTester tester, Widget widget) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.pumpWidget(widget);
    await tester.pumpAndSettle();
  }

  /// Brings a finder into view. These screens are long, and a `ListView` only
  /// builds what is on screen, so anything below the fold has to be scrolled to
  /// before it can be asserted on.
  Future<void> scrollTo(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(
      finder,
      240,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
  }

  group('s-home', () {
    testWidgets('shows the hero risk stair and the customer own requests',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: repository,
        ),
      );

      // The steel hero replaced the greeting nav bar, the KPI strip and the
      // roll-up card: the wordmark, the building count, the one sentence that
      // says how bad things are, and the five bands as five columns.
      expect(find.text('soko'), findsOneWidget);
      expect(find.textContaining('1 БАРИЛГА · '), findsOneWidget);
      // The fixture's building carries three ATTENTION devices and no critical
      // ones, so the headline is the attention line and the figure is its own.
      expect(find.text('3 төхөөрөмж анхаарал шаардаж байна'), findsOneWidget);
      expect(find.text('ХЭВИЙН'), findsOneWidget);
      expect(find.text('АНХААРАХ'), findsOneWidget);
      expect(find.text('НОЦТОЙ'), findsOneWidget);
      expect(find.text('40'), findsOneWidget);
      // The building listing, worst risk first, and the request section below it.
      expect(find.text('БҮХ БАРИЛГА · ЭРСДЭЛЭЭР'), findsOneWidget);
      expect(find.text('Төв цамхаг'), findsOneWidget);
      expect(find.text('ОЙРЫН ХҮСЭЛТҮҮД'), findsOneWidget);
      expect(find.textContaining('SR-202607-0012'), findsWidgets);

      // Removed on request: the status roll-up and the new-request call to action.
      // The Хүсэлт tab owns both - the status of every request is the list itself,
      // and that tab carries its own create action - so the home screen stops
      // restating them. Asserted so putting either back is a deliberate act.
      expect(find.text('ХҮСЭЛТИЙН ТӨЛӨВ'), findsNothing);
      expect(find.text('Шинэ хүсэлт үүсгэх'), findsNothing);
    });

    testWidgets('every read went out carrying the session customer id',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: repository,
        ),
      );

      // Not a hand-passed scope: the screen fetched with whatever
      // customerScopeProvider derived from the signed-in account.
      expect(repository.requestedCustomerIds, isNotEmpty);
      expect(repository.requestedCustomerIds, everyElement(testCustomerId));
    });

    testWidgets('explains itself instead of loading for an unlinked account',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: FakeCustomerPortalRepository(),
          user: unlinkedCustomer,
        ),
      );

      expect(
        find.text(UnavailableCustomerScope.accountNotLinked.reason),
        findsOneWidget,
      );
      expect(find.textContaining('Админд хандана уу'), findsOneWidget);
      // Not an error state and not an empty portal: no data, and no failure line.
      expect(find.text('Төв цамхаг'), findsNothing);
      expect(find.textContaining('SR-202607-0012'), findsNothing);
      expect(find.text('Дахин оролдох'), findsNothing);
    });

    testWidgets('an unlinked account issues no scoped read at all',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: repository,
          user: unlinkedCustomer,
        ),
      );

      expect(repository.requestedCustomerIds, isEmpty);
    });

    testWidgets('surfaces the backend message when a read is refused',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: FakeCustomerPortalRepository(
            failure: const AuthFailure(
              'Энэ үйлдлийг хийх эрх байхгүй байна.',
              code: 'FORBIDDEN',
            ),
          ),
        ),
      );

      expect(find.text('Энэ үйлдлийг хийх эрх байхгүй байна.'), findsOneWidget);
      expect(find.text('Дахин оролдох'), findsWidgets);
    });

    testWidgets('a 403 not-linked reply is shown in the servers own words',
        (WidgetTester tester) async {
      // The account looks linked to the app - it was linked when /auth/me last ran -
      // but the server refuses the read. The server's message is the accurate one, so
      // it is what the customer reads, verbatim and untranslated.
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          CustomerHomeScreen(onOpenTab: (_) {}),
          repository: FakeCustomerPortalRepository(
            failure: const AuthFailure(serverNotLinkedMessage, code: 'FORBIDDEN'),
          ),
        ),
      );

      expect(find.text(serverNotLinkedMessage), findsOneWidget);
      expect(find.text('Дахин оролдох'), findsWidgets);
    });
  });

  group('s-buildings', () {
    testWidgets('lists the customer buildings with their risk roll-up',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const BuildingListScreen(),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('Барилга'), findsOneWidget);
      expect(find.text('МИНИЙ БАРИЛГУУД'), findsOneWidget);
      expect(find.text('Төв цамхаг'), findsOneWidget);
      expect(find.textContaining('8 давхар'), findsOneWidget);
    });

    testWidgets('the Эрсдэлтэй tab hides a building with no risk',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const BuildingListScreen(),
          repository: FakeCustomerPortalRepository(
            buildings: <BuildingModel>[
              buildingFixture(name: 'Эрүүл байшин'),
            ],
          ),
        ),
      );

      expect(find.text('Эрүүл байшин'), findsOneWidget);

      await tester.tap(find.text('ХЭВИЙН'));
      await tester.pumpAndSettle();

      // The fixture carries three ATTENTION objects, so it is not in the healthy set.
      expect(find.text('Эрүүл байшин'), findsNothing);
      expect(find.text('Энэ шүүлтүүрт тохирох барилга алга байна.'), findsOneWidget);
    });
  });

  group('s-building-detail', () {
    testWidgets('shows the silhouette and the floor rows, with no legend',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          BuildingDetailScreen(building: buildingFixture()),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('БАРИЛГЫН ХАРАГДАЦ'), findsOneWidget);
      expect(find.text('ДАВХРУУД'), findsOneWidget);
      expect(find.text('2-р давхар'), findsWidgets);
      expect(find.textContaining('Лобби, оффис'), findsOneWidget);

      // The six-row colour key was removed on request, from here and from the floor
      // and device screens. It restated what every row already says in words: each
      // floor carries its worst band by NAME, so the colour was never load-bearing
      // and the key was three screens of repetition.
      expect(find.byType(RiskLegend), findsNothing);

      // What replaces it: the band still reaches the reader as text plus a glyph, so
      // risk survives greyscale without a key to consult.
      expect(find.byType(RiskGlyph), findsWidgets);

      // No numeric scale anywhere on the screen. The band boundaries are
      // runtime-configurable server-side and neither mobile role can read
      // GET /settings (403), so a printed range can silently contradict the server.
      expect(find.textContaining('81-100'), findsNothing);
      expect(find.textContaining('21-40'), findsNothing);
    });
  });

  group('s-floor-detail', () {
    testWidgets('opens on the plan tab and switches to devices and history',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const FloorDetailScreen(
            floorId: '6d0000000000000000000002',
            buildingId: '6b0000000000000000000001',
            buildingName: 'Төв цамхаг',
            projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
          ),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('ЗУРАГЛАЛ'), findsOneWidget);
      expect(find.textContaining('эрсдэлийн төлөв'), findsOneWidget);
      expect(find.text('ДАВХРЫН ПЛАН'), findsOneWidget);
      // No plan uploaded in this fixture, so the tab says so rather than blanking.
      expect(
        find.text('Энэ давхарт план зураг ачаалагдаагүй байна.'),
        findsOneWidget,
      );

      await tester.tap(find.text('ТӨХӨӨРӨМЖ'));
      await tester.pumpAndSettle();
      expect(find.text('БҮХ ОБЪЕКТ'), findsOneWidget);
      expect(find.textContaining('LDB-2F-02'), findsWidgets);

      await tester.tap(find.text('ТҮҮХ'));
      await tester.pumpAndSettle();
      expect(find.text('ЭНЭ ДАВХРЫН ХҮСЭЛТҮҮД'), findsOneWidget);
      expect(find.textContaining('SR-202607-0012'), findsWidgets);
    });
  });

  group('s-device-detail', () {
    testWidgets('shows the үнэлгээ as a percent with its band label',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('38'), findsOneWidget);
      expect(find.text('ҮНЭЛГЭЭ %'), findsOneWidget);
      expect(find.textContaining('Ноцтой эрсдэлтэй'), findsWidgets);

      // The panel attribute block, not the circuit or equipment one.
      await scrollTo(tester, find.text('Хамгаалалт'));
      expect(find.text('Хамгаалалт'), findsOneWidget);
      expect(find.text('MCCB 100A'), findsOneWidget);
      expect(find.text('Тэжээгдэх самбар'), findsNothing);

      await scrollTo(tester, find.text('ДҮГНЭЛТ БА ЗӨВЛӨМЖ'));
      expect(find.text('Таслуур хэт халалттай байна.'), findsOneWidget);
    });

    testWidgets('an incomplete load reads as Бүрэн бус and never as zero',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      await scrollTo(tester, find.text('ТООЦООЛСОН АЧААЛАЛ'));
      expect(find.text('52.40'), findsOneWidget);

      // reserveKw is incomplete in the fixture; it must not render a 0.
      await scrollTo(tester, find.text('НӨӨЦ'));
      expect(find.text('Бүрэн бус'), findsWidgets);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('an unassessed object says Үнэлгээгүй rather than showing a score',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(
            objectDetail: objectFixture(score: null, riskLevel: null),
          ),
        ),
      );

      expect(find.textContaining('Үнэлгээгүй'), findsWidgets);
      expect(
        find.text('Энэ объектод үнэлгээ хараахан бүртгэгдээгүй байна.'),
        findsOneWidget,
      );
      // The circle shows a dash, never a zero, for a score that was never taken.
      expect(find.text('-'), findsWidgets);
      expect(find.text('ДҮГНЭЛТ БА ЗӨВЛӨМЖ'), findsNothing);
    });

    testWidgets('hides the request action without a create permission',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('Засварын хүсэлт илгээх'), findsNothing);
    });

    testWidgets('shows the request action once the permission is granted',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(),
          user: customerWithCreateRight(),
        ),
      );

      expect(find.text('Засварын хүсэлт илгээх'), findsOneWidget);
    });

    /// The object timeline is staff-only by decision: it folds in audit rows,
    /// planned-work tasks and internal request detail, none of which is customer
    /// facing. Rendered unconditionally it 403'd on every device page, so it is
    /// hidden - not disabled - exactly as the request action is.
    testWidgets('hides the object history without object_master.view',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository =
          FakeCustomerPortalRepository();

      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: repository,
        ),
      );

      // Scrolled to the foot of the list, so "not found" cannot mean "not built yet".
      await scrollTo(tester, find.text('ДҮГНЭЛТ БА ЗӨВЛӨМЖ'));
      expect(find.text('ОБЪЕКТЫН ТҮҮХ'), findsNothing);
      // And no error state in its place: the section is absent, not refused.
      expect(find.text('Энэ үйлдлийг хийх эрх байхгүй байна.'), findsNothing);
      // The request the server would have answered 403 is never issued at all.
      expect(repository.historyRequestedFor, isEmpty);
    });

    testWidgets('shows the object history once the permission is granted',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: FakeCustomerPortalRepository(
            objectHistory: objectHistoryFixture(),
          ),
          user: customerWithObjectMasterView(),
        ),
      );
      await tester.pumpAndSettle();

      await scrollTo(tester, find.text('ОБЪЕКТЫН ТҮҮХ'));
      expect(find.text('ОБЪЕКТЫН ТҮҮХ'), findsOneWidget);
      expect(find.text('Үнэлгээ бүртгэгдлээ'), findsOneWidget);
    });
  });

  group('s-requests', () {
    testWidgets('splits active from finished on the workflow terminal statuses',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestListScreen(),
          repository: FakeCustomerPortalRepository(
            requests: <ServiceRequestListItemModel>[
              serviceRequestFixture(status: 'ASSIGNED'),
              serviceRequestFixture(
                id: '710000000000000000000099',
                requestNumber: 'SR-202607-0004',
                status: 'COMPLETED',
                isUrgent: false,
              ),
            ],
          ),
        ),
      );

      expect(find.text('ИДЭВХТЭЙ ХҮСЭЛТҮҮД'), findsOneWidget);
      expect(find.textContaining('SR-202607-0012'), findsOneWidget);
      expect(find.textContaining('SR-202607-0004'), findsNothing);

      await tester.tap(find.text('ДУУССАН'));
      await tester.pumpAndSettle();
      expect(find.text('ДУУССАН ХҮСЭЛТҮҮД'), findsOneWidget);
      expect(find.textContaining('SR-202607-0004'), findsOneWidget);
      expect(find.textContaining('SR-202607-0012'), findsNothing);

      await tester.tap(find.text('БҮГД'));
      await tester.pumpAndSettle();
      expect(find.textContaining('SR-202607-0012'), findsOneWidget);
      expect(find.textContaining('SR-202607-0004'), findsOneWidget);
    });

    testWidgets('is blocked with an explanation for an unlinked account',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestListScreen(),
          repository: FakeCustomerPortalRepository(),
          user: unlinkedCustomer,
        ),
      );

      expect(find.textContaining('Байгууллагын хамаарал'), findsWidgets);
      expect(find.textContaining('SR-202607-0012'), findsNothing);
    });
  });

  group('s-request-detail', () {
    testWidgets('shows the status, the SLA and the progress timeline',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const ServiceRequestDetailScreen(requestId: '710000000000000000000006'),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('SR-202607-0012'), findsOneWidget);
      expect(find.text('Хүсэлтийн явц'), findsOneWidget);
      expect(
        find.text('Хэт ачаалал илэрсэн, таслуур солих шаардлагатай.'),
        findsOneWidget,
      );
      expect(find.text('ТӨЛӨВ'), findsOneWidget);
      expect(find.text('Хуваарилагдсан'), findsWidgets);

      await scrollTo(tester, find.text('9911-2233'));
      expect(find.text('9911-2233'), findsOneWidget);

      await scrollTo(tester, find.text('ҮЙЛ ЯВЦ'));
      expect(find.text('Шинэ → Хуваарилагдсан'), findsOneWidget);
      expect(find.text('Шинэ төлөвт бүртгэгдсэн'), findsOneWidget);
    });
  });

  group('s-profile', () {
    testWidgets('shows the account and the settings the API can honour',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerProfileScreen(),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('Профайл'), findsOneWidget);
      expect(find.text('Д. Оюунчимэг'), findsOneWidget);
      expect(find.textContaining('oyun@centraltower.mn'), findsOneWidget);
      expect(find.text('Харилцагч'), findsOneWidget);
      expect(find.text('Мэдэгдэл'), findsOneWidget);
      expect(find.text('Нууц үг солих'), findsOneWidget);
      expect(find.text('Гарах'), findsOneWidget);
      // The organisation name comes from the session payload, not from a picker.
      expect(find.text(testCustomerName), findsOneWidget);
    });

    testWidgets('an unlinked account is told why the access row is empty',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerProfileScreen(),
          repository: FakeCustomerPortalRepository(),
          user: unlinkedCustomer,
        ),
      );

      expect(find.text('С. Батжаргал'), findsOneWidget);
      expect(find.textContaining('Байгууллагын хамаарал тодорхойгүй'), findsOneWidget);
      expect(find.text(testCustomerName), findsNothing);
    });
  });

  group('shell', () {
    testWidgets('carries the four prototype tabs and no create button by default',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerShellScreen(),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      expect(find.text('Нүүр'), findsOneWidget);
      expect(find.text('Барилга'), findsWidgets);
      expect(find.text('Хүсэлт'), findsOneWidget);
      expect(find.text('Профайл'), findsWidgets);
      expect(find.byType(FloatingActionButton), findsNothing);
    });

    testWidgets('reveals the create button when the permission is present',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerShellScreen(),
          repository: FakeCustomerPortalRepository(),
          user: customerWithCreateRight(),
        ),
      );

      expect(find.byType(FloatingActionButton), findsOneWidget);
    });

    testWidgets('keeps the create button hidden for an unlinked account',
        (WidgetTester tester) async {
      // The permission is held but there is no organisation to file the request
      // against, so the control would only ever produce a 403.
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerShellScreen(),
          repository: FakeCustomerPortalRepository(),
          user: AppUser(
            id: unlinkedCustomer.id,
            fullName: unlinkedCustomer.fullName,
            email: unlinkedCustomer.email,
            phone: unlinkedCustomer.phone,
            role: unlinkedCustomer.role,
            status: unlinkedCustomer.status,
            permissions: const <String>{
              PermissionKeys.portalServiceRequestCreate,
            },
          ),
        ),
      );

      expect(find.byType(FloatingActionButton), findsNothing);
    });

    testWidgets('switches tab when the bottom bar is tapped',
        (WidgetTester tester) async {
      await pumpPhone(
        tester,
        wrapCustomerScreen(
          const CustomerShellScreen(),
          repository: FakeCustomerPortalRepository(),
        ),
      );

      await tester.tap(find.text('Хүсэлт'));
      await tester.pumpAndSettle();

      expect(find.text('ИДЭВХТЭЙ ХҮСЭЛТҮҮД'), findsOneWidget);
    });
  });
}
