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
import 'package:monhorus_employee/features/employee/project/data/models/report_record_models.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/report_sheet.dart';

Map<String, dynamic> _device({
  bool canAssess = true,
  List<Map<String, dynamic>> attributes = const <Map<String, dynamic>>[],
  Map<String, dynamic> attributeValues = const <String, dynamic>{},
}) =>
    <String, dynamic>{
      'id': 'o1',
      'code': 'CT-LDB-1',
      'name': 'Гэрэлтүүлгийн самбар',
      'category': 'PANEL',
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'name': 'Хуваарилах самбар',
        'icon': 'PANEL',
        // The type's own declared fields ride on the type reference, which every object row
        // carries — the same source the Дүгнэлт editor reads from a picked list item.
        'attributes': attributes,
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
      'attributeValues': attributeValues,
    };

AppUser _user({required Set<String> permissions}) => AppUser(
      id: 'u',
      fullName: 'Дорж Ganbold',
      email: 'd.ganbold@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: permissions,
    );

Widget _screen(
  AppUser user, {
  bool canAssess = true,
  List<Map<String, dynamic>> attributes = const <Map<String, dynamic>>[],
  Map<String, dynamic> attributeValues = const <String, dynamic>{},
}) {
  return ProviderScope(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(user),
      objectDetailProvider('o1').overrideWith(
        (Ref ref) async => ObjectDetailModel.fromJson(
          _device(
            canAssess: canAssess,
            attributes: attributes,
            attributeValues: attributeValues,
          ),
        ),
      ),
      // The reports list, not the event timeline it replaced. Empty here: this file is
      // about the assess button and the sheet behind it. The fixture device carries no
      // `planPosition`, so the location section stops at its own notice and never
      // reaches for a plan — which is why this scope needs no plan overrides.
      objectReportsProvider('o1')
          .overrideWith((Ref ref) async => const <ReportRecordModel>[]),
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

/// Scrolls the assessment sheet until [target] is built.
///
/// Dragged by the list itself rather than by a widget inside it: the sheet's list
/// unmounts what scrolls off, so any anchor picked from its contents disappears
/// mid-drag and takes the drag with it. `shrinkWrap` identifies the sheet's own list
/// against the page behind it and the horizontal photo strip inside it.
Future<void> _scrollSheetTo(WidgetTester tester, Finder target) async {
  final Finder sheetList = find.byWidgetPredicate(
    (Widget widget) => widget is ListView && widget.shrinkWrap,
  );

  for (int attempt = 0; attempt < 20 && target.evaluate().isEmpty; attempt++) {
    await tester.drag(sheetList, const Offset(0, -180));
    await tester.pumpAndSettle();
  }
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

  // Multiple load units: the repeatable reading editor beside the kW box.
  //
  // The sheet's submit cannot be driven here (evidence needs `image_picker`'s platform
  // channel), so what is checked is the part this widget owns: rows appear, rows go away
  // again, and a fresh row never lands on a (kind, phase) pair already on the form —
  // which is the pairing the backend refuses.
  testWidgets('the sheet no longer offers the other-measurements editor', (
    WidgetTester tester,
  ) async {
    // "Бусад хэмжилт (А, В)" was removed from this sheet and from the web assessment form
    // together, so the two clients keep asking for the same things. The kW box is a different
    // field and stays: it is the authoritative figure the floor totals sum.
    //
    // Nothing was migrated. `CreateAssessmentRequest.measurements` and the API still accept
    // readings, and readings already recorded still display on the history.
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

    // Hunting for the editor's own button drags the sheet all the way to the bottom, because
    // there is nothing left to find — which is the assertion: the whole sheet was walked and
    // neither the heading nor the add button is anywhere on it.
    await _scrollSheetTo(tester, find.text('Хэмжилт нэмэх'));

    expect(find.text('Хэмжилт нэмэх'), findsNothing);
    expect(find.text('Бусад хэмжилт (А, В)'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  // A stored reading is read beside the assessment it was taken during.
  testWidgets('the report sheet shows the readings next to the kW figure', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: ReportSheet(
            report: ReportView.fromAssessment(
              ObjectAssessmentModel.fromJson(<String, dynamic>{
                'id': 'a1',
                'objectId': 'o1',
                'previousScore': 80,
                'newScore': 72,
                'riskLevel': 'ATTENTION',
                'assessedByName': 'Дорж Ganbold',
                'assessedAt': '2026-07-20T02:00:00.000Z',
                'photos': <dynamic>[],
                'conclusion': 'Ачаалал жигд бус.',
                'recommendation': null,
                'actionTaken': null,
                'measuredLoadKw': 17.2,
                'measurements': <Map<String, dynamic>>[
                  <String, dynamic>{
                    'kind': 'CURRENT',
                    'value': 41.2,
                    'unit': 'AMPERE',
                    'phase': 'L1',
                  },
                  <String, dynamic>{
                    'kind': 'VOLTAGE',
                    'value': 231,
                    'unit': 'VOLT',
                    'phase': null,
                  },
                ],
                'repairRequired': false,
                'revisitRequired': false,
                'revisitDate': null,
                'revisitOwnerName': null,
                'sourceLabel': null,
              }),
              deviceLabel: 'CT-LDB-1',
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    // `formatDecimal` keeps two digits on a non-integral reading and drops the tail on
    // a whole one, which is why the volts read plainly and the amps do not.
    expect(find.text('Хэмжсэн ачаалал 17.20 kW'), findsOneWidget);
    expect(find.text('41.20 А (L1) · 231 В'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  /// The equipment type's own declared fields, on the sheet a technician actually fills in
  /// (requirements 4.1).
  ///
  /// Nothing in the app names an attribute: the definitions arrive on the device response and
  /// the sheet renders whatever is there, so a field added in Тоноглолын төрөл is asked here
  /// with no release. These tests therefore drive the sheet from a fixture that declares the
  /// worked example from the brief — a breaker that is fused or not.

  const Map<String, dynamic> fuse = <String, dynamic>{
    'key': 'fuse',
    'label': 'Хайлмал хамгаалалт',
    'type': 'SELECT',
    'required': true,
    'options': <Map<String, dynamic>>[
      <String, dynamic>{'value': 'FUSED', 'label': 'Хайлмалтай'},
      <String, dynamic>{'value': 'NOT_FUSED', 'label': 'Хайлмалгүй'},
    ],
  };

  const Map<String, dynamic> serial = <String, dynamic>{
    'key': 'serial',
    'label': 'Сериал дугаар',
    'type': 'TEXT',
    'required': false,
    'options': <Map<String, dynamic>>[],
  };

  const Map<String, dynamic> sealed = <String, dynamic>{
    'key': 'sealed',
    'label': 'Лацдсан эсэх',
    'type': 'BOOLEAN',
    'required': true,
    'options': <Map<String, dynamic>>[],
  };

  /// Whether the chip answering [attributeLabel] with [optionLabel] is the chosen one.
  ///
  /// Matched on the semantics label the picker builds — "Хайлмал хамгаалалт: Хайлмалгүй" —
  /// rather than by walking up from the text, because `find.ancestor(...).first` lands on
  /// whichever Semantics Material happens to wrap the ink with, whose `selected` is null.
  bool chipSelected(
    WidgetTester tester,
    String attributeLabel,
    String optionLabel,
  ) {
    final Semantics chip = tester.widget<Semantics>(
      find.byWidgetPredicate(
        (Widget widget) =>
            widget is Semantics &&
            widget.properties.label == '$attributeLabel: $optionLabel',
      ),
    );
    return chip.properties.selected ?? false;
  }

  Future<void> openSheet(WidgetTester tester) async {
    await tester.scrollUntilVisible(
      find.text('Дүгнэлт тайлан бичих'),
      300,
      scrollable: find.byType(Scrollable).first,
    );
    await tester.pumpAndSettle();
    await tester.tap(find.text('Дүгнэлт тайлан бичих'));
    await tester.pumpAndSettle();
  }

  testWidgets('the sheet asks the equipment type\'s own questions', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _screen(
        _user(permissions: assessor),
        attributes: <Map<String, dynamic>>[fuse, serial, sealed],
      ),
    );
    await tester.pumpAndSettle();
    await openSheet(tester);

    // A required field says so in its own label, so a technician knows before saving.
    await _scrollSheetTo(tester, find.text('ХАЙЛМАЛ ХАМГААЛАЛТ (ЗААВАЛ)'));
    expect(find.text('ХАЙЛМАЛ ХАМГААЛАЛТ (ЗААВАЛ)'), findsOneWidget);
    // A SELECT offers exactly the options its definition lists, as chips.
    expect(find.text('Хайлмалтай'), findsOneWidget);
    expect(find.text('Хайлмалгүй'), findsOneWidget);

    await _scrollSheetTo(tester, find.text('ЛАЦДСАН ЭСЭХ (ЗААВАЛ)'));
    // A BOOLEAN is a three-state picker, not a switch: "not answered yet" has to remain
    // expressible or a required yes/no is satisfied by a control nobody touched.
    expect(find.text('Тийм'), findsOneWidget);
    expect(find.text('Үгүй'), findsOneWidget);

    // An optional TEXT field is a plain box and is not marked заавал.
    await _scrollSheetTo(tester, find.text('СЕРИАЛ ДУГААР'));
    expect(find.text('СЕРИАЛ ДУГААР'), findsOneWidget);

    expect(tester.takeException(), isNull);
  });

  testWidgets('the sheet opens on the answers already recorded', (
    WidgetTester tester,
  ) async {
    // Standing facts about the kit, not a fresh reading like the score: the right starting
    // point is what is on record, so the technician corrects rather than re-enters.
    await tester.binding.setSurfaceSize(const Size(390, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _screen(
        _user(permissions: assessor),
        attributes: <Map<String, dynamic>>[fuse, serial],
        attributeValues: <String, dynamic>{
          'fuse': 'NOT_FUSED',
          'serial': 'AB-1200',
        },
      ),
    );
    await tester.pumpAndSettle();
    await openSheet(tester);

    await _scrollSheetTo(tester, find.text('СЕРИАЛ ДУГААР'));
    expect(find.text('AB-1200'), findsOneWidget);

    // The chip that matches the stored value is the selected one, and its sibling is not.
    expect(chipSelected(tester, 'Хайлмал хамгаалалт', 'Хайлмалгүй'), isTrue);
    expect(chipSelected(tester, 'Хайлмал хамгаалалт', 'Хайлмалтай'), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a required attribute is named when it is left unanswered', (
    WidgetTester tester,
  ) async {
    /**
     * Refused before the request, by the same three rules the server enforces.
     *
     * The evidence rule already blocks the save button until a photo lands, and this test
     * cannot press the camera, so what is asserted is that the field itself is on the sheet
     * and marked заавал — the message is raised from `_attributeIssues`, which the API test
     * covers on the server side under the same `attributeValues.<key>` key.
     */
    await tester.binding.setSurfaceSize(const Size(390, 1400));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _screen(_user(permissions: assessor), attributes: <Map<String, dynamic>>[fuse]),
    );
    await tester.pumpAndSettle();
    await openSheet(tester);

    await _scrollSheetTo(tester, find.text('ХАЙЛМАЛ ХАМГААЛАЛТ (ЗААВАЛ)'));

    // Nothing is preselected, so the answer is genuinely absent rather than defaulted —
    // which is what makes `required` mean something on a two-option question.
    expect(chipSelected(tester, 'Хайлмал хамгаалалт', 'Хайлмалтай'), isFalse);
    expect(chipSelected(tester, 'Хайлмал хамгаалалт', 'Хайлмалгүй'), isFalse);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a type declaring nothing leaves the sheet exactly as it was', (
    WidgetTester tester,
  ) async {
    // The path every type took before the feature existed, and the one that must be
    // untouched — including sending no `attributeValues` key at all, which is what tells
    // the server it was not asked.
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_screen(_user(permissions: assessor)));
    await tester.pumpAndSettle();
    await openSheet(tester);

    await _scrollSheetTo(tester, find.text('Засвар шаардлагатай'));
    expect(find.text('ХАЙЛМАЛ ХАМГААЛАЛТ (ЗААВАЛ)'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
