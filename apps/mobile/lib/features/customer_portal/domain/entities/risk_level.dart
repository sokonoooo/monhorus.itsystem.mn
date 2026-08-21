import 'package:flutter/painting.dart';

import '../../presentation/theme/customer_tokens.dart';
import 'server_vocabulary.dart';

/// Mirrors `RiskLevel` in packages/shared/src/constants/service-request.ts.
///
/// Five documented bands, best-first, plus three reserved storage keys. A null
/// `riskLevel` is a further *display* state - `unassessed` - for an object that exists
/// but has never been scored. It is not a band and must never be rendered as one, and
/// it is never green.
///
/// The backend is the authority: it always sends `riskLevel`, and the app never
/// derives a band from a score when the API sent one.
///
/// **The names and colours below are defaults, not facts.** An administrator may
/// rename and recolour any band, and `GET /vocabulary` is where this app reads what
/// they chose - see `server_vocabulary.dart`. [label], [shortLabel] and [tone] are
/// getters over that answer for exactly that reason: making them getters is what let
/// the server's words reach every call site in the portal without one of them
/// changing. Each falls back to the compiled value, so an app that never reached the
/// server reads exactly as it always did.
enum RiskLevel {
  normal('NORMAL', 'Хэвийн', 'Хэвийн', 81, 100, AccentTone.green),
  attention(
      'ATTENTION', 'Анхаарах шаардлагатай', 'Анхаарах', 61, 80, AccentTone.yellow),
  scheduleRepair('SCHEDULE_REPAIR', 'Ойрын хугацаанд засварлах', 'Засварлах', 41,
      60, AccentTone.orange),
  critical('CRITICAL', 'Ноцтой эрсдэлтэй', 'Ноцтой', 21, 40, AccentTone.red),
  outOfService(
      'OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', 0, 20, AccentTone.black),

  /*
   * The three reserved keys.
   *
   * `RISK_LEVELS` carries eight entries, not five: the spares exist so an
   * administrator can add a sixth, seventh or eighth band in Тохиргоо without
   * rewriting six collections of stored assessments. They are storage keys and carry
   * no meaning of their own - an unconfigured spare is never assigned to anything, and
   * a configured one means whatever the administrator named it.
   *
   * They are here so a device graded into one still renders. Without them `fromWire`
   * would answer null for a real band and the device would read as «Үнэлгээгүй» - an
   * object nobody has looked at - which is a different and much worse claim than an
   * unfamiliar band name.
   *
   * The names and the neutral triad below are placeholders meant to be replaced:
   * `serverRiskLabel` and `serverRiskColour` supply the administrator's own, and
   * [riskBandsInUse] keeps an unconfigured spare out of every legend and stair, so
   * these words normally never appear at all.
   *
   * Their score range is EMPTY (min 0, max -1) rather than merely unused, so
   * [fromScore] can never land a legacy payload on a band nobody has defined.
   */
  band6('BAND_6', 'Түвшин 6', 'Түвшин 6', 0, -1, AccentTone.neutral),
  band7('BAND_7', 'Түвшин 7', 'Түвшин 7', 0, -1, AccentTone.neutral),
  band8('BAND_8', 'Түвшин 8', 'Түвшин 8', 0, -1, AccentTone.neutral);

  const RiskLevel(
    this.wireValue,
    this._bundledLabel,
    this._bundledShortLabel,
    this.min,
    this.max,
    this._bundledTone,
  );

  final String wireValue;

  /// The band name as the backend's `RISK_LEVEL_LABELS` had it at build time.
  final String _bundledLabel;

  /// The abbreviation drawn for this band by the designer.
  final String _bundledShortLabel;

  /// The triad the five documented bands were designed in.
  final AccentTone _bundledTone;

  /// The full band name: the administrator's, or the one compiled in.
  String get label => serverRiskLabel(wireValue) ?? _bundledLabel;

  /// Used only where the full label will not fit. Never a colour name: "Улаан",
  /// "Шар" and friends repeat the colour, carry no meaning and are useless to a
  /// colour-blind reader.
  ///
  /// The server sends one name per band and no abbreviation, so there are two cases.
  /// A band the administrator has NOT renamed keeps [_bundledShortLabel] - the
  /// designed abbreviation is still the right short form of the same word. A band they
  /// HAVE renamed shows their name in full: a chip reading «Засварлах» under a band
  /// somebody renamed to something else would be this app inventing an abbreviation
  /// for a word it has never seen.
  String get shortLabel {
    final String? configured = serverRiskLabel(wireValue);
    if (configured == null || configured == _bundledLabel) {
      return _bundledShortLabel;
    }
    return configured;
  }

  /// The band's triad: the administrator's colour, or the designed one.
  AccentTone get tone =>
      AccentTone.named(serverRiskColour(wireValue)) ?? _bundledTone;

  /// **NOT AUTHORITATIVE.** The frozen defaults from the shared package, kept solely
  /// so [fromScore] has boundaries to fall back on for a legacy payload that carried a
  /// score with no band.
  ///
  /// The live thresholds are runtime-configurable server-side (`riskBandsOf`,
  /// `settings.ts:286`) and neither mobile role can read `GET /settings` - it answers
  /// 403, because `SETTINGS_VIEW` is admin/management/finance only. `GET /vocabulary`
  /// does report the configured ranges, and they are still not printed: a range on a
  /// chip is a promise about how the next assessment will be graded, and only the
  /// server can keep it. Show the band name and the object's own score; never the
  /// scale.
  final int min;
  final int max;

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

/// The five bands requirements section 10 documents, best-first.
///
/// What the portal shows when it has not been told otherwise. It is not
/// `RiskLevel.values` any more: three of those eight are reserved storage keys.
const List<RiskLevel> documentedRiskBands = <RiskLevel>[
  RiskLevel.normal,
  RiskLevel.attention,
  RiskLevel.scheduleRepair,
  RiskLevel.critical,
  RiskLevel.outOfService,
];

/// The bands a legend, the home stair or a per-band breakdown should be drawn from.
///
/// **Never `RiskLevel.values`.** Three of the eight are spare storage keys reserved so
/// the band count can change without a data migration, and iterating the enum would
/// print «Түвшин 6», «Түвшин 7» and «Түвшин 8» beside «Хэвийн» on every screen that
/// lists bands - naming three that nobody configured and no device can be in.
///
/// So: the ladder the server reports, when it has reported one, and the five
/// documented bands otherwise. Ordered by the enum's own declaration order rather than
/// by the server's, which is worst-first: the legend, the count chips and the hero
/// stair all read best-first, and reversing them would silently invert the escalation
/// the colours spell out.
List<RiskLevel> riskBandsInUse() {
  final List<String> configured = serverRiskLevels();
  if (configured.isEmpty) return documentedRiskBands;

  final List<RiskLevel> bands = <RiskLevel>[
    for (final String wire in configured)
      if (RiskLevel.fromWire(wire) case final RiskLevel level) level,
  ]..sort((RiskLevel a, RiskLevel b) => a.index.compareTo(b.index));

  // A ladder of keys this binary has never heard of is no more useful than none.
  return bands.isEmpty ? documentedRiskBands : bands;
}
