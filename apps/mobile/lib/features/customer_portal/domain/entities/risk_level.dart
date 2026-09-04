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
   * Their score range is EMPTY (min 0, max -1) rather than merely unused, so nothing
   * that reads a range can land on a band nobody has defined. A spare an administrator
   * HAS configured gets its real range from `/vocabulary`; see [configuredMax].
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

  /// **NOT AUTHORITATIVE.** The frozen defaults from the shared package, and only the
  /// fallback for [configuredMin] / [configuredMax] on a device that has never reached
  /// `GET /vocabulary`.
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

  /// The lowest score this installation puts in this band, or the compiled default.
  int get configuredMin => serverRiskMin(wireValue) ?? min;

  /// The highest score this installation puts in this band, or the compiled default.
  int get configuredMax => serverRiskMax(wireValue) ?? max;

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

/// The bands a legend, the home stair or a per-band breakdown should be drawn from,
/// best-first — and the ONE definition of severity order in this app.
///
/// **Never `RiskLevel.values`.** Three of the eight are spare storage keys reserved so
/// the band count can change without a data migration, and iterating the enum would
/// print «Түвшин 6», «Түвшин 7» and «Түвшин 8» beside «Хэвийн» on every screen that
/// lists bands - naming three that nobody configured and no device can be in.
///
/// So: the ladder the server reports, in the ORDER THE SERVER REPORTS IT, and the five
/// documented bands otherwise. `riskBandsOf` (`settings.ts:328`) reverses the resolved
/// ladder before it reaches `GET /vocabulary`, so what arrives is already best-first —
/// highest minimum score first — which is how the legend, the count chips and the hero
/// stair all read.
///
/// This used to re-sort by the compiled enum index, which quietly undid the
/// administrator's configuration: the three reserved keys are declared after
/// OUT_OF_SERVICE, so a configured spare was pushed past the worst band however its own
/// cut points were set. A ladder of NORMAL, ATTENTION, BAND_6, OUT_OF_SERVICE was drawn
/// with the worst band third and a mid-severity band last, and every rule that read
/// "worse than" off that order inherited the mistake.
List<RiskLevel> riskBandsInUse() {
  final List<String> configured = serverRiskLevels();
  if (configured.isEmpty) return documentedRiskBands;

  final List<RiskLevel> bands = <RiskLevel>[
    for (final String wire in configured)
      if (RiskLevel.fromWire(wire) case final RiskLevel level) level,
  ];

  // A ladder of keys this binary has never heard of is no more useful than none.
  return bands.isEmpty ? documentedRiskBands : bands;
}

/// Where a band sits on the ladder in force: 0 is the healthiest, and a higher number
/// is worse. -1 for a band this installation does not configure.
///
/// The one place "worse than" is decided. A stored assessment naming a band that has
/// since been dropped is not on the ladder at all, and answering -1 rather than
/// guessing a position is what keeps it out of every rule below.
int riskBandRank(RiskLevel level) => riskBandsInUse().indexOf(level);

/// The band that asks nothing of the customer: the top of the configured ladder.
RiskLevel? healthiestRiskBand() {
  final List<RiskLevel> bands = riskBandsInUse();
  return bands.isEmpty ? null : bands.first;
}

/// The worst band this installation defines.
RiskLevel? worstRiskBand() {
  final List<RiskLevel> bands = riskBandsInUse();
  return bands.isEmpty ? null : bands.last;
}

/// Whether a band is one the customer should act on: any configured band but the
/// healthiest.
///
/// This replaces «is it the NORMAL key», which named one band rather than describing
/// one — rename NORMAL, or ship an installation whose healthy band is called something
/// else, and every at-risk list quietly swept the healthy equipment in with the rest.
bool riskNeedsAttention(RiskLevel level) => riskBandRank(level) > 0;

/// Whether a band is severe enough to warrant an alert banner, a danger-styled action
/// and an urgent flag on a request the SERVER then dispatches.
///
/// **This is the app's own reading of the configured ladder, and it has to be.** The
/// backend attaches the real answer to each band — `requiresConclusion`, `notifies` and
/// `decommissions` in `risk-band.ts` — but `GET /vocabulary` publishes only the key,
/// name, colour and range, so a client cannot ask. What it can read is where the
/// administrator put the band on the 0-100 scale, and that is what this uses: a band
/// whose whole range sits in the bottom half of the scale is severe.
///
/// On the shipped ladder that is exactly CRITICAL (21-40) and OUT_OF_SERVICE (0-20),
/// which is the pair the hardcoded checks named — so nothing changes until somebody
/// reconfigures the ladder, and then this follows them instead of ignoring them.
///
/// A band this installation does not configure is never severe: it is not a band a
/// device here can be graded into.
bool riskIsSevere(RiskLevel level) {
  if (riskBandRank(level) < 0) return false;
  return level.configuredMax < riskScaleMidpoint;
}

/// The midpoint of the 0-100 assessment scale every band is defined against.
///
/// The scale's own middle, not a business threshold: the bands tile 0..100 by
/// construction (`risk-band.ts`), so "the bottom half" is a statement about the scale
/// rather than a number chosen here.
const int riskScaleMidpoint = 50;

/// Devices in the bands that call for the customer's attention without being severe.
///
/// Takes the count function rather than a collection because the two callers hold the
/// figures differently - a building's `riskSummary` holds a list, the home summary a map
/// - and the RULE is the thing that must not exist twice. Both used to spell it out as
/// `ATTENTION + SCHEDULE_REPAIR`, in two files, naming bands instead of describing them.
int attentionTotalOver(int Function(RiskLevel level) countOf) {
  int total = 0;
  for (final RiskLevel level in riskBandsInUse()) {
    if (riskNeedsAttention(level) && !riskIsSevere(level)) total += countOf(level);
  }
  return total;
}

/// Devices in the severe bands. See [riskIsSevere] for what makes a band one.
int severeTotalOver(int Function(RiskLevel level) countOf) {
  int total = 0;
  for (final RiskLevel level in riskBandsInUse()) {
    if (riskIsSevere(level)) total += countOf(level);
  }
  return total;
}
