import '../../../../../core/util/json_parse.dart';
import '../../../project/data/models/object_models.dart';

/// The section 9.2 service-request conclusion, as this app reads and writes it.
///
/// A transcription of `WorkReportDto`, not a mobile-only shape: the same record backs the
/// web editor, and both write through `PUT /service-requests/:id/report`. A second model
/// with its own fields would let the two clients disagree about what a conclusion is.
///
/// IMPORTANT: `GET /service-requests/:id/report` CREATES the draft on first read and
/// attributes it to the caller. It must therefore only ever be issued from an explicit
/// "Дүгнэлт бичих", never speculatively while rendering a list — the same rule the
/// calendar sheet documents.
enum WorkReportStatus {
  draft('DRAFT', 'Ноорог'),
  submitted('SUBMITTED', 'Админ хянах'),
  approved('APPROVED', 'Батлагдсан'),
  returned('RETURNED', 'Буцаагдсан');

  const WorkReportStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static WorkReportStatus fromWire(String? value) {
    return WorkReportStatus.values.firstWhere(
      (WorkReportStatus status) => status.wireValue == value,
      orElse: () => WorkReportStatus.draft,
    );
  }

  /// Whether the conclusion may still be edited.
  ///
  /// The server is the authority — it refuses a write on an approved report — and this
  /// only decides whether to draw the controls. DRAFT and RETURNED are the two the
  /// backend's own `assertReportAllows` admits; a returned one is edited and resubmitted,
  /// which is the whole point of returning it.
  bool get isEditable => this == WorkReportStatus.draft || this == WorkReportStatus.returned;
}

/// A field the server refuses to submit without.
///
/// A transcription of `WORK_REPORT_REQUIREMENTS` and `WORK_REPORT_REQUIREMENT_LABELS` in
/// `packages/shared/src/constants/work-report.ts`. The wire values are what
/// `POST /report/submit` returns in `missing` and in the `issues[].field` of its refusal;
/// the labels are the same Mongolian words the web console prints, so a technician told
/// "Үнэлгээ (0-100)" on one client is told the same on the other.
///
/// THE REQUIREMENTS ARE VISIT-LEVEL AND ARE NOT SATISFIED BY PER-EQUIPMENT FINDINGS. A
/// conclusion whose every equipment card is filled in is still refused without the visit's
/// own score and its two photographs, which is why the editor draws a control for each of
/// them rather than leaving them as rules with nowhere to be obeyed.
enum WorkReportRequirement {
  score('SCORE', 'Ерөнхий үнэлгээ (0-100)'),
  conclusion('CONCLUSION', 'Ерөнхий дүгнэлт'),
  recommendation('RECOMMENDATION', 'Зөвлөмж'),
  beforePhoto('BEFORE_PHOTO', 'Ажлын өмнөх зураг'),
  afterPhoto('AFTER_PHOTO', 'Ажлын дараах зураг');

  const WorkReportRequirement(this.wireValue, this.label);

  final String wireValue;
  final String label;

  /// Null for anything that is not a requirement key.
  ///
  /// Deliberately not defaulted: `issues[].field` also carries per-object refusals keyed by
  /// object id, and mapping one of those onto a requirement would name a field the
  /// technician has actually filled in.
  static WorkReportRequirement? fromWire(String? value) {
    for (final WorkReportRequirement requirement in WorkReportRequirement.values) {
      if (requirement.wireValue == value) return requirement;
    }
    return null;
  }

  /// The Mongolian labels for a wire list, unknown keys passed through verbatim.
  ///
  /// A key this build does not know about is still shown: a silently dropped requirement is
  /// exactly the failure this whole path is fixing.
  static List<String> labelsOf(Iterable<String> wire) {
    return wire
        .map((String value) => WorkReportRequirement.fromWire(value)?.label ?? value)
        .toList();
  }
}

/// One evidence file already attached to the conclusion.
class WorkReportPhotoModel {
  const WorkReportPhotoModel({
    required this.id,
    required this.name,
    required this.downloadUrl,
  });

  final String id;
  final String name;

  /// A protected path (`/files/:id`), never a public URL. Fetched through the
  /// authenticated client like every other attachment in this app.
  final String downloadUrl;

  static WorkReportPhotoModel fromJson(Map<String, dynamic> json) {
    final String id = parseString(json['id']) ?? '';
    return WorkReportPhotoModel(
      id: id,
      name: parseString(json['name']) ?? '',
      downloadUrl: parseString(json['downloadUrl']) ?? '/files/$id',
    );
  }
}

/// What was found on ONE piece of equipment.
///
/// The finding that becomes a `ReportItem`. Each assessed object carries its own score and
/// narrative, so a healthy panel and a failing one inspected on the same visit read
/// differently — the shared-score model this replaced could not express that.
///
/// `riskLevel` is derived server-side from the score against the thresholds in force, so it
/// is read here and never sent: a client that could choose it could label a 92 critical.
class WorkReportObjectAssessmentModel {
  const WorkReportObjectAssessmentModel({
    required this.objectId,
    required this.photoIds,
    required this.attributeValues,
    required this.objectTypeAttributes,
    this.code,
    this.name,
    this.score,
    this.observation,
    this.conclusion,
    this.recommendation,
  });

  final String objectId;
  final String? code;
  final String? name;
  final int? score;
  final String? observation;
  final String? conclusion;
  final String? recommendation;
  final List<String> photoIds;

  /// What the equipment has answered for its type's declared attributes (4.1).
  ///
  /// Off the OBJECT, not off this finding: the score and the narrative are what the visit
  /// observed, while "this breaker is fused" is true between visits — so every report
  /// against the same equipment reads the same answers.
  final Map<String, Object?> attributeValues;

  /// The definitions in force for this equipment's type, in display order.
  ///
  /// Per row rather than per report: a report may name a panel and a breaker and they
  /// declare different things.
  final List<ObjectTypeAttributeModel> objectTypeAttributes;

  /*
   * THERE IS DELIBERATELY NO `riskLevel` HERE.
   *
   * The band is a function of the score against the thresholds in force, and those live in
   * Тохиргоо, which this app cannot read (403). `RiskLevel.fromScore` exists but its own
   * documentation calls it non-authoritative and forbids printing it, and the assessment
   * sheet — the app's existing precedent for entering a score — accordingly shows no band
   * while typing and states the scale in words instead.
   *
   * The server derives the band when it writes the ReportItem. What the editor shows
   * alongside a score is the equipment's CURRENT standing, which is authoritative because
   * the server computed it, and is what stops a technician assessing the wrong object.
   */

  static WorkReportObjectAssessmentModel fromJson(Map<String, dynamic> json) {
    return WorkReportObjectAssessmentModel(
      objectId: parseString(json['objectId']) ?? '',
      code: parseString(json['code']),
      name: parseString(json['name']),
      score: parseInt(json['score']),
      observation: parseString(json['observation']),
      conclusion: parseString(json['conclusion']),
      recommendation: parseString(json['recommendation']),
      photoIds: (json['photoIds'] as List<dynamic>? ?? <dynamic>[])
          .map((Object? id) => parseString(id))
          .whereType<String>()
          .toList(),
      // Defensive on both: a server that predates the field answers neither, and the editor
      // then simply asks nothing extra rather than failing to parse the report.
      attributeValues: json['attributeValues'] is Map
          ? Map<String, Object?>.from(json['attributeValues'] as Map)
          : const <String, Object?>{},
      objectTypeAttributes:
          parseList(json['objectTypeAttributes'], ObjectTypeAttributeModel.fromJson),
    );
  }
}

/// One material the job consumed, as `saveWorkReportSchema.materials` types it.
///
/// Read and re-sent, never authored here: this app draws no materials control, and the
/// list is only modelled at all so a mobile save stops erasing what the web recorded.
///
/// Deliberately NOT `MaterialItemModel`: that is a catalogue row (`id`/`code`/
/// `defaultUnit`) picked from master data, whereas a conclusion carries a freehand
/// name/quantity/unit triple with no catalogue behind it.
class WorkReportMaterialModel {
  const WorkReportMaterialModel({
    required this.name,
    required this.quantity,
    required this.unit,
  });

  final String name;

  /// `num` rather than `double`, so a quantity of 3 goes back as `3` and not as `3.0`.
  final num quantity;

  /// The WIRE value, not a [MaterialUnit]. `MaterialUnit.fromWire` folds anything it does
  /// not recognise onto PIECE, which on a field this app only relays would quietly rewrite
  /// a unit added after this build shipped into the wrong one.
  final String unit;

  /// Null for an entry the server's own schema would refuse back.
  ///
  /// `name` is `min(1)` and `quantity` is `positive()` there, so a malformed row is dropped
  /// rather than relayed: sending it back would turn every subsequent save into a 400 and
  /// lock the technician out of their own draft.
  static WorkReportMaterialModel? fromJson(Map<String, dynamic> json) {
    final String? name = parseString(json['name']);
    final Object? quantity = json['quantity'];
    if (name == null || quantity is! num || quantity <= 0) return null;
    return WorkReportMaterialModel(
      name: name,
      quantity: quantity,
      // The schema's own default, so an entry stored before the unit existed still sends.
      unit: parseString(json['unit']) ?? 'PIECE',
    );
  }

  Map<String, dynamic> toJson() => <String, dynamic>{
        'name': name,
        'quantity': quantity,
        'unit': unit,
      };
}

/// Equipment the conclusion names without yet saying anything about it.
///
/// A real intermediate state while a draft is filled in, and the reason `objects` and
/// `objectAssessments` are separate lists rather than one.
class WorkReportObjectModel {
  const WorkReportObjectModel({required this.id, this.code, this.name});

  final String id;
  final String? code;
  final String? name;

  static WorkReportObjectModel fromJson(Map<String, dynamic> json) {
    return WorkReportObjectModel(
      id: parseString(json['id']) ?? '',
      code: parseString(json['code']),
      name: parseString(json['name']),
    );
  }
}

class WorkReportModel {
  const WorkReportModel({
    required this.id,
    required this.serviceRequestId,
    required this.status,
    required this.beforePhotos,
    required this.afterPhotos,
    required this.objects,
    required this.objectAssessments,
    required this.missing,
    required this.isComplete,
    this.score,
    this.riskLevelWire,
    this.conclusion,
    this.recommendation,
    this.actionTaken,
    this.returnReason,
    this.materials = const <WorkReportMaterialModel>[],
    this.repairRequired = false,
    this.revisitRequired = false,
    this.revisitDateWire,
  });

  final String id;
  final String serviceRequestId;
  final WorkReportStatus status;

  /// The visit-level figures, which an object without its own finding falls back to.
  final int? score;
  final String? riskLevelWire;
  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final String? returnReason;

  final List<WorkReportPhotoModel> beforePhotos;
  final List<WorkReportPhotoModel> afterPhotos;

  /// Membership: every object the conclusion covers, assessed or not.
  final List<WorkReportObjectModel> objects;

  /// Findings: the subset that has actually been written up.
  final List<WorkReportObjectAssessmentModel> objectAssessments;

  /// The server's own list of what still blocks submission, in its own vocabulary.
  final List<String> missing;
  final bool isComplete;

  /*
   * THE OFFICE'S FOUR FIELDS, HELD ONLY SO A SAVE FROM HERE DOES NOT DESTROY THEM.
   *
   * `materials`, `repairRequired`, `revisitRequired` and `revisitDate` are entered on the
   * web console; this app draws no control for any of them. But `PUT .../report` REPLACES
   * the record, and the schema defaults every one of them, so a payload that omits them —
   * or hard-codes `false` — erases what a dispatcher recorded the moment the technician
   * taps "Ноорогт хадгалах".
   *
   * They are therefore the exact OPPOSITE of the photo and object lists below, which are
   * the editor's working copies precisely so a local removal survives: these are immutable
   * pass-through, read from the response and echoed back byte for byte, and nothing in the
   * app may edit them. `revisitDate` is kept as the wire string rather than a `DateTime` so
   * a round trip cannot shift it through a timezone or drop its precision.
   */
  final List<WorkReportMaterialModel> materials;
  final bool repairRequired;
  final bool revisitRequired;
  final String? revisitDateWire;

  static WorkReportModel fromJson(Map<String, dynamic> json) {
    List<WorkReportPhotoModel> photos(Object? value) =>
        (value as List<dynamic>? ?? <dynamic>[])
            .whereType<Map<String, dynamic>>()
            .map(WorkReportPhotoModel.fromJson)
            .toList();

    return WorkReportModel(
      id: parseString(json['id']) ?? '',
      serviceRequestId: parseString(json['serviceRequestId']) ?? '',
      status: WorkReportStatus.fromWire(parseString(json['status'])),
      score: parseInt(json['score']),
      riskLevelWire: parseString(json['riskLevel']),
      conclusion: parseString(json['conclusion']),
      recommendation: parseString(json['recommendation']),
      actionTaken: parseString(json['actionTaken']),
      returnReason: parseString(json['returnReason']),
      beforePhotos: photos(json['beforePhotos']),
      afterPhotos: photos(json['afterPhotos']),
      objects: (json['objects'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .map(WorkReportObjectModel.fromJson)
          .toList(),
      objectAssessments: (json['objectAssessments'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .map(WorkReportObjectAssessmentModel.fromJson)
          .toList(),
      missing: (json['missing'] as List<dynamic>? ?? <dynamic>[])
          .map((Object? entry) => parseString(entry))
          .whereType<String>()
          .toList(),
      isComplete: json['isComplete'] == true,
      materials: (json['materials'] as List<dynamic>? ?? <dynamic>[])
          .whereType<Map<String, dynamic>>()
          .map(WorkReportMaterialModel.fromJson)
          .whereType<WorkReportMaterialModel>()
          .toList(),
      repairRequired: parseBool(json['repairRequired']),
      revisitRequired: parseBool(json['revisitRequired']),
      revisitDateWire: parseString(json['revisitDate']),
    );
  }
}

/// One equipment finding on its way to the server.
class SaveObjectAssessment {
  const SaveObjectAssessment({
    required this.objectId,
    required this.photoIds,
    this.score,
    this.observation,
    this.conclusion,
    this.recommendation,
    this.attributeValues,
  });

  final String objectId;
  final int? score;
  final String? observation;
  final String? conclusion;
  final String? recommendation;
  final List<String> photoIds;

  /// The equipment's per-type attributes, answered while writing this finding (4.1).
  ///
  /// NULL MEANS "NOT ASKED", AND IS NOT EMPTY. Null leaves the key off the body, and the
  /// server then enforces nothing and clears nothing — which is what a card whose type
  /// declares no attributes sends. An empty map would say "the answer to everything is
  /// nothing" and would wipe what the equipment already carries.
  final Map<String, Object?>? attributeValues;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'objectId': objectId,
      // Nulls are sent rather than omitted: the field is nullish on the schema, and
      // omitting it would leave a previously entered value in place instead of clearing it.
      'score': score,
      'observation': observation,
      'conclusion': conclusion,
      'recommendation': recommendation,
      'photoIds': photoIds,
      // Unlike the nullish fields above, null here means "leave it alone" rather than
      // "clear it", so the key is omitted entirely.
      if (attributeValues != null) 'attributeValues': attributeValues,
    };
  }
}

/// The whole conclusion, replaced outright on every save.
///
/// `PUT` semantics: the server replaces the object list, the assessments and both photo
/// sets with exactly what arrives, so every field here is the editor's working copy rather
/// than the stored one. Sending back what was loaded would resurrect anything just removed.
class SaveWorkReportRequest {
  const SaveWorkReportRequest({
    required this.objectIds,
    required this.objectAssessments,
    required this.beforePhotoIds,
    required this.afterPhotoIds,
    this.score,
    this.conclusion,
    this.recommendation,
    this.actionTaken,
    this.materials = const <WorkReportMaterialModel>[],
    this.repairRequired = false,
    this.revisitRequired = false,
    this.revisitDateWire,
  });

  final int? score;
  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final List<String> objectIds;
  final List<SaveObjectAssessment> objectAssessments;
  final List<String> beforePhotoIds;
  final List<String> afterPhotoIds;

  /// The four office-entered fields, carried back exactly as they were read.
  ///
  /// Not a working copy and not a default: they used to be `false`, `false` and two absent
  /// keys, and because the server replaces the record and the schema defaults every one of
  /// them, saving from the phone wiped the dispatcher's materials and flags. Whatever the
  /// loaded report holds is what goes back.
  final List<WorkReportMaterialModel> materials;
  final bool repairRequired;
  final bool revisitRequired;
  final String? revisitDateWire;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'score': score,
      'conclusion': conclusion,
      'recommendation': recommendation,
      'actionTaken': actionTaken,
      'repairRequired': repairRequired,
      'revisitRequired': revisitRequired,
      'revisitDate': revisitDateWire,
      'materials':
          materials.map((WorkReportMaterialModel entry) => entry.toJson()).toList(),
      'objectIds': objectIds,
      'objectAssessments':
          objectAssessments.map((SaveObjectAssessment entry) => entry.toJson()).toList(),
      'beforePhotoIds': beforePhotoIds,
      'afterPhotoIds': afterPhotoIds,
    };
  }
}
