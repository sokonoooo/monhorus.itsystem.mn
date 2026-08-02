import '../../../../../core/util/json_parse.dart';

/// Mirrors `DashboardSummaryDto` in
/// packages/shared/src/types/dashboard.types.ts, narrowed to the blocks the home tab
/// reads.
///
/// The backend OMITS a block the caller lacks permission for rather than zero-filling
/// it, which is the whole point of the endpoint's design: a null block here means
/// "not permitted or not reported", never "the value is zero". Every field is
/// therefore nullable and the UI must not substitute a 0 for a missing block.
class DashboardSummaryModel {
  const DashboardSummaryModel({
    required this.requests,
    required this.plannedWork,
    required this.today,
    required this.generatedAt,
  });

  final DashboardRequestSummaryModel? requests;
  final DashboardPlannedWorkSummaryModel? plannedWork;
  final DashboardTodaySummaryModel? today;
  final DateTime? generatedAt;

  factory DashboardSummaryModel.fromJson(Map<String, dynamic> json) {
    return DashboardSummaryModel(
      requests: json['requests'] is Map<String, dynamic>
          ? DashboardRequestSummaryModel.fromJson(
              json['requests']! as Map<String, dynamic>)
          : null,
      plannedWork: json['plannedWork'] is Map<String, dynamic>
          ? DashboardPlannedWorkSummaryModel.fromJson(
              json['plannedWork']! as Map<String, dynamic>)
          : null,
      today: json['today'] is Map<String, dynamic>
          ? DashboardTodaySummaryModel.fromJson(
              json['today']! as Map<String, dynamic>)
          : null,
      generatedAt: parseDate(json['generatedAt']),
    );
  }
}

/// `DashboardRequestSummary`.
class DashboardRequestSummaryModel {
  const DashboardRequestSummaryModel({
    required this.newRequests,
    required this.unassignedRequests,
    required this.urgentRequests,
    required this.slaNearBreach,
    required this.slaBreached,
    required this.inProgress,
    required this.dueToday,
    required this.completedToday,
  });

  final int newRequests;
  final int unassignedRequests;
  final int urgentRequests;
  final int slaNearBreach;
  final int slaBreached;
  final int inProgress;
  final int dueToday;
  final int completedToday;

  factory DashboardRequestSummaryModel.fromJson(Map<String, dynamic> json) {
    return DashboardRequestSummaryModel(
      newRequests: parseInt(json['newRequests']) ?? 0,
      unassignedRequests: parseInt(json['unassignedRequests']) ?? 0,
      urgentRequests: parseInt(json['urgentRequests']) ?? 0,
      slaNearBreach: parseInt(json['slaNearBreach']) ?? 0,
      slaBreached: parseInt(json['slaBreached']) ?? 0,
      inProgress: parseInt(json['inProgress']) ?? 0,
      dueToday: parseInt(json['dueToday']) ?? 0,
      completedToday: parseInt(json['completedToday']) ?? 0,
    );
  }
}

/// `DashboardPlannedWorkSummary`.
class DashboardPlannedWorkSummaryModel {
  const DashboardPlannedWorkSummaryModel({
    required this.total,
    required this.inProgress,
    required this.overdue,
    required this.completed,
    required this.averageProgress,
  });

  final int total;
  final int inProgress;
  final int overdue;
  final int completed;

  /// Quantity-weighted mean progress across non-archived work, 0-100.
  final double averageProgress;

  factory DashboardPlannedWorkSummaryModel.fromJson(Map<String, dynamic> json) {
    return DashboardPlannedWorkSummaryModel(
      total: parseInt(json['total']) ?? 0,
      inProgress: parseInt(json['inProgress']) ?? 0,
      overdue: parseInt(json['overdue']) ?? 0,
      completed: parseInt(json['completed']) ?? 0,
      averageProgress: parseDouble(json['averageProgress']) ?? 0,
    );
  }
}

/// `DashboardTodaySummary` — what still has to be done today, org-wide.
///
/// The counts are not scoped to the caller; the endpoint has no self-scoping. The
/// home screen therefore only ever labels these as organisation figures.
class DashboardTodaySummaryModel {
  const DashboardTodaySummaryModel({
    required this.date,
    required this.timezone,
    required this.dueCount,
    required this.overdueCount,
    required this.urgentCount,
    required this.unassignedCount,
    required this.completedCount,
    required this.items,
  });

  /// `YYYY-MM-DD` in the server's configured timezone.
  final String date;
  final String timezone;
  final int dueCount;
  final int overdueCount;
  final int urgentCount;
  final int unassignedCount;
  final int completedCount;
  final List<DashboardTodayItemModel> items;

  factory DashboardTodaySummaryModel.fromJson(Map<String, dynamic> json) {
    return DashboardTodaySummaryModel(
      date: parseString(json['date']) ?? '',
      timezone: parseString(json['timezone']) ?? '',
      dueCount: parseInt(json['dueCount']) ?? 0,
      overdueCount: parseInt(json['overdueCount']) ?? 0,
      urgentCount: parseInt(json['urgentCount']) ?? 0,
      unassignedCount: parseInt(json['unassignedCount']) ?? 0,
      completedCount: parseInt(json['completedCount']) ?? 0,
      items: parseList(json['items'], DashboardTodayItemModel.fromJson),
    );
  }
}

/// `DashboardTodayItem`.
class DashboardTodayItemModel {
  const DashboardTodayItemModel({
    required this.id,
    required this.kind,
    required this.reference,
    required this.title,
    required this.customerName,
    required this.locationLabel,
    required this.assigneeNames,
    required this.statusLabel,
    required this.dueAt,
    required this.isUrgent,
    required this.isOverdue,
  });

  final String id;

  /// `SERVICE_REQUEST` or `PLANNED_WORK`.
  final String kind;
  final String reference;
  final String title;
  final String? customerName;
  final String? locationLabel;
  final List<String> assigneeNames;
  final String statusLabel;
  final DateTime? dueAt;
  final bool isUrgent;
  final bool isOverdue;

  factory DashboardTodayItemModel.fromJson(Map<String, dynamic> json) {
    return DashboardTodayItemModel(
      id: parseString(json['id']) ?? '',
      kind: parseString(json['kind']) ?? '',
      reference: parseString(json['reference']) ?? '',
      title: parseString(json['title']) ?? '',
      customerName: parseString(json['customerName']),
      locationLabel: parseString(json['locationLabel']),
      assigneeNames: parseStringList(json['assigneeNames']),
      statusLabel: parseString(json['statusLabel']) ?? '',
      dueAt: parseDate(json['dueAt']),
      isUrgent: parseBool(json['isUrgent']),
      isOverdue: parseBool(json['isOverdue']),
    );
  }
}
