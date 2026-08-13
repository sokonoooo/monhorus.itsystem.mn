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
/// NO SCORE BOUNDARIES LIVE ON THIS ENUM, AND NONE MAY BE ADDED.
///
/// It carried `81/61/41/21/0` until they were deleted. They were the shipped defaults,
/// an administrator moves them in Тохиргоо, and this app cannot read `/settings` — so a
/// boundary here is a number the server can silently contradict. `risk_level_test.dart`
/// fails the build if any reappear.
enum RiskLevel {
  normal('NORMAL', 'Хэвийн', 'Хэвийн', AccentTone.green),
  attention('ATTENTION', 'Анхаарах шаардлагатай', 'Анхаарах', AccentTone.yellow),
  scheduleRepair(
      'SCHEDULE_REPAIR', 'Ойрын хугацаанд засварлах', 'Засварлах', AccentTone.orange),
  critical('CRITICAL', 'Ноцтой эрсдэлтэй', 'Ноцтой', AccentTone.red),
  outOfService('OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', AccentTone.black);

  const RiskLevel(
    this.wireValue,
    this.label,
    this.shortLabel,
    this.tone,
  );

  final String wireValue;

  /// The backend's `RISK_LEVEL_LABELS` value, verbatim.
  final String label;

  /// Used only where the full label will not fit. Never a colour name: "Улаан",
  /// "Шар" and friends repeat the colour, carry no meaning and are useless to a
  /// colour-blind reader.
  final String shortLabel;

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

  /// The band colour as a solid fill.
  Color get solidBackground => tone.foreground;

  /// White on a solid band fill, except on `ATTENTION` where white is unreadable.
  Color get solidForeground => this == RiskLevel.attention
      ? CustomerTokens.onAttention
      : CustomerTokens.white;
}

/// Shown wherever a band is absent, matching the admin web's `ScorePercent`.
const String unassessedLabel = 'Үнэлгээгүй';
