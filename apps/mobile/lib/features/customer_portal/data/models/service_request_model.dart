import '../../domain/entities/service_request_enums.dart';
import 'json_utils.dart';

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
    required this.requestType,
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
  final ServiceRequestType? requestType;
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
      requestType: ServiceRequestType.fromWire(json['requestType'] as String?),
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
    required super.requestType,
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
      requestType: ServiceRequestType.fromWire(json['requestType'] as String?),
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
    required this.requestType,
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
    this.isUrgent = false,
    this.attachmentIds = const <String>[],
  });

  final String customerId;
  final String? branch;
  final String? projectId;
  final String buildingId;
  final String? floorId;
  final String? roomId;
  final String? panelId;
  final String? circuitId;
  final String? deviceId;
  final ServiceRequestType requestType;
  final bool isUrgent;
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
        if (branch != null && branch!.isNotEmpty) 'branch': branch,
        if (projectId != null) 'projectId': projectId,
        'buildingId': buildingId,
        if (floorId != null) 'floorId': floorId,
        if (roomId != null) 'roomId': roomId,
        if (panelId != null) 'panelId': panelId,
        if (circuitId != null) 'circuitId': circuitId,
        if (deviceId != null) 'deviceId': deviceId,
        'requestType': requestType.wireValue,
        'isUrgent': isUrgent,
        'description': description,
        'contactName': contactName,
        'contactPhone': contactPhone,
        'attachmentIds': attachmentIds,
      };
}
