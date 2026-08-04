import '../../domain/entities/risk_level.dart';
import 'json_utils.dart';

/// Mirrors `RiskLevelCountDto` in
/// packages/shared/src/types/object-master.types.ts.
class RiskLevelCountModel {
  const RiskLevelCountModel({required this.level, required this.count});

  final RiskLevel? level;
  final int count;

  factory RiskLevelCountModel.fromJson(Map<String, dynamic> json) {
    return RiskLevelCountModel(
      level: RiskLevel.fromWire(json['level'] as String?),
      count: parseInt(json['count']) ?? 0,
    );
  }
}

/// Mirrors `ReportRollupDto` in
/// packages/shared/src/types/report-record.types.ts.
///
/// The node's standing as one figure: [score] is the *worst* assessed object beneath it
/// and [riskLevel] that score's band. Both are null for a node whose equipment has never
/// been assessed, which is a distinct state from a low score and must never render as a
/// zero.
///
/// The band is banded server-side on read rather than stored, because the thresholds are
/// a runtime setting — so the app takes [riskLevel] as sent and never derives it from
/// [score]. [worstObjectName] is the object that produced the figure, which is what makes
/// the number actionable rather than merely alarming.
class RollupModel {
  const RollupModel({
    required this.score,
    required this.riskLevel,
    required this.assessedCount,
    required this.unassessedCount,
    required this.worstObjectId,
    required this.worstObjectName,
    required this.calculatedAt,
  });

  final int? score;
  final RiskLevel? riskLevel;
  final int assessedCount;
  final int unassessedCount;
  final String? worstObjectId;
  final String? worstObjectName;
  final DateTime? calculatedAt;

  factory RollupModel.fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return RollupModel.empty;
    return RollupModel(
      score: parseInt(raw['score']),
      riskLevel: RiskLevel.fromWire(raw['riskLevel'] as String?),
      assessedCount: parseInt(raw['assessedCount']) ?? 0,
      unassessedCount: parseInt(raw['unassessedCount']) ?? 0,
      worstObjectId: emptyToNull(raw['worstObjectId']),
      worstObjectName: raw['worstObjectName'] as String?,
      calculatedAt: parseDate(raw['calculatedAt']),
    );
  }

  static const RollupModel empty = RollupModel(
    score: null,
    riskLevel: null,
    assessedCount: 0,
    unassessedCount: 0,
    worstObjectId: null,
    worstObjectName: null,
    calculatedAt: null,
  );

  /// True only when the server sent both halves. A score without a band, or a band
  /// without a score, is not renderable as a figure and falls back to "Үнэлгээгүй".
  bool get hasScore => score != null && riskLevel != null;
}

/// Mirrors `RiskSummaryDto` in packages/shared/src/types/project.types.ts.
///
/// Per-band counts, which answer a different question from [RollupModel]: the counts say
/// how the equipment is distributed, the rollup says how bad the worst of it is. Both
/// travel on the same DTO and the backend expects both to be shown — "42, and eleven of
/// the fourteen panels have never been looked at" is not the same statement as "42".
class RiskSummaryModel {
  const RiskSummaryModel({
    required this.counts,
    required this.unassessedCount,
    required this.hasCritical,
    required this.lastAssessedAt,
  });

  /// Non-zero bands only. An empty list means nothing under this node was assessed.
  final List<RiskLevelCountModel> counts;
  final int unassessedCount;
  final bool hasCritical;
  final DateTime? lastAssessedAt;

  factory RiskSummaryModel.fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return RiskSummaryModel.empty;
    return RiskSummaryModel(
      counts: parseList(raw['counts'], RiskLevelCountModel.fromJson),
      unassessedCount: parseInt(raw['unassessedCount']) ?? 0,
      hasCritical: raw['hasCritical'] as bool? ?? false,
      lastAssessedAt: parseDate(raw['lastAssessedAt']),
    );
  }

  static const RiskSummaryModel empty = RiskSummaryModel(
    counts: <RiskLevelCountModel>[],
    unassessedCount: 0,
    hasCritical: false,
    lastAssessedAt: null,
  );

  int countOf(RiskLevel level) {
    for (final RiskLevelCountModel entry in counts) {
      if (entry.level == level) return entry.count;
    }
    return 0;
  }

  int get assessedTotal =>
      counts.fold(0, (int sum, RiskLevelCountModel entry) => sum + entry.count);

  int get total => assessedTotal + unassessedCount;

  /// Bands that call for action: everything below NORMAL.
  int get attentionCount =>
      countOf(RiskLevel.attention) + countOf(RiskLevel.scheduleRepair);

  int get criticalCount =>
      countOf(RiskLevel.critical) + countOf(RiskLevel.outOfService);

  /// The worst band present, or null when nothing is assessed. Used to colour a row.
  RiskLevel? get worstLevel {
    for (final RiskLevel level in <RiskLevel>[
      RiskLevel.outOfService,
      RiskLevel.critical,
      RiskLevel.scheduleRepair,
      RiskLevel.attention,
      RiskLevel.normal,
    ]) {
      if (countOf(level) > 0) return level;
    }
    return null;
  }

  bool get isEmpty => counts.isEmpty && unassessedCount == 0;
}

/// Mirrors `ProjectDto` in packages/shared/src/types/project.types.ts.
class ProjectModel {
  const ProjectModel({
    required this.id,
    required this.code,
    required this.name,
    required this.customerId,
    required this.customerName,
    required this.contractNumber,
    required this.responsibleEmployeeId,
    required this.responsibleEmployeeName,
    required this.startDate,
    required this.endDate,
    required this.description,
    required this.isActive,
    required this.buildingCount,
    required this.floorCount,
    required this.objectCount,
    required this.riskSummary,
    required this.rollup,
    required this.createdAt,
    required this.updatedAt,
    required this.deleteBlockers,
  });

  final String id;
  final String code;
  final String name;
  final String customerId;
  final String? customerName;
  final String? contractNumber;
  final String? responsibleEmployeeId;
  final String? responsibleEmployeeName;
  final DateTime? startDate;
  final DateTime? endDate;
  final String? description;
  final bool isActive;
  final int buildingCount;
  final int floorCount;
  final int objectCount;
  final RiskSummaryModel riskSummary;
  final RollupModel rollup;
  final DateTime? createdAt;
  final DateTime? updatedAt;

  /// Mongolian free text explaining why deletion is refused. Display only; there are
  /// no machine-readable codes behind these strings.
  final List<String> deleteBlockers;

  factory ProjectModel.fromJson(Map<String, dynamic> json) {
    return ProjectModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      customerId: json['customerId'] as String? ?? '',
      customerName: json['customerName'] as String?,
      contractNumber: json['contractNumber'] as String?,
      responsibleEmployeeId: json['responsibleEmployeeId'] as String?,
      responsibleEmployeeName: json['responsibleEmployeeName'] as String?,
      startDate: parseDate(json['startDate']),
      endDate: parseDate(json['endDate']),
      description: json['description'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      buildingCount: parseInt(json['buildingCount']) ?? 0,
      floorCount: parseInt(json['floorCount']) ?? 0,
      objectCount: parseInt(json['objectCount']) ?? 0,
      riskSummary: RiskSummaryModel.fromJson(json['riskSummary']),
      rollup: RollupModel.fromJson(json['rollup']),
      createdAt: parseDate(json['createdAt']),
      updatedAt: parseDate(json['updatedAt']),
      deleteBlockers: parseStringList(json['deleteBlockers']),
    );
  }
}

/// Mirrors `BuildingDto` in packages/shared/src/types/project.types.ts.
///
/// [projectId] arrives as an empty string rather than null when the node has no
/// parent, so it is normalised to null here.
class BuildingModel {
  const BuildingModel({
    required this.id,
    required this.code,
    required this.name,
    required this.projectId,
    required this.projectName,
    required this.customerId,
    required this.address,
    required this.gpsLatitude,
    required this.gpsLongitude,
    required this.description,
    required this.isActive,
    required this.floorCount,
    required this.objectCount,
    required this.riskSummary,
    required this.rollup,
    required this.createdAt,
    required this.updatedAt,
    required this.deleteBlockers,
  });

  final String id;
  final String code;
  final String name;
  final String? projectId;
  final String? projectName;
  final String customerId;
  final String? address;
  final double? gpsLatitude;
  final double? gpsLongitude;
  final String? description;
  final bool isActive;
  final int floorCount;
  final int objectCount;
  final RiskSummaryModel riskSummary;
  final RollupModel rollup;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<String> deleteBlockers;

  factory BuildingModel.fromJson(Map<String, dynamic> json) {
    return BuildingModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      projectId: emptyToNull(json['projectId']),
      projectName: json['projectName'] as String?,
      customerId: json['customerId'] as String? ?? '',
      address: json['address'] as String?,
      gpsLatitude: parseDouble(json['gpsLatitude']),
      gpsLongitude: parseDouble(json['gpsLongitude']),
      description: json['description'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      floorCount: parseInt(json['floorCount']) ?? 0,
      objectCount: parseInt(json['objectCount']) ?? 0,
      riskSummary: RiskSummaryModel.fromJson(json['riskSummary']),
      rollup: RollupModel.fromJson(json['rollup']),
      createdAt: parseDate(json['createdAt']),
      updatedAt: parseDate(json['updatedAt']),
      deleteBlockers: parseStringList(json['deleteBlockers']),
    );
  }

  /// The two-to-four character badge the prototype puts in the row tile.
  String get shortCode => code.isEmpty
      ? name.substring(0, name.length < 3 ? name.length : 3).toUpperCase()
      : (code.length <= 4 ? code : code.substring(0, 4));
}

/// Mirrors `FloorDto` in packages/shared/src/types/project.types.ts.
///
/// Two wire quirks are absorbed here: [buildingId] and [projectId] arrive as empty
/// strings when the relation is missing, and [projectName] is always null on the list
/// response - only `GET /floors/:floorId` fills it in.
class FloorModel {
  const FloorModel({
    required this.id,
    required this.code,
    required this.name,
    required this.buildingId,
    required this.buildingName,
    required this.projectId,
    required this.projectName,
    required this.customerId,
    required this.floorNumber,
    required this.areaSqm,
    required this.purpose,
    required this.description,
    required this.isActive,
    required this.hasPlanImage,
    required this.objectCount,
    required this.riskSummary,
    required this.rollup,
    required this.createdAt,
    required this.updatedAt,
    required this.deleteBlockers,
  });

  final String id;
  final String code;
  final String name;
  final String? buildingId;
  final String? buildingName;
  final String? projectId;
  final String? projectName;
  final String customerId;

  /// Signed, so a basement level is -1.
  final int? floorNumber;
  final double? areaSqm;
  final String? purpose;
  final String? description;
  final bool isActive;
  final bool hasPlanImage;
  final int objectCount;
  final RiskSummaryModel riskSummary;
  final RollupModel rollup;
  final DateTime? createdAt;
  final DateTime? updatedAt;
  final List<String> deleteBlockers;

  factory FloorModel.fromJson(Map<String, dynamic> json) {
    return FloorModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      buildingId: emptyToNull(json['buildingId']),
      buildingName: json['buildingName'] as String?,
      projectId: emptyToNull(json['projectId']),
      projectName: json['projectName'] as String?,
      customerId: json['customerId'] as String? ?? '',
      floorNumber: parseInt(json['floorNumber']),
      areaSqm: parseDouble(json['areaSqm']),
      purpose: json['purpose'] as String?,
      description: json['description'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      hasPlanImage: json['hasPlanImage'] as bool? ?? false,
      objectCount: parseInt(json['objectCount']) ?? 0,
      riskSummary: RiskSummaryModel.fromJson(json['riskSummary']),
      rollup: RollupModel.fromJson(json['rollup']),
      createdAt: parseDate(json['createdAt']),
      updatedAt: parseDate(json['updatedAt']),
      deleteBlockers: parseStringList(json['deleteBlockers']),
    );
  }

  /// The badge the prototype puts in a floor row. Falls back to the code when the
  /// floor has no number, because a blank tile reads as a rendering fault.
  String get shortLabel {
    final int? number = floorNumber;
    if (number != null) return '$number';
    return code.isEmpty ? '?' : (code.length <= 3 ? code : code.substring(0, 3));
  }
}

/// Mirrors `FloorPlanDto` in packages/shared/src/types/project.types.ts.
///
/// [downloadUrl] is a path on the API and the endpoint behind it needs the Bearer
/// header, so it cannot be passed to `Image.network`.
class FloorPlanModel {
  const FloorPlanModel({
    required this.id,
    required this.floorId,
    required this.fileId,
    required this.fileName,
    required this.downloadUrl,
    required this.mimeType,
    required this.sizeBytes,
    required this.title,
    required this.description,
    required this.uploadedById,
    required this.uploadedByName,
    required this.uploadedAt,
    required this.updatedAt,
  });

  final String id;
  final String floorId;
  final String fileId;
  final String fileName;
  final String downloadUrl;
  final String mimeType;
  final int sizeBytes;
  final String? title;
  final String? description;
  final String? uploadedById;
  final String? uploadedByName;
  final DateTime? uploadedAt;
  final DateTime? updatedAt;

  factory FloorPlanModel.fromJson(Map<String, dynamic> json) {
    return FloorPlanModel(
      id: json['id'] as String,
      floorId: json['floorId'] as String? ?? '',
      fileId: json['fileId'] as String? ?? '',
      fileName: json['fileName'] as String? ?? '',
      downloadUrl: json['downloadUrl'] as String? ?? '',
      mimeType: json['mimeType'] as String? ?? '',
      sizeBytes: parseInt(json['sizeBytes']) ?? 0,
      title: json['title'] as String?,
      description: json['description'] as String?,
      uploadedById: json['uploadedById'] as String?,
      uploadedByName: json['uploadedByName'] as String?,
      uploadedAt: parseDate(json['uploadedAt']),
      updatedAt: parseDate(json['updatedAt']),
    );
  }

  bool get isImage => mimeType.startsWith('image/');
}
