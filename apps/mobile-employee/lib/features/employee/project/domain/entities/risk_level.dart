import '../../../presentation/theme/employee_tokens.dart';

/// Mirrors `RiskLevel` in packages/shared/src/constants/service-request.ts.
///
/// **This is the only `RiskLevel` in the app.** The work feature used to carry a
/// second copy whose colour mapping collapsed ATTENTION onto SCHEDULE_REPAIR and
/// CRITICAL onto OUT_OF_SERVICE, so the same device read as two different bands in
/// two different tabs. That enum is deleted; `planned_work_enums.dart` re-exports
/// this one.
///
/// The band boundaries are configurable per requirements 10.1 and are read from
/// `/settings`, which a field technician does not hold `settings.view` for. The app
/// therefore never derives a band: every screen displays the `riskLevel` the API sent
/// alongside the score, and no screen ever prints the scale.
/// NO SCORE BOUNDARIES LIVE ON THIS ENUM, AND NONE MAY BE ADDED.
///
/// It carried `81/61/41/21/0` until they were deleted. They were the shipped defaults,
/// an administrator moves them in Тохиргоо, and this app cannot read `/settings` — so a
/// boundary here is a number the server can silently contradict. `risk_level_test.dart`
/// fails the build if any reappear.
enum RiskLevel {
  normal('NORMAL', 'Хэвийн', 'Хэвийн', Tone.green),
  attention('ATTENTION', 'Анхаарах шаардлагатай', 'Анхаарах', Tone.yellow),
  scheduleRepair(
    'SCHEDULE_REPAIR',
    'Ойрын хугацаанд засварлах',
    'Засварлах',
    Tone.orange,
  ),
  critical('CRITICAL', 'Ноцтой эрсдэлтэй', 'Ноцтой', Tone.red),
  outOfService('OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', Tone.black);

  const RiskLevel(
    this.wireValue,
    this.label,
    this.shortLabel,
    this.tone,
  );

  final String wireValue;

  /// The full band name, verbatim from the backend's `RISK_LEVEL_LABELS`.
  final String label;

  /// The abbreviation for a chip too narrow for [label].
  ///
  /// Never a colour name. "Улаан", "Шар" and friends repeat the colour, carry no
  /// meaning and are useless to a colour-blind reader; the band identity is carried
  /// by the glyph and the swatch, and the text says what the band *means*.
  final String shortLabel;

  /// The band's `{fg, bg, border}` triad. All five are distinct, everywhere.
  final Tone tone;

  /// Null-tolerant: the API sends `riskLevel: null` for a never-assessed object, and
  /// that is a distinct display state, not a band, so it must not be coerced into one.
  static RiskLevel? fromWire(String? value) {
    if (value == null) return null;
    for (final RiskLevel level in RiskLevel.values) {
      if (level.wireValue == value) return level;
    }
    return null;
  }

  /// Bands that call for a technician's attention: everything below NORMAL.
  bool get needsAttention => this != RiskLevel.normal;

  /// The two bands section 10.2 requires a warning marker on.
  bool get isCritical =>
      this == RiskLevel.critical || this == RiskLevel.outOfService;
}

/// Shown wherever an object has never been assessed. An unassessed device is an
/// unknown, never a zero and never a failing score — and never green.
const String unassessedLabel = 'Үнэлгээгүй';

/// The full band name for a screen reader, including the null case.
String riskSemanticLabel(RiskLevel? level) => level?.label ?? unassessedLabel;

/// The abbreviation for a chip, including the null case.
String riskShortLabel(RiskLevel? level) => level?.shortLabel ?? unassessedLabel;

/// The triad for a band, including the null case. Grey, never green.
Tone riskTone(RiskLevel? level) => level?.tone ?? Tone.neutral;
