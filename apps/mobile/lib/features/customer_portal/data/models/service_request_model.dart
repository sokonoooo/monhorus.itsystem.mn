import '../../domain/entities/risk_level.dart';
import '../../domain/entities/service_request_enums.dart';
import 'json_utils.dart';
import 'object_master_model.dart';

/// Every model in this file is a hand-written mirror of a TypeScript type in
/// packages/shared. Dart cannot import that package, so the pairing is recorded in a
/// comment above each class and the two must be checked against each other by hand
/// whenever the shared type changes.

/// Mirrors the inline `{ id: string; name: string } | null` location and team
/// references on `ServiceRequestListItemDto`
/// (packages/shared/src/types/service-request.types.ts).
///
/// The backend's `ref()` helper returns null whenever a relation was not populated,
/// so every one of these is nullable at the call site even where the database column
/// is required.
class ObjectRefModel {
  const ObjectRefModel({required this.id, required this.name});

  final String id;
  final String name;

  static ObjectRefModel? fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return null;
    final Object? id = json['id'];
    if (id is! String) return null;
    return ObjectRefModel(id: id, name: json['name'] as String? ?? '');
  }
}

/// Mirrors `EmployeeRefDto` in packages/shared/src/types/employee.types.ts.
class EmployeeRefModel {
  const EmployeeRefModel({
    required this.id,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
    required this.photoUrl,
  });

  final String id;
  final String employeeCode;
  final String firstName;
  final String lastName;
  final String? photoUrl;

  factory EmployeeRefModel.fromJson(Map<String, dynamic> json) {
    return EmployeeRefModel(
      id: json['id'] as String,
      employeeCode: json['employeeCode'] as String? ?? '',
      firstName: json['firstName'] as String? ?? '',
      lastName: json['lastName'] as String? ?? '',
      photoUrl: json['photoUrl'] as String?,
    );
  }

  /// Mongolian convention: surname initial, then given name.
  String get displayName {
    if (lastName.isEmpty) return firstName;
    return '${lastName.substring(0, 1).toUpperCase()}. $firstName'.trim();
  }
}

/// Mirrors `ObjectBreadcrumbDto` in packages/shared/src/types/object.types.ts.
class ObjectBreadcrumbModel {
  const ObjectBreadcrumbModel({
    required this.id,
    required this.kind,
    required this.name,
  });

  final String id;
  final ObjectNodeKind? kind;
  final String name;

  factory ObjectBreadcrumbModel.fromJson(Map<String, dynamic> json) {
    return ObjectBreadcrumbModel(
      id: json['id'] as String,
      kind: ObjectNodeKind.fromWire(json['kind'] as String?),
      name: json['name'] as String? ?? '',
    );
  }
}

/// Mirrors `ServiceRequestAttachmentDto` in
/// packages/shared/src/types/service-request.types.ts.
///
/// [downloadUrl] is a path on the API, not an absolute URL, and the endpoint behind
/// it requires the Bearer header - it cannot be handed to a plain `Image.network`.
class ServiceRequestAttachmentModel {
  const ServiceRequestAttachmentModel({
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

  factory ServiceRequestAttachmentModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestAttachmentModel(
      id: json['id'] as String,
      name: json['name'] as String? ?? '',
      downloadUrl: json['downloadUrl'] as String? ?? '',
      mimeType: json['mimeType'] as String? ?? '',
      sizeBytes: (json['sizeBytes'] as num?)?.toInt() ?? 0,
      uploadedByName: json['uploadedByName'] as String?,
      uploadedAt: parseDate(json['uploadedAt']),
    );
  }

  bool get isImage => mimeType.startsWith('image/');
}

/// `WorkReportPhotoDto` in packages/shared/src/types/work-report.types.ts is
/// field-for-field the same shape as `ServiceRequestAttachmentDto` — id, name,
/// downloadUrl, mimeType, sizeBytes, uploadedByName, uploadedAt — so it is parsed by
/// the same model rather than by a second copy of it that could drift.
typedef WorkReportPhotoModel = ServiceRequestAttachmentModel;

/// Mirrors `ServiceRequestStatusHistoryDto` in
/// packages/shared/src/types/service-request.types.ts.
///
/// The backend deliberately withholds `changedBy`; only `changedByName` is exposed.
/// Present on the detail response only, and already sorted newest first.
class ServiceRequestStatusHistoryModel {
  const ServiceRequestStatusHistoryModel({
    required this.id,
    required this.fromStatus,
    required this.toStatus,
    required this.reason,
    required this.changedByName,
    required this.changedAt,
  });

  final String id;
  final ServiceRequestStatus? fromStatus;
  final ServiceRequestStatus? toStatus;
  final String? reason;
  final String? changedByName;
  final DateTime? changedAt;

  factory ServiceRequestStatusHistoryModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestStatusHistoryModel(
      id: json['id'] as String,
      fromStatus: ServiceRequestStatus.fromWire(json['fromStatus'] as String?),
      toStatus: ServiceRequestStatus.fromWire(json['toStatus'] as String?),
      reason: json['reason'] as String?,
      changedByName: json['changedByName'] as String?,
      changedAt: parseDate(json['changedAt']),
    );
  }
}

/// Mirrors `ServiceRequestListItemDto` in
/// packages/shared/src/types/service-request.types.ts.
///
/// There is no priority field on this API. Urgency is the boolean [isUrgent]; the
/// prototype's three-level "Яаралтай байдал" chooser has no counterpart in the
/// contract, so it is not modelled here.
class ServiceRequestListItemModel {
  const ServiceRequestListItemModel({
    required this.id,
    required this.requestNumber,
    required this.customer,
    required this.project,
    required this.building,
    required this.floor,
    required this.room,
    required this.device,
    required this.isUrgent,
    required this.status,
    required this.assignedEmployees,
    required this.assignedTeam,
    required this.createdAt,
    required this.slaDueAt,
    required this.slaState,
    required this.slaRemainingMinutes,
  });

  final String id;
  final String requestNumber;
  final ObjectRefModel? customer;
  final ObjectRefModel? project;
  final ObjectRefModel? building;
  final ObjectRefModel? floor;
  final ObjectRefModel? room;
  final ObjectRefModel? device;
  final bool isUrgent;
  final ServiceRequestStatus? status;
  final List<EmployeeRefModel> assignedEmployees;
  final ObjectRefModel? assignedTeam;
  final DateTime? createdAt;

  /// Typed `string | null` in the shared DTO even though the document always carries
  /// one, so it stays nullable here to match the declared contract.
  final DateTime? slaDueAt;
  final SlaState? slaState;

  /// Genuinely null for a cancelled request. Negative means the window is overdue.
  final int? slaRemainingMinutes;

  factory ServiceRequestListItemModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestListItemModel(
      id: json['id'] as String,
      requestNumber: json['requestNumber'] as String? ?? '',
      customer: ObjectRefModel.fromJson(json['customer']),
      project: ObjectRefModel.fromJson(json['project']),
      building: ObjectRefModel.fromJson(json['building']),
      floor: ObjectRefModel.fromJson(json['floor']),
      room: ObjectRefModel.fromJson(json['room']),
      device: ObjectRefModel.fromJson(json['device']),
      isUrgent: json['isUrgent'] as bool? ?? false,
      status: ServiceRequestStatus.fromWire(json['status'] as String?),
      assignedEmployees: parseList(json['assignedEmployees'], EmployeeRefModel.fromJson),
      assignedTeam: ObjectRefModel.fromJson(json['assignedTeam']),
      createdAt: parseDate(json['createdAt']),
      slaDueAt: parseDate(json['slaDueAt']),
      slaState: SlaState.fromWire(json['slaState'] as String?),
      slaRemainingMinutes: (json['slaRemainingMinutes'] as num?)?.toInt(),
    );
  }

  /// "Main Tower · 2-р давхар" - the location line under a request title.
  String get locationLine {
    final List<String> parts = <String>[
      if (building != null) building!.name,
      if (floor != null) floor!.name,
      if (room != null) room!.name,
    ];
    return parts.join(' · ');
  }

  String get assigneeLine {
    if (assignedEmployees.isEmpty) {
      return assignedTeam?.name ?? 'Ажилтан хуваарилагдаагүй';
    }
    return assignedEmployees
        .map((EmployeeRefModel employee) => employee.displayName)
        .join(', ');
  }
}

/// Mirrors `ServiceRequestDetailDto` in
/// packages/shared/src/types/service-request.types.ts, which extends the list item.
class ServiceRequestDetailModel extends ServiceRequestListItemModel {
  const ServiceRequestDetailModel({
    required super.id,
    required super.requestNumber,
    required super.customer,
    required super.project,
    required super.building,
    required super.floor,
    required super.room,
    required super.device,
    required super.isUrgent,
    required super.status,
    required super.assignedEmployees,
    required super.assignedTeam,
    required super.createdAt,
    required super.slaDueAt,
    required super.slaState,
    required super.slaRemainingMinutes,
    required this.panel,
    required this.circuit,
    required this.branch,
    required this.description,
    required this.contactName,
    required this.contactPhone,
    required this.attachments,
    required this.statusHistory,
    required this.locationPath,
    required this.teamLeaderEmployeeId,
    required this.slaStartedAt,
    required this.slaExtendedMinutes,
    required this.slaExtensionReason,
    required this.revisitReason,
    required this.revisitDueAt,
    required this.parentRequestId,
    required this.createdByName,
    required this.updatedAt,
    required this.hasApprovedReport,
  });

  final ObjectRefModel? panel;
  final ObjectRefModel? circuit;
  final String? branch;
  final String description;
  final String contactName;
  final String contactPhone;
  final List<ServiceRequestAttachmentModel> attachments;
  final List<ServiceRequestStatusHistoryModel> statusHistory;
  final List<ObjectBreadcrumbModel> locationPath;
  final String? teamLeaderEmployeeId;
  final DateTime? slaStartedAt;
  final int slaExtendedMinutes;
  final String? slaExtensionReason;
  final String? revisitReason;
  final DateTime? revisitDueAt;
  final String? parentRequestId;
  final String? createdByName;
  final DateTime? updatedAt;

  /// Whether `GET /service-requests/:id/report/customer` would answer with a
  /// conclusion rather than a 404.
  ///
  /// The server computes it, and it is true only for a report the office has
  /// APPROVED — a draft, a submission and a returned report are all false, exactly as
  /// the report endpoint treats them. Read before that endpoint is called so the
  /// report tab does not fire a request it already knows will 404.
  ///
  /// Optional in `ServiceRequestDetailDto`, so an older server that does not send it
  /// reads false: the tab then says the conclusion is not ready, which is the honest
  /// answer when nothing said otherwise.
  final bool hasApprovedReport;

  factory ServiceRequestDetailModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestDetailModel(
      id: json['id'] as String,
      requestNumber: json['requestNumber'] as String? ?? '',
      customer: ObjectRefModel.fromJson(json['customer']),
      project: ObjectRefModel.fromJson(json['project']),
      building: ObjectRefModel.fromJson(json['building']),
      floor: ObjectRefModel.fromJson(json['floor']),
      room: ObjectRefModel.fromJson(json['room']),
      device: ObjectRefModel.fromJson(json['device']),
      isUrgent: json['isUrgent'] as bool? ?? false,
      status: ServiceRequestStatus.fromWire(json['status'] as String?),
      assignedEmployees: parseList(json['assignedEmployees'], EmployeeRefModel.fromJson),
      assignedTeam: ObjectRefModel.fromJson(json['assignedTeam']),
      createdAt: parseDate(json['createdAt']),
      slaDueAt: parseDate(json['slaDueAt']),
      slaState: SlaState.fromWire(json['slaState'] as String?),
      slaRemainingMinutes: (json['slaRemainingMinutes'] as num?)?.toInt(),
      panel: ObjectRefModel.fromJson(json['panel']),
      circuit: ObjectRefModel.fromJson(json['circuit']),
      branch: json['branch'] as String?,
      description: json['description'] as String? ?? '',
      contactName: json['contactName'] as String? ?? '',
      contactPhone: json['contactPhone'] as String? ?? '',
      attachments:
          parseList(json['attachments'], ServiceRequestAttachmentModel.fromJson),
      statusHistory:
          parseList(json['statusHistory'], ServiceRequestStatusHistoryModel.fromJson),
      locationPath: parseList(json['locationPath'], ObjectBreadcrumbModel.fromJson),
      teamLeaderEmployeeId: json['teamLeaderEmployeeId'] as String?,
      slaStartedAt: parseDate(json['slaStartedAt']),
      slaExtendedMinutes: (json['slaExtendedMinutes'] as num?)?.toInt() ?? 0,
      slaExtensionReason: json['slaExtensionReason'] as String?,
      revisitReason: json['revisitReason'] as String?,
      revisitDueAt: parseDate(json['revisitDueAt']),
      parentRequestId: json['parentRequestId'] as String?,
      createdByName: json['createdByName'] as String?,
      updatedAt: parseDate(json['updatedAt']),
      hasApprovedReport: json['hasApprovedReport'] as bool? ?? false,
    );
  }
}

/// Mirrors `CustomerWorkReportDto` in
/// packages/shared/src/types/work-report.types.ts — the eleven fields the backend
/// writes out by hand for a customer, and not one field of the staff `WorkReportDto`
/// more.
///
/// Only ever obtained for an APPROVED report: `getCustomerWorkReport` answers 404 for
/// a draft, a submission, a returned report and a request belonging to somebody else,
/// so the presence of this object is itself the statement that a technician's
/// conclusion has been approved.
class CustomerWorkReportModel {
  const CustomerWorkReportModel({
    required this.conclusion,
    required this.recommendation,
    required this.score,
    required this.riskLevel,
    required this.repairRequired,
    required this.revisitRequired,
    required this.revisitDate,
    required this.beforePhotos,
    required this.afterPhotos,
    required this.approvedAt,
    required this.approvedByName,
  });

  final String? conclusion;
  final String? recommendation;

  /// 0-100, or null when the technician recorded no score. Never rendered as a zero.
  final int? score;

  /// The band the server derived from [score] against the thresholds in force. Never
  /// derived on the device; see [RiskLevel.fromScore].
  final RiskLevel? riskLevel;

  final bool repairRequired;
  final bool revisitRequired;
  final DateTime? revisitDate;

  final List<WorkReportPhotoModel> beforePhotos;
  final List<WorkReportPhotoModel> afterPhotos;

  final DateTime? approvedAt;
  final String? approvedByName;

  factory CustomerWorkReportModel.fromJson(Map<String, dynamic> json) {
    return CustomerWorkReportModel(
      conclusion: json['conclusion'] as String?,
      recommendation: json['recommendation'] as String?,
      score: (json['score'] as num?)?.toInt(),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      repairRequired: json['repairRequired'] as bool? ?? false,
      revisitRequired: json['revisitRequired'] as bool? ?? false,
      revisitDate: parseDate(json['revisitDate']),
      beforePhotos:
          parseList(json['beforePhotos'], ServiceRequestAttachmentModel.fromJson),
      afterPhotos:
          parseList(json['afterPhotos'], ServiceRequestAttachmentModel.fromJson),
      approvedAt: parseDate(json['approvedAt']),
      approvedByName: json['approvedByName'] as String?,
    );
  }
}

/// Mirrors `CreateServiceRequestRequest` in
/// packages/shared/src/types/service-request.types.ts and the Zod schema
/// `createServiceRequestSchema` in
/// packages/shared/src/schemas/service-request.schema.ts.
///
/// The Zod schema is stricter than the TypeScript type in three places the form has
/// to respect: `description` is 5 to 4000 characters, `contactName` 1 to 200, and
/// `contactPhone` must match `/^(\+976)?[- ]?\d{4}[- ]?\d{4}$/`.
class CreateServiceRequestRequestModel {
  const CreateServiceRequestRequestModel({
    required this.customerId,
    required this.buildingId,
    required this.objectTypeId,
    required this.description,
    required this.contactName,
    required this.contactPhone,
    this.branch,
    this.projectId,
    this.floorId,
    this.roomId,
    this.panelId,
    this.circuitId,
    this.deviceId,
    this.planPosition,
    this.attachmentIds = const <String>[],
  });

  final String customerId;

  /// The equipment type this call is about. The server takes the SLA window from it, and
  /// refuses a type that may not be called about, so this is required rather than nullable:
  /// a nullable field here would only move that refusal to runtime.
  final String objectTypeId;
  final String? branch;
  final String? projectId;
  final String buildingId;
  final String? floorId;
  final String? roomId;
  final String? panelId;
  final String? circuitId;

  /// An `ObjectNode` of kind DEVICE, NOT an entry in the object-master register.
  ///
  /// The two are different collections and `validateLocationChain` resolves this one
  /// with `ObjectNode.findById`, so a master-register id here is refused outright with
  /// `Төхөөрөмж олдсонгүй.` and a 400. Nothing in the customer app has a node id of
  /// that kind to give — every device screen here is built on the master register —
  /// so no flow in this app populates the field; see [CreateRequestSheet].
  final String? deviceId;

  /// Where on the floor's plan the customer says the fault is, as a fraction of the
  /// drawing's width and height.
  ///
  /// `createServiceRequestSchema` refuses a pin that names no floor, so this is only
  /// ever sent alongside [floorId]. Independent of [roomId]: pointing at the spot and
  /// naming a zone are two different statements and either may be made alone.
  final PlanPositionModel? planPosition;
  final String description;
  final String contactName;
  final String contactPhone;
  final List<String> attachmentIds;

  /// Minimum description length enforced by `createServiceRequestSchema`.
  static const int descriptionMinLength = 5;
  static const int descriptionMaxLength = 4000;

  /// `phoneSchema` in packages/shared/src/schemas/common.schema.ts.
  static final RegExp phonePattern =
      RegExp(r'^(\+976)?[- ]?\d{4}[- ]?\d{4}$');

  Map<String, dynamic> toJson() => <String, dynamic>{
        'customerId': customerId,
        'objectTypeId': objectTypeId,
        if (branch != null && branch!.isNotEmpty) 'branch': branch,
        if (projectId != null) 'projectId': projectId,
        'buildingId': buildingId,
        if (floorId != null) 'floorId': floorId,
        if (roomId != null) 'roomId': roomId,
        if (panelId != null) 'panelId': panelId,
        if (circuitId != null) 'circuitId': circuitId,
        if (deviceId != null) 'deviceId': deviceId,
        if (planPosition != null) 'planPosition': planPosition!.toJson(),
        'description': description,
        'contactName': contactName,
        'contactPhone': contactPhone,
        'attachmentIds': attachmentIds,
      };
}

/// One option in the call form's equipment-type picker.
///
/// Mirrors `CallableObjectTypeDto`: a label, a value, and the SLA window the choice
/// implies. Deliberately NOT `ObjectTypeRefModel`, which is the reference embedded on an
/// object row - that carries a code and an icon and no window, and answers a different
/// question.
class CallableObjectTypeModel {
  const CallableObjectTypeModel({
    required this.id,
    required this.name,
    required this.callSlaHours,
  });

  factory CallableObjectTypeModel.fromJson(Map<String, dynamic> json) {
    return CallableObjectTypeModel(
      id: json['id'] as String,
      name: json['name'] as String,
      callSlaHours: (json['callSlaHours'] as num).toInt(),
    );
  }

  final String id;
  final String name;

  /// Hours. The deadline this call will be given, and worth showing beside the name so the
  /// choice is not made blind.
  final int callSlaHours;
}
