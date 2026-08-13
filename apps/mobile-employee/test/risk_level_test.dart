import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/employee/presentation/theme/employee_tokens.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';

/// Guards the rule that this app never carries a score boundary.
///
/// The band edges are runtime-configurable in Тохиргоо (`riskBandsOf`) and no mobile role
/// holds `settings.view`, so `GET /settings` answers 403. A threshold compiled into the
/// app is therefore a number the server can silently contradict: an installation that
/// moves its green band to 90 would have this app calling 85 "Хэвийн" forever, with no
/// error anywhere. The enum used to carry `81/61/41/21/0` for a `fromScore` helper that
/// nothing called — dead code that was one import away from becoming a wrong answer.
///
/// The source-scanning test is deliberately crude. It is the only kind that fails when
/// somebody re-adds the constants in a future edit, which is the actual risk here — a
/// behavioural test cannot catch a number that nothing reads yet.
void main() {
  group('the band scale is the server\'s, never ours', () {
    test('no risk band carries a score boundary', () {
      // If a `min`/`max` is ever added back, this stops compiling or starts failing —
      // whichever comes first. The enum must expose identity and presentation only.
      for (final RiskLevel level in RiskLevel.values) {
        expect(level.wireValue, isNotEmpty);
        expect(level.label, isNotEmpty);
        expect(level.shortLabel, isNotEmpty);
      }
      expect(RiskLevel.values, hasLength(5));
    });

    test('risk_level.dart declares no numeric threshold', () {
      final File source = File(
        'lib/features/employee/project/domain/entities/risk_level.dart',
      );
      expect(source.existsSync(), isTrue, reason: 'risk_level.dart moved; update this test');

      final List<String> offending = source
          .readAsLinesSync()
          .where((String line) {
            final String code = line.split('///').first;
            // The shipped defaults, and any other bare number in enum/field position.
            return RegExp(r'\b(0|20|21|40|41|60|61|80|81|100)\b').hasMatch(code);
          })
          .toList();

      expect(
        offending,
        isEmpty,
        reason:
            'A score boundary reappeared in risk_level.dart. The bands are configurable '
            'server-side and this app cannot read them — render the API\'s riskLevel '
            'instead, and never print the scale.',
      );
    });

    test('no screen derives a band from a score', () {
      final ProcessResult grep = Process.runSync(
        'grep',
        // The call, not the word: a comment explaining why the helper is gone must not
        // fail the test that keeps it gone.
        <String>['-rn', '--include=*.dart', 'fromScore(', 'lib'],
      );
      expect(
        (grep.stdout as String).trim(),
        isEmpty,
        reason:
            'Something derives a risk band on the device. The server sends `riskLevel` '
            'beside every score; that is the only authority.',
      );
    });

    test('an absent band is an explicit unknown, never a band and never green', () {
      expect(riskSemanticLabel(null), unassessedLabel);
      expect(riskShortLabel(null), unassessedLabel);
      expect(riskTone(null), Tone.neutral);
      // The failing band is a real answer and must not be confused with the unknown one.
      expect(riskTone(RiskLevel.outOfService), isNot(Tone.neutral));
    });

    test('an unknown wire value is null rather than a guessed band', () {
      expect(RiskLevel.fromWire(null), isNull);
      expect(RiskLevel.fromWire('SOMETHING_NEW'), isNull);
      expect(RiskLevel.fromWire('NORMAL'), RiskLevel.normal);
    });
  });
}
