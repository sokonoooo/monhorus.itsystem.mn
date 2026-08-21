/// The words and colours the SERVER says to paint with.
///
/// Every other enum in this folder is a hand-written mirror of a TypeScript constant
/// in packages/shared, compiled into the binary and therefore frozen at the last store
/// release. That is the right default — the portal has to render on a phone with no
/// signal — but it is only a default. The service-request stage names, the risk-band
/// names and both sets of colours are an administrator's decision, stored under
/// `workflow.request_stages` and `risk.bands`, and `GET /api/v1/vocabulary` is where a
/// client reads them.
///
/// That endpoint is separate from `GET /settings` precisely so this app can call it. A
/// customer account holds no `settings.view` and never should — the SLA thresholds and
/// the finance keys are none of their business — but the words on their own screen
/// are. `/vocabulary` needs authentication and no permission at all.
///
/// **It is a default, not a dependency.** Nothing here is required to render a screen:
/// [ServerVocabulary.empty] is what a failed, refused or not-yet-attempted read leaves
/// behind, every lookup below answers null against it, and every caller falls back to
/// the value it was compiled with. A portal that cannot reach the server keeps working
/// in the old words, exactly as it did before this file existed.
///
/// Deliberately free of Flutter, like the rest of `domain/entities`. The colour NAMES
/// it returns are resolved to a triad by `AccentTone.named` in the token file, which is
/// the one place that owns the palette.
library;

/// One row of `requestStages` — a coarse workflow step, as the administrator named it.
class VocabularyStage {
  const VocabularyStage({
    required this.key,
    required this.label,
    required this.colour,
    required this.statuses,
    required this.hidden,
  });

  /// Stable across renames, so this is what a saved filter would travel as.
  final String key;

  final String label;

  /// One of `STAGE_COLOURS`: grey, blue, indigo, amber, orange, green, red.
  ///
  /// A name from a closed palette rather than free hex, because every surface that
  /// paints a stage resolves it to its own idea of that colour — Tailwind classes on
  /// the web, an [AccentTone] triad here — and neither can construct one from an
  /// arbitrary runtime string.
  final String colour;

  /// The engine statuses this stage groups, as wire values.
  ///
  /// Kept as raw strings rather than parsed into [ServiceRequestStatus]: a newer API
  /// may group a status this binary has never heard of, and dropping it here would
  /// silently make the group look narrower than it is.
  final List<String> statuses;

  /// Hidden stages stay out of pickers and filters, never out of history.
  final bool hidden;

  static VocabularyStage? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? key = json['key'];
    final Object? label = json['label'];
    if (key is! String || label is! String) return null;

    final Object? statuses = json['statuses'];
    return VocabularyStage(
      key: key,
      label: label,
      colour: json['colour'] is String ? json['colour']! as String : '',
      statuses: statuses is List
          ? statuses.whereType<String>().toList(growable: false)
          : const <String>[],
      hidden: json['hidden'] == true,
    );
  }
}

/// One row of `riskBands` — a score band, as the administrator named and coloured it.
class VocabularyBand {
  const VocabularyBand({
    required this.level,
    required this.label,
    required this.colour,
    required this.min,
    required this.max,
  });

  /// One of the eight reserved storage keys — NORMAL … OUT_OF_SERVICE, BAND_6 …
  /// BAND_8 — which is what a stored assessment carries and what this app matches on.
  final String level;

  final String label;

  /// One of `RISK_COLOURS`: green, yellow, orange, red, black, grey, blue, purple.
  final String colour;

  /// The band's score range.
  ///
  /// Parsed for completeness and never printed. The rule has not changed just because
  /// the numbers are now readable: a screen shows the band's name and the object's own
  /// score, never the scale, because a range on a chip is a promise about how the next
  /// assessment will be graded and only the server can keep it.
  final int min;
  final int max;

  static VocabularyBand? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? level = json['level'];
    final Object? label = json['label'];
    if (level is! String || label is! String) return null;

    return VocabularyBand(
      level: level,
      label: label,
      colour: json['colour'] is String ? json['colour']! as String : '',
      min: json['min'] is num ? (json['min']! as num).toInt() : 0,
      max: json['max'] is num ? (json['max']! as num).toInt() : 0,
    );
  }
}

/// The whole answer to `GET /vocabulary`.
class ServerVocabulary {
  const ServerVocabulary({required this.stages, required this.bands});

  /// What the app runs on until a read succeeds, and what it goes on running on if one
  /// never does.
  static const ServerVocabulary empty = ServerVocabulary(
    stages: <VocabularyStage>[],
    bands: <VocabularyBand>[],
  );

  final List<VocabularyStage> stages;
  final List<VocabularyBand> bands;

  bool get isEmpty => stages.isEmpty && bands.isEmpty;

  /// Tolerant by design: a malformed row is dropped rather than thrown on, because a
  /// vocabulary this app could only partly parse is still better than none of it, and
  /// none of it is not an error state anyway.
  factory ServerVocabulary.fromJson(Map<String, dynamic> json) {
    final Object? stages = json['requestStages'];
    final Object? bands = json['riskBands'];

    return ServerVocabulary(
      stages: stages is List
          ? stages
              .map(VocabularyStage.fromJson)
              .whereType<VocabularyStage>()
              .toList(growable: false)
          : const <VocabularyStage>[],
      bands: bands is List
          ? bands
              .map(VocabularyBand.fromJson)
              .whereType<VocabularyBand>()
              .toList(growable: false)
          : const <VocabularyBand>[],
    );
  }

  /// The stage covering a status wire value, or null.
  VocabularyStage? stageOfStatus(String statusWire) {
    for (final VocabularyStage stage in stages) {
      if (stage.statuses.contains(statusWire)) return stage;
    }
    return null;
  }

  VocabularyBand? bandOf(String levelWire) {
    for (final VocabularyBand band in bands) {
      if (band.level == levelWire) return band;
    }
    return null;
  }
}

// -- The installed vocabulary -------------------------------------------------
//
// A top-level holder rather than something read off a `Ref`, and that is a decision
// rather than a shortcut.
//
// The things that need these words are `RiskLevel.label`, `RiskLevel.tone`,
// `ServiceRequestStatus.label` and a `CustomPainter` — enum getters and plain
// functions, reached from `Semantics` labels, chip builders and paint calls scattered
// over every screen in the portal. None of them holds a `Ref`, and giving them one
// would mean editing every one of their several dozen call sites to thread a provider
// through. That churn is the thing this design exists to avoid: the labels had to start
// coming from the server without the screens having to know that they do.
//
// It is written exactly once per session, by `serverVocabularyProvider`, from data the
// server sent. Nothing else may write it.

ServerVocabulary _installed = ServerVocabulary.empty;
int _revision = 0;

/// The vocabulary in force. [ServerVocabulary.empty] until a read succeeds.
ServerVocabulary get serverVocabulary => _installed;

/// How many times a vocabulary has been installed — 0 when none ever has.
///
/// The shell hangs a key off this so the tab bodies are rebuilt the once, when the
/// answer lands: three of the four tabs are const widgets, and a const widget is
/// canonicalised, so a parent rebuild alone would leave those elements painting the
/// words they were first built with. It never changes on a failed read, so an offline
/// start costs nothing.
int get serverVocabularyRevision => _revision;

/// Installs a freshly read vocabulary.
///
/// An empty answer is ignored rather than installed: a server that replied with no
/// stages and no bands has told the app nothing, and replacing a good vocabulary with
/// that would be a downgrade dressed up as an update.
void installServerVocabulary(ServerVocabulary vocabulary) {
  if (vocabulary.isEmpty) return;
  _installed = vocabulary;
  _revision++;
}

/// Drops back to the compiled-in words. For tests, which share a process and would
/// otherwise leak one case's vocabulary into the next.
void resetServerVocabulary() {
  _installed = ServerVocabulary.empty;
  _revision = 0;
}

// -- Lookups ------------------------------------------------------------------

/// The administrator's own name for one status, or null to keep the compiled one.
///
/// A stage is COARSER than a status. The shipped ladder folds ON_SITE and IN_PROGRESS
/// into a single «Гүйцэтгэж байна», and REPORT_SUBMITTED, VERIFICATION and COMPLETED
/// into «Дууссан». Printing a stage name wherever a status appears would therefore
/// delete distinctions the timeline is made of: a request's history would read
/// «Дууссан» three times in a row, for filing the conclusion, checking it and
/// approving it.
///
/// So a stage renames a status only when it covers that status ALONE — then the two are
/// one thing under two names, and the administrator's is the current one. Where a stage
/// groups several statuses its name is still shown, but only where the GROUP is what is
/// being reported: the `stage` the DTO carries on a list row and a detail header, which
/// is a different field and a different question.
String? serverStageLabelForStatus(String statusWire) {
  final VocabularyStage? stage = _installed.stageOfStatus(statusWire);
  if (stage == null || stage.statuses.length != 1) return null;
  return stage.label;
}

/// The colour name of the stage a status sits in, or null.
///
/// Unlike the label this is taken from the group as a whole. A colour is a severity cue
/// rather than a name, so two statuses in one stage sharing it says something true —
/// they are the same step of the job — where sharing a name would not.
String? serverStageColourForStatus(String statusWire) =>
    _installed.stageOfStatus(statusWire)?.colour;

/// The administrator's own name for a risk band, or null to keep the compiled one.
String? serverRiskLabel(String levelWire) => _installed.bandOf(levelWire)?.label;

/// The administrator's own colour for a risk band, or null to keep the compiled one.
String? serverRiskColour(String levelWire) => _installed.bandOf(levelWire)?.colour;

/// The band keys an administrator has actually configured, in the server's order, or an
/// empty list when no vocabulary has been read.
///
/// The storage vocabulary has eight keys and the shipped ladder uses five; the other
/// three are spares, reserved so the band count can change without a data migration. A
/// legend or a hero stair drawn from `RiskLevel.values` would print «Түвшин 6»,
/// «Түвшин 7» and «Түвшин 8» beside «Хэвийн» — naming three bands nobody configured and
/// no device can be in. This is the list that says which ones are real.
List<String> serverRiskLevels() =>
    _installed.bands.map((VocabularyBand band) => band.level).toList(growable: false);
