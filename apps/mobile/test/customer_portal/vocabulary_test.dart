// What the portal says when the server has named things itself — and what it says when
// the server never answered.
//
// The second half is the important one. Every label and colour in this app used to be
// compiled in, and the change that ended that must not have made the portal depend on a
// call a phone may not be able to make. So the failure case is asserted as hard as the
// success case: a refused, broken or unreachable `/vocabulary` has to leave the screens
// reading exactly as they did before the endpoint existed.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/risk_level.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/server_vocabulary.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/theme/customer_tokens.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/service_request_card.dart';

import 'fakes.dart';

/// A `GET /vocabulary` body shaped as the route emits it, with an administrator's
/// changes in it: NORMAL renamed and recoloured, a sixth band configured, one stage
/// renamed that covers a single status and one that covers three.
Map<String, dynamic> _configured() => <String, dynamic>{
      'requestStages': <Map<String, dynamic>>[
        <String, dynamic>{
          'key': 'OPEN',
          'label': 'Нээлттэй',
          'colour': 'grey',
          'statuses': <String>['NEW', 'UNASSIGNED'],
          'hidden': false,
        },
        <String, dynamic>{
          'key': 'ON_THE_WAY',
          'label': 'Замд гарсан',
          'colour': 'indigo',
          'statuses': <String>['ON_THE_WAY'],
          'hidden': false,
        },
        <String, dynamic>{
          'key': 'COMPLETED',
          'label': 'Дууссан',
          'colour': 'green',
          'statuses': <String>['REPORT_SUBMITTED', 'VERIFICATION', 'COMPLETED'],
          'hidden': false,
        },
      ],
      'riskBands': <Map<String, dynamic>>[
        <String, dynamic>{
          'level': 'NORMAL',
          'label': 'Бүрэн бүтэн',
          'colour': 'blue',
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

ServiceRequestListItemModel _row({Map<String, dynamic>? stage}) =>
    ServiceRequestListItemModel.fromJson(<String, dynamic>{
      'id': '710000000000000000000006',
      'requestNumber': 'SR-202607-0012',
      'status': 'ON_SITE',
      if (stage != null) 'stage': stage,
      'isUrgent': false,
      'assignedEmployees': <Object>[],
    });

void main() {
  // The installed vocabulary is process-wide, so one case's server must not become the
  // next case's starting point.
  setUp(resetServerVocabulary);
  tearDown(resetServerVocabulary);

  group('the compiled-in words are what a failed read leaves behind', () {
    test('an unreachable server changes nothing', () async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        vocabulary: ServerVocabulary.fromJson(_configured()),
        vocabularyFailure: const NetworkFailure('Сүлжээнд холбогдож чадсангүй.'),
      );

      final ServerVocabulary answer =
          await _container(repository).read(serverVocabularyProvider.future);

      // The provider resolves rather than throwing: there is no error state for a
      // screen to render, because nothing is missing from the screen.
      expect(answer.isEmpty, isTrue);
      expect(repository.vocabularyReads, 1);
      expect(serverVocabularyRevision, 0);

      expect(RiskLevel.normal.label, 'Хэвийн');
      expect(RiskLevel.normal.shortLabel, 'Хэвийн');
      expect(RiskLevel.normal.tone, AccentTone.green);
      expect(RiskLevel.critical.label, 'Ноцтой эрсдэлтэй');

      expect(ServiceRequestStatus.onTheWay.label, 'Замдаа');
      expect(ServiceRequestStatus.onTheWay.tone, AccentTone.blue);

      // And the legend still lists the five bands the requirements document.
      expect(riskBandsInUse(), documentedRiskBands);
    });

    test('a refusal is not treated differently from a broken wire', () async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        vocabularyFailure: const AuthFailure('Хандах эрхгүй.', code: 'FORBIDDEN'),
      );

      await _container(repository).read(serverVocabularyProvider.future);

      expect(serverVocabularyRevision, 0);
      expect(RiskLevel.outOfService.label, 'Ашиглах боломжгүй');
      expect(ServiceRequestStatus.completed.label, 'Дууссан');
    });

    testWidgets('a request card falls back to the status when the read failed',
        (WidgetTester tester) async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        vocabularyFailure: const NetworkFailure('Сүлжээнд холбогдож чадсангүй.'),
      );
      await _container(repository).read(serverVocabularyProvider.future);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            backgroundColor: CustomerTokens.bg,
            body: ServiceRequestCard(request: _row()),
          ),
        ),
      );
      await tester.pumpAndSettle();

      // The pill upper-cases what it is given.
      expect(find.text('ОЧСОН'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    test('an empty answer is not installed over a good one', () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));
      final int installed = serverVocabularyRevision;

      installServerVocabulary(ServerVocabulary.empty);

      expect(serverVocabularyRevision, installed);
      expect(RiskLevel.normal.label, 'Бүрэн бүтэн');
    });

    test('a body this binary cannot parse degrades row by row', () {
      installServerVocabulary(
        ServerVocabulary.fromJson(<String, dynamic>{
          'requestStages': 'not a list',
          'riskBands': <Object>[
            'not a row',
            <String, dynamic>{'level': 'NORMAL'}, // no label
            <String, dynamic>{'level': 'CRITICAL', 'label': 'Аюултай'},
          ],
        }),
      );

      // The two unusable rows are dropped and the usable one is kept, rather than the
      // whole read being thrown away over one bad entry.
      expect(RiskLevel.normal.label, 'Хэвийн');
      expect(RiskLevel.critical.label, 'Аюултай');
    });
  });

  group('an administrator has renamed things', () {
    test('the provider installs what it read', () async {
      final FakeCustomerPortalRepository repository = FakeCustomerPortalRepository(
        vocabulary: ServerVocabulary.fromJson(_configured()),
      );

      await _container(repository).read(serverVocabularyProvider.future);

      expect(serverVocabularyRevision, 1);
      expect(RiskLevel.normal.label, 'Бүрэн бүтэн');
      expect(RiskLevel.normal.tone, AccentTone.blue);

      // A renamed band shows its new name in full where the short label goes: this app
      // has never seen the word and must not invent an abbreviation for it.
      expect(RiskLevel.normal.shortLabel, 'Бүрэн бүтэн');
      // A band that was NOT renamed keeps its designed abbreviation.
      expect(RiskLevel.attention.shortLabel, 'Анхаарах');
    });

    test('a stage covering one status renames it; a stage covering three does not', () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));

      // ON_THE_WAY is its own stage, so the two are the same step under two names.
      expect(ServiceRequestStatus.onTheWay.label, 'Замд гарсан');

      // «Дууссан» groups REPORT_SUBMITTED, VERIFICATION and COMPLETED. Printing the
      // group's name on each would make the timeline report three different events —
      // the conclusion filed, checked and approved — as the same one.
      expect(ServiceRequestStatus.reportSubmitted.label, 'Дүгнэлт илгээсэн');
      expect(ServiceRequestStatus.verification.label, 'Баталгаажуулах');
      expect(ServiceRequestStatus.completed.label, 'Дууссан');

      // The colour, unlike the name, is taken from the group: it is a severity cue, and
      // three statuses of one step sharing it says something true.
      expect(ServiceRequestStatus.verification.tone, AccentTone.green);
      expect(ServiceRequestStatus.onTheWay.tone, AccentTone.purple);
    });

    test('a configured spare band joins the legend and the unconfigured ones do not',
        () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));

      expect(RiskLevel.band6.label, 'Хяналтад авах');
      expect(RiskLevel.band6.tone, AccentTone.purple);

      // Best-first, in the enum's own order rather than the server's, so the legend and
      // the hero stair keep reading as an escalation.
      expect(riskBandsInUse(), <RiskLevel>[
        RiskLevel.normal,
        RiskLevel.attention,
        RiskLevel.outOfService,
        RiskLevel.band6,
      ]);
      expect(riskBandsInUse(), isNot(contains(RiskLevel.band7)));
    });

    test('a device graded into a spare band renders as that band, never as unassessed',
        () {
      expect(RiskLevel.fromWire('BAND_7'), RiskLevel.band7);

      // And no legacy score can be read into one: their range is empty on purpose.
      for (int score = 0; score <= 100; score++) {
        expect(RiskLevel.fromScore(score).index, lessThan(RiskLevel.band6.index));
      }
    });
  });

  group('the stage on a request DTO', () {
    testWidgets('is what a list row prints, over the raw status',
        (WidgetTester tester) async {
      final ServiceRequestListItemModel row = _row(
        stage: <String, dynamic>{
          'key': 'IN_PROGRESS',
          'label': 'Гүйцэтгэж байна',
          'colour': 'amber',
        },
      );

      expect(row.stepLabel, 'Гүйцэтгэж байна');
      expect(row.stepTone, AccentTone.yellow);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            backgroundColor: CustomerTokens.bg,
            body: ServiceRequestCard(request: row),
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('ГҮЙЦЭТГЭЖ БАЙНА'), findsOneWidget);
      // The engine status is not also printed beside it.
      expect(find.text('ОЧСОН'), findsNothing);
    });

    test('falls back to the status when the server sent none', () {
      final ServiceRequestListItemModel row = _row();

      expect(row.stage, isNull);
      expect(row.stepLabel, 'Очсон');
    });
  });
}
