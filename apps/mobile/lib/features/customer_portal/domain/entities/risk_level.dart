import 'package:flutter/painting.dart';

import '../../presentation/theme/customer_tokens.dart';

/// Mirrors `RiskLevel` in packages/shared/src/constants/service-request.ts.
///
/// Exactly five bands, best-first. A null `riskLevel` is a sixth *display* state -
/// `unassessed` - for an object that exists but has never been scored. It is not a
/// band and must never be rendered as one, and it is never green.
///
/// The backend is the authority: it always sends `riskLevel`, and the app never
/// derives a band from a score when the API sent one.
enum RiskLevel {
  normal('NORMAL', 'Хэвийн', 'Хэвийн', 81, 100, AccentTone.green),
  attention(
      'ATTENTION', 'Анхаарах шаардлагатай', 'Анхаарах', 61, 80, AccentTone.yellow),
  scheduleRepair('SCHEDULE_REPAIR', 'Ойрын хугацаанд засварлах', 'Засварлах', 41,
      60, AccentTone.orange),
  critical('CRITICAL', 'Ноцтой эрсдэлтэй', 'Ноцтой', 21, 40, AccentTone.red),
  outOfService(
      'OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', 0, 20, AccentTone.black);

  const RiskLevel(
    this.wireValue,
    this.label,
    this.shortLabel,
    this.min,
    this.max,
    this.tone,
  );

  final String wireValue;

  /// The backend's `RISK_LEVEL_LABELS` value, verbatim.
  final String label;

  /// Used only where the full label will not fit. Never a colour name: "Улаан",
  /// "Шар" and friends repeat the colour, carry no meaning and are useless to a
  /// colour-blind reader.
  final String shortLabel;

  /// **NOT AUTHORITATIVE.** The frozen defaults from the shared package, kept
  /// solely so [fromScore] has boundaries to fall back on for a legacy payload that
  /// carried a score with no band.
  ///
  /// The live thresholds are runtime-configurable server-side (`riskBandsOf`,
  /// `settings.ts:286`) and neither mobile role can read `GET /settings` - it
  /// answers 403, because `SETTINGS_VIEW` is admin/management/finance only. Mobile
  /// therefore cannot know the real boundaries, so these two numbers must never
  /// reach the UI. Show the band name and the object's own score; never the scale.
  final int min;
  final int max;

  final AccentTone tone;

  /// Null-tolerant: the API sends `riskLevel: null` for a never-assessed object, and
  /// that is a distinct state from any band, so it must not be coerced to one.
  static RiskLevel? fromWire(String? value) {
    if (value == null) return null;
    for (final RiskLevel level in RiskLevel.values) {
      if (level.wireValue == value) return level;
    }
    return null;
  }

  /// Legacy fallback only. Mirrors `riskLevelFromScore` against the frozen defaults
  /// in [min]/[max]; see the caveat there. Never drives the legend, and never runs
  /// when the server sent a band.
  static RiskLevel fromScore(int score) {
    for (final RiskLevel level in RiskLevel.values) {
      if (score >= level.min && score <= level.max) return level;
    }
    return RiskLevel.outOfService;
  }

  /// The band colour as a solid fill.
  Color get solidBackground => tone.foreground;

  /// White on a solid band fill, except on `ATTENTION` where white is unreadable.
  Color get solidForeground => this == RiskLevel.attention
      ? CustomerTokens.onAttention
      : CustomerTokens.white;
}

/// Shown wherever a band is absent, matching the admin web's `ScorePercent`.
const String unassessedLabel = 'Үнэлгээгүй';
