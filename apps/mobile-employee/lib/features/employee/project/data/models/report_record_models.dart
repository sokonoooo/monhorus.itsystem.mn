import '../../../../../core/util/json_parse.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/risk_level.dart';

/// The central report registry, as one piece of equipment sees it.
///
/// Every conclusion written anywhere in the platform lands in one collection — an
/// assessment raised straight against a device, the result of a planned work, the
/// conclusion of a service request, and several of those signed off together. Before
/// that they were four unrelated shapes and nothing could be compared across them.
///
/// A REPORT says what was concluded overall; a REPORT ITEM says what was found on one
/// piece of equipment. That split is why a technician looking at one device is shown the
/// reports that touched it and, inside each, only the finding about THIS device rather
/// than the whole visit.

/// Mirrors `ReportType` / `REPORT_TYPE_LABELS`.
enum ReportRecordType {
  objectAssessment('OBJECT_ASSESSMENT', 'Тоноглолын үнэлгээ'),
  plannedWork('PLANNED_WORK', 'Төлөвлөгөөт ажил'),
  serviceRequest('SERVICE_REQUEST', 'Үйлчилгээний хүсэлт'),
  consolidated('CONSOLIDATED', 'Нэгдсэн тайлан');

  const ReportRecordType(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static ReportRecordType? fromWire(String? value) {
    if (value == null) return null;
    for (final ReportRecordType type in ReportRecordType.values) {
      if (type.wireValue == value) return type;
    }
    return null;
  }
}

/// Mirrors `ReportStatus` / `REPORT_STATUS_LABELS`.
///
/// The tone is a local choice. APPROVED and PUBLISHED are the two states in which a
/// finding is believed — everything below them is a claim still being reviewed — so they
/// are the only ones drawn in a settled colour.
enum ReportRecordStatus {
  draft('DRAFT', 'Ноорог', Tone.neutral),
  submitted('SUBMITTED', 'Хянуулахаар илгээсэн', Tone.yellow),
  approved('APPROVED', 'Батлагдсан', Tone.green),
  returned('RETURNED', 'Буцаагдсан', Tone.red),
  published('PUBLISHED', 'Нийтлэгдсэн', Tone.green);

  const ReportRecordStatus(this.wireValue, this.label, this.tone);

  final String wireValue;
  final String label;
  final Tone tone;

  static ReportRecordStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final ReportRecordStatus status in ReportRecordStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }
}

/// Mirrors `ReportAttachmentDto`. [id] is what the authenticated image widget wants;
/// `downloadUrl` needs the bearer header and so cannot be handed to a plain image.
class ReportAttachmentModel {
  const ReportAttachmentModel({
    required this.id,
    required this.name,
    required this.mimeType,
  });

  final String id;
  final String name;
  final String mimeType;

  static ReportAttachmentModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    return ReportAttachmentModel(
      id: id,
      name: raw['name'] as String? ?? '',
      mimeType: raw['mimeType'] as String? ?? '',
    );
  }

  bool get isImage => mimeType.startsWith('image/');
}

/// Mirrors `ReportItemDto` — what one report found on one piece of equipment.
class ReportItemModel {
  const ReportItemModel({
    required this.id,
    required this.objectId,
    required this.objectCode,
    required this.objectName,
    required this.score,
    required this.riskLevel,
    required this.observation,
    required this.conclusion,
    required this.recommendation,
    required this.measuredLoadKw,
    required this.evidence,
  });

  final String id;
  final String objectId;
  final String? objectCode;
  final String? objectName;

  /// Null for an item recorded without a score, which is a distinct state from zero.
  final int? score;
  final RiskLevel? riskLevel;
  final String? observation;
  final String? conclusion;
  final String? recommendation;
  final double? measuredLoadKw;
  final List<ReportAttachmentModel> evidence;

  static ReportItemModel? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final Object? id = raw['id'];
    if (id is! String) return null;
    final Object? attachments = raw['evidenceAttachments'];
    return ReportItemModel(
      id: id,
      objectId: raw['objectId'] as String? ?? '',
      objectCode: raw['objectCode'] as String?,
      objectName: raw['objectName'] as String?,
      score: parseInt(raw['score']),
      riskLevel: RiskLevel.fromWire(raw['riskLevel'] as String?),
      observation: raw['observation'] as String?,
      conclusion: raw['conclusion'] as String?,
      recommendation: raw['recommendation'] as String?,
      measuredLoadKw: parseDouble(raw['measuredLoadKw']),
      evidence: attachments is List
          ? attachments
              .map(ReportAttachmentModel.fromJson)
              .whereType<ReportAttachmentModel>()
              .toList(growable: false)
          : const <ReportAttachmentModel>[],
    );
  }
}

/// Mirrors `ReportListItemDto` — a report without its per-object findings.
///
/// The list endpoint omits `items` deliberately: a floor's worth of reports would
/// otherwise carry every finding of every visit. The findings arrive with
/// [ReportRecordDetailModel] when one report is actually opened.
class ReportRecordModel {
  const ReportRecordModel({
    required this.id,
    required this.reportNumber,
    required this.type,
    required this.status,
    required this.title,
    required this.conclusion,
    required this.recommendation,
    required this.overallScore,
    required this.riskLevel,
    required this.itemCount,
    required this.createdByName,
    required this.approvedByName,
    required this.approvedAt,
    required this.occurredAt,
  });

  final String id;
  final String reportNumber;
  final ReportRecordType? type;
  final ReportRecordStatus? status;
  final String title;
  final String? conclusion;
  final String? recommendation;

  /// The worst item's score, so a report and the equipment it covers agree.
  final int? overallScore;
  final RiskLevel? riskLevel;
  final int itemCount;
  final String? createdByName;
  final String? approvedByName;
  final DateTime? approvedAt;

  /// When the work happened, which is not when the row was written.
  final DateTime? occurredAt;

  factory ReportRecordModel.fromJson(Map<String, dynamic> json) {
    return ReportRecordModel(
      id: json['id'] as String,
      reportNumber: json['reportNumber'] as String? ?? '',
      type: ReportRecordType.fromWire(json['type'] as String?),
      status: ReportRecordStatus.fromWire(json['status'] as String?),
      title: json['title'] as String? ?? '',
      conclusion: json['conclusion'] as String?,
      recommendation: json['recommendation'] as String?,
      overallScore: parseInt(json['overallScore']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      itemCount: parseInt(json['itemCount']) ?? 0,
      createdByName: json['createdByName'] as String?,
      approvedByName: json['approvedByName'] as String?,
      approvedAt: parseDate(json['approvedAt']),
      occurredAt: parseDate(json['occurredAt']),
    );
  }

  /// "RPT-202608-0007 · Тоноглолын үнэлгээ" — the row's title line.
  String get titleLine =>
      type == null ? reportNumber : '$reportNumber · ${type!.label}';
}

/// Mirrors `ReportDto` — a report WITH its per-object findings.
class ReportRecordDetailModel extends ReportRecordModel {
  const ReportRecordDetailModel({
    required super.id,
    required super.reportNumber,
    required super.type,
    required super.status,
    required super.title,
    required super.conclusion,
    required super.recommendation,
    required super.overallScore,
    required super.riskLevel,
    required super.itemCount,
    required super.createdByName,
    required super.approvedByName,
    required super.approvedAt,
    required super.occurredAt,
    required this.items,
  });

  final List<ReportItemModel> items;

  factory ReportRecordDetailModel.fromJson(Map<String, dynamic> json) {
    final ReportRecordModel head = ReportRecordModel.fromJson(json);
    final Object? rawItems = json['items'];
    return ReportRecordDetailModel(
      id: head.id,
      reportNumber: head.reportNumber,
      type: head.type,
      status: head.status,
      title: head.title,
      conclusion: head.conclusion,
      recommendation: head.recommendation,
      overallScore: head.overallScore,
      riskLevel: head.riskLevel,
      itemCount: head.itemCount,
      createdByName: head.createdByName,
      approvedByName: head.approvedByName,
      approvedAt: head.approvedAt,
      occurredAt: head.occurredAt,
      items: rawItems is List
          ? rawItems
              .map(ReportItemModel.fromJson)
              .whereType<ReportItemModel>()
              .toList(growable: false)
          : const <ReportItemModel>[],
    );
  }

  /// This report's finding about ONE piece of equipment.
  ///
  /// A report covers a visit and may carry a finding for every device touched; a
  /// technician who opened it from one device's screen is asking about that device.
  /// Null when the report names the object without recording a finding for it, which the
  /// sheet reports rather than papering over with the report-level conclusion.
  ReportItemModel? itemFor(String objectId) {
    for (final ReportItemModel item in items) {
      if (item.objectId == objectId) return item;
    }
    return null;
  }
}
