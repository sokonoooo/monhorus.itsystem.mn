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
  normal('NORMAL', 'Хэвийн', 'Хэвийн', 81, 100, Tone.green),
  attention('ATTENTION', 'Анхаарах шаардлагатай', 'Анхаарах', 61, 80, Tone.yellow),
  scheduleRepair(
    'SCHEDULE_REPAIR',
    'Ойрын хугацаанд засварлах',
    'Засварлах',
    41,
    60,
    Tone.orange,
  ),
  critical('CRITICAL', 'Ноцтой эрсдэлтэй', 'Ноцтой', 21, 40, Tone.red),
  outOfService('OUT_OF_SERVICE', 'Ашиглах боломжгүй', 'Боломжгүй', 0, 20, Tone.black),

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
   * Their score range is EMPTY (min 0, max -1) rather than merely unused, so
   * [fromScore] can never land a legacy payload on a band nobody has defined.
   */
  band6('BAND_6', 'Түвшин 6', 'Түвшин 6', 0, -1, Tone.neutral),
  band7('BAND_7', 'Түвшин 7', 'Түвшин 7', 0, -1, Tone.neutral),
  band8('BAND_8', 'Түвшин 8', 'Түвшин 8', 0, -1, Tone.neutral);

  const RiskLevel(
    this.wireValue,
    this._bundledLabel,
    this._bundledShortLabel,
    this._legacyMin,
    this._legacyMax,
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

  /// Not authoritative. See [fromScore].
  final int _legacyMin;

  /// Not authoritative. See [fromScore].
  final int _legacyMax;

  /// Null-tolerant: the API sends `riskLevel: null` for a never-assessed object, and
  /// that is a distinct display state, not a band, so it must not be coerced into one.
  static RiskLevel? fromWire(String? value) {
    if (value == null) return null;
    for (final RiskLevel level in RiskLevel.values) {
      if (level.wireValue == value) return level;
    }
    return null;
  }

  /// Legacy fallback for a payload that carried a score but no `riskLevel`.
  ///
  /// The thresholds baked into [_legacyMin] / [_legacyMax] are the frozen defaults in
  /// shared; an administrator may move the boundaries in Тохиргоо and this app cannot
  /// read `/settings` (403), so **they are not authoritative**. Nothing user-facing
  /// may print them, and nothing may call this when the server sent a band.
  static RiskLevel fromScore(int score) {
    for (final RiskLevel level in RiskLevel.values) {
      if (score >= level._legacyMin && score <= level._legacyMax) return level;
    }
    return RiskLevel.outOfService;
  }

  /// Bands that call for a technician's attention: everything below NORMAL.
  bool get needsAttention => this != RiskLevel.normal;

  /// The two bands section 10.2 requires a warning marker on.
  ///
  /// Still those two by name, and deliberately not "the worst two in the ladder". A
  /// configured spare sits wherever the administrator put it and this app cannot know
  /// what it demands — `requiresConclusion` and `decommissions` travel with the band
  /// server-side and are not on `/vocabulary` — so a marker is drawn only where the
  /// requirement actually names one.
  bool get isCritical =>
      this == RiskLevel.critical || this == RiskLevel.outOfService;
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

/// The bands a legend, a stair or a per-band breakdown should be drawn from.
///
/// **Never `RiskLevel.values`.** Three of the eight are spare storage keys reserved so
/// the band count can change without a data migration, and iterating the enum would
/// print «Түвшин 6», «Түвшин 7» and «Түвшин 8» beside «Хэвийн» on every screen that
/// lists bands — naming three that nobody configured and no device can be in.
///
/// So: the ladder the server reports, when it has reported one, and the five
/// documented bands otherwise. Ordered by the enum's own declaration order rather than
/// by the server's, which is worst-first: every layout here — the legend, the count
/// strip, the stair — reads best-first, and reversing them would silently invert the
/// escalation the shapes and colours spell out.
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

/// The full band name for a screen reader, including the null case.
String riskSemanticLabel(RiskLevel? level) => level?.label ?? unassessedLabel;

/// The abbreviation for a chip, including the null case.
String riskShortLabel(RiskLevel? level) => level?.shortLabel ?? unassessedLabel;

/// The triad for a band, including the null case. Grey, never green.
Tone riskTone(RiskLevel? level) => level?.tone ?? Tone.neutral;
