import '../../domain/entities/risk_level.dart';
import '../../../../../core/util/json_parse.dart';
import 'project_models.dart';

/// Mirrors `InspectionListItemDto` in
/// packages/shared/src/types/inspection.types.ts.
///
/// This is the consolidated device conclusion report (Нэгдсэн төхөөрөмжийн тайлан):
/// a cross-cutting read over the append-only assessment history, one row per written
/// conclusion, filterable by project, building, floor and band. It is what backs the
/// prototype's floor-level "Тайлангийн жагсаалт".
class InspectionListItemModel {
  const InspectionListItemModel({
    required this.id,
    required this.reportNumber,
    required this.objectId,
    required this.objectCode,
    required this.objectName,
    required this.objectTypeName,
    required this.locationPath,
    required this.floorId,
    required this.floorName,
    required this.buildingName,
    required this.score,
    required this.previousScore,
    required this.riskLevel,
    required this.conclusion,
    required this.recommendation,
    required this.actionTaken,
    required this.measuredLoadKw,
    required this.repairRequired,
    required this.revisitRequired,
    required this.revisitDate,
    required this.revisitOwnerName,
    required this.assessedByName,
    required this.assessedAt,
    required this.sourceLabel,
  });

  final String id;

  /// Derived server-side from the assessment, e.g. `RPT-2F-009`.
  final String reportNumber;

  final String objectId;
  final String objectCode;
  final String objectName;
  final String? objectTypeName;

  /// "Төв байр · 2-р давхар". Null segments are omitted server-side rather than
  /// printed as dashes.
  final String locationPath;
  final String? floorId;
  final String? floorName;
  final String? buildingName;

  final int score;
  final int? previousScore;
  final RiskLevel? riskLevel;

  final String? conclusion;
  final String? recommendation;
  final String? actionTaken;
  final double? measuredLoadKw;

  final bool repairRequired;
  final bool revisitRequired;
  final DateTime? revisitDate;
  final String? revisitOwnerName;

  final String? assessedByName;
  final DateTime? assessedAt;

  /// Where the conclusion was raised, e.g. a service request or planned work.
  final String? sourceLabel;

  factory InspectionListItemModel.fromJson(Map<String, dynamic> json) {
    return InspectionListItemModel(
      id: json['id'] as String,
      reportNumber: json['reportNumber'] as String? ?? '',
      objectId: json['objectId'] as String? ?? '',
      objectCode: json['objectCode'] as String? ?? '',
      objectName: json['objectName'] as String? ?? '',
      objectTypeName: json['objectTypeName'] as String?,
      locationPath: json['locationPath'] as String? ?? '',
      floorId: parseString(json['floorId']),
      floorName: json['floorName'] as String?,
      buildingName: json['buildingName'] as String?,
      score: parseInt(json['score']) ?? 0,
      previousScore: parseInt(json['previousScore']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      conclusion: json['conclusion'] as String?,
      recommendation: json['recommendation'] as String?,
      actionTaken: json['actionTaken'] as String?,
      measuredLoadKw: parseDouble(json['measuredLoadKw']),
      repairRequired: json['repairRequired'] as bool? ?? false,
      revisitRequired: json['revisitRequired'] as bool? ?? false,
      revisitDate: parseDate(json['revisitDate']),
      revisitOwnerName: json['revisitOwnerName'] as String?,
      assessedByName: json['assessedByName'] as String?,
      assessedAt: parseDate(json['assessedAt']),
      sourceLabel: json['sourceLabel'] as String?,
    );
  }

  /// "RPT-2F-009 · CT-LDB-1" — the prototype's report row title.
  String get titleLine =>
      objectCode.isEmpty ? reportNumber : '$reportNumber · $objectCode';
}

/// Mirrors `InspectionSummaryDto`.
///
/// Per-band counts and an unassessed count, never one rolled-up figure — the same
/// section 19.2 constraint that governs [RiskSummaryModel].
class InspectionSummaryModel {
  const InspectionSummaryModel({
    required this.totalObjects,
    required this.assessedObjects,
    required this.unassessedObjects,
    required this.counts,
    required this.repairRequiredCount,
    required this.revisitRequiredCount,
  });

  final int totalObjects;
  final int assessedObjects;
  final int unassessedObjects;
  final List<RiskLevelCountModel> counts;
  final int repairRequiredCount;
  final int revisitRequiredCount;

  factory InspectionSummaryModel.fromJson(Map<String, dynamic> json) {
    return InspectionSummaryModel(
      totalObjects: parseInt(json['totalObjects']) ?? 0,
      assessedObjects: parseInt(json['assessedObjects']) ?? 0,
      unassessedObjects: parseInt(json['unassessedObjects']) ?? 0,
      counts: parseList(json['counts'], RiskLevelCountModel.fromJson),
      repairRequiredCount: parseInt(json['repairRequiredCount']) ?? 0,
      revisitRequiredCount: parseInt(json['revisitRequiredCount']) ?? 0,
    );
  }

  static const InspectionSummaryModel empty = InspectionSummaryModel(
    totalObjects: 0,
    assessedObjects: 0,
    unassessedObjects: 0,
    counts: <RiskLevelCountModel>[],
    repairRequiredCount: 0,
    revisitRequiredCount: 0,
  );

  int countOf(RiskLevel level) {
    for (final RiskLevelCountModel entry in counts) {
      if (entry.level == level) return entry.count;
    }
    return 0;
  }
}
