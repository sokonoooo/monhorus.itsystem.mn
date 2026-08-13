import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/object_enums.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';

/// Keeps this app's hand-written wire vocabularies honest against `packages/shared`.
///
/// WHY THIS IS A TEST AND NOT AN IMPORT. `packages/shared` is TypeScript and this app is
/// Dart; there is no code path between them and no generator in the build. Every enum here
/// is therefore transcribed by hand, and a value renamed on the server goes unnoticed until
/// a screen renders blank. That already happened once — `ObjectHistoryKind` drifted from
/// the backend's union and three server values now parse to null.
///
/// So this reads the TypeScript as TEXT and asserts every wire value this app can emit or
/// match still exists there. It is deliberately one-directional: shared may contain values
/// this app does not model yet (that is normal and safe), but a value THIS app believes in
/// and shared has never heard of is a bug — it can only ever fail to match.
///
/// Labels are NOT compared. They are presentation, they are allowed to be shortened for a
/// phone, and asserting them would freeze the Mongolian copy against a file nobody edits
/// for wording. Values are the contract; labels are not.
///
/// `ObjectHistoryKind` IS KNOWINGLY ABSENT FROM THIS FILE, and saying so here is the point
/// — a guard that silently omits the one vocabulary already known to be broken would be
/// worse than no guard. It has drifted: the backend sends `ReportType | 'MEASUREMENT' |
/// 'AUDIT'`, so `OBJECT_ASSESSMENT`, `SERVICE_REQUEST` and `CONSOLIDATED` all parse to
/// null here, while this app's `ASSESSMENT`, `INSPECTION` and `REPAIR` match nothing. It is
/// latent only because `objectHistoryProvider` is watched by no widget. Adding it to this
/// group is the first step of that fix, not part of this change.
String _sharedConstant(String file) {
  final File source = File('../../packages/shared/src/constants/$file');
  expect(
    source.existsSync(),
    isTrue,
    reason: 'packages/shared moved relative to this app; update the path in this test',
  );
  return source.readAsStringSync();
}

/// Every `'SCREAMING_CASE'` literal in a shared constants file.
Set<String> _wireValuesIn(String file) {
  return RegExp(r"'([A-Z][A-Z0-9_]*)'")
      .allMatches(_sharedConstant(file))
      .map((RegExpMatch match) => match.group(1)!)
      .toSet();
}

void main() {
  group('wire vocabularies match packages/shared', () {
    test('every ObjectCategory this app knows exists in shared', () {
      final Set<String> shared = _wireValuesIn('object-master.ts');
      for (final ObjectCategory category in ObjectCategory.values) {
        expect(
          shared,
          contains(category.wireValue),
          reason: '${category.wireValue} is not in shared/constants/object-master.ts',
        );
      }
    });

    test('every ObjectStatus this app knows exists in shared', () {
      final Set<String> shared = _wireValuesIn('object-master.ts');
      for (final ObjectStatus status in ObjectStatus.values) {
        expect(shared, contains(status.wireValue));
      }
    });

    test('every ObjectIcon this app knows exists in shared', () {
      final Set<String> shared = _wireValuesIn('object-master.ts');
      for (final ObjectIcon icon in ObjectIcon.values) {
        expect(
          shared,
          contains(icon.wireValue),
          reason:
              '${icon.wireValue} is not a shared OBJECT_ICONS key, so a type using it '
              'would silently fall back to the generic glyph',
        );
      }
    });

    test('every RiskLevel this app knows exists in shared', () {
      final Set<String> shared = _wireValuesIn('service-request.ts');
      for (final RiskLevel level in RiskLevel.values) {
        expect(shared, contains(level.wireValue));
      }
    });

    test('every LoadMeasurement vocabulary value exists in shared', () {
      final Set<String> shared = _wireValuesIn('load-measurement.ts');
      for (final LoadMeasurementKind kind in LoadMeasurementKind.values) {
        expect(shared, contains(kind.wireValue));
      }
      for (final LoadMeasurementUnit unit in LoadMeasurementUnit.values) {
        expect(shared, contains(unit.wireValue));
      }
      for (final LoadMeasurementPhase phase in LoadMeasurementPhase.values) {
        expect(shared, contains(phase.wireValue));
      }
    });
  });
}
