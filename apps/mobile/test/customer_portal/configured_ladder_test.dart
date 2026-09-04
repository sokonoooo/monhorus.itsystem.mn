// Things the portal must read off the server rather than off its own compiled tables.
//
// Four separate places used to decide, in Dart, questions only the installation can
// answer: which bands exist and in what order, which of them are bad enough to warrant
// a red banner and an urgent flag on a request the SERVER then dispatches, whether an
// absent score is a score, and whether a list that stopped is a list that ended.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/object_master_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/risk_level.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/server_vocabulary.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/risk_widgets.dart';

import 'fakes.dart';

/// `GET /vocabulary` as the route emits it: `riskBandsOf` reverses the resolved ladder,
/// so the bands arrive BEST-FIRST — highest minimum score first — and a configured spare
/// sits wherever its own cut points put it, not where the enum happens to declare it.
Map<String, dynamic> _ladderWithASpareInTheMiddle() => <String, dynamic>{
      'requestStages': <Map<String, dynamic>>[],
      'riskBands': <Map<String, dynamic>>[
        <String, dynamic>{
          'level': 'NORMAL',
          'label': 'Хэвийн',
          'colour': 'green',
          'min': 81,
          'max': 100,
        },
        <String, dynamic>{
          'level': 'ATTENTION',
          'label': 'Анхаарах шаардлагатай',
          'colour': 'yellow',
          'min': 61,
          'max': 80,
        },
        <String, dynamic>{
          'level': 'BAND_6',
          'label': 'Хяналтад авах',
          'colour': 'purple',
          'min': 41,
          'max': 60,
        },
        <String, dynamic>{
          'level': 'OUT_OF_SERVICE',
          'label': 'Ашиглах боломжгүй',
          'colour': 'black',
          'min': 0,
          'max': 40,
        },
      ],
    };

void main() {
  setUp(resetServerVocabulary);
  tearDown(resetServerVocabulary);

  group('the ladder is the server\'s, in the server\'s order', () {
    test('a configured spare keeps the place its own cut points give it', () {
      installServerVocabulary(
        ServerVocabulary.fromJson(_ladderWithASpareInTheMiddle()),
      );

      // Re-sorting by the compiled enum index used to push BAND_6 past
      // OUT_OF_SERVICE, because that is where the reserved keys are declared — so a
      // legend drawn best-first ended with the WORST band in the middle and a
      // mid-severity band at the end.
      expect(riskBandsInUse(), <RiskLevel>[
        RiskLevel.normal,
        RiskLevel.attention,
        RiskLevel.band6,
        RiskLevel.outOfService,
      ]);
    });

    test('the healthiest and the worst band are read off that order', () {
      installServerVocabulary(
        ServerVocabulary.fromJson(_ladderWithASpareInTheMiddle()),
      );

      expect(healthiestRiskBand(), RiskLevel.normal);
      expect(worstRiskBand(), RiskLevel.outOfService);
      expect(riskBandRank(RiskLevel.band6), 2);
      expect(riskNeedsAttention(RiskLevel.band6), isTrue);
      expect(riskNeedsAttention(RiskLevel.normal), isFalse);
    });

    test('a ladder whose worst band is a spare treats that spare as the severe one',
        () {
      installServerVocabulary(
        ServerVocabulary.fromJson(<String, dynamic>{
          'requestStages': <Map<String, dynamic>>[],
          'riskBands': <Map<String, dynamic>>[
            <String, dynamic>{
              'level': 'NORMAL',
              'label': 'Хэвийн',
              'colour': 'green',
              'min': 50,
              'max': 100,
            },
            <String, dynamic>{
              'level': 'BAND_7',
              'label': 'Аюултай',
              'colour': 'red',
              'min': 0,
              'max': 49,
            },
          ],
        }),
      );

      expect(riskIsSevere(RiskLevel.band7), isTrue);
      expect(riskIsSevere(RiskLevel.normal), isFalse);
      // CRITICAL is not on this installation's ladder at all, so it is not a band
      // this app may act on.
      expect(riskIsSevere(RiskLevel.critical), isFalse);
    });

    test('with no vocabulary the five documented bands still answer', () {
      expect(riskBandsInUse(), documentedRiskBands);
      expect(healthiestRiskBand(), RiskLevel.normal);
      expect(worstRiskBand(), RiskLevel.outOfService);
      expect(riskIsSevere(RiskLevel.critical), isTrue);
      expect(riskIsSevere(RiskLevel.outOfService), isTrue);
      expect(riskIsSevere(RiskLevel.scheduleRepair), isFalse);
    });
  });

  group('the roll-ups are summed over the configured ladder', () {
    test('a device in a configured spare is counted, not dropped', () {
      installServerVocabulary(
        ServerVocabulary.fromJson(_ladderWithASpareInTheMiddle()),
      );

      final BuildingModel building = buildingWithBands(<String, int>{
        'NORMAL': 10,
        'BAND_6': 4,
        'OUT_OF_SERVICE': 2,
      });

      // BAND_6 asks for attention without being severe; OUT_OF_SERVICE is the worst
      // band on this ladder. Neither figure used to include a spare at all.
      expect(building.riskSummary.attentionCount, 4);
      expect(building.riskSummary.criticalCount, 2);
    });
  });

  group('an absent score is not a score', () {
    test('an assessment with no score parses as null, never as the worst reading', () {
      final ObjectDetailModel object = objectFixture(scoreMissing: true);

      // Zero is the bottom of an INVERTED scale, so `?? 0` displayed a missing
      // reading as the worst one there is.
      expect(object.score, isNull);
      expect(object.latestAssessment, isNotNull);
    });

    testWidgets('and the device screen draws a dash where the figure goes',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        objectDetail: objectFixture(scoreMissing: true),
      );

      tester.view.physicalSize = const Size(1170, 2532);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      expect(find.descendant(of: find.byType(ScoreRing), matching: find.text('-')),
          findsOneWidget);
      expect(find.descendant(of: find.byType(ScoreRing), matching: find.text('0')),
          findsNothing);
    });
  });

  group('the type\'s own declared attributes reach the customer', () {
    testWidgets('every declared kind renders with the answer recorded against it',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        objectDetail: objectFixture(withTypeAttributes: true),
      );

      tester.view.physicalSize = const Size(1170, 4000);
      tester.view.devicePixelRatio = 3;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(
        wrapCustomerScreen(
          const DeviceDetailScreen(objectId: '6e0000000000000000000003'),
          repository: repository,
        ),
      );
      await tester.pumpAndSettle();

      // A SELECT reads as its option's LABEL, never its stored value.
      expect(find.text('Хайлмал'), findsOneWidget);
      expect(find.text('Хайлмалтай'), findsOneWidget);
      expect(find.text('FUSED'), findsNothing);

      // A BOOLEAN reads Тийм/Үгүй, and `false` is an answer rather than an absence.
      expect(find.text('Заавал үзлэгтэй'), findsOneWidget);
      expect(find.text('Үгүй'), findsOneWidget);

      // NUMBER and TEXT print themselves.
      expect(find.text('Үйлдвэрлэсэн он'), findsOneWidget);
      expect(find.text('2019'), findsOneWidget);
      expect(find.text('Сериал дугаар'), findsOneWidget);
      expect(find.text('SN-44120'), findsOneWidget);

      // An attribute the type declares and nobody has answered says so rather than
      // disappearing.
      expect(find.text('Хамгаалалтын зэрэглэл'), findsOneWidget);
    });
  });
}
