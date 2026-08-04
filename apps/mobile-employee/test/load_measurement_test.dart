// Multiple load units: the readings a visit takes in A, V and kW.
//
// The rule every case here defends is that `measuredLoadKw` stays the single summable
// figure. Amps and volts ride alongside it on the assessment and are visible to nothing
// that adds up, so the payload has to keep them out of the kW field and the parser has
// to keep three per-phase currents apart rather than collapsing them.
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/object_enums.dart';
import 'package:monhorus_employee/features/employee/project/presentation/format.dart';

Map<String, dynamic> _assessment({Object? measurements}) => <String, dynamic>{
      'id': 'a1',
      'objectId': 'o1',
      'previousScore': 80,
      'newScore': 72,
      'riskLevel': 'ATTENTION',
      'assessedByName': 'Дорж Ganbold',
      'assessedAt': '2026-07-20T02:00:00.000Z',
      'photos': <dynamic>[],
      'conclusion': 'Гурван фазын ачаалал жигд бус.',
      'recommendation': 'Ачааллыг тэнцвэржүүлнэ.',
      'actionTaken': null,
      'measuredLoadKw': 17.2,
      if (measurements != null) 'measurements': measurements,
      'repairRequired': false,
      'revisitRequired': false,
      'revisitDate': null,
      'revisitOwnerName': null,
      'sourceLabel': null,
    };

void main() {
  group('LoadMeasurementModel parsing', () {
    test('round-trips three per-phase current readings', () {
      final ObjectAssessmentModel assessment = ObjectAssessmentModel.fromJson(
        _assessment(measurements: <Map<String, dynamic>>[
          <String, dynamic>{
            'kind': 'CURRENT',
            'value': 41.2,
            'unit': 'AMPERE',
            'phase': 'L1',
          },
          <String, dynamic>{
            'kind': 'CURRENT',
            'value': 38.9,
            'unit': 'AMPERE',
            'phase': 'L2',
          },
          <String, dynamic>{
            'kind': 'CURRENT',
            'value': 44.1,
            'unit': 'AMPERE',
            'phase': 'L3',
          },
        ]),
      );

      // The imbalance between the phases is the finding, so all three survive as
      // separate readings rather than being averaged into one.
      expect(assessment.measurements, hasLength(3));
      expect(
        assessment.measurements
            .map(formatLoadMeasurement)
            .toList(growable: false),
        // `formatDecimal` holds two digits on a non-integral reading.
        <String>['41.20 А (L1)', '38.90 А (L2)', '44.10 А (L3)'],
      );
      // And the kW head is untouched by them.
      expect(assessment.measuredLoadKw, 17.2);
    });

    test('an assessment with no measurements parses as it always did', () {
      final ObjectAssessmentModel assessment =
          ObjectAssessmentModel.fromJson(_assessment());

      expect(assessment.measurements, isEmpty);
      expect(assessment.measuredLoadKw, 17.2);
      expect(assessment.newScore, 72);
    });

    test('a reading the app cannot name is dropped, not thrown', () {
      // Forward compatibility: a kind added to the shared vocabulary after this build
      // shipped must cost one line of display, not the whole device history.
      final ObjectAssessmentModel assessment = ObjectAssessmentModel.fromJson(
        _assessment(measurements: <Map<String, dynamic>>[
          <String, dynamic>{
            'kind': 'POWER_FACTOR',
            'value': 0.92,
            'unit': 'RATIO',
            'phase': null,
          },
          <String, dynamic>{
            'kind': 'VOLTAGE',
            'value': 231,
            'unit': 'VOLT',
            'phase': null,
          },
        ]),
      );

      expect(assessment.measurements, hasLength(1));
      expect(assessment.measurements.single.kind, LoadMeasurementKind.voltage);
      expect(formatLoadMeasurement(assessment.measurements.single), '231 В');
    });
  });

  group('CreateAssessmentRequest payload', () {
    test('sends the readings with the unit resolved from the kind', () {
      final Map<String, dynamic> body = const CreateAssessmentRequest(
        newScore: 72,
        photoIds: <String>['p1'],
        measuredLoadKw: 17.2,
        measurements: <LoadMeasurementModel>[
          LoadMeasurementModel(
            kind: LoadMeasurementKind.current,
            value: 41.2,
            unit: LoadMeasurementUnit.ampere,
            phase: LoadMeasurementPhase.l1,
          ),
          LoadMeasurementModel(
            kind: LoadMeasurementKind.voltage,
            value: 231,
            unit: LoadMeasurementUnit.volt,
            phase: null,
          ),
        ],
      ).toJson();

      expect(body['measuredLoadKw'], 17.2);
      expect(body['measurements'], <Map<String, dynamic>>[
        <String, dynamic>{
          'kind': 'CURRENT',
          'value': 41.2,
          'unit': 'AMPERE',
          'phase': 'L1',
        },
        <String, dynamic>{
          'kind': 'VOLTAGE',
          'value': 231.0,
          'unit': 'VOLT',
          'phase': null,
        },
      ]);
    });

    test('omits the field entirely when nothing extra was read', () {
      final Map<String, dynamic> body = const CreateAssessmentRequest(
        newScore: 72,
        photoIds: <String>['p1'],
        measuredLoadKw: 17.2,
      ).toJson();

      // An untouched editor sends exactly what the form sent before the field existed.
      expect(body.containsKey('measurements'), isFalse);
      expect(body['measuredLoadKw'], 17.2);
    });

    test('never lets a power reading carry a phase', () {
      final Map<String, dynamic> body = const CreateAssessmentRequest(
        newScore: 72,
        photoIds: <String>['p1'],
        measurements: <LoadMeasurementModel>[
          LoadMeasurementModel(
            kind: LoadMeasurementKind.activePower,
            value: 8.4,
            unit: LoadMeasurementUnit.kilowatt,
            phase: LoadMeasurementPhase.l2,
          ),
        ],
      ).toJson();

      final List<dynamic> readings = body['measurements'] as List<dynamic>;
      expect((readings.single as Map<String, dynamic>)['phase'], isNull);
      expect((readings.single as Map<String, dynamic>)['unit'], 'KILOWATT');
    });
  });
}
