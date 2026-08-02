import '../../domain/entities/work_enums.dart';
import '../../../../../core/util/json_parse.dart';

export '../../../shared/service_request_models.dart';

/// The three work records the home tab reads, each narrowed to the fields the
/// dashboard actually renders. The Ажил tab owns the full detail DTOs.
///
/// `ServiceRequestListItemModel` is one of the three but is no longer declared here:
/// the Ажил tab's "Нээлттэй" segment lists the unclaimed pool off the same route and
/// the same DTO, and a feature must not import across a sibling feature. It now lives
/// in `features/employee/shared/service_request_models.dart` and is re-exported above,
/// so the home call sites keep importing this one file.

/// Mirrors `PlannedWorkListItemDto`.
class PlannedWorkListItemModel {
  const PlannedWorkListItemModel({
    required this.id,
    required this.workNumber,
    required this.title,
    required this.customer,
    required this.project,
    required this.building,
    required this.effectiveStatus,
    required this.plannedStartDate,
    required this.plannedEndDate,
    required this.actualEndDate,
    required this.progressPercent,
    required this.taskCount,
    required this.completedQuantity,
    required this.totalQuantity,
    required this.assignedEmployees,
    required this.assignedTeam,
  });

  final String id;
  final String workNumber;
  final String title;
  final NamedRef? customer;
  final NamedRef? project;
  final NamedRef? building;

  /// The backend's authoritative status, including the derived OVERDUE. Null when a
  /// newer API version reports a value this build does not know.
  final PlannedWorkStatus? effectiveStatus;

  final DateTime? plannedStartDate;
  final DateTime? plannedEndDate;
  final DateTime? actualEndDate;

  /// 0-100, computed by the backend from recorded quantity.
  final double progressPercent;

  final int taskCount;
  final double completedQuantity;
  final double totalQuantity;
  final List<NamedRef> assignedEmployees;
  final NamedRef? assignedTeam;

  factory PlannedWorkListItemModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkListItemModel(
      id: parseString(json['id']) ?? '',
      workNumber: parseString(json['workNumber']) ?? '',
      title: parseString(json['title']) ?? '',
      customer: NamedRef.fromJson(json['customer']),
      project: NamedRef.fromJson(json['project']),
      building: NamedRef.fromJson(json['building']),
      effectiveStatus:
          PlannedWorkStatus.fromWire(parseString(json['effectiveStatus'])),
      plannedStartDate: parseDate(json['plannedStartDate']),
      plannedEndDate: parseDate(json['plannedEndDate']),
      actualEndDate: parseDate(json['actualEndDate']),
      progressPercent: parseDouble(json['progressPercent']) ?? 0,
      taskCount: parseInt(json['taskCount']) ?? 0,
      completedQuantity: parseDouble(json['completedQuantity']) ?? 0,
      totalQuantity: parseDouble(json['totalQuantity']) ?? 0,
      assignedEmployees: NamedRef.listFrom(json['assignedEmployees']),
      assignedTeam: NamedRef.fromJson(json['assignedTeam']),
    );
  }

  /// `Central Tower ХХК · Төв байр`, skipping whichever part the API left null.
  String get locationLabel => <String>[
        if (customer != null && customer!.name.isNotEmpty) customer!.name,
        if (building != null && building!.name.isNotEmpty) building!.name,
      ].join(' · ');
}

/// Mirrors `CalendarEventDto` — one entry of the unified day feed.
class CalendarEventModel {
  const CalendarEventModel({
    required this.id,
    required this.source,
    required this.sourceId,
    required this.reference,
    required this.title,
    required this.start,
    required this.end,
    required this.statusLabel,
    required this.isOverdue,
    required this.isUrgent,
    required this.customerName,
    required this.buildingName,
    required this.assignedNames,
    required this.progressPercent,
  });

  final String id;
  final CalendarSource? source;
  final String sourceId;
  final String reference;
  final String title;
  final DateTime? start;

  /// For a request this is the SLA deadline, not a finish time.
  final DateTime? end;

  final String statusLabel;
  final bool isOverdue;
  final bool isUrgent;
  final String? customerName;
  final String? buildingName;
  final List<String> assignedNames;

  /// Null for sources that do not track quantity, which is every service request.
  final double? progressPercent;

  factory CalendarEventModel.fromJson(Map<String, dynamic> json) {
    return CalendarEventModel(
      id: parseString(json['id']) ?? '',
      source: CalendarSource.fromWire(parseString(json['source'])),
      sourceId: parseString(json['sourceId']) ?? '',
      reference: parseString(json['reference']) ?? '',
      title: parseString(json['title']) ?? '',
      start: parseDate(json['start']),
      end: parseDate(json['end']),
      statusLabel: parseString(json['statusLabel']) ?? '',
      isOverdue: parseBool(json['isOverdue']),
      isUrgent: parseBool(json['isUrgent']),
      customerName: parseString(json['customerName']),
      buildingName: parseString(json['buildingName']),
      assignedNames: parseStringList(json['assignedNames']),
      progressPercent: parseDouble(json['progressPercent']),
    );
  }

  String get locationLabel => <String>[
        if (customerName != null) customerName!,
        if (buildingName != null) buildingName!,
      ].join(' · ');
}

/// Mirrors `CalendarResultDto`.
class CalendarResultModel {
  const CalendarResultModel({required this.timezone, required this.events});

  final String timezone;
  final List<CalendarEventModel> events;

  factory CalendarResultModel.fromJson(Map<String, dynamic> json) {
    return CalendarResultModel(
      timezone: parseString(json['timezone']) ?? '',
      events: parseList(json['events'], CalendarEventModel.fromJson),
    );
  }
}
