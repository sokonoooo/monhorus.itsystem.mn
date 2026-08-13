import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/risk_level.dart';

/// The customer app's half of the same rule the employee app's `risk_level_test.dart`
/// enforces: the band scale belongs to the server.
///
/// The edges are configurable in Тохиргоо and no customer holds `settings.view`, so a
/// threshold compiled in here is a number this app cannot verify and the server can
/// silently contradict. The enum carried `81/61/41/21/0` for a `fromScore` helper nothing
/// called; both are gone, and this keeps them gone.
void main() {
  group('the band scale is the server\'s, never ours', () {
    test('no risk band carries a score boundary', () {
      for (final RiskLevel level in RiskLevel.values) {
        expect(level.wireValue, isNotEmpty);
        expect(level.label, isNotEmpty);
        expect(level.shortLabel, isNotEmpty);
      }
      expect(RiskLevel.values, hasLength(5));
    });

    test('risk_level.dart declares no numeric threshold', () {
      final File source = File(
        'lib/features/customer_portal/domain/entities/risk_level.dart',
      );
      expect(source.existsSync(), isTrue, reason: 'risk_level.dart moved; update this test');

      final List<String> offending = source
          .readAsLinesSync()
          .where((String line) {
            final String code = line.split('///').first;
            return RegExp(r'\b(0|20|21|40|41|60|61|80|81|100)\b').hasMatch(code);
          })
          .toList();

      expect(
        offending,
        isEmpty,
        reason:
            'A score boundary reappeared in risk_level.dart. Render the API\'s riskLevel '
            'instead, and never print the scale.',
      );
    });

    test('no screen derives a band from a score', () {
      final ProcessResult grep = Process.runSync(
        'grep',
        // The call, not the word, so an explanatory comment cannot fail this.
        <String>['-rn', '--include=*.dart', 'fromScore(', 'lib'],
      );
      expect(
        (grep.stdout as String).trim(),
        isEmpty,
        reason: 'Something derives a risk band on the device; the server is the authority.',
      );
    });

    test('an unknown wire value is null rather than a guessed band', () {
      expect(RiskLevel.fromWire(null), isNull);
      expect(RiskLevel.fromWire('SOMETHING_NEW'), isNull);
      expect(RiskLevel.fromWire('CRITICAL'), RiskLevel.critical);
    });
  });
}
