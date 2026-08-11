import '../../domain/entities/object_master_enums.dart';
import '../../domain/entities/risk_level.dart';
import 'json_utils.dart';

/// Mirrors `LoadValueDto` in packages/shared/src/types/object-master.types.ts.
///
/// [valueKw] is null whenever [complete] is false. It must never be coerced to zero:
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
}

/// Mirrors `ObjectRefDto` in packages/shared/src/types/object-master.types.ts.
///
/// Distinct from the `{ id, name }` reference used by service requests: this one
/// also carries `code` and `category`.
class ObjectMasterRefModel {
  const ObjectMasterRefModel({
    required this.id,
    required this.code,
    required this.name,
    required this.category,
  });

  final String id;
  final String code;
  final String name;
  final ObjectCategory? category;

  static ObjectMasterRefModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    return ObjectMasterRefModel(
      id: id,
      code: raw['code'] as String? ?? '',
      name: raw['name'] as String? ?? '',
      category: ObjectCategory.fromWire(raw['category'] as String?),
    );
  }
}

/// Mirrors the inline `objectType` reference on `ObjectListItemDto`
/// (`{ id, code, name, icon, iconUrl, showOnPlan } | null`).
class ObjectTypeRefModel {
  const ObjectTypeRefModel({
    required this.id,
    required this.code,
    required this.name,
    required this.icon,
    required this.iconUrl,
    required this.showOnPlan,
  });

  final String id;
  final String code;
  final String name;

  /// The built-in key, and the FALLBACK whenever there is no custom icon or the custom
  /// one cannot be drawn. Always present, so there is always something to draw.
  final ObjectIcon icon;

  /// The download path of the type's uploaded SVG, or null for a type using the
  /// built-in glyph.
  ///
  /// A path — `/api/v1/files/<id>` — and not a picture: the route wants the bearer
  /// header like every other stored file, so nothing can hand this to a plain image
  /// widget. [iconFileId] is what a caller actually fetches with.
  final String? iconUrl;

  /// The registry's own answer to "may an object of this type be drawn on a floor
  /// plan". False when absent: a server that has not been rebuilt yet must leave the
  /// plan as it was rather than scatter markers the admin web would not draw.
  final bool showOnPlan;

  /// The stored-file id inside [iconUrl], or null when there is no usable one.
  ///
  /// The inline type reference carries the URL and not the id — the admin web renders
  /// the URL directly and never needed one — so the id is read back out of the path.
  /// Deliberately strict: anything that is not a plain 24-hex id is treated as no
  /// custom icon at all rather than sent to the server as a request that cannot
  /// succeed. A type whose icon this build cannot address still draws its [icon].
  String? get iconFileId {
    final String? url = iconUrl;
    if (url == null || url.isEmpty) return null;
    final String last = url.split('?').first.split('/').last;
    return RegExp(r'^[0-9a-fA-F]{24}$').hasMatch(last) ? last : null;
  }

  static ObjectTypeRefModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    final Object? iconUrl = raw['iconUrl'];
    return ObjectTypeRefModel(
      id: id,
      code: raw['code'] as String? ?? '',
      name: raw['name'] as String? ?? '',
      icon: ObjectIcon.fromWire(raw['icon'] as String?),
      // Anything that is not a non-empty string means "no custom icon", including the
      // null the server sends for most types.
      iconUrl: iconUrl is String && iconUrl.isNotEmpty ? iconUrl : null,
      showOnPlan: raw['showOnPlan'] as bool? ?? false,
    );
  }
}

/// Mirrors `PlanPositionDto` - where the object sits on its floor plan, as a fraction
/// of the plan image's width and height.
///
/// Normalised rather than pixel-based so a placement survives the plan being replaced
/// at another resolution. Both numbers must be finite and within 0..1: a marker drawn
/// from anything else lands outside the drawing, where it is either invisible or - worse
/// - pinned to an edge as though that were the recorded position. Such a value is
/// rejected here, and the object then renders as unplaced, which is a truthful state.
class PlanPositionModel {
  const PlanPositionModel({required this.x, required this.y});

  /// Fraction of the plan's width, 0 at the left edge and 1 at the right.
  final double x;

  /// Fraction of the plan's height, 0 at the top edge and 1 at the bottom.
  final double y;

  /// Read with `is num` rather than a cast: a coordinate that arrives as a string, or
  /// as null, must cost one unplaced marker and not the whole floor's object list.
  static PlanPositionModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? rawX = raw['x'];
    final Object? rawY = raw['y'];
    if (rawX is! num || rawY is! num) return null;
    final double x = rawX.toDouble();
    final double y = rawY.toDouble();
    if (!_inRange(x) || !_inRange(y)) return null;
    return PlanPositionModel(x: x, y: y);
  }

  static bool _inRange(double value) =>
      value.isFinite && value >= 0 && value <= 1;

  /// The shape `planPositionSchema` accepts, which is the same one it emits — an
  /// object's placement and a service request's fault pin travel as the identical
  /// `{ x, y }` pair, so one serialiser serves both.
  Map<String, dynamic> toJson() => <String, dynamic>{'x': x, 'y': y};

  @override
  bool operator ==(Object other) =>
      other is PlanPositionModel && other.x == x && other.y == y;

  @override
  int get hashCode => Object.hash(x, y);

  @override
  String toString() => 'PlanPositionModel($x, $y)';
}

/// Mirrors `LatestAssessmentDto` in
/// packages/shared/src/types/object-master.types.ts.
///
/// This is the үнэлгээ the customer sees. [score] is an integer 0 to 100 where higher
/// is better, and [riskLevel] is resolved server-side against the configurable bands
/// in settings - the app displays the level it is given rather than deriving one.
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

/// Mirrors `ObjectPhotoDto` in packages/shared/src/types/object-master.types.ts.
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
}

/// Mirrors `PanelAttributesDto`.
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
///
/// The response names differ from the create-request names: the request sends
/// `panelId`, `startPointObjectId` and `endPointObjectId`; the response returns
/// `panel`, `startPoint` and `endPoint` as object references.
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

  final ObjectMasterRefModel? panel;
  final ObjectMasterRefModel? startPoint;
  final ObjectMasterRefModel? endPoint;
  final String? breakerRating;
  final String? cableType;
  final double? cableSectionMm2;
  final double? cableLengthM;
  final double? permittedCapacityKw;

  static CircuitAttributesModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return CircuitAttributesModel(
      panel: ObjectMasterRefModel.fromJson(raw['panel']),
      startPoint: ObjectMasterRefModel.fromJson(raw['startPoint']),
      endPoint: ObjectMasterRefModel.fromJson(raw['endPoint']),
      breakerRating: raw['breakerRating'] as String?,
      cableType: raw['cableType'] as String?,
      cableSectionMm2: parseDouble(raw['cableSectionMm2']),
      cableLengthM: parseDouble(raw['cableLengthM']),
      permittedCapacityKw: parseDouble(raw['permittedCapacityKw']),
    );
  }
}

/// Mirrors `EquipmentAttributesDto`. The request sends `circuitId`; the response
/// returns `circuit` as an object reference.
class EquipmentAttributesModel {
  const EquipmentAttributesModel({
    required this.circuit,
    required this.panel,
    required this.ratedPowerKw,
    required this.quantity,
    required this.usageCoefficient,
    required this.installedAt,
    required this.warrantyUntil,
  });

  final ObjectMasterRefModel? circuit;

  /// The panel enclosure the device is mounted inside, when it is one of the
  /// things that live in a panel: an RCD, a busbar, a meter, an arrester.
  ///
  /// A physical location, never a supply, and independent of [circuit] — a device
  /// may carry both. Only the circuit ever carries load.
  final ObjectMasterRefModel? panel;
  final double? ratedPowerKw;
  final int? quantity;
  final double? usageCoefficient;
  final DateTime? installedAt;
  final DateTime? warrantyUntil;

  static EquipmentAttributesModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    return EquipmentAttributesModel(
      circuit: ObjectMasterRefModel.fromJson(raw['circuit']),
      panel: ObjectMasterRefModel.fromJson(raw['panel']),
      ratedPowerKw: parseDouble(raw['ratedPowerKw']),
      quantity: parseInt(raw['quantity']),
      usageCoefficient: parseDouble(raw['usageCoefficient']),
      installedAt: parseDate(raw['installedAt']),
      warrantyUntil: parseDate(raw['warrantyUntil']),
    );
  }
}

/// Mirrors `ObjectListItemDto` in
/// packages/shared/src/types/object-master.types.ts.
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
    required this.planPosition,
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

  /// Where the object sits on its floor's plan image. Null when it has never been
  /// placed - or when the stored value was unusable - and it then draws no marker.
  final PlanPositionModel? planPosition;

  final ObjectStatus? status;

  /// Null when the object has never been assessed. That is a distinct state from a
  /// low score and is rendered as "Үнэлгээгүй", never as a zero.
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
      planPosition: PlanPositionModel.fromJson(json['planPosition']),
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

  /// The stored-file id of this object's type's uploaded icon, or null to draw [icon].
  String? get iconFileId => objectType?.iconFileId;

  /// "LDB-2F-02 · Дэд самбар" - the row title in the prototype.
  String get titleLine {
    final String typeName = objectType?.name ?? category?.label ?? '';
    return typeName.isEmpty ? name : '$name · $typeName';
  }
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
    required super.planPosition,
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
    required this.deleteBlockers,
  });

  final String? description;
  final String? notes;
  final DateTime? updatedAt;
  final List<ObjectPhotoModel> photos;

  /// Only the block matching [category] is non-null; the other two are null.
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

  /// True when the object type is configured to generate a conclusion. The customer
  /// app never records an assessment, but the flag explains an absent үнэлгээ.
  final bool canAssess;
  final List<String> deleteBlockers;

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
      planPosition: PlanPositionModel.fromJson(json['planPosition']),
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
      deleteBlockers: parseStringList(json['deleteBlockers']),
    );
  }
}

/// Mirrors `ObjectAssessmentDto` in
/// packages/shared/src/types/object-master.types.ts.
class ObjectAssessmentModel {
  const ObjectAssessmentModel({
    required this.id,
    required this.objectId,
    required this.previousScore,
    required this.newScore,
    required this.riskLevel,
    required this.assessedById,
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
    required this.createdAt,
  });

  final String id;
  final String objectId;
  final int? previousScore;
  final int newScore;
  final RiskLevel? riskLevel;
  final String? assessedById;
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
  final String? sourceLabel;
  final DateTime? createdAt;

  factory ObjectAssessmentModel.fromJson(Map<String, dynamic> json) {
    return ObjectAssessmentModel(
      id: json['id'] as String,
      objectId: json['objectId'] as String? ?? '',
      previousScore: parseInt(json['previousScore']),
      newScore: parseInt(json['newScore']) ?? 0,
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      assessedById: json['assessedById'] as String?,
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
      createdAt: parseDate(json['createdAt']),
    );
  }
}

/// Mirrors `ObjectHistoryEntryDto`.
///
/// [id] carries a source prefix such as `ASSESSMENT:` or `REQUEST:`, which does not
/// always agree with [kind] - a request row is prefixed `REQUEST:` while its kind is
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
    required this.linkPath,
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
  final String? linkPath;

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
      linkPath: json['linkPath'] as String?,
    );
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
}

/// Mirrors `FloorLoadSummaryDto` in
/// packages/shared/src/types/object-master.types.ts.
class FloorLoadSummaryModel {
  const FloorLoadSummaryModel({
    required this.panelCount,
    required this.circuitCount,
    required this.equipmentCount,
    required this.totalKw,
    required this.measuredTotalKw,
    required this.variance,
    required this.unattachedEquipmentCount,
    required this.unattachedEquipmentKw,
    required this.riskCounts,
    required this.unassessedCount,
    required this.kvaNote,
  });

  final int panelCount;
  final int circuitCount;
  final int equipmentCount;
  final LoadValueModel totalKw;
  final double? measuredTotalKw;
  final LoadValueModel variance;
  final int unattachedEquipmentCount;
  final LoadValueModel unattachedEquipmentKw;
  final List<RiskLevelCountEntry> riskCounts;
  final int unassessedCount;

  /// Explains why kVA is not reported. Server-supplied text, shown verbatim.
  final String kvaNote;

  factory FloorLoadSummaryModel.fromJson(Map<String, dynamic> json) {
    return FloorLoadSummaryModel(
      panelCount: parseInt(json['panelCount']) ?? 0,
      circuitCount: parseInt(json['circuitCount']) ?? 0,
      equipmentCount: parseInt(json['equipmentCount']) ?? 0,
      totalKw: LoadValueModel.fromJson(json['totalKw']),
      measuredTotalKw: parseDouble(json['measuredTotalKw']),
      variance: LoadValueModel.fromJson(json['variance']),
      unattachedEquipmentCount: parseInt(json['unattachedEquipmentCount']) ?? 0,
      unattachedEquipmentKw: LoadValueModel.fromJson(json['unattachedEquipmentKw']),
      riskCounts: parseList(json['riskCounts'], RiskLevelCountEntry.fromJson),
      unassessedCount: parseInt(json['unassessedCount']) ?? 0,
      kvaNote: json['kvaNote'] as String? ?? '',
    );
  }
}

/// Mirrors `RiskLevelCountDto` as it appears on `FloorLoadSummaryDto`. The same
/// shape is mirrored by `RiskLevelCountModel` for risk summaries; both exist because
/// the two are declared separately in the shared package and could drift.
class RiskLevelCountEntry {
  const RiskLevelCountEntry({required this.level, required this.count});

  final RiskLevel? level;
  final int count;

  factory RiskLevelCountEntry.fromJson(Map<String, dynamic> json) {
    return RiskLevelCountEntry(
      level: RiskLevel.fromWire(json['level'] as String?),
      count: parseInt(json['count']) ?? 0,
    );
  }
}
