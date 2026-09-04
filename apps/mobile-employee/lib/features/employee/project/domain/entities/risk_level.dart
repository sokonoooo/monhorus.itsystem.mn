import '../../../presentation/theme/employee_tokens.dart';
import '../../../shared/server_vocabulary.dart';

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
///
/// **The names and colours below are defaults, not facts.** An administrator may
/// rename and recolour any band, and `GET /vocabulary` is where this app reads what
/// they chose — see `shared/server_vocabulary.dart`. [label], [shortLabel] and [tone]
/// are getters over that answer for exactly that reason: making them getters is what
/// let the server's words reach forty-odd call sites without one of them changing.
/// Each falls back to the compiled value, so an app that never reached the server, or
/// reached one that has been configured with nothing, reads exactly as it always did.
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
  outOfService('OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', Tone.black),

  /*
   * The three reserved keys.
   *
   * `RISK_LEVELS` carries eight entries, not five: the spares exist so an
   * administrator can add a sixth, seventh or eighth band in Тохиргоо without
   * rewriting six collections of stored assessments. They are storage keys, and they
   * carry no meaning of their own — an unconfigured spare is never assigned to
   * anything, and a configured one means whatever the administrator named it.
   *
   * They are here so that a device graded into one still renders. Without them
   * `fromWire` would answer null for a real band and the device would read as
   * «Үнэлгээгүй» — an object nobody has looked at — which is a different and much
   * worse claim than an unfamiliar band name.
   *
   * The names and the neutral triad below are placeholders and are meant to be
   * replaced: `serverRiskLabel` and `serverRiskColour` supply the administrator's
   * own, and `riskBandsInUse` keeps an unconfigured spare out of every legend and
   * stair so these words normally never appear at all.
   *
   * No band here carries a score range at all — not the spares, and not the five
   * documented ones. The cut points are Тохиргооны өгөгдөл this app cannot read, and
   * the API sends the band it derived, so a spare is reachable only by an explicit
   * `riskLevel` naming it.
   */
  band6('BAND_6', 'Түвшин 6', 'Түвшин 6', Tone.neutral),
  band7('BAND_7', 'Түвшин 7', 'Түвшин 7', Tone.neutral),
  band8('BAND_8', 'Түвшин 8', 'Түвшин 8', Tone.neutral);

  const RiskLevel(
    this.wireValue,
    this._bundledLabel,
    this._bundledShortLabel,
    this._bundledTone,
  );

  final String wireValue;

  /// The band name as `RISK_LEVEL_LABELS` had it at build time.
  final String _bundledLabel;

  /// The abbreviation drawn for this band by the designer, for a chip too narrow for
  /// [label].
  final String _bundledShortLabel;

  /// The `{fg, bg, border}` triad the five documented bands were designed in.
  final Tone _bundledTone;

  /// The full band name: the administrator's, or the one compiled in.
  String get label => serverRiskLabel(wireValue) ?? _bundledLabel;

  /// The abbreviation for a chip too narrow for [label].
  ///
  /// Never a colour name. "Улаан", "Шар" and friends repeat the colour, carry no
  /// meaning and are useless to a colour-blind reader; the band identity is carried
  /// by the glyph and the swatch, and the text says what the band *means*.
  ///
  /// The server sends one name per band and no abbreviation, so there are two cases.
  /// A band the administrator has NOT renamed keeps [_bundledShortLabel] — the
  /// designed abbreviation is still the right short form of the same word. A band
  /// they HAVE renamed shows their name in full: a chip reading «Засварлах» under a
  /// band somebody renamed to something else would be this app inventing an
  /// abbreviation for a word it has never seen.
  String get shortLabel {
    final String? configured = serverRiskLabel(wireValue);
    if (configured == null || configured == _bundledLabel) {
      return _bundledShortLabel;
    }
    return configured;
  }

  /// The band's `{fg, bg, border}` triad: the administrator's colour, or the designed
  /// one. All five documented bands are distinct, everywhere.
  Tone get tone => Tone.named(serverRiskColour(wireValue)) ?? _bundledTone;

  /// Null-tolerant: the API sends `riskLevel: null` for a never-assessed object, and
  /// that is a distinct display state, not a band, so it must not be coerced into one.
  static RiskLevel? fromWire(String? value) {
    if (value == null) return null;
    for (final RiskLevel level in RiskLevel.values) {
      if (level.wireValue == value) return level;
    }
    return null;
  }
}

/// Shown wherever an object has never been assessed. An unassessed device is an
/// unknown, never a zero and never a failing score — and never green.
const String unassessedLabel = 'Үнэлгээгүй';

/// The five bands requirements section 10 documents, best-first.
///
/// What the app shows when it has not been told otherwise. It is not `RiskLevel.values`
/// any more: three of those eight are reserved storage keys.
const List<RiskLevel> documentedRiskBands = <RiskLevel>[
  RiskLevel.normal,
  RiskLevel.attention,
  RiskLevel.scheduleRepair,
  RiskLevel.critical,
  RiskLevel.outOfService,
];

/// The bands a legend, a stair or a per-band breakdown should be drawn from,
/// **best-first — in the server's own order**.
///
/// **Never `RiskLevel.values`.** Three of the eight are spare storage keys reserved so
/// the band count can change without a data migration, and iterating the enum would
/// print «Түвшин 6», «Түвшин 7» and «Түвшин 8» beside «Хэвийн» on every screen that
/// lists bands — naming three that nobody configured and no device can be in.
///
/// So: the ladder the server reports, when it has reported one, and the five documented
/// bands otherwise.
///
/// THE ORDER IS THE SERVER'S AND USED TO BE RE-SORTED AWAY. This function ended
/// `..sort((a, b) => a.index.compareTo(b.index))`, on the stated ground that the server
/// publishes the ladder worst-first while every layout here reads best-first. That ground
/// is false: `riskBandsOf` in packages/shared reverses the stored ladder before serving
/// it, precisely so `GET /vocabulary` emits highest-score-first, which IS best-first. The
/// sort therefore corrected nothing and destroyed something — a spare band is declared
/// last in the enum, so an administrator who configures BAND_6 at 41-60, between
/// SCHEDULE_REPAIR and CRITICAL, had it shoved past OUT_OF_SERVICE to the end of every
/// legend and stair in the app. The escalation the colours spell out ran backwards for
/// exactly the installation that had bothered to configure one.
///
/// A key this binary has never heard of is dropped rather than guessed at; the gaps that
/// leaves preserve the order of what remains.
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

/// The three roll-ups the count strips report, cut out of the configured ladder.
///
/// The four figures above a floor plan — critical, attention, normal, unassessed — are
/// drawn beside the server's own `total`, so they have to ADD UP to it. They used to be
/// built from five hard-coded keys: normal was NORMAL, attention was ATTENTION plus
/// SCHEDULE_REPAIR, critical was CRITICAL plus OUT_OF_SERVICE, and any device graded into
/// a configured spare was counted by none of the three while still being counted by the
/// total. On an installation using a sixth band the four cards visibly did not sum, and
/// the missing devices were invisible rather than merely uncounted.
///
/// So the ladder itself is partitioned, and every configured band lands in exactly one
/// group. The cut points are the two anchors the requirements name, located BY POSITION in
/// the ladder rather than by identity:
///
///   * everything from CRITICAL down (or from OUT_OF_SERVICE down, if the administrator
///     has removed CRITICAL) is the critical group;
///   * everything above NORMAL's position, plus NORMAL, is the normal group;
///   * everything left in between is the attention group.
///
/// On the shipped five-band ladder this reproduces the old groupings exactly. On a
/// configured ladder it puts a spare where the administrator put it, and the arithmetic
/// holds by construction rather than by coincidence.
class RiskBandGroups {
  const RiskBandGroups({
    required this.normal,
    required this.attention,
    required this.critical,
  });

  /// The best bands: the ones that mean "nothing to do here".
  final List<RiskLevel> normal;

  /// Between the two anchors — worth a look, not yet an alarm.
  final List<RiskLevel> attention;

  /// The bands a red banner and a warning marker are drawn for.
  final List<RiskLevel> critical;

  /// The whole ladder again, best-first. The three groups are a partition of it, which
  /// is what makes the count strips add up.
  List<RiskLevel> get all =>
      <RiskLevel>[...normal, ...attention, ...critical];
}

RiskBandGroups riskBandGroups() {
  final List<RiskLevel> ladder = riskBandsInUse();

  /// The first anchor present, or [fallback] when the administrator has kept none.
  int indexOfFirst(List<RiskLevel> anchors, int fallback) {
    for (final RiskLevel anchor in anchors) {
      final int at = ladder.indexOf(anchor);
      if (at >= 0) return at;
    }
    return fallback;
  }

  // Nothing is critical when neither anchor survives, rather than the bottom band being
  // promoted into an alarm nobody configured.
  final int criticalFrom =
      indexOfFirst(<RiskLevel>[RiskLevel.critical, RiskLevel.outOfService], ladder.length);

  // NORMAL's own position, so a band configured ABOVE it — a spare at 91-100, say — is
  // counted as normal rather than as something to look at. Nothing is normal when NORMAL
  // itself has been removed.
  final int normalTo = ladder.indexOf(RiskLevel.normal);

  return RiskBandGroups(
    normal: ladder.sublist(0, (normalTo + 1).clamp(0, criticalFrom)),
    attention: ladder.sublist((normalTo + 1).clamp(0, criticalFrom), criticalFrom),
    critical: ladder.sublist(criticalFrom),
  );
}

/// The bands section 10.2 requires a warning marker on, as the CONFIGURED ladder has them.
///
/// It was `this == critical || this == outOfService`, a getter on the enum, and it gated
/// the red «Яаралтай үзлэг шаардлагатай» banner on a device. The two names are still the
/// anchors — see [riskBandGroups] — but a band an administrator configured BELOW them is a
/// worse condition than critical by the only measure the ladder states, the score, and a
/// device sitting in one raised no banner at all.
///
/// The old comment's objection stands and is answered rather than ignored: this app cannot
/// know what a band DEMANDS, because `requiresConclusion` and `decommissions` travel with
/// the band server-side and are not on `/vocabulary`. But the banner does not claim to
/// know what the band demands. It claims the device is in a severe condition, and position
/// in the ladder is exactly the claim the server publishes.
bool isCriticalBand(RiskLevel? level) =>
    level != null && riskBandGroups().critical.contains(level);

/// The full band name for a screen reader, including the null case.
String riskSemanticLabel(RiskLevel? level) => level?.label ?? unassessedLabel;

/// The abbreviation for a chip, including the null case.
String riskShortLabel(RiskLevel? level) => level?.shortLabel ?? unassessedLabel;

/// The triad for a band, including the null case. Grey, never green.
Tone riskTone(RiskLevel? level) => level?.tone ?? Tone.neutral;
