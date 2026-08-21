import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../data/datasources/home_remote_data_source.dart';
import '../../data/models/dashboard_summary_model.dart';
import '../../data/models/employee_model.dart';
import '../../data/models/notification_model.dart';
import '../../data/models/work_models.dart';
import '../../../identity/employee_self.dart';
import '../../../identity/employee_self_provider.dart';
import '../../data/repositories/home_repository_impl.dart';
import '../../domain/entities/employee_identity.dart';
import '../../domain/entities/work_enums.dart';
import '../../domain/repositories/home_repository.dart';
import '../format.dart';

// -- Dependency graph --------------------------------------------------------

final Provider<HomeRepository> homeRepositoryProvider = Provider<HomeRepository>(
  (Ref ref) => HomeRepositoryImpl(
    HomeRemoteDataSource(ref.watch(dioClientProvider)),
  ),
);

// -- Identity ----------------------------------------------------------------

/// Which employee record the signed-in account is.
///
/// The read is shared: [employeeSelfProvider] performs one `GET /employees/me` per
/// session for the whole app, so the four tabs that need this ask the question once.
/// This provider only maps that result into the vocabulary the Нүүр tab explains
/// itself in.
final FutureProvider<EmployeeIdentity> employeeIdentityProvider =
    FutureProvider<EmployeeIdentity>((Ref ref) async {
  final EmployeeSelf self = await ref.watch(employeeSelfProvider.future);

  return switch (self) {
    EmployeeSelfResolved(:final Map<String, dynamic> record) =>
      ResolvedEmployeeIdentity(EmployeeDetailModel.fromJson(record)),
    EmployeeSelfUnavailable(
      :final EmployeeSelfProblem problem,
      :final String? serverMessage,
    ) =>
      UnresolvedEmployeeIdentity(
        switch (problem) {
          EmployeeSelfProblem.noSession => EmployeeIdentityProblem.noSession,
          EmployeeSelfProblem.notLinked => EmployeeIdentityProblem.notLinked,
          EmployeeSelfProblem.lookupFailed =>
            EmployeeIdentityProblem.lookupFailed,
        },
        serverMessage: serverMessage,
      ),
  };
});

// -- Overview ----------------------------------------------------------------

/// Everything the Нүүр body renders, in one value.
///
/// Blocks are fetched independently and a block that fails becomes a null plus a
/// note, rather than taking the whole screen down: a technician who cannot read the
/// organisation dashboard can still see their own agenda, and the other way round.
/// [failure] is set only when nothing at all could be loaded.
class HomeOverview {
  const HomeOverview({
    required this.identity,
    required this.dashboard,
    required this.plannedWork,
    required this.requests,
    required this.agenda,
    required this.agendaScoped,
    required this.notices,
    required this.failure,
  });

  final EmployeeIdentity identity;

  /// Organisation-wide figures. Never presented as the reader's own.
  final DashboardSummaryModel? dashboard;

  /// The reader's own work. Empty whenever [identity] is unresolved, because an
  /// unfiltered list would be everyone's work under a personal heading.
  final List<PlannedWorkListItemModel> plannedWork;

  /// `GET /service-requests` as it came back — WHICH IS NOT ONLY THE READER'S.
  ///
  /// The service-request read passes `includeUnclaimed: true` server-side, so the
  /// response carries the entire open queue alongside the reader's own work. That
  /// branch is deliberate — it is what the Ажил tab's "Нээлттэй" segment and
  /// `POST /service-requests/:id/claim` are built on — but it means this list must
  /// never be counted as "mine". Everything that claims to be the reader's counts
  /// [assignedRequests] instead.
  final List<ServiceRequestListItemModel> requests;

  /// Today's entries. Scoped to the reader when [agendaScoped] is true; otherwise it
  /// is the whole organisation's day and the screen says so.
  final List<CalendarEventModel> agenda;
  final bool agendaScoped;

  /// One line per block that could not be loaded, in the backend's own wording.
  final List<String> notices;

  /// Set only when every block failed, so the async view can offer a retry.
  final Failure? failure;

  bool get isScoped => identity is ResolvedEmployeeIdentity;

  EmployeeWorkloadModel? get workload =>
      identity is ResolvedEmployeeIdentity
          ? (identity as ResolvedEmployeeIdentity).workload
          : null;

  // -- Derived counters -------------------------------------------------------

  /// The requests that are actually this reader's: named individually, or carried by
  /// their team.
  ///
  /// THE FIGURES ON "МИНИЙ АЖИЛ" ARE COUNTED FROM HERE AND NEVER FROM [requests].
  /// The unfiltered list includes the unclaimed queue, so every hero figure was
  /// inflated by work nobody had taken — a technician with an empty plate and a busy
  /// dispatch board was told they had nine active jobs.
  ///
  /// The test is the union the server itself bounds the list with; see
  /// [ServiceRequestListItemModel.isAssignedTo]. With no employee card there is nothing
  /// to compare against, so nothing counts as the reader's — which is the same answer
  /// the personal blocks already give for that account, and they say why.
  List<ServiceRequestListItemModel> get assignedRequests {
    final EmployeeIdentity self = identity;
    if (self is! ResolvedEmployeeIdentity) {
      return const <ServiceRequestListItemModel>[];
    }
    return requests
        .where((ServiceRequestListItemModel request) => request.isAssignedTo(
              employeeId: self.employeeId,
              teamId: self.employee.teamId,
            ))
        .toList(growable: false);
  }

  List<PlannedWorkListItemModel> get outstandingPlannedWork => plannedWork
      .where((PlannedWorkListItemModel work) =>
          work.effectiveStatus?.isOutstanding ?? false)
      .toList(growable: false);

  List<ServiceRequestListItemModel> get outstandingRequests => assignedRequests
      .where((ServiceRequestListItemModel request) =>
          request.status?.isOutstanding ?? false)
      .toList(growable: false);

  /// The hero figure: everything still on this person's plate.
  int get activeCount =>
      outstandingPlannedWork.length + outstandingRequests.length;

  /// Work that has actually been started, as opposed to merely assigned.
  int get inProgressCount =>
      plannedWork
          .where((PlannedWorkListItemModel work) =>
              work.effectiveStatus?.isInProgress ?? false)
          .length +
      assignedRequests
          .where((ServiceRequestListItemModel request) =>
              request.status?.isInProgress ?? false)
          .length;

  /// Past its deadline and unfinished. Both figures are the backend's own verdict —
  /// the derived `OVERDUE` status and the computed `slaState` — never a date
  /// subtraction done on the device.
  int get overdueCount =>
      plannedWork
          .where((PlannedWorkListItemModel work) =>
              work.effectiveStatus == PlannedWorkStatus.overdue)
          .length +
      outstandingRequests
          .where((ServiceRequestListItemModel request) =>
              request.slaState == SlaState.breached ||
              request.slaState == SlaState.late)
          .length;

  /// `REVISIT_REQUIRED` — the prototype's "Дахин очих".
  int get revisitCount => assignedRequests
      .where((ServiceRequestListItemModel request) =>
          request.status == ServiceRequestStatus.revisitRequired)
      .length;

  /// Lifetime completions, as counted by the backend on the employee record. Null
  /// when the account is not linked, and rendered as a dash rather than a zero.
  int? get completedTotal => workload?.completedAssignments;

  /// What the "Яаралтай анхаарах" section lists: overdue planned work first, then
  /// requests the backend flagged urgent or at risk, soonest deadline first.
  ///
  /// THE READER'S OWN WORK ONLY — over [assignedRequests], never over [requests].
  ///
  /// This section used to run over the unfiltered list on the argument that an urgent
  /// request nobody has taken is the thing a technician most needs to see. It reads
  /// differently on the page than it did in the argument: Нүүр is the reader's own
  /// screen, and a row on it is read as "yours and late" no matter what the heading
  /// says. The unclaimed pool put calls belonging to nobody — and, once the pool and a
  /// colleague's rows arrive down the same read, potentially to somebody else — at the
  /// top of a personal screen, four at a time, above the reader's actual overdue work.
  ///
  /// The open queue has not gone anywhere: it is the Ажил tab's "Нээлттэй" segment,
  /// which is where a request is claimed and which is built for exactly this. The
  /// predicate is not restated here — [assignedRequests] is the one copy of the
  /// assigned-or-team rule the server itself bounds the list with.
  List<HomeUrgentItem> get urgentItems {
    final List<HomeUrgentItem> items = <HomeUrgentItem>[
      for (final PlannedWorkListItemModel work in plannedWork)
        if (work.effectiveStatus == PlannedWorkStatus.overdue)
          HomeUrgentItem.fromPlannedWork(work),
      for (final ServiceRequestListItemModel request in assignedRequests)
        if (request.needsAttention) HomeUrgentItem.fromRequest(request),
    ];

    items.sort((HomeUrgentItem a, HomeUrgentItem b) {
      if (a.isOverdue != b.isOverdue) return a.isOverdue ? -1 : 1;
      final DateTime? left = a.dueAt;
      final DateTime? right = b.dueAt;
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left.compareTo(right);
    });
    return items;
  }

  /// What is LEFT of today, earliest first.
  ///
  /// "Өнөөдрийн хуваарь" is a list of what to go and do, so a job that is already done
  /// is struck off it rather than left sitting at the top of the day with a green pill.
  /// Which states count as done is [CalendarEventModel.isFinished], read from each
  /// source's own vocabulary; the sort is unchanged.
  List<CalendarEventModel> get sortedAgenda {
    final List<CalendarEventModel> sorted = agenda
        .where((CalendarEventModel event) => !event.isFinished)
        .toList();
    sorted.sort((CalendarEventModel a, CalendarEventModel b) {
      final DateTime? left = a.start;
      final DateTime? right = b.start;
      if (left == null && right == null) return 0;
      if (left == null) return 1;
      if (right == null) return -1;
      return left.compareTo(right);
    });
    return sorted;
  }

  /// The day had work on it and every last piece of it is done.
  ///
  /// Distinct from an empty [sortedAgenda], which is also what a day with nothing
  /// scheduled looks like. The two deserve opposite sentences — one is an achievement
  /// and the other is a blank diary — and without this the filter above would quietly
  /// turn the first into the second.
  bool get agendaAllFinished => agenda.isNotEmpty && sortedAgenda.isEmpty;
}

/// One row of "Яаралтай анхаарах", flattened from either source so the section can
/// render a single card type.
class HomeUrgentItem {
  const HomeUrgentItem({
    required this.reference,
    required this.title,
    required this.location,
    required this.statusLabel,
    required this.band,
    required this.dueAt,
    required this.isOverdue,
    required this.detail,
    this.serviceRequestId,
    this.plannedWorkId,
    this.buildingId,
    this.buildingName,
  });

  final String reference;
  final String title;
  final String location;
  final String statusLabel;
  final SeverityBand band;
  final DateTime? dueAt;
  final bool isOverdue;

  /// A second line under the location: the SLA countdown, or the progress figure.
  final String detail;

  /// Exactly one of these two is set, and it says which record the row is and how to
  /// open it. Both null means the source gave the row no id, and such a row is drawn
  /// as flat text rather than as something that can be tapped.
  final String? serviceRequestId;
  final String? plannedWorkId;

  final String? buildingId;
  final String? buildingName;

  factory HomeUrgentItem.fromPlannedWork(PlannedWorkListItemModel work) {
    return HomeUrgentItem(
      reference: work.workNumber,
      title: work.title,
      location: work.locationLabel,
      statusLabel: work.effectiveStatus?.label ?? '',
      band: work.effectiveStatus?.band ?? SeverityBand.neutral,
      dueAt: work.plannedEndDate,
      isOverdue: work.effectiveStatus == PlannedWorkStatus.overdue,
      // The "Явц …" half is dropped rather than printed as 0% when the answer
      // carried no figure, leaving the sub-task count, which is a fact either way.
      detail: <String>[
        if (work.progressPercent != null)
          'Явц ${formatPercent(work.progressPercent)}',
        '${work.taskCount} task',
      ].join(' · '),
      // Empty when a newer API version answered without one, which leaves the row
      // untappable rather than pushing a detail screen onto a blank id.
      plannedWorkId: work.id.isEmpty ? null : work.id,
    );
  }

  factory HomeUrgentItem.fromRequest(ServiceRequestListItemModel request) {
    final SlaState? sla = request.slaState;
    return HomeUrgentItem(
      reference: request.requestNumber,
      title: request.subjectLabel,
      location: request.locationLabel,
      statusLabel: request.isUrgent ? 'Яаралтай' : (sla?.label ?? ''),
      band: request.isUrgent ? SeverityBand.red : (sla?.band ?? SeverityBand.yellow),
      dueAt: request.slaDueAt,
      isOverdue: sla == SlaState.breached || sla == SlaState.late,
      // The backend's own remaining-minutes figure, which already accounts for any
      // authorised SLA extension. Subtracting dates on the device would disagree
      // with the dispatch board the moment a clock drifts.
      detail: 'SLA ${formatSlaRemaining(request.slaRemainingMinutes)}',
      serviceRequestId: request.id.isEmpty ? null : request.id,
      buildingId: request.building?.id,
      buildingName: request.building?.name,
    );
  }
}

/// Loads every block of the home screen.
final FutureProvider<HomeOverview> homeOverviewProvider =
    FutureProvider<HomeOverview>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);
  final HomeRepository repository = ref.watch(homeRepositoryProvider);
  final EmployeeIdentity identity = await ref.watch(employeeIdentityProvider.future);

  final bool canReadDashboard = user?.has(PermissionKeys.dashboardView) ?? false;
  final bool canReadPlannedWork =
      user?.has(PermissionKeys.plannedWorkView) ?? false;
  final bool canReadRequests =
      user?.has(PermissionKeys.serviceRequestView) ?? false;
  final String? employeeId = identity is ResolvedEmployeeIdentity
      ? identity.employeeId
      : null;

  final List<String> notices = <String>[];
  final List<Failure> failures = <Failure>[];
  int attempted = 0;

  /// Runs one block, recording rather than propagating its failure.
  Future<T?> block<T>(Future<ApiResult<T>> Function() call) async {
    attempted += 1;
    final ApiResult<T> result = await call();
    final Failure? failure = result.failureOrNull;
    if (failure != null) {
      failures.add(failure);
      if (!notices.contains(failure.message)) notices.add(failure.message);
      return null;
    }
    return result.dataOrNull;
  }

  // The three reads are independent, so they go out together rather than in series.
  final (
    DashboardSummaryModel? dashboard,
    PaginatedData<PlannedWorkListItemModel>? plannedWork,
    PaginatedData<ServiceRequestListItemModel>? requests,
    CalendarResultModel? agenda,
  ) results = await (
    canReadDashboard
        ? block(repository.getDashboardSummary)
        : Future<DashboardSummaryModel?>.value(),
    employeeId != null && canReadPlannedWork
        ? block(repository.listPlannedWork)
        : Future<PaginatedData<PlannedWorkListItemModel>?>.value(),
    employeeId != null && canReadRequests
        ? block(repository.listServiceRequests)
        : Future<PaginatedData<ServiceRequestListItemModel>?>.value(),
    canReadPlannedWork || canReadRequests
        ? block(() => repository.getDayAgenda(
              day: DateTime.now(),
              employeeId: employeeId,
            ))
        : Future<CalendarResultModel?>.value(),
  ).wait;

  return HomeOverview(
    identity: identity,
    dashboard: results.$1,
    plannedWork: results.$2?.items ?? const <PlannedWorkListItemModel>[],
    requests: results.$3?.items ?? const <ServiceRequestListItemModel>[],
    agenda: results.$4?.events ?? const <CalendarEventModel>[],
    agendaScoped: employeeId != null,
    notices: notices,
    // Only a total loss becomes an error state; a partial one is reported in place.
    failure: attempted > 0 && failures.length == attempted ? failures.first : null,
  );
});

// -- Notifications -----------------------------------------------------------

/// The reader's inbox. Scoped server-side by recipient, so it needs no employee id
/// and keeps working when the account is not linked to an employee record.
final FutureProvider<List<NotificationModel>> homeNotificationsProvider =
    FutureProvider<List<NotificationModel>>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user != null && !user.has(PermissionKeys.notificationView)) {
    return const <NotificationModel>[];
  }

  final ApiResult<PaginatedData<NotificationModel>> result =
      await ref.watch(homeRepositoryProvider).listNotifications();

  return result.when(
    success: (PaginatedData<NotificationModel> page) => page.items,
    failure: (Failure failure) => throw failure,
  );
});

/// The figure on the bell badge.
///
/// Read from `/notifications/unread-count` rather than counted from the list, so the
/// badge stays right when the inbox runs past one page. A failure resolves to zero:
/// the badge is an ornament on someone else's screen, and taking the header down
/// over it would be the wrong trade.
final FutureProvider<int> unreadNotificationCountProvider =
    FutureProvider<int>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user != null && !user.has(PermissionKeys.notificationView)) return 0;

  final ApiResult<NotificationUnreadCountModel> result =
      await ref.watch(homeRepositoryProvider).getUnreadCount();

  return result.when(
    success: (NotificationUnreadCountModel count) => count.unread,
    failure: (Failure _) => 0,
  );
});

/// Marks one notification read, then refreshes the badge and the list.
///
/// Returns the failure when the server refused, so the sheet can say so instead of
/// silently leaving the row unread.
Future<Failure?> markNotificationRead(WidgetRef ref, String notificationId) async {
  final ApiResult<NotificationModel> result =
      await ref.read(homeRepositoryProvider).markNotificationRead(notificationId);

  final Failure? failure = result.failureOrNull;
  if (failure == null) {
    ref.invalidate(homeNotificationsProvider);
    ref.invalidate(unreadNotificationCountProvider);
  }
  return failure;
}

/// Marks the whole inbox read.
Future<Failure?> markAllNotificationsRead(WidgetRef ref) async {
  final ApiResult<void> result =
      await ref.read(homeRepositoryProvider).markAllNotificationsRead();

  final Failure? failure = result.failureOrNull;
  if (failure == null) {
    ref.invalidate(homeNotificationsProvider);
    ref.invalidate(unreadNotificationCountProvider);
  }
  return failure;
}
