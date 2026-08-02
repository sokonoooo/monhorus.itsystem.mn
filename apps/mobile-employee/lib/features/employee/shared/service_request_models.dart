import '../../../core/util/json_parse.dart';
import 'service_request_vocabulary.dart';

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

  /// Urgent, or the backend says the SLA is in danger or already missed.
  bool get needsAttention =>
      (status?.isOutstanding ?? false) &&
      (isUrgent || (slaState?.needsAttention ?? false));
}
