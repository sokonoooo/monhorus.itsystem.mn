import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../../../../../core/util/json_parse.dart';

/// Mirrors `LoadValueDto` in packages/shared/src/types/object-master.types.ts.
///
/// [valueKw] is null whenever [complete] is false and must never be coerced to zero:
/// an incomplete calculation renders as "Бүрэн бус" with its reasons, so a missing
/// technical field cannot be mistaken for a genuine reading.
class LoadValueModel {
  const LoadValueModel({
    required this.valueKw,
    required this.complete,
    required this.reasons,
  });

  final double? valueKw;
  final bool complete;
  final List<LoadIncompleteReason?> reasons;

  factory LoadValueModel.fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return LoadValueModel.unknown;
    final Object? rawReasons = raw['reasons'];
    return LoadValueModel(
      valueKw: parseDouble(raw['valueKw']),
      complete: raw['complete'] as bool? ?? false,
      reasons: rawReasons is List
          ? rawReasons
              .map((Object? entry) => LoadIncompleteReason.fromWire(entry as String?))
              .toList(growable: false)
          : const <LoadIncompleteReason?>[],
    );
  }

  static const LoadValueModel unknown = LoadValueModel(
    valueKw: null,
    complete: false,
    reasons: <LoadIncompleteReason?>[],
  );

  bool get hasValue => complete && valueKw != null;

  /// The reasons as one readable line, for the tooltip under an incomplete figure.
  String get reasonLine => reasons
      .whereType<LoadIncompleteReason>()
      .map((LoadIncompleteReason reason) => reason.label)
      .join(' · ');
}

/// Mirrors `ObjectRefDto` — `{ id, code, name, category }`.
class ObjectRefModel {
  const ObjectRefModel({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
  });

  final String id;
  final String code;
  final String name;
  final ObjectCategory? category;

  static ObjectRefModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    return ObjectRefModel(
      id: id,
      code: raw['code'] as String? ?? '',
      name: raw['name'] as String? ?? '',
      category: ObjectCategory.fromWire(raw['category'] as String?),
    );
  }

  String get label => code.isEmpty ? name : '$code · $name';
}

/// Mirrors the inline `objectType` reference on `ObjectListItemDto`.
class ObjectTypeRefModel {
  const ObjectTypeRefModel({
    required this.id,
    required this.code,
    required this.name,
    required this.icon,
  });

  final String id;
  final String code;
  final String name;
  final ObjectIcon icon;

  static ObjectTypeRefModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    return ObjectTypeRefModel(
      id: id,
      code: raw['code'] as String? ?? '',
      name: raw['name'] as String? ?? '',
      icon: ObjectIcon.fromWire(raw['icon'] as String?),
    );
  }
}

/// Mirrors `LatestAssessmentDto`.
///
/// [score] is an integer 0-100 where higher is better, and [riskLevel] is resolved
/// server-side against the configurable bands in settings — the app displays the
/// level it is given rather than deriving one.
class LatestAssessmentModel {
  const LatestAssessmentModel({
    required this.id,
    required this.score,
    required this.riskLevel,
    required this.assessedAt,
    required this.assessedByName,
    required this.conclusion,
    required this.recommendation,
    required this.repairRequired,
    required this.revisitRequired,
    required this.revisitDate,
  });

  final String id;
  final int score;
  final RiskLevel? riskLevel;
  final DateTime? assessedAt;
  final String? assessedByName;
  final String? conclusion;
  final String? recommendation;
  final bool repairRequired;
  final bool revisitRequired;
  final DateTime? revisitDate;

  static LatestAssessmentModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    return LatestAssessmentModel(
      id: id,
      score: parseInt(raw['score']) ?? 0,
      riskLevel: RiskLevel.fromWire(raw['riskLevel'] as String?),
      assessedAt: parseDate(raw['assessedAt']),
      assessedByName: raw['assessedByName'] as String?,
      conclusion: raw['conclusion'] as String?,
      recommendation: raw['recommendation'] as String?,
      repairRequired: raw['repairRequired'] as bool? ?? false,
      revisitRequired: raw['revisitRequired'] as bool? ?? false,
      revisitDate: parseDate(raw['revisitDate']),
    );
  }
}

/// Mirrors `ObjectPhotoDto`. [downloadUrl] needs the Bearer header, so [id] is what
/// the image widget uses.
class ObjectPhotoModel {
  const ObjectPhotoModel({
    required this.id,
    required this.name,
    required this.downloadUrl,
    required this.mimeType,
    required this.sizeBytes,
    required this.uploadedByName,
    required this.uploadedAt,
  });

  final String id;
  final String name;
  final String downloadUrl;
  final String mimeType;
  final int sizeBytes;
  final String? uploadedByName;
  final DateTime? uploadedAt;

  factory ObjectPhotoModel.fromJson(Map<String, dynamic> json) {
    return ObjectPhotoModel(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      downloadUrl: json['downloadUrl'] as String? ?? '',
      mimeType: json['mimeType'] as String? ?? '',
      sizeBytes: parseInt(json['sizeBytes']) ?? 0,
      uploadedByName: json['uploadedByName'] as String?,
      uploadedAt: parseDate(json['uploadedAt']),
    );
  }

  bool get isImage => mimeType.startsWith('image/');
}

/// Mirrors `PanelAttributesDto`. [location] is the prototype's "Байршил" field.
class PanelAttributesModel {
  const PanelAttributesModel({
    required this.capacityKw,
    required this.location,
    required this.protection,
  });

  final double? capacityKw;
  final String? location;
  final String? protection;

  static PanelAttributesModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return PanelAttributesModel(
      capacityKw: parseDouble(raw['capacityKw']),
      location: raw['location'] as String?,
      protection: raw['protection'] as String?,
    );
  }
}

/// Mirrors `CircuitAttributesDto`.
class CircuitAttributesModel {
  const CircuitAttributesModel({
    required this.panel,
    required this.startPoint,
    required this.endPoint,
    required this.breakerRating,
    required this.cableType,
    required this.cableSectionMm2,
    required this.cableLengthM,
    required this.permittedCapacityKw,
  });

  final ObjectRefModel? panel;
  final ObjectRefModel? startPoint;
  final ObjectRefModel? endPoint;
  final String? breakerRating;
  final String? cableType;
  final double? cableSectionMm2;
  final double? cableLengthM;
  final double? permittedCapacityKw;

  static CircuitAttributesModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return CircuitAttributesModel(
      panel: ObjectRefModel.fromJson(raw['panel']),
      startPoint: ObjectRefModel.fromJson(raw['startPoint']),
      endPoint: ObjectRefModel.fromJson(raw['endPoint']),
      breakerRating: raw['breakerRating'] as String?,
      cableType: raw['cableType'] as String?,
      cableSectionMm2: parseDouble(raw['cableSectionMm2']),
      cableLengthM: parseDouble(raw['cableLengthM']),
      permittedCapacityKw: parseDouble(raw['permittedCapacityKw']),
    );
  }
}

/// Mirrors `EquipmentAttributesDto`. [installedAt] and [warrantyUntil] are the
/// prototype's "Суурилуулсан" and "Баталгаат хугацаа" rows.
class EquipmentAttributesModel {
  const EquipmentAttributesModel({
    required this.circuit,
    required this.ratedPowerKw,
    required this.quantity,
    required this.usageCoefficient,
    required this.installedAt,
    required this.warrantyUntil,
  });

  final ObjectRefModel? circuit;
  final double? ratedPowerKw;
  final int? quantity;
  final double? usageCoefficient;
  final DateTime? installedAt;
  final DateTime? warrantyUntil;

  static EquipmentAttributesModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return EquipmentAttributesModel(
      circuit: ObjectRefModel.fromJson(raw['circuit']),
      ratedPowerKw: parseDouble(raw['ratedPowerKw']),
      quantity: parseInt(raw['quantity']),
      usageCoefficient: parseDouble(raw['usageCoefficient']),
      installedAt: parseDate(raw['installedAt']),
      warrantyUntil: parseDate(raw['warrantyUntil']),
    );
  }
}

/// Mirrors `ObjectListItemDto`.
class ObjectListItemModel {
  const ObjectListItemModel({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
    required this.objectType,
    required this.customerId,
    required this.customerName,
    required this.floorId,
    required this.floorName,
    required this.buildingName,
    required this.status,
    required this.latestAssessment,
    required this.calculatedLoad,
    required this.measuredLoadKw,
    required this.loadVariance,
    required this.createdAt,
  });

  final String id;
  final String code;
  final String name;
  final ObjectCategory? category;
  final ObjectTypeRefModel? objectType;
  final String customerId;
  final String? customerName;
  final String? floorId;
  final String? floorName;
  final String? buildingName;
  final ObjectStatus? status;

  /// Null when the object has never been assessed. That is a distinct state from a
  /// low score and renders as "Үнэлгээгүй", never as a zero.
  final LatestAssessmentModel? latestAssessment;
  final LoadValueModel calculatedLoad;
  final double? measuredLoadKw;

  /// Measured minus calculated.
  final LoadValueModel loadVariance;
  final DateTime? createdAt;

  factory ObjectListItemModel.fromJson(Map<String, dynamic> json) {
    return ObjectListItemModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      category: ObjectCategory.fromWire(json['category'] as String?),
      objectType: ObjectTypeRefModel.fromJson(json['objectType']),
      customerId: json['customerId'] as String? ?? '',
      customerName: json['customerName'] as String?,
      floorId: json['floorId'] as String?,
      floorName: json['floorName'] as String?,
      buildingName: json['buildingName'] as String?,
      status: ObjectStatus.fromWire(json['status'] as String?),
      latestAssessment: LatestAssessmentModel.fromJson(json['latestAssessment']),
      calculatedLoad: LoadValueModel.fromJson(json['calculatedLoad']),
      measuredLoadKw: parseDouble(json['measuredLoadKw']),
      loadVariance: LoadValueModel.fromJson(json['loadVariance']),
      createdAt: parseDate(json['createdAt']),
    );
  }

  int? get score => latestAssessment?.score;

  RiskLevel? get riskLevel => latestAssessment?.riskLevel;

  ObjectIcon get icon => objectType?.icon ?? ObjectIcon.other;

  /// The device type, as the prototype's row subtitle prints it.
  String get typeName => objectType?.name ?? category?.label ?? '';

  /// "CT-LDB-1 · Гэрэлтүүлгийн самбар" — the prototype's row title.
  String get titleLine => code.isEmpty ? name : '$code · $name';
}

/// Mirrors `ObjectDetailDto`, which extends `ObjectListItemDto`.
class ObjectDetailModel extends ObjectListItemModel {
  const ObjectDetailModel({
    required super.id,
    required super.code,
    required super.name,
    required super.category,
    required super.objectType,
    required super.customerId,
    required super.customerName,
    required super.floorId,
    required super.floorName,
    required super.buildingName,
    required super.status,
    required super.latestAssessment,
    required super.calculatedLoad,
    required super.measuredLoadKw,
    required super.loadVariance,
    required super.createdAt,
    required this.description,
    required this.notes,
    required this.updatedAt,
    required this.photos,
    required this.panel,
    required this.circuit,
    required this.equipment,
    required this.childCircuits,
    required this.childEquipment,
    required this.loadPercent,
    required this.reserveKw,
    required this.canAssess,
  });

  final String? description;

  /// The prototype's "Тэмдэглэл".
  final String? notes;
  final DateTime? updatedAt;
  final List<ObjectPhotoModel> photos;

  /// Only the block matching `category` is non-null; the other two are null.
  final PanelAttributesModel? panel;
  final CircuitAttributesModel? circuit;
  final EquipmentAttributesModel? equipment;

  /// Populated only for a PANEL.
  final List<ObjectListItemModel> childCircuits;

  /// Populated only for a CIRCUIT.
  final List<ObjectListItemModel> childEquipment;

  /// Load as a ratio of capacity. Over 100 percent is reported, never clamped.
  final LoadValueModel loadPercent;
  final LoadValueModel reserveKw;

  /// True when the type registry marks this type as able to carry a conclusion. An
  /// object whose type cannot be assessed explains an absent үнэлгээ.
  final bool canAssess;

  factory ObjectDetailModel.fromJson(Map<String, dynamic> json) {
    return ObjectDetailModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      category: ObjectCategory.fromWire(json['category'] as String?),
      objectType: ObjectTypeRefModel.fromJson(json['objectType']),
      customerId: json['customerId'] as String? ?? '',
      customerName: json['customerName'] as String?,
      floorId: json['floorId'] as String?,
      floorName: json['floorName'] as String?,
      buildingName: json['buildingName'] as String?,
      status: ObjectStatus.fromWire(json['status'] as String?),
      latestAssessment: LatestAssessmentModel.fromJson(json['latestAssessment']),
      calculatedLoad: LoadValueModel.fromJson(json['calculatedLoad']),
      measuredLoadKw: parseDouble(json['measuredLoadKw']),
      loadVariance: LoadValueModel.fromJson(json['loadVariance']),
      createdAt: parseDate(json['createdAt']),
      description: json['description'] as String?,
      notes: json['notes'] as String?,
      updatedAt: parseDate(json['updatedAt']),
      photos: parseList(json['photos'], ObjectPhotoModel.fromJson),
      panel: PanelAttributesModel.fromJson(json['panel']),
      circuit: CircuitAttributesModel.fromJson(json['circuit']),
      equipment: EquipmentAttributesModel.fromJson(json['equipment']),
      childCircuits: parseList(json['childCircuits'], ObjectListItemModel.fromJson),
      childEquipment: parseList(json['childEquipment'], ObjectListItemModel.fromJson),
      loadPercent: LoadValueModel.fromJson(json['loadPercent']),
      reserveKw: LoadValueModel.fromJson(json['reserveKw']),
      canAssess: json['canAssess'] as bool? ?? false,
    );
  }

  /// The prototype's "Байршил" line.
  ///
  /// Only a panel carries a free-text location; a circuit and a piece of equipment
  /// are located by the node they hang off. Falls back to the building and floor the
  /// object is linked to rather than printing a dash.
  String? get locationLine {
    final String? panelLocation = panel?.location;
    if (panelLocation != null && panelLocation.isNotEmpty) return panelLocation;

    final ObjectRefModel? parent = circuit?.panel ?? equipment?.circuit;
    if (parent != null) return parent.label;

    final List<String> parts = <String>[
      if (buildingName != null && buildingName!.isNotEmpty) buildingName!,
      if (floorName != null && floorName!.isNotEmpty) floorName!,
    ];
    return parts.isEmpty ? null : parts.join(' · ');
  }
}

/// Mirrors `ObjectAssessmentDto` — one written conclusion, append-only.
class ObjectAssessmentModel {
  const ObjectAssessmentModel({
    required this.id,
    required this.objectId,
    required this.previousScore,
    required this.newScore,
    required this.riskLevel,
    required this.assessedByName,
    required this.assessedAt,
    required this.photos,
    required this.conclusion,
    required this.recommendation,
    required this.actionTaken,
    required this.measuredLoadKw,
    required this.repairRequired,
    required this.revisitRequired,
    required this.revisitDate,
    required this.revisitOwnerName,
    required this.sourceLabel,
  });

  final String id;
  final String objectId;
  final int? previousScore;
  final int newScore;
  final RiskLevel? riskLevel;
  final String? assessedByName;
  final DateTime? assessedAt;
  final List<ObjectPhotoModel> photos;
  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final double? measuredLoadKw;
  final bool repairRequired;
  final bool revisitRequired;
  final DateTime? revisitDate;
  final String? revisitOwnerName;

  /// Where the assessment came from, when it was raised during work.
  final String? sourceLabel;

  factory ObjectAssessmentModel.fromJson(Map<String, dynamic> json) {
    return ObjectAssessmentModel(
      id: json['id'] as String,
      objectId: json['objectId'] as String? ?? '',
      previousScore: parseInt(json['previousScore']),
      newScore: parseInt(json['newScore']) ?? 0,
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      assessedByName: json['assessedByName'] as String?,
      assessedAt: parseDate(json['assessedAt']),
      photos: parseList(json['photos'], ObjectPhotoModel.fromJson),
      conclusion: json['conclusion'] as String?,
      recommendation: json['recommendation'] as String?,
      actionTaken: json['actionTaken'] as String?,
      measuredLoadKw: parseDouble(json['measuredLoadKw']),
      repairRequired: json['repairRequired'] as bool? ?? false,
      revisitRequired: json['revisitRequired'] as bool? ?? false,
      revisitDate: parseDate(json['revisitDate']),
      revisitOwnerName: json['revisitOwnerName'] as String?,
      sourceLabel: json['sourceLabel'] as String?,
    );
  }
}

/// Mirrors `ObjectHistoryEntryDto`.
///
/// [id] carries a source prefix such as `ASSESSMENT:` or `REQUEST:`, which does not
/// always agree with [kind] — a request row is prefixed `REQUEST:` while its kind is
/// INSPECTION or REPAIR. [kind] is the field to switch on.
class ObjectHistoryEntryModel {
  const ObjectHistoryEntryModel({
    required this.id,
    required this.kind,
    required this.occurredAt,
    required this.title,
    required this.detail,
    required this.actorName,
    required this.previousScore,
    required this.newScore,
    required this.riskLevel,
  });

  final String id;
  final ObjectHistoryKind? kind;
  final DateTime? occurredAt;
  final String title;
  final String? detail;
  final String? actorName;
  final int? previousScore;
  final int? newScore;
  final RiskLevel? riskLevel;

  factory ObjectHistoryEntryModel.fromJson(Map<String, dynamic> json) {
    return ObjectHistoryEntryModel(
      id: json['id'] as String,
      kind: ObjectHistoryKind.fromWire(json['kind'] as String?),
      occurredAt: parseDate(json['occurredAt']),
      title: json['title'] as String? ?? '',
      detail: json['detail'] as String?,
      actorName: json['actorName'] as String?,
      previousScore: parseInt(json['previousScore']),
      newScore: parseInt(json['newScore']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
    );
  }

  /// The `ASSESSMENT:<id>` prefix, so a timeline row can be paired with the full
  /// assessment record that came back in the same response.
  String? get assessmentId {
    const String prefix = 'ASSESSMENT:';
    if (!id.startsWith(prefix)) return null;
    final String value = id.substring(prefix.length);
    return value.isEmpty ? null : value;
  }
}

/// Mirrors `ObjectHistoryDto`. [timeline] arrives sorted newest first.
class ObjectHistoryModel {
  const ObjectHistoryModel({required this.assessments, required this.timeline});

  final List<ObjectAssessmentModel> assessments;
  final List<ObjectHistoryEntryModel> timeline;

  factory ObjectHistoryModel.fromJson(Map<String, dynamic> json) {
    return ObjectHistoryModel(
      assessments: parseList(json['assessments'], ObjectAssessmentModel.fromJson),
      timeline: parseList(json['timeline'], ObjectHistoryEntryModel.fromJson),
    );
  }

  static const ObjectHistoryModel empty = ObjectHistoryModel(
    assessments: <ObjectAssessmentModel>[],
    timeline: <ObjectHistoryEntryModel>[],
  );

  bool get isEmpty => assessments.isEmpty && timeline.isEmpty;

  /// The full record behind a timeline row, when that row is an assessment.
  ObjectAssessmentModel? assessmentFor(ObjectHistoryEntryModel entry) {
    final String? target = entry.assessmentId;
    if (target == null) return null;
    for (final ObjectAssessmentModel assessment in assessments) {
      if (assessment.id == target) return assessment;
    }
    return null;
  }
}

/// The body of `POST /objects-master/:objectId/assessments`.
///
/// Mirrors `createObjectAssessmentSchema`. Two of its rules shape this class:
///
///   * [photoIds] must hold at least one id. There is no "assessment without
///     evidence" state, so the field is required here too and the sheet cannot build
///     a request that omits it.
///   * The conditional requirements on [conclusion], [recommendation] and
///     [actionTaken] depend on the band the backend resolves [newScore] into, and the
///     band thresholds are configurable in settings. The client therefore does not
///     pre-judge them: it sends what was filled in and prints the server's own
///     per-field message when a band demands more.
///
/// `revisitRequired` is deliberately absent. Setting it obliges the caller to name a
/// revisit date AND a responsible employee, and this app has no employee directory
/// screen to pick one from; [repairRequired] is the half of that rule a technician on
/// site can actually answer.
class CreateAssessmentRequest {
  const CreateAssessmentRequest({
    required this.newScore,
    required this.photoIds,
    this.conclusion,
    this.recommendation,
    this.actionTaken,
    this.measuredLoadKw,
    this.repairRequired = false,
  });

  final int newScore;
  final List<String> photoIds;
  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final double? measuredLoadKw;
  final bool repairRequired;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'newScore': newScore,
      'photoIds': photoIds,
      'repairRequired': repairRequired,
      // An empty box is not an answer of "": the field is left off entirely so the
      // schema's nullish branch applies rather than storing a blank string.
      if (conclusion != null && conclusion!.isNotEmpty) 'conclusion': conclusion,
      if (recommendation != null && recommendation!.isNotEmpty)
        'recommendation': recommendation,
      if (actionTaken != null && actionTaken!.isNotEmpty) 'actionTaken': actionTaken,
      if (measuredLoadKw != null) 'measuredLoadKw': measuredLoadKw,
    };
  }
}
