import '../../../core/util/json_parse.dart';
import '../project/data/models/object_models.dart';
import 'service_request_vocabulary.dart';

/// The fault pin's coordinate type is the object tree's own [PlanPositionModel] — the
/// same normalised pair a device's placement uses, because it is the same drawing and
/// the same arithmetic. Re-exported so a screen reading `planPosition` off a request
/// does not have to reach into the project feature's model file to name its type.
export '../project/data/models/object_models.dart' show PlanPositionModel;

/// Mirrors `ServiceRequestListItemDto` — one row of `GET /service-requests`.
///
/// Shared rather than owned by a tab, for the same reason `service_request_vocabulary
/// .dart` beside it is: the Нүүр tab reads the requests assigned to the reader and the
/// Ажил tab's "Нээлттэй" segment reads the unclaimed pool, off the same route and the
/// same DTO. It was lifted out of
/// `home/data/models/work_models.dart`, which now re-exports it so the home call sites
/// keep importing the one file they always did.
class ServiceRequestListItemModel {
  const ServiceRequestListItemModel({
    required this.id,
    required this.requestNumber,
    required this.customer,
    required this.building,
    required this.floor,
    required this.device,
    required this.requestType,
    required this.isUrgent,
    required this.status,
    required this.slaState,
    required this.slaDueAt,
    required this.slaRemainingMinutes,
    required this.assignedEmployees,
    required this.assignedTeam,
    required this.createdAt,
  });

  final String id;
  final String requestNumber;
  final NamedRef? customer;
  final NamedRef? building;
  final NamedRef? floor;
  final NamedRef? device;
  final ServiceRequestType? requestType;
  final bool isUrgent;
  final ServiceRequestStatus? status;
  final SlaState? slaState;
  final DateTime? slaDueAt;

  /// Backend-computed. Negative means the deadline has passed.
  final int? slaRemainingMinutes;

  final List<NamedRef> assignedEmployees;

  /// The team the request is on, or null. Carried because it is half of the server's
  /// own definition of "unclaimed" — see [isUnclaimed] — and the DTO has always sent
  /// it; the app simply threw it away.
  final NamedRef? assignedTeam;

  final DateTime? createdAt;

  factory ServiceRequestListItemModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestListItemModel(
      id: parseString(json['id']) ?? '',
      requestNumber: parseString(json['requestNumber']) ?? '',
      customer: NamedRef.fromJson(json['customer']),
      building: NamedRef.fromJson(json['building']),
      floor: NamedRef.fromJson(json['floor']),
      device: NamedRef.fromJson(json['device']),
      requestType: ServiceRequestType.fromWire(parseString(json['requestType'])),
      isUrgent: parseBool(json['isUrgent']),
      status: ServiceRequestStatus.fromWire(parseString(json['status'])),
      slaState: SlaState.fromWire(parseString(json['slaState'])),
      slaDueAt: parseDate(json['slaDueAt']),
      slaRemainingMinutes: parseInt(json['slaRemainingMinutes']),
      assignedEmployees: NamedRef.listFrom(json['assignedEmployees']),
      assignedTeam: NamedRef.fromJson(json['assignedTeam']),
      createdAt: parseDate(json['createdAt']),
    );
  }

  /// What a list card calls this request.
  ///
  /// `ServiceRequestListItemDto` carries no `description` — only the detail DTO does,
  /// and fetching a detail per row would be a request per card. The device is the
  /// most specific thing on the list row; failing that, the request type says what
  /// kind of job it is. The request number is never used, because it is already
  /// printed on its own mono line and a card titled with its own reference says
  /// nothing twice.
  String get subjectLabel {
    final NamedRef? target = device;
    if (target != null && target.name.isNotEmpty) return target.name;
    return requestType?.label ?? 'Үйлчилгээний хүсэлт';
  }

  String get locationLabel => <String>[
        if (customer != null && customer!.name.isNotEmpty) customer!.name,
        if (building != null && building!.name.isNotEmpty) building!.name,
        if (floor != null && floor!.name.isNotEmpty) floor!.name,
      ].join(' · ');

  /// Nobody holds this request: no employee named AND no team.
  ///
  /// The server's own definition, verbatim — the `includeUnclaimed` branch of
  /// `resolveAssignedWorkFilter` in
  /// apps/backend/src/modules/planned-work/planned-work.scope.ts is
  /// `{ assignedEmployees: { $size: 0 }, assignedTeam: null }`. BOTH halves matter: a
  /// request carrying only a team is somebody's work even though it names nobody, and
  /// treating an empty `assignedEmployees` alone as "unclaimed" would push every
  /// team-assigned job back into the open pool.
  ///
  /// This is the branch that makes `GET /service-requests` answer a technician with
  /// rows that are not theirs — deliberately, because the "Нээлттэй" segment and
  /// `POST /:id/claim` are built on it — so the "Хүсэлт" segment, which lists only the
  /// reader's own, has to subtract it again.
  bool get isUnclaimed => assignedEmployees.isEmpty && assignedTeam == null;

  /// Whether this row is the reader's own work.
  ///
  /// The same union the server bounds the list with: named individually, OR carried by
  /// the reader's team. Testing the employee id alone would drop every request assigned
  /// to the team without naming anybody — the exact mistake the `employeeId` query
  /// filter used to make on `/planned-work`, which is why that filter is gone.
  ///
  /// Both comparisons guard the empty string as well as null, because two empty ids
  /// matching would claim every row with an unpopulated relation.
  bool isAssignedTo({required String? employeeId, String? teamId}) {
    if (employeeId != null &&
        employeeId.isNotEmpty &&
        assignedEmployees.any((NamedRef employee) => employee.id == employeeId)) {
      return true;
    }
    final String? team = assignedTeam?.id;
    return teamId != null &&
        teamId.isNotEmpty &&
        team != null &&
        team == teamId;
  }

  /// Urgent, or the backend says the SLA is in danger or already missed.
  bool get needsAttention =>
      (status?.isOutstanding ?? false) &&
      (isUrgent || (slaState?.needsAttention ?? false));
}

/// One file hung off a request — `ServiceRequestAttachmentDto`.
///
/// `downloadUrl` is carried but deliberately NOT used to load the bytes: it is
/// `/api/v1/files/:id` on the server, and that route still demands the Bearer header,
/// so handing it to `Image.network` answers 401 rather than an image. [id] is what the
/// app fetches with, through the authenticated client. See `workFileBytesProvider`.
class ServiceRequestAttachmentModel {
  const ServiceRequestAttachmentModel({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
  });

  final String id;
  final String name;
  final String mimeType;
  final int? sizeBytes;

  /// Whether this attachment is something a screen can draw.
  ///
  /// The customer who raised the request may attach anything the intake form accepts,
  /// so a PDF has to be listed rather than pushed through an image decoder.
  bool get isImage => mimeType.startsWith('image/');

  factory ServiceRequestAttachmentModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestAttachmentModel(
      id: parseString(json['id']) ?? '',
      name: parseString(json['name']) ?? '',
      mimeType: parseString(json['mimeType']) ?? '',
      sizeBytes: parseInt(json['sizeBytes']),
    );
  }
}

/// Mirrors `ServiceRequestDetailDto` — the answer to `GET /service-requests/:id`.
///
/// It exists because [ServiceRequestListItemModel] cannot answer the question a
/// technician opens a request to ask. The list DTO carries no `description`, no
/// `contactName`/`contactPhone` and no `attachments`; those four fields are only on the
/// detail DTO, so a screen rendered purely from a list row can show the location and
/// nothing else — which is exactly what the detail screen used to do.
///
/// Only the fields a field employee acts on are transcribed. `statusHistory`,
/// `slaExtensionReason`, `parentRequestId` and the rest of the DTO are real and are
/// simply not read here; adding one is a parse line, not a backend change.
class ServiceRequestDetailModel {
  const ServiceRequestDetailModel({
    required this.id,
    required this.requestNumber,
    required this.customer,
    required this.project,
    required this.building,
    required this.floor,
    required this.room,
    required this.device,
    required this.panel,
    required this.circuit,
    required this.branch,
    required this.requestType,
    required this.isUrgent,
    required this.status,
    required this.slaState,
    required this.slaDueAt,
    required this.slaRemainingMinutes,
    required this.assignedEmployees,
    required this.assignedTeam,
    required this.createdAt,
    required this.description,
    required this.contactName,
    required this.contactPhone,
    required this.attachments,
    required this.locationPath,
    required this.planPosition,
  });

  final String id;
  final String requestNumber;
  final NamedRef? customer;
  final NamedRef? project;
  final NamedRef? building;
  final NamedRef? floor;
  final NamedRef? room;
  final NamedRef? device;
  final NamedRef? panel;
  final NamedRef? circuit;
  final String? branch;
  final ServiceRequestType? requestType;
  final bool isUrgent;
  final ServiceRequestStatus? status;
  final SlaState? slaState;
  final DateTime? slaDueAt;
  final int? slaRemainingMinutes;
  final List<NamedRef> assignedEmployees;
  final NamedRef? assignedTeam;
  final DateTime? createdAt;

  /// The fault, in the reporter's own words. The single most useful sentence on the
  /// screen and the one the list row could never carry.
  final String description;

  final String contactName;
  final String contactPhone;
  final List<ServiceRequestAttachmentModel> attachments;

  /// `locationPath` — the server's own breadcrumb, root first. Names only: the screen
  /// prints the trail, it does not navigate it.
  final List<String> locationPath;

  /// Where on [floor]'s plan the reporter said the fault is, or null when they marked
  /// nothing.
  ///
  /// A fraction of the drawing's width and height, so the mark survives the plan being
  /// re-imported at another resolution. It is the ONE fact on this record that a
  /// sentence cannot carry: "3-р давхар" names a floor, not the panel at the far end of
  /// the corridor, and the technician walking in is the person who needs the
  /// difference. Read-only in this app — placing the pin is the customer's act, on the
  /// intake form.
  final PlanPositionModel? planPosition;

  factory ServiceRequestDetailModel.fromJson(Map<String, dynamic> json) {
    return ServiceRequestDetailModel(
      id: parseString(json['id']) ?? '',
      requestNumber: parseString(json['requestNumber']) ?? '',
      customer: NamedRef.fromJson(json['customer']),
      project: NamedRef.fromJson(json['project']),
      building: NamedRef.fromJson(json['building']),
      floor: NamedRef.fromJson(json['floor']),
      room: NamedRef.fromJson(json['room']),
      device: NamedRef.fromJson(json['device']),
      panel: NamedRef.fromJson(json['panel']),
      circuit: NamedRef.fromJson(json['circuit']),
      branch: parseString(json['branch']),
      requestType: ServiceRequestType.fromWire(parseString(json['requestType'])),
      isUrgent: parseBool(json['isUrgent']),
      status: ServiceRequestStatus.fromWire(parseString(json['status'])),
      slaState: SlaState.fromWire(parseString(json['slaState'])),
      slaDueAt: parseDate(json['slaDueAt']),
      slaRemainingMinutes: parseInt(json['slaRemainingMinutes']),
      assignedEmployees: NamedRef.listFrom(json['assignedEmployees']),
      assignedTeam: NamedRef.fromJson(json['assignedTeam']),
      createdAt: parseDate(json['createdAt']),
      description: parseString(json['description']) ?? '',
      contactName: parseString(json['contactName']) ?? '',
      contactPhone: parseString(json['contactPhone']) ?? '',
      attachments: parseList(
        json['attachments'],
        ServiceRequestAttachmentModel.fromJson,
      ),
      locationPath: _breadcrumbNames(json['locationPath']),
      // Null for a malformed or out-of-range coordinate rather than a throw — see
      // [PlanPositionModel.fromJson]. The request then reads as "no pin", which is the
      // truthful state; a corrupt pair must not cost the whole record.
      planPosition: PlanPositionModel.fromJson(json['planPosition']),
    );
  }

  /// The full location, most general first.
  ///
  /// Built from the server's breadcrumb when it sent one, because that trail is the
  /// object tree's own answer and already contains every level that exists. The
  /// relation fields are the fallback, so a request whose breadcrumb could not be
  /// resolved still names where it is rather than printing a dash.
  String get locationLabel {
    if (locationPath.isNotEmpty) {
      return <String>[
        if (customer != null && customer!.name.isNotEmpty) customer!.name,
        ...locationPath,
      ].join(' · ');
    }
    return <String>[
      for (final NamedRef? ref in <NamedRef?>[
        customer,
        project,
        building,
        floor,
        room,
        device,
      ])
        if (ref != null && ref.name.isNotEmpty) ref.name,
    ].join(' · ');
  }

  /// The heading, chosen the same way a list card chooses one, so the title does not
  /// change under the reader when the fetch lands.
  String get subjectLabel {
    final NamedRef? target = device;
    if (target != null && target.name.isNotEmpty) return target.name;
    return requestType?.label ?? 'Үйлчилгээний хүсэлт';
  }

  /// Nobody holds this request. The server's own definition, both halves of it — see
  /// [ServiceRequestListItemModel.isUnclaimed].
  bool get isUnclaimed => assignedEmployees.isEmpty && assignedTeam == null;

  /// Whether this request is the reader's own work.
  ///
  /// The same union the server bounds a write with: named individually, OR carried by the
  /// reader's team. The detail screen needs it for the reason the list does not — the
  /// status control and the approve action are both assignment-scoped server-side, and a
  /// control that can only ever answer 403 is worse than one that is absent with a reason
  /// printed beside it.
  ///
  /// Both comparisons guard the empty string as well as null, because two empty ids
  /// matching would claim every record with an unpopulated relation.
  bool isAssignedTo({required String? employeeId, String? teamId}) {
    if (employeeId != null &&
        employeeId.isNotEmpty &&
        assignedEmployees.any((NamedRef employee) => employee.id == employeeId)) {
      return true;
    }
    final String? team = assignedTeam?.id;
    return teamId != null && teamId.isNotEmpty && team != null && team == teamId;
  }

  /// The attachments a screen can actually draw.
  List<ServiceRequestAttachmentModel> get images =>
      attachments.where((ServiceRequestAttachmentModel a) => a.isImage).toList(
            growable: false,
          );

  /// The attachments that are not images, listed by name instead.
  List<ServiceRequestAttachmentModel> get documents =>
      attachments.where((ServiceRequestAttachmentModel a) => !a.isImage).toList(
            growable: false,
          );

  static List<String> _breadcrumbNames(Object? raw) {
    if (raw is! List) return const <String>[];
    return raw
        .whereType<Map<String, dynamic>>()
        .map((Map<String, dynamic> node) => parseString(node['name']))
        .whereType<String>()
        .toList(growable: false);
  }
}
