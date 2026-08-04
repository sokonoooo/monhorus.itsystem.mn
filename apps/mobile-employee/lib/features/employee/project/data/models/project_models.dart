import '../../domain/entities/risk_level.dart';
import '../../../../../core/util/json_parse.dart';

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

/// Mirrors `RiskSummaryDto` in packages/shared/src/types/project.types.ts.
///
/// Deliberately a set of per-band counts and never a single rolled-up score: the
/// backend's own comment cites requirements section 19.2 as leaving the aggregation
/// method for a project, building or floor unapproved. The prototype's "оноо /100" on
/// a floor row has no counterpart in the API, so this app shows the breakdown instead
/// of inventing an average.
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

  /// Bands below NORMAL that are not yet critical.
  int get attentionCount =>
      countOf(RiskLevel.attention) + countOf(RiskLevel.scheduleRepair);

  /// The two bands section 10.2 requires a warning marker on.
  int get criticalCount =>
      countOf(RiskLevel.critical) + countOf(RiskLevel.outOfService);

  int get normalCount => countOf(RiskLevel.normal);

  /// The worst band present, or null when nothing is assessed. Colours a row tile.
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
    required this.createdAt,
    required this.updatedAt,
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
  final DateTime? createdAt;
  final DateTime? updatedAt;

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
      createdAt: parseDate(json['createdAt']),
      updatedAt: parseDate(json['updatedAt']),
    );
  }

  /// The two-to-four character badge the prototype puts in the row tile ("CT", "AP").
  String get shortCode => _badgeOf(code, name, fromEnd: false);
}

/// Mirrors `BuildingDto`.
///
/// [projectId] arrives as an empty string rather than null when the node has no
/// parent, so it is normalised here.
class BuildingModel {
  const BuildingModel({
    required this.id,
    required this.code,
    required this.name,
    required this.projectId,
    required this.projectName,
    required this.customerId,
    required this.address,
    required this.description,
    required this.isActive,
    required this.floorCount,
    required this.objectCount,
    required this.riskSummary,
  });

  final String id;
  final String code;
  final String name;
  final String? projectId;
  final String? projectName;
  final String customerId;
  final String? address;
  final String? description;
  final bool isActive;
  final int floorCount;
  final int objectCount;
  final RiskSummaryModel riskSummary;

  factory BuildingModel.fromJson(Map<String, dynamic> json) {
    return BuildingModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      projectId: parseString(json['projectId']),
      projectName: json['projectName'] as String?,
      customerId: json['customerId'] as String? ?? '',
      address: json['address'] as String?,
      description: json['description'] as String?,
      isActive: json['isActive'] as bool? ?? true,
      floorCount: parseInt(json['floorCount']) ?? 0,
      objectCount: parseInt(json['objectCount']) ?? 0,
      riskSummary: RiskSummaryModel.fromJson(json['riskSummary']),
    );
  }

  String get shortCode => _badgeOf(code, name, fromEnd: true);
}

/// Mirrors `FloorDto`.
///
/// Two wire quirks are absorbed here: [buildingId] and [projectId] arrive as empty
/// strings when the relation is missing, and [projectName] is always null on the list
/// response — only `GET /floors/:floorId` fills it in.
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

  factory FloorModel.fromJson(Map<String, dynamic> json) {
    return FloorModel(
      id: json['id'] as String,
      code: json['code'] as String? ?? '',
      name: json['name'] as String? ?? '',
      buildingId: parseString(json['buildingId']),
      buildingName: json['buildingName'] as String?,
      projectId: parseString(json['projectId']),
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
    );
  }

  /// The badge the prototype puts in a floor row ("2F"). Falls back to the code when
  /// the floor carries no number, because a blank tile reads as a rendering fault.
  String get shortLabel {
    final int? number = floorNumber;
    if (number != null) return number < 0 ? 'B${number.abs()}' : '${number}F';
    return code.isEmpty ? '?' : (code.length <= 4 ? code : code.substring(0, 4));
  }
}

/// Mirrors `FloorPlanDto`.
///
/// [downloadUrl] is a path on the API and the endpoint behind it needs the Bearer
/// header, so it cannot be handed to `Image.network`; the bytes go through the
/// authenticated client instead.
///
/// Note what is NOT here: the DTO carries no pin, marker or coordinate list — and it
/// does not need one. A device's place on the drawing is `planPosition` on the object
/// itself (`ObjectListItemModel`), a fraction of the plan's width and height, so a
/// marker layer is built from the floor's object list rather than from the plan.
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
    required this.uploadedByName,
    required this.uploadedAt,
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
  final String? uploadedByName;
  final DateTime? uploadedAt;

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
      uploadedByName: json['uploadedByName'] as String?,
      uploadedAt: parseDate(json['uploadedAt']),
    );
  }

  bool get isImage => mimeType.startsWith('image/');
}

/// A short uppercase badge for a row tile, the prototype's "CT" / "MAIN" chip.
///
/// Codes in this system are segmented (`CT-PRJ-1`, `CT-B1`), and a blind truncation
/// produces "CT-P", which reads as a rendering fault. So one segment is taken whole:
/// the first for a project, where the leading segment is the customer marker and is
/// what distinguishes one project from another, and the last for a building, where
/// every building under a project shares the same leading segment and only the tail
/// tells them apart.
String _badgeOf(String code, String name, {required bool fromEnd}) {
  final List<String> segments = code
      .split(RegExp(r'[^A-Za-z0-9]+'))
      .where((String segment) => segment.isNotEmpty)
      .toList();

  if (segments.isNotEmpty) {
    final String segment = fromEnd ? segments.last : segments.first;
    return segment.length <= 4 ? segment : segment.substring(0, 4);
  }

  if (name.isEmpty) return '?';
  return name.substring(0, name.length < 2 ? name.length : 2).toUpperCase();
}
