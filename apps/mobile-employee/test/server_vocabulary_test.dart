// What the app says when the server has named things itself — and what it says when
// the server never answered.
//
// The second half is the important one. Every label and colour in this app used to be
// compiled in, and the change that ended that must not have made the app depend on a
// call it can make from a basement with no signal. So the failure case is asserted as
// hard as the success case: a refused, broken or unreachable `/vocabulary` has to leave
// the screens reading exactly as they did before the endpoint existed.
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:monhorus_employee/core/error/exceptions.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/presentation/theme/employee_tokens.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';
import 'package:monhorus_employee/features/employee/shared/server_vocabulary.dart';
import 'package:monhorus_employee/features/employee/shared/server_vocabulary_data_source.dart';
import 'package:monhorus_employee/features/employee/shared/server_vocabulary_provider.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_vocabulary.dart';

const AppUser _technician = AppUser(
  id: '6a6a1dc9cf308958351efe01',
  fullName: 'Сараа Пүрэв',
  email: 'p.saraa@monhorus.mn',
  phone: '8811-9922',
  role: UserRole.technician,
  status: AccountStatus.active,
);

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

/// A server that cannot be reached — the ordinary case on a site with no signal.
class _OfflineSource implements ServerVocabularyRemoteDataSource {
  @override
  Future<ServerVocabulary> fetch() => Future<ServerVocabulary>.error(
        const NetworkException(),
      );
}

/// A server that answers, and refuses.
class _RefusingSource implements ServerVocabularyRemoteDataSource {
  @override
  Future<ServerVocabulary> fetch() => Future<ServerVocabulary>.error(
        const ServerException(
          message: 'Хандах эрхгүй.',
          code: 'FORBIDDEN',
          statusCode: 403,
        ),
      );
}

class _AnsweringSource implements ServerVocabularyRemoteDataSource {
  const _AnsweringSource(this.body);

  final Map<String, dynamic> body;

  @override
  Future<ServerVocabulary> fetch() async => ServerVocabulary.fromJson(body);
}

ProviderContainer _container(ServerVocabularyRemoteDataSource source) {
  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      currentUserProvider.overrideWithValue(_technician),
      serverVocabularyDataSourceProvider.overrideWithValue(source),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  // The installed vocabulary is process-wide, so one case's server must not be the
  // next case's starting point.
  setUp(resetServerVocabulary);
  tearDown(resetServerVocabulary);

  group('the compiled-in words are what a failed read leaves behind', () {
    test('an unreachable server changes nothing', () async {
      final ProviderContainer container = _container(_OfflineSource());

      final ServerVocabulary answer =
          await container.read(serverVocabularyProvider.future);

      // The provider resolves rather than throwing: there is no error state for a
      // screen to render, because nothing is missing from the screen.
      expect(answer.isEmpty, isTrue);
      expect(serverVocabularyRevision, 0);

      expect(RiskLevel.normal.label, 'Хэвийн');
      expect(RiskLevel.normal.shortLabel, 'Хэвийн');
      expect(RiskLevel.normal.tone, Tone.green);
      expect(riskSemanticLabel(RiskLevel.critical), 'Ноцтой эрсдэлтэй');
      expect(riskShortLabel(null), 'Үнэлгээгүй');
      expect(riskTone(null), Tone.neutral);

      expect(ServiceRequestStatus.onTheWay.label, 'Замдаа');
      expect(ServiceRequestStatus.onTheWay.stageColour, isNull);

      // And the legend still lists the five bands the requirements document.
      expect(riskBandsInUse(), documentedRiskBands);
    });

    test('a 403 is not treated differently from a broken wire', () async {
      final ProviderContainer container = _container(_RefusingSource());

      await container.read(serverVocabularyProvider.future);

      expect(serverVocabularyRevision, 0);
      expect(RiskLevel.outOfService.label, 'Ашиглах боломжгүй');
      expect(ServiceRequestStatus.completed.label, 'Дууссан');
    });

    test('an empty answer is not installed over a good one', () async {
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
    test('the fetched words replace the compiled ones', () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));

      expect(RiskLevel.normal.label, 'Бүрэн бүтэн');
      expect(RiskLevel.normal.tone, Tone.blue);

      // A renamed band shows its new name in full where the short label goes: this
      // app has never seen the word and must not invent an abbreviation for it.
      expect(RiskLevel.normal.shortLabel, 'Бүрэн бүтэн');
      // A band that was NOT renamed keeps its designed abbreviation.
      expect(RiskLevel.attention.shortLabel, 'Анхаарах');
    });

    test('the provider installs what it read', () async {
      final ProviderContainer container =
          _container(_AnsweringSource(_configured()));

      await container.read(serverVocabularyProvider.future);

      expect(serverVocabularyRevision, 1);
      expect(RiskLevel.normal.label, 'Бүрэн бүтэн');
    });

    test('a stage covering one status renames it; a stage covering three does not',
        () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));

      // ON_THE_WAY is its own stage, so the two are the same step under two names.
      expect(ServiceRequestStatus.onTheWay.label, 'Замд гарсан');

      // «Дууссан» groups REPORT_SUBMITTED, VERIFICATION and COMPLETED. Printing the
      // group's name on each would tell a technician their conclusion had been
      // approved the moment they filed it.
      expect(ServiceRequestStatus.reportSubmitted.label, 'Дүгнэлт илгээсэн');
      expect(ServiceRequestStatus.verification.label, 'Баталгаажуулах');
      expect(ServiceRequestStatus.completed.label, 'Дууссан');

      // The colour, unlike the name, is taken from the group: it is a severity cue,
      // and three statuses of one step sharing it says something true.
      expect(Tone.named(ServiceRequestStatus.verification.stageColour), Tone.green);
      expect(Tone.named(ServiceRequestStatus.onTheWay.stageColour), Tone.purple);
    });

    test('a configured spare band joins the legend and the unconfigured ones do not',
        () {
      installServerVocabulary(ServerVocabulary.fromJson(_configured()));

      expect(RiskLevel.band6.label, 'Хяналтад авах');
      expect(RiskLevel.band6.tone, Tone.purple);

      // Best-first, in the enum's own order rather than the server's, so the legend
      // and the stair keep reading as an escalation.
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
    test('is preferred over the raw status on a row', () {
      final ServiceRequestListItemModel row =
          ServiceRequestListItemModel.fromJson(<String, dynamic>{
        'id': 'r1',
        'requestNumber': 'SR-202608-0001',
        'status': 'ON_SITE',
        'stage': <String, dynamic>{
          'key': 'IN_PROGRESS',
          'label': 'Гүйцэтгэж байна',
          'colour': 'amber',
        },
        'assignedEmployees': <Object>[],
      });

      expect(row.stage?.label, 'Гүйцэтгэж байна');
      expect(row.stepLabel, 'Гүйцэтгэж байна');
      expect(Tone.named(row.stage?.colour), Tone.yellow);
    });

    test('falls back to the status when the server sent none', () {
      final ServiceRequestListItemModel row =
          ServiceRequestListItemModel.fromJson(<String, dynamic>{
        'id': 'r1',
        'requestNumber': 'SR-202608-0002',
        'status': 'ON_SITE',
        'assignedEmployees': <Object>[],
      });

      expect(row.stage, isNull);
      expect(row.stepLabel, 'Очсон');
    });
  });
}
