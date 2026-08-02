// Hermetic render checks for the Төсөл tab's device write: no network, no plugins.
//
// The point of this file is the two gates in front of "Дүгнэлт тайлан бичих" and the
// evidence rule behind it. Nothing here presses the camera — `image_picker` needs a
// platform channel — so the assertions stop at the sheet, which is exactly where the
// rules this app is responsible for live: the button is drawn only when the caller
// holds `object_master.assess` AND the object's type generates a conclusion, and the
// save button stays refused until a photo has actually been uploaded.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/device_detail_screen.dart';

Map<String, dynamic> _device({bool canAssess = true}) => <String, dynamic>{
      'id': 'o1',
      'code': 'CT-LDB-1',
      'name': 'Гэрэлтүүлгийн самбар',
      'category': 'PANEL',
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'name': 'Хуваарилах самбар',
        'icon': 'PANEL',
      },
      'customerId': 'c1',
      'customerName': 'Central Tower ХХК',
      'floorId': 'f1',
      'floorName': '2-р давхар',
      'buildingName': 'Төв байр',
      'status': 'ACTIVE',
      'latestAssessment': <String, dynamic>{
        'score': 72,
        'riskLevel': 'ATTENTION',
        'assessedAt': '2026-07-20T02:00:00.000Z',
        'assessedByName': 'Дорж Ganbold',
        'conclusion': 'Автомат таслуурын халалт бага зэрэг ажиглагдав.',
      },
      'calculatedLoad': <String, dynamic>{
        'valueKw': 18.5,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'measuredLoadKw': 17.2,
      'loadVariance': <String, dynamic>{
        'valueKw': -1.3,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'loadPercent': <String, dynamic>{
        'valueKw': 74.0,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'reserveKw': <String, dynamic>{
        'valueKw': 6.5,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'createdAt': '2026-01-04T02:00:00.000Z',
      'updatedAt': '2026-07-20T02:00:00.000Z',
      'description': null,
      'notes': null,
      // Empty on purpose: `recordAssessment` files evidence against the assessment,
      // never against `object.photos`, and the empty state has to say so.
      'photos': <dynamic>[],
      'panel': <String, dynamic>{
        'capacityKw': 25,
        'location': '2-р давхар, цахилгааны өрөө',
        'protection': 'C63',
      },
      'childCircuits': <dynamic>[],
      'childEquipment': <dynamic>[],
      'canAssess': canAssess,
    };

AppUser _user({required Set<String> permissions}) => AppUser(
      id: 'u',
      fullName: 'Дорж Ganbold',
      email: 'd.ganbold@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: permissions,
    );

Widget _screen(AppUser user, {bool canAssess = true}) {
  return ProviderScope(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(user),
      objectDetailProvider('o1').overrideWith(
        (Ref ref) async => ObjectDetailModel.fromJson(_device(canAssess: canAssess)),
      ),
      objectHistoryProvider('o1')
          .overrideWith((Ref ref) async => ObjectHistoryModel.empty),
    ],
    child: const MaterialApp(
      home: DeviceDetailScreen(
        objectId: 'o1',
        fallbackTitle: 'CT-LDB-1',
        fallbackSubtitle: 'Гэрэлтүүлгийн самбар',
        floorName: '2-р давхар',
        buildingName: 'Төв байр',
        projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
      ),
    ),
  );
}

void main() {
  const Set<String> assessor = <String>{
    'object.view',
    'object_master.view',
    'object_master.assess',
  };

  testWidgets('the assess button is drawn for a holder of object_master.assess', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_screen(_user(permissions: assessor)));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Дүгнэлт тайлан бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Дүгнэлт тайлан бичих'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('without the permission the button is absent entirely', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _screen(
        _user(permissions: <String>{'object.view', 'object_master.view'}),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Дүгнэлт тайлан бичих'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a type that carries no conclusion says so instead', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_screen(_user(permissions: assessor), canAssess: false));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.textContaining('дүгнэлт бүртгэх тохиргоо идэвхгүй'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    expect(find.text('Дүгнэлт тайлан бичих'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the sheet refuses to save until evidence has been uploaded', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_screen(_user(permissions: assessor)));
    await tester.pumpAndSettle();

    await tester.scrollUntilVisible(
      find.text('Дүгнэлт тайлан бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Дүгнэлт тайлан бичих'));
    await tester.pumpAndSettle();

    expect(find.text('НОТЛОХ ЗУРАГ (ЗААВАЛ)'), findsOneWidget);
    expect(
      find.text('Зураг хавсаргасны дараа үнэлгээг хадгалах боломжтой болно.'),
      findsOneWidget,
    );

    // Tapping the disabled save must do nothing at all — no request, no navigation,
    // and above all no exception from a request the schema would have refused.
    await tester.tap(find.text('Үнэлгээ хадгалах'));
    await tester.pumpAndSettle();

    expect(find.text('Үнэлгээ хадгалах'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
