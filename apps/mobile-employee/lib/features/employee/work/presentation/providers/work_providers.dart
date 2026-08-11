import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../home/presentation/providers/home_providers.dart';
import '../../../identity/employee_self.dart';
import '../../../identity/employee_self_provider.dart';
import '../../../shared/service_request_models.dart';
import '../../../shared/service_request_vocabulary.dart';
import '../../data/datasources/work_remote_data_source.dart';
import '../../data/models/employee_link_model.dart';
import '../../data/models/inspection_report_model.dart';
import '../../data/models/planned_work_model.dart';
import '../../data/models/task_material_model.dart';
import '../../data/repositories/work_repository_impl.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../../domain/entities/work_identity.dart';
import '../../domain/repositories/work_repository.dart';

// -- Dependency graph --------------------------------------------------------

/// Built on the shared [dioClientProvider] from the auth feature, so this tab reuses
/// the app's single Dio instance, its token storage and its 401 refresh path.
final Provider<WorkRepository> workRepositoryProvider =
    Provider<WorkRepository>(
  (Ref ref) =>
      WorkRepositoryImpl(WorkRemoteDataSource(ref.watch(dioClientProvider))),
);

// -- Helpers -----------------------------------------------------------------

/// Unwraps an [ApiResult] for an async provider, throwing the [Failure] so it lands
/// in `AsyncValue.error` with the backend's own Mongolian message intact.
T _unwrap<T>(ApiResult<T> result) => result.when(
      success: (T data) => data,
      failure: (Failure failure) => throw failure,
    );

// -- Permissions -------------------------------------------------------------

/// Live permission gates, read from the effective set `GET /auth/me` reported.
///
/// Never inferred from the role: `resolveEffectivePermissions` returns the union of
/// the account's dynamic roles for every tier except `head_admin`, and `seedRbac` is
/// prune-only for non-system roles, so a deployed database can hold strictly less
/// than the shipped defaults suggest. The role is not evidence; the array is.
///
/// The set is empty between login and the first `/auth/me`, so every gate here reads
/// false until then and a control stays hidden rather than being shown and refused.
class WorkGrants {
  const WorkGrants(this._permissions);

  final Set<String> _permissions;

  bool get canView => _permissions.contains(PermissionKeys.plannedWorkView);
  bool get canRecordProgress =>
      _permissions.contains(PermissionKeys.plannedWorkRecordProgress);
  bool get canChangeStatus =>
      _permissions.contains(PermissionKeys.plannedWorkChangeStatus);
  bool get canCancel => _permissions.contains(PermissionKeys.plannedWorkCancel);
  bool get canSubmitReport =>
      _permissions.contains(PermissionKeys.plannedWorkSubmitReport);
  bool get canApproveReport =>
      _permissions.contains(PermissionKeys.plannedWorkApproveReport);

  /// Whether a specific lifecycle action may be offered. The record's
  /// `availableActions` says the action is legal for the record; this says it is
  /// legal for the caller. Both must hold.
  bool allows(PlannedWorkAction action) =>
      _permissions.contains(action.permission);

  /// Whether the caller supervises planned work rather than merely carrying it out.
  ///
  /// Mirrors `OVERSIGHT_PERMISSIONS` in
  /// apps/backend/src/modules/planned-work/planned-work.scope.ts — the WRITE set, and
  /// deliberately not the read union beside it. Holding one of these lifts the
  /// assignment scope on writes server-side, so the app must not narrow its own
  /// controls for a dispatcher or a manager who is legitimately acting on somebody
  /// else's job.
  ///
  /// `READ_OVERSIGHT_PERMISSIONS` — `invoice.view`, `report.view`, `dispatch.view` —
  /// is NOT mirrored here and must not be added. Those keys widen what an account may
  /// SEE, and this getter decides which buttons to draw: an accountant who can read
  /// every job in the company still cannot start one, so mirroring them would offer a
  /// control whose only outcome is a 403.
  ///
  /// The four keys the TECHNICIAN default grants — view, change_status,
  /// record_progress, submit_report — are deliberately absent, and adding one here
  /// would silently dissolve the whole restriction for the field tier. It is a
  /// capability test and never a role-string test, for the same reason the backend
  /// makes it one: the tier describes how an account was provisioned, not what it may
  /// do.
  bool get hasPlannedWorkOversight =>
      _permissions.any(_plannedWorkOversightKeys.contains);

  static const Set<String> _plannedWorkOversightKeys = <String>{
    PermissionKeys.plannedWorkCreate,
    PermissionKeys.plannedWorkUpdate,
    PermissionKeys.plannedWorkReschedule,
    PermissionKeys.plannedWorkCancel,
    PermissionKeys.plannedWorkApproveReport,
    PermissionKeys.dispatchAssign,
  };

  /// True only once the permission array has actually arrived, so a screen can tell
  /// "no grants" apart from "not asked yet".
  bool get isKnown => _permissions.isNotEmpty;
}

final Provider<WorkGrants> workGrantsProvider = Provider<WorkGrants>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  return WorkGrants(user?.permissions ?? const <String>{});
});

// -- Identity ----------------------------------------------------------------

/// Which employee record the signed-in account is.
///
/// See [WorkIdentity] for why this has to be resolved before the tab can filter. The
/// read itself is shared — [employeeSelfProvider] performs one `GET /employees/me`
/// per session for the whole app — and this provider maps the result into the
/// vocabulary this tab explains itself in.
///
/// Failures are returned as an [UnresolvedWorkIdentity] rather than thrown, because
/// "we could not work out who you are" is a state the tab renders and explains, not
/// an error that should blank the screen.
final FutureProvider<WorkIdentity> workIdentityProvider =
    FutureProvider<WorkIdentity>((Ref ref) async {
  final EmployeeSelf self = await ref.watch(employeeSelfProvider.future);

  return switch (self) {
    EmployeeSelfResolved(:final Map<String, dynamic> record) => () {
        final EmployeeDetailModel employee =
            EmployeeDetailModel.fromJson(record);
        return ResolvedWorkIdentity(
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
          positionName: employee.positionName,
          teamId: employee.teamId,
          teamName: employee.teamName,
        );
      }(),
    EmployeeSelfUnavailable(:final EmployeeSelfProblem problem) =>
      UnresolvedWorkIdentity(
        switch (problem) {
          EmployeeSelfProblem.lookupFailed => WorkIdentityProblem.lookupFailed,
          // A missing session is not a state this tab can be in — the shell only
          // renders it when there is one — so it reads as the same "no card" notice.
          EmployeeSelfProblem.noSession ||
          EmployeeSelfProblem.notLinked =>
            WorkIdentityProblem.notLinked,
        },
      ),
  };
});

// -- Assignment scope --------------------------------------------------------

/// Whether the server's planned-work assignment scope would admit this caller on
/// this record.
///
/// A client-side mirror of `resolveAssignmentScope` in
/// apps/backend/src/modules/planned-work/planned-work.scope.ts, and nothing more than
/// that. The server enforces the rule; this exists so the app does not offer a button
/// whose only possible outcome is a 403. Every refusal is still surfaced with the
/// backend's own message when one arrives, because a mirror can be wrong and a
/// silently dead control is worse than an explained one.
enum PlannedWorkAssignment {
  /// The rule does not restrict this caller — either they hold an oversight
  /// permission, or the app does not yet know enough to say it restricts them.
  ///
  /// The permissive default is deliberate and matches the backend's own
  /// `availableActionsFor(..., assignmentAllowed: true)`: only positive knowledge
  /// narrows the UI, so an unresolved provider can never hide a control from somebody
  /// entitled to it.
  unrestricted,

  /// The record names this employee, or the team they belong to.
  assigned,

  /// The record names neither. Every write on it will be refused.
  notAssigned;

  /// True when a write on this record would be refused for scope reasons alone.
  bool get blocksWrites => this == PlannedWorkAssignment.notAssigned;
}

/// Applies the rule to one record.
///
/// THE RULE, as the backend states it: a scoped caller may act only when their
/// employee id appears in `assignedEmployees`, or their `Employee.team` equals the
/// work's `assignedTeam`. Two nulls never match — a work with no team does not admit
/// every teamless technician — which is why the team comparison guards both sides.
///
/// [identity] is nullable so a still-loading provider reads as "not known yet" rather
/// than as "you are nobody"; the resolved-but-unlinked case is a separate, definite
/// answer and does block writes, exactly as a null `auth.employeeId` does server-side.
PlannedWorkAssignment resolvePlannedWorkAssignment({
  required PlannedWorkModel work,
  required WorkIdentity? identity,
  required WorkGrants grants,
}) {
  // Between login and the first /auth/me the permission set is empty, so oversight
  // cannot be ruled out. Assert nothing rather than narrow the screen wrongly.
  if (!grants.isKnown) return PlannedWorkAssignment.unrestricted;
  if (grants.hasPlannedWorkOversight) return PlannedWorkAssignment.unrestricted;

  if (identity == null) return PlannedWorkAssignment.unrestricted;
  if (identity is! ResolvedWorkIdentity) {
    return PlannedWorkAssignment.notAssigned;
  }

  // Both comparisons guard the empty string as well as null. `NamedRefModel` and
  // `ResolvedWorkIdentity` both default a missing id to '', and two empty ids matching
  // would admit a caller to every record with an unpopulated assignee.
  final String me = identity.employeeId;
  final bool named = me.isNotEmpty &&
      work.assignedEmployees.any((NamedRefModel employee) => employee.id == me);
  if (named) return PlannedWorkAssignment.assigned;

  final String? myTeam = identity.teamId;
  final String? workTeam = work.assignedTeam?.id;
  if (myTeam != null && myTeam.isNotEmpty && myTeam == workTeam) {
    return PlannedWorkAssignment.assigned;
  }

  return PlannedWorkAssignment.notAssigned;
}

// -- List --------------------------------------------------------------------

/// Which slice of work the list is showing.
///
/// THE SEGMENTS SPLIT BY RECORD TYPE, NOT BY WHOSE WORK IT IS. They used to be
/// "Миний" / "Багийн" / "Нээлттэй", which mixed two questions: the first two named an
/// owner and each carried BOTH record types, so a technician looking for the request
/// they had just been given had to scroll past a planned-work board to reach it.
///
/// Dropping "Багийн" loses nothing, and that is a property of the reads rather than a
/// judgement about the UI. Both lists are already scoped own-OR-team: the server bounds
/// `GET /planned-work` and `GET /service-requests` with that union for any caller
/// without an oversight permission, and the client-side subtraction in
/// [assignedRequestsProvider] uses the same union — [ServiceRequestListItemModel.isAssignedTo]
/// matches on the employee id OR the team. "Багийн" was a NARROWING over rows these two
/// segments already contain, never a source of extra ones, so every row it could show is
/// still reachable — now under whichever type it is.
enum WorkScope {
  /// The service requests assigned to the reader or to their team.
  ///
  /// The default, because it is the segment with a clock on it: a request carries an SLA
  /// deadline the server is counting down, and it is what arrives unannounced during a
  /// shift. Planned work is scheduled days ahead and does not change while nobody is
  /// looking, so opening on it would put the slower list in front of the urgent one.
  requests('Хүсэлт'),

  /// The planned work assigned to the reader or to their team.
  ///
  /// Labelled with the adjective alone rather than "Төлөвлөгөөт ажил": the three chips
  /// share one row at equal width, which is about 112 logical pixels on a 390-wide
  /// handset, and the full phrase ellipsises there.
  plannedWork('Төлөвлөгөөт'),

  /// The unclaimed pool — and the one segment that is nobody's work yet.
  ///
  /// It is SERVICE REQUESTS, like [requests], and not both record types, because that is
  /// the only half of the question the API can answer: `plannedWorkListQuerySchema` has
  /// no "unassigned" filter, so there is no way to ask `GET /planned-work` for the jobs
  /// nobody holds, while `GET /service-requests?status=UNASSIGNED` answers exactly that.
  /// See [openRequestPoolProvider]. It stays its own segment rather than folding into
  /// [requests] because the two answer opposite questions — what is mine, and what is
  /// still going spare — and only this one carries a claim action.
  open('Нээлттэй');

  const WorkScope(this.label);

  final String label;
}

final NotifierProvider<WorkScopeController, WorkScope> workScopeProvider =
    NotifierProvider<WorkScopeController, WorkScope>(WorkScopeController.new);

class WorkScopeController extends Notifier<WorkScope> {
  @override
  WorkScope build() => WorkScope.requests;

  void select(WorkScope scope) => state = scope;
}

/// The list, grouped the way a technician triages it.
///
/// Overdue first because it is the only band with a consequence attached, then work
/// in flight, then what is merely scheduled, then what is finished. The grouping is
/// on `effectiveStatus`, which the server derived; nothing here re-decides what is
/// late.
class PlannedWorkBoard {
  const PlannedWorkBoard({
    required this.overdue,
    required this.active,
    required this.upcoming,
    required this.finished,
    this.identityProblem,
  });

  final List<PlannedWorkListItemModel> overdue;
  final List<PlannedWorkListItemModel> active;
  final List<PlannedWorkListItemModel> upcoming;
  final List<PlannedWorkListItemModel> finished;

  /// Set when the account could not be matched to an employee card, which the screen
  /// must say out loud.
  ///
  /// It is carried ALONGSIDE the rows rather than thrown in their place, because the
  /// two facts are now independent: the server bounds the list by itself, so a list
  /// still arrives — it is simply empty, and an empty list with no explanation reads
  /// as "you have no work" when the truth is "nobody can be given work under this
  /// login until an administrator links it".
  final WorkIdentityProblem? identityProblem;

  bool get isEmpty =>
      overdue.isEmpty && active.isEmpty && upcoming.isEmpty && finished.isEmpty;

  int get total =>
      overdue.length + active.length + upcoming.length + finished.length;

  int get openCount => overdue.length + active.length + upcoming.length;

  /// Records due before midnight tonight that are not finished yet.
  int dueTodayCount({DateTime? now}) {
    final DateTime reference = (now ?? DateTime.now()).toLocal();
    final DateTime endOfDay =
        DateTime(reference.year, reference.month, reference.day, 23, 59, 59);

    return <PlannedWorkListItemModel>[...overdue, ...active, ...upcoming]
        .where((PlannedWorkListItemModel item) {
      final DateTime? due = item.plannedEndDate?.toLocal();
      return due != null && !due.isAfter(endOfDay);
    }).length;
  }

  factory PlannedWorkBoard.from(
    List<PlannedWorkListItemModel> items, {
    WorkIdentityProblem? identityProblem,
  }) {
    final List<PlannedWorkListItemModel> overdue = <PlannedWorkListItemModel>[];
    final List<PlannedWorkListItemModel> active = <PlannedWorkListItemModel>[];
    final List<PlannedWorkListItemModel> upcoming =
        <PlannedWorkListItemModel>[];
    final List<PlannedWorkListItemModel> finished =
        <PlannedWorkListItemModel>[];

    for (final PlannedWorkListItemModel item in items) {
      switch (item.effectiveStatus) {
        case PlannedWorkEffectiveStatus.overdue:
          overdue.add(item);
        case PlannedWorkEffectiveStatus.started:
        case PlannedWorkEffectiveStatus.paused:
          active.add(item);
        case PlannedWorkEffectiveStatus.planned:
        case PlannedWorkEffectiveStatus.draft:
          upcoming.add(item);
        case PlannedWorkEffectiveStatus.completed:
        case PlannedWorkEffectiveStatus.archived:
        case PlannedWorkEffectiveStatus.cancelled:
          finished.add(item);
      }
    }

    int byDeadline(PlannedWorkListItemModel a, PlannedWorkListItemModel b) {
      final DateTime? left = a.plannedEndDate;
      final DateTime? right = b.plannedEndDate;
      // A record with no deadline sinks rather than pretending to be due now.
      if (left == null && right == null) {
        return a.workNumber.compareTo(b.workNumber);
      }
      if (left == null) return 1;
      if (right == null) return -1;
      return left.compareTo(right);
    }

    overdue.sort(byDeadline);
    active.sort(byDeadline);
    upcoming.sort(byDeadline);
    // Finished work reads best newest first: the last thing done is the thing a
    // technician is most likely to be looking for.
    finished.sort((PlannedWorkListItemModel a, PlannedWorkListItemModel b) =>
        byDeadline(b, a));

    return PlannedWorkBoard(
      overdue: overdue,
      active: active,
      upcoming: upcoming,
      finished: finished,
      identityProblem: identityProblem,
    );
  }
}

/// Raised, and rendered, when the selected scope has nothing behind it.
///
/// Deliberately not a [Failure]: nothing failed. Either the account is not linked to an
/// employee card yet, or it does not hold the permission the segment's read needs. Both
/// are situations to explain, not errors to apologise for, so they carry their own type
/// and get their own presentation.
///
/// What this type must NOT be used for any more is "the API cannot answer that": the
/// "Нээлттэй" segment threw one saying exactly that, and it was wrong — `GET
/// /service-requests?status=UNASSIGNED` had always answered it. A notice claiming an
/// endpoint does not exist is unfalsifiable from the outside, so it has to be checked
/// against the routes rather than inherited.
///
/// (`Failure` is a sealed class in `lib/core`, which a feature library could not
/// extend even if this were an error.)
class WorkScopeUnavailable implements Exception {
  const WorkScopeUnavailable(this.title, {required this.detail});

  final String title;
  final String detail;

  @override
  String toString() => 'WorkScopeUnavailable: $title';
}

/// The planned work assigned to the reader or to their team — the "Төлөвлөгөөт" segment.
///
/// IT SENDS NO FILTER, AND THAT IS THE FIX RATHER THAN A SHORTCUT.
///
/// It used to send `employeeId=<me>`, because `GET /planned-work` took no auth context
/// and answered every job in the company to anyone who omitted it. That filter could
/// never express the rule the server actually applies: assignment scope admits a caller
/// named individually OR belonging to the assigned team, and `employeeId` and `teamId`
/// AND together server-side, so a technician whose only work was assigned to their TEAM
/// saw an empty "Миний" and concluded they had nothing to do. Sending both was not the
/// answer; there was no way to ask for a union from the outside at all.
///
/// The server now bounds the list itself — `resolveAssignedWorkFilter` in
/// apps/backend/src/modules/planned-work/planned-work.scope.ts — with exactly that union,
/// for every caller without an oversight permission. So the honest request for "my work"
/// is the one with no filter on it: the answer is scoped by the same policy that decides
/// what the caller may act on, and it cannot drift from it. A dispatcher or manager, who
/// legitimately sees everything, gets everything here too, which is correct: this app is
/// not the place that decides what their reach is.
///
/// This is also why the old "show me the unfiltered system-wide list" escape hatch is
/// gone. It existed because an unlinked account had a completely dead tab while
/// `planned_work.view` exposed the whole company anyway. Both halves of that premise are
/// false now: the unfiltered request is the same request "Миний" already makes, and for a
/// scoped caller it returns the same scoped rows — a button offering "all planned work"
/// would have been offering a promise the server no longer keeps.
///
/// THE "БАГИЙН" SEGMENT USED TO SEND `teamId` HERE, and removing it removes no rows. It
/// was a narrowing and never a scope: it asked "what is my team carrying", which is a
/// strict SUBSET of the union the server already enforces on the unfiltered call above.
/// Every row it could produce is in this board, so the team-assigned work a technician
/// used to find under "Багийн" is here, in the same four status groups.
///
/// The identity is still resolved, for one reason only — an account with no employee card
/// must be TOLD so. See [PlannedWorkBoard.identityProblem]: it is carried with the rows
/// rather than thrown in their place, because the list itself succeeds now.
///
/// Neither request segment is served here — [WorkScope.requests] and [WorkScope.open] are
/// service requests, which [PlannedWorkBoard] structurally cannot hold — so the screen
/// watches [assignedRequestsProvider] and [openRequestPoolProvider] for those, and this
/// provider is not read at all while either is selected.
final FutureProvider<PlannedWorkBoard> plannedWorkBoardProvider =
    FutureProvider<PlannedWorkBoard>((Ref ref) async {
  final WorkIdentity identity = await ref.watch(workIdentityProvider.future);
  final WorkRepository repository = ref.watch(workRepositoryProvider);

  final PaginatedData<PlannedWorkListItemModel> page =
      _unwrap(await repository.listPlannedWork());

  return PlannedWorkBoard.from(
    page.items,
    identityProblem:
        identity is UnresolvedWorkIdentity ? identity.problem : null,
  );
});

// -- The reader's own service requests ---------------------------------------

/// The service requests assigned to the reader — everything the "Хүсэлт" segment draws.
///
/// A failed read is a [notice] on the value rather than a thrown failure. The rows and
/// the explanation are independent facts: a `/service-requests` that refuses leaves this
/// list empty, and an empty list with no explanation reads as "no requests" when the
/// truth is "we could not ask". The same is true of [identityProblem], which is why both
/// travel WITH the items instead of in place of them.
class AssignedRequests {
  const AssignedRequests({
    required this.items,
    this.notice,
    this.identityProblem,
  });

  static const AssignedRequests none =
      AssignedRequests(items: <ServiceRequestListItemModel>[]);

  final List<ServiceRequestListItemModel> items;

  /// The backend's own message, when the read failed.
  final String? notice;

  /// Set when the account could not be matched to an employee card, which the screen
  /// must say out loud — the twin of [PlannedWorkBoard.identityProblem], and for the
  /// same reason: no employee card means no assignment can name this caller, so the
  /// list is legitimately empty and completely indistinguishable from a quiet week.
  final WorkIdentityProblem? identityProblem;

  bool get isEmpty => items.isEmpty;

  /// The requests still expecting something of the reader.
  ///
  /// A status this build does not know does not count, which is what `HomeOverview` does
  /// with the same rows — the two tabs print the same figure and must not disagree.
  List<ServiceRequestListItemModel> get outstanding => items
      .where((ServiceRequestListItemModel request) =>
          request.status?.isOutstanding ?? false)
      .toList(growable: false);

  int get activeCount => outstanding.length;

  /// Outstanding rows whose SLA deadline falls before midnight tonight.
  int get dueTodayCount {
    final DateTime now = DateTime.now().toLocal();
    final DateTime midnight =
        DateTime(now.year, now.month, now.day, 23, 59, 59);
    return outstanding.where((ServiceRequestListItemModel request) {
      final DateTime? due = request.slaDueAt?.toLocal();
      return due != null && !due.isAfter(midnight);
    }).length;
  }

  /// Past the deadline on the backend's own verdict — the computed `slaState`. Nothing
  /// here subtracts dates.
  int get overdueCount => outstanding
      .where((ServiceRequestListItemModel request) =>
          request.slaState == SlaState.breached ||
          request.slaState == SlaState.late)
      .length;
}

/// `GET /service-requests`, narrowed to the rows that are actually the reader's.
///
/// THIS IS THE LIST THE TAB WAS MISSING ENTIRELY. A request assigned to a technician had
/// nowhere to appear: [PlannedWorkBoard] holds `PlannedWorkListItemModel` and structurally
/// cannot carry a service request, so the moment a request left the "Нээлттэй" pool it left
/// the Ажил tab — the assignment was correct server-side and invisible in the app. It is
/// its own segment now rather than a section under someone else's heading.
///
/// TWO SUBTRACTIONS, and both are necessary:
///
///   * **The unclaimed pool.** The service-request list read passes
///     `includeUnclaimed: true` server-side — deliberately, because that branch is what
///     the "Нээлттэй" segment and `POST /:id/claim` are built on — so the response
///     carries the whole open queue as well as the reader's work. Those rows belong to
///     nobody and are the other segment's.
///   * **Everybody else's.** An oversight caller (a dispatcher) is not bounded by the
///     server's predicate at all and gets the organisation's requests. "Хүсэлт" means
///     the reader's for them too.
///
/// Both fall out of one test: [ServiceRequestListItemModel.isAssignedTo], the union the
/// server itself uses — named individually OR carried by the reader's team. That OR is
/// also why the old "Багийн" segment was redundant: a request assigned to the reader's
/// team is already in this list.
///
/// Without a resolved identity there is nothing to compare against, so the answer is an
/// empty list rather than a guess — carrying the problem, so the screen can say why.
final FutureProvider<AssignedRequests> assignedRequestsProvider =
    FutureProvider<AssignedRequests>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);
  // The same key the pool's read is gated on, and read from the effective set rather
  // than inferred from the role. This is a whole segment now rather than a section
  // beside a board that answered, so a missing grant is stated instead of leaving an
  // empty pane: the refusal is thrown, and `WorkAsyncView` renders a
  // [WorkScopeUnavailable] as a written sentence rather than as an error.
  if (!(user?.has(PermissionKeys.serviceRequestView) ?? false)) {
    throw const WorkScopeUnavailable(
      'Үйлчилгээний хүсэлт харах эрх байхгүй',
      detail: 'Танд оногдсон үйлчилгээний хүсэлтийн жагсаалтыг харахад '
          '"service_request.view" эрх шаардлагатай бөгөөд таны эрхийн санд '
          'одоогоор байхгүй байна. Эрхээ администратороор нэмүүлнэ үү.',
    );
  }

  final WorkIdentity identity = await ref.watch(workIdentityProvider.future);
  if (identity is! ResolvedWorkIdentity) {
    return AssignedRequests(
      items: const <ServiceRequestListItemModel>[],
      identityProblem:
          identity is UnresolvedWorkIdentity ? identity.problem : null,
    );
  }

  final ApiResult<PaginatedData<ServiceRequestListItemModel>> result =
      await ref.watch(workRepositoryProvider).listAssignedServiceRequests();

  return result.when(
    success: (PaginatedData<ServiceRequestListItemModel> page) {
      final List<ServiceRequestListItemModel> mine = page.items
          .where((ServiceRequestListItemModel request) => request.isAssignedTo(
                employeeId: identity.employeeId,
                teamId: identity.teamId,
              ))
          .toList()
        ..sort(_byOutstandingThenUrgency);
      return AssignedRequests(items: mine);
    },
    failure: (Failure failure) => AssignedRequests(
      items: const <ServiceRequestListItemModel>[],
      notice: failure.message,
    ),
  );
});

/// Live work first, then whatever will breach first.
///
/// The list is not filtered by status — a request the reader closed this morning is
/// still theirs and hiding it would look like the row vanished — but a finished job is
/// never the thing to read first, so it sinks below everything outstanding.
int _byOutstandingThenUrgency(
  ServiceRequestListItemModel a,
  ServiceRequestListItemModel b,
) {
  final bool left = a.status?.isOutstanding ?? true;
  final bool right = b.status?.isOutstanding ?? true;
  if (left != right) return left ? -1 : 1;
  return WorkRemoteDataSource.compareByUrgency(a, b);
}

// -- One request, in full ----------------------------------------------------

/// `GET /service-requests/:id`, for the detail screen.
///
/// The screen used to render purely from the list row it was handed, which is why it
/// could show a location and nothing else: `ServiceRequestListItemDto` carries no
/// description, no contact and no attachments. This is the read that carries all three.
///
/// `null` is the route's 404 and is NOT an error state. The endpoint is
/// assignment-scoped, so a request that stopped being the caller's — reassigned while
/// they were looking at the list, say — answers "missing" rather than "forbidden". The
/// screen turns that into a sentence; an `AsyncError` would turn it into an apology for
/// something that did not go wrong.
///
/// Family-keyed on the request id and left `autoDispose`-free for the same reason the
/// other reads here are: it is invalidated by the actions that change it.
final FutureProviderFamily<ServiceRequestDetailModel?, String>
    serviceRequestDetailProvider =
    FutureProvider.family<ServiceRequestDetailModel?, String>(
        (Ref ref, String requestId) async {
  final WorkRepository repository = ref.watch(workRepositoryProvider);
  return _unwrap(await repository.getServiceRequestDetail(requestId));
});

/// Whether the server's assignment scope would admit this caller on this REQUEST.
///
/// The service-request twin of [resolvePlannedWorkAssignment], and it exists for the same
/// reason: `assertSelfProgressAllowed` and `assertReportApprovalAllowed` in
/// apps/backend/src/modules/service-request/self-progress.policy.ts bound both writes to a
/// request that names the caller or their team, so a control offered on anything else can
/// only ever produce a 403.
///
/// THE UNCLAIMED POOL IS NOT ADMITTED HERE, and that is the one place this differs from the
/// read the screen is built on. `GET /service-requests/:id` passes `includeUnclaimed: true`
/// — which is what lets a technician open a "Нээлттэй" row and read the fault before
/// deciding to take it — while the write policy passes false. A request nobody holds is
/// readable and not yet actionable; claiming it is the separate act that changes that.
///
/// PERMISSIVE WHEN UNSURE, exactly as the planned-work mirror is: only positive knowledge
/// narrows the screen, so an unresolved identity or a permission set that has not arrived
/// yet leaves the control drawn rather than hiding it from somebody entitled to it.
PlannedWorkAssignment resolveRequestAssignment({
  required ServiceRequestDetailModel request,
  required WorkIdentity? identity,
  required WorkGrants grants,
}) {
  if (!grants.isKnown) return PlannedWorkAssignment.unrestricted;
  if (grants.hasPlannedWorkOversight) return PlannedWorkAssignment.unrestricted;

  if (identity == null) return PlannedWorkAssignment.unrestricted;
  if (identity is UnresolvedWorkIdentity) {
    /*
     * "We could not ask" is not "you are nobody".
     *
     * `notLinked` is a definite answer — no employee card means no assignment can name this
     * caller, which is exactly what a null `auth.employeeId` means server-side — so it
     * blocks. `lookupFailed` is a network or server problem and says nothing about who the
     * caller is; hiding the controls on it would let one failed `GET /employees/me` make a
     * technician's own job read as somebody else's until they restarted the app.
     */
    return identity.problem == WorkIdentityProblem.notLinked
        ? PlannedWorkAssignment.notAssigned
        : PlannedWorkAssignment.unrestricted;
  }
  if (identity is! ResolvedWorkIdentity) return PlannedWorkAssignment.notAssigned;

  return request.isAssignedTo(
    employeeId: identity.employeeId,
    teamId: identity.teamId,
  )
      ? PlannedWorkAssignment.assigned
      : PlannedWorkAssignment.notAssigned;
}

// -- Acting on one request ---------------------------------------------------

/// What the detail screen is currently doing to a request, and how it went.
///
/// Keyed per request rather than held as one flag, for the same reason [ClaimState] is: two
/// detail screens can be on the navigation stack at once, and a transition in flight on one
/// must not disable the other.
class RequestActionState {
  const RequestActionState({this.pending, this.message, this.failed = false});

  /// The wire value of the transition in flight, or null when nothing is running.
  ///
  /// It once also carried `'APPROVE'`, for the conclusion-approval button this screen used
  /// to draw. That button is gone — approving is an office act done on the web admin — and
  /// with it the only non-transition this state ever described.
  final String? pending;

  /// The outcome to show once it settles. Cleared by [ServiceRequestActionController.dismiss].
  final String? message;
  final bool failed;

  bool get isBusy => pending != null;
}

final NotifierProviderFamily<ServiceRequestActionController, RequestActionState, String>
    serviceRequestActionProvider =
    NotifierProvider.family<ServiceRequestActionController, RequestActionState, String>(
  ServiceRequestActionController.new,
);

/// The one write the detail screen offers: move the request on.
///
/// It offered a second — approving a submitted conclusion — and no longer does. Approval is
/// the office's act, performed on the web admin against the same
/// `POST /service-requests/:id/report/approve` route, which is untouched; what is gone is
/// this app's client for it, because a field app that can sign off the conclusion it just
/// wrote is not a workflow, it is a rubber stamp.
///
/// EVERY SUCCESS INVALIDATES THE SAME FOUR READS, and each one is load-bearing rather than
/// defensive. The detail itself obviously moved. The reader's own request list carries the
/// row's status and is a sibling screen that will not re-read on its own. The open pool can
/// gain or lose the row — UNASSIGNED is not reachable from here, but a request that leaves
/// NEW does leave the pool. And the Нүүр tab counts the same rows: leaving it stale showed a
/// technician a hero figure that disagreed with the screen they had just changed.
class ServiceRequestActionController extends FamilyNotifier<RequestActionState, String> {
  @override
  RequestActionState build(String requestId) => const RequestActionState();

  /// Moves the request to [status]. Returns null on success, or the refusal to show.
  ///
  /// The permitted set is NOT re-checked here. The screen decides which buttons exist from
  /// `selfProgressTargets` and the live grants; the server decides whether the move
  /// happens. A third opinion in the middle is only somewhere for the two to drift apart.
  Future<String?> moveTo(ServiceRequestStatus status, {String? reason}) async {
    if (state.isBusy) return null;
    state = RequestActionState(pending: status.wireValue);

    final ApiResult<ServiceRequestDetailModel> result =
        await ref.read(workRepositoryProvider).changeServiceRequestStatus(
              requestId: arg,
              status: status,
              reason: reason,
            );

    return result.when(
      // The response IS the re-read record, but it is discarded rather than published: the
      // detail is a `FutureProvider.family` with no state to write into, and inventing a
      // second store for it would be a second version of the same request.
      success: (ServiceRequestDetailModel _) {
        state = RequestActionState(message: 'Төлөв "${status.label}" боллоо.');
        _refresh();
        return null;
      },
      failure: (Failure failure) {
        state = RequestActionState(message: _explainAction(failure), failed: true);
        return _explainAction(failure);
      },
    );
  }

  void dismiss() => state = const RequestActionState();

  void _refresh() {
    ref.invalidate(serviceRequestDetailProvider(arg));
    ref.invalidate(assignedRequestsProvider);
    ref.invalidate(openRequestPoolProvider);
    ref.invalidate(homeOverviewProvider);
  }
}

/// A refusal in the words a technician can act on.
///
/// A 403 here is not "something went wrong". It is one of two specific things — the key is
/// missing, or the job is not this caller's — and the server's own message says which, so
/// it is passed through rather than replaced. What must NOT happen is a permission refusal
/// or a rejected transition being reported as a network problem, which sends somebody to
/// check their signal over a rule.
String _explainAction(Failure failure) {
  if (failure is AuthFailure) {
    return failure.message;
  }
  if (failure is ServerFailure) {
    final String? reason = failure.fieldErrors['reason'];
    if (reason != null) return reason;
    return failure.message;
  }
  return failure.message;
}

// -- The unclaimed pool ------------------------------------------------------

/// The service requests nobody has been assigned to, as the "Нээлттэй" segment shows
/// them.
///
/// Claimable now, which it was not when this segment was first built. The blocker then
/// was real: the only way onto a request was `POST /service-requests/:id/assign`, guarded
/// by `dispatch.assign` — a key the TECHNICIAN default does not carry — and it takes an
/// arbitrary employee id, making it a dispatcher's tool for assigning anyone rather than
/// a self-service one. A button wired to it could only ever return 403.
///
/// `POST /service-requests/:id/claim` is the endpoint that did not exist. It takes no
/// body, resolves the claimer from the session, and answers to `service_request.claim`,
/// which a technician does hold. See [ClaimController].
class OpenRequestPool {
  const OpenRequestPool({required this.items, required this.total});

  final List<ServiceRequestListItemModel> items;

  /// The server's own count for the two statuses together, which can exceed
  /// `items.length` when the pool is longer than the page the data source asked for.
  /// Shown as-is; the app does not restate a figure the backend computed.
  final int total;

  bool get isEmpty => items.isEmpty;

  int get urgentCount =>
      items.where((ServiceRequestListItemModel item) => item.isUrgent).length;

  /// Rows the backend says are near, at risk of, or already past their SLA deadline.
  int get slaRiskCount => items
      .where((ServiceRequestListItemModel item) =>
          item.slaState?.needsAttention ?? false)
      .length;
}

/// Loads the pool, gated on the permission its read actually needs.
///
/// Gated the same way `home_providers.dart` gates its own `/service-requests` read: on
/// `service_request.view` from the effective set `GET /auth/me` reported, never on the
/// role string. TECHNICIAN holds that key by default, but a deployed database can hold
/// strictly less than the shipped defaults — `seedRbac` is prune-only for non-system
/// roles — so the grant is checked rather than assumed, and a caller without it is told
/// which permission is missing instead of being shown a 403 the screen cannot explain.
final FutureProvider<OpenRequestPool> openRequestPoolProvider =
    FutureProvider<OpenRequestPool>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);

  if (!(user?.has(PermissionKeys.serviceRequestView) ?? false)) {
    throw const WorkScopeUnavailable(
      'Нээлттэй дуудлагыг харах эрх байхгүй',
      detail: 'Эзэнгүй үйлчилгээний хүсэлтийн жагсаалтыг харахад '
          '"service_request.view" эрх шаардлагатай бөгөөд таны эрхийн санд '
          'одоогоор байхгүй байна. Эрхээ администратороор нэмүүлнэ үү.',
    );
  }

  final WorkRepository repository = ref.watch(workRepositoryProvider);
  final PaginatedData<ServiceRequestListItemModel> page =
      _unwrap(await repository.listOpenServiceRequests());

  return OpenRequestPool(items: page.items, total: page.total);
});

/// What the pool is currently doing about a claim.
///
/// Keyed by request id rather than held as one flag, because the pool is a list: a
/// pending claim must disable the row it belongs to and leave every other row tappable.
class ClaimState {
  const ClaimState({this.pendingId, this.message, this.failed = false});

  /// The row whose claim is in flight, if any.
  final String? pendingId;

  /// The outcome to show once it settles. Cleared by [ClaimController.dismiss].
  final String? message;
  final bool failed;

  bool isPending(String requestId) => pendingId == requestId;
}

/// Claims a row, then re-reads the pool.
///
/// The pool is invalidated rather than patched in memory. A successful claim removes the
/// row from the caller's own "Нээлттэй" list AND puts it into their planned queue, and a
/// lost race removes it too — for a different reason. Re-reading is the only version that
/// reports both correctly; splicing the row out locally would show the loser of a race a
/// pool that agrees with them and a server that does not.
///
/// A 409 is treated as an outcome, not an error. Two technicians tapping the same row at
/// the same moment is expected, and the server settling it is the feature working: the
/// loser is told plainly that somebody else took it, not shown a failure banner implying
/// the app broke.
final NotifierProvider<ClaimController, ClaimState> claimControllerProvider =
    NotifierProvider<ClaimController, ClaimState>(ClaimController.new);

class ClaimController extends Notifier<ClaimState> {
  @override
  ClaimState build() => const ClaimState();

  Future<void> claim(ServiceRequestListItemModel request) async {
    if (state.pendingId != null) return;
    state = ClaimState(pendingId: request.id);

    final ApiResult<void> result =
        await ref.read(workRepositoryProvider).claimServiceRequest(request.id);

    result.when(
      success: (_) {
        state =
            ClaimState(message: '${request.requestNumber} ажлыг өөртөө авлаа.');
        // The claimed request is now assigned work, so the planned queue is stale too.
        ref.invalidate(plannedWorkBoardProvider);
        // ...and so is the "Хүсэлт" list the row has just moved INTO. This is
        // the invalidation that makes the notice above the pool true: without it the
        // claimed request left the pool and appeared nowhere until the next refresh.
        ref.invalidate(assignedRequestsProvider);
        // The Нүүр tab counts the same rows and is a sibling tab rather than a pushed
        // route, so it is already built and will not re-read on its own. Leaving it
        // stale showed a technician a hero figure that disagreed with the list they had
        // just changed, until they thought to pull it down.
        ref.invalidate(homeOverviewProvider);
      },
      failure: (Failure failure) {
        state = ClaimState(message: _claimMessage(failure), failed: true);
      },
    );

    // Re-read either way. On success the row has left the pool; on failure the usual
    // cause is that it left the pool a moment earlier, in somebody else's hands.
    ref.invalidate(openRequestPoolProvider);
    // The request's own record now names an assignee either way — this caller, or the
    // colleague who won the race — so a detail screen already holding it is stale.
    ref.invalidate(serviceRequestDetailProvider(request.id));
  }

  void dismiss() => state = const ClaimState();
}

/// The refusal, in the words the technician needs.
///
/// A conflict is the only status with a meaning specific to this action, and it is the
/// one that must not read as breakage. Everything else falls back to the server's own
/// message, which is already written for this audience.
String _claimMessage(Failure failure) {
  // The conflict the endpoint raises when a concurrent claim won. `DUPLICATE_KEY` is
  // the backend's own code for it; matching on that rather than on the wording keeps
  // this working if the message is ever reworded.
  if (failure is ServerFailure && failure.code == 'DUPLICATE_KEY') {
    return 'Энэ ажлыг өөр ажилтан саяхан авчихсан байна.';
  }
  return failure.message;
}

// -- Material catalogue ------------------------------------------------------

/// The material catalogue, loaded once per session.
///
/// Gated on `material.view` rather than assumed from the role, like every other read in
/// this tab: a deployed role can hold strictly less than the shipped default, and a picker
/// that always fails is worse than one that is absent.
final FutureProvider<List<MaterialItemModel>> materialCatalogueProvider =
    FutureProvider<List<MaterialItemModel>>((Ref ref) async {
  final AppUser? user = ref.watch(currentUserProvider);
  if (!(user?.has(PermissionKeys.materialView) ?? false)) {
    return const <MaterialItemModel>[];
  }
  final PaginatedData<MaterialItemModel> page =
      _unwrap(await ref.watch(workRepositoryProvider).listMaterialItems());
  return page.items;
});

// -- Detail ------------------------------------------------------------------

/// One planned work — its tasks, floor roll-up, materials, report state, available
/// actions and completion blockers — plus every write that acts on it.
///
/// A notifier rather than a `FutureProvider` because each of those writes answers
/// with the full re-read record. `POST .../tasks/:taskId/progress` returns the whole
/// [PlannedWorkModel] despite its name, as does every transition and report call, so
/// the response is published straight into state instead of triggering a re-fetch:
/// the task list, the roll-up percentage, the blockers and the action list all move
/// in one frame, and the screen never shows a half-updated record or a spinner it
/// did not need.
class PlannedWorkDetailNotifier
    extends FamilyAsyncNotifier<PlannedWorkModel, String> {
  @override
  Future<PlannedWorkModel> build(String plannedWorkId) async {
    final WorkRepository repository = ref.watch(workRepositoryProvider);
    return _unwrap(await repository.getPlannedWork(plannedWorkId));
  }

  WorkRepository get _repository => ref.read(workRepositoryProvider);

  /// Publishes a write's response, and refreshes the list behind it, since the card
  /// there shows the progress and status that just moved.
  ApiResult<PlannedWorkModel> _publish(ApiResult<PlannedWorkModel> result) {
    final PlannedWorkModel? work = result.dataOrNull;
    if (work != null) {
      state = AsyncValue<PlannedWorkModel>.data(work);
      ref.invalidate(plannedWorkBoardProvider);
      // Every write reachable through this notifier changes the assembled preview: a
      // quantity, a photo count, a task note, the conclusion or the report's status. The
      // detail response does not carry the preview, so it has to be re-read rather than
      // published, and it is only fetched at all once somebody opens it.
      ref.invalidate(plannedWorkReportBundleProvider(arg));
    }
    return result;
  }

  /// Records the CUMULATIVE completed quantity for one sub-task.
  Future<ApiResult<PlannedWorkModel>> recordProgress({
    required String taskId,
    required RecordTaskProgressRequest request,
  }) async {
    return _publish(
      await _repository.recordTaskProgress(
        plannedWorkId: arg,
        taskId: taskId,
        request: request,
      ),
    );
  }

  /// Uploads one evidence photo against a sub-task.
  ///
  /// The reply is the whole record, so publishing it can flip the task's status to
  /// DONE and clear a completion blocker in the same frame the thumbnail appears —
  /// which is exactly what happens when the last missing picture lands on a task
  /// whose quantity was already full. The invalidated photo-bytes provider is not
  /// needed: a new photo has a new file id and therefore a new family key.
  Future<ApiResult<PlannedWorkModel>> attachPhoto({
    required String taskId,
    required TaskPhotoKind kind,
    required CapturedPhoto photo,
  }) async {
    return _publish(
      await _repository.attachTaskPhoto(
        plannedWorkId: arg,
        taskId: taskId,
        kind: kind,
        photo: photo,
      ),
    );
  }

  Future<ApiResult<PlannedWorkModel>> transition({
    required PlannedWorkAction action,
    String? reason,
  }) async {
    return _publish(
      await _repository.transition(
        plannedWorkId: arg,
        action: action,
        reason: reason,
      ),
    );
  }

  Future<ApiResult<PlannedWorkModel>> saveReport({
    String? conclusion,
    String? recommendation,
  }) async {
    return _publish(
      await _repository.updateReport(
        plannedWorkId: arg,
        conclusion: conclusion,
        recommendation: recommendation,
      ),
    );
  }

  Future<ApiResult<PlannedWorkModel>> submitReport() async {
    return _publish(await _repository.submitReport(arg));
  }

  /// Full re-read, for pull-to-refresh.
  Future<void> reload() async {
    state = await AsyncValue.guard<PlannedWorkModel>(
      () async => _unwrap(await _repository.getPlannedWork(arg)),
    );
  }
}

final AsyncNotifierProviderFamily<PlannedWorkDetailNotifier, PlannedWorkModel,
        String> plannedWorkDetailProvider =
    AsyncNotifierProvider.family<PlannedWorkDetailNotifier, PlannedWorkModel,
        String>(
  PlannedWorkDetailNotifier.new,
);

// -- Report preview ----------------------------------------------------------

/// `GET /planned-work/:id/report`: the report row plus the server's assembled content.
///
/// A second read on purpose. The detail response carries `report` — the row and its gates
/// — but never the `preview`, which the server assembles on every call from the tasks, the
/// floor roll-up and the materials WHETHER OR NOT a report row exists. That is what makes
/// it worth fetching before the work is finished: it is the write-up as a reviewer will
/// see it, available while there is still time to fix what it says.
///
/// A family rather than part of the detail notifier so it is fetched only when something
/// actually asks for it — the preview costs the server five queries and most visits to the
/// screen never open it.
final FutureProviderFamily<PlannedWorkReportBundleModel, String>
    plannedWorkReportBundleProvider =
    FutureProvider.family<PlannedWorkReportBundleModel, String>(
        (Ref ref, String plannedWorkId) async {
  final WorkRepository repository = ref.watch(workRepositoryProvider);
  return _unwrap(await repository.getReport(plannedWorkId));
});

// -- Consolidated inspection report ------------------------------------------

/// The inspection report and whether one may be produced yet, as one value.
///
/// The two are always read and rendered together: with no report the card can only offer
/// generation, and whether it may offer it is precisely what readiness answers.
class InspectionReportState {
  const InspectionReportState({required this.report, required this.readiness});

  /// Null until a draft has been generated. `GET .../inspection-report` 404s until then,
  /// which the data source maps to null.
  final InspectionReportModel? report;

  final InspectionReportReadinessModel readiness;

  InspectionReportState withReport(InspectionReportModel report) =>
      InspectionReportState(report: report, readiness: readiness);
}

/// Reads and writes the consolidated inspection report for one planned work.
///
/// A notifier rather than a `FutureProvider` for the same reason the detail is one: every
/// write answers with the whole re-read report, so the response is published straight into
/// state and the card moves in one frame without a second GET.
class InspectionReportNotifier
    extends FamilyAsyncNotifier<InspectionReportState, String> {
  @override
  Future<InspectionReportState> build(String plannedWorkId) async {
    final WorkRepository repository = ref.watch(workRepositoryProvider);

    // Readiness first, and it is the only unconditional call: it says whether a report
    // exists, so fetching the report itself before knowing that would mean sending a
    // request whose expected answer is a 404.
    final InspectionReportReadinessModel readiness =
        _unwrap(await repository.getInspectionReportReadiness(plannedWorkId));

    final InspectionReportModel? report = readiness.hasReport
        ? _unwrap(await repository.getInspectionReport(plannedWorkId))
        : null;

    return InspectionReportState(report: report, readiness: readiness);
  }

  WorkRepository get _repository => ref.read(workRepositoryProvider);

  /// Publishes a write's response.
  ///
  /// The planned-work detail is invalidated alongside it because the report's status is
  /// part of that record's own read model, and because the two cards sit one above the
  /// other on the same screen: leaving one of them stale would show two versions of the
  /// same fact at once.
  ApiResult<InspectionReportModel> _publish(
    ApiResult<InspectionReportModel> result,
  ) {
    final InspectionReportModel? report = result.dataOrNull;
    final InspectionReportState? current = state.valueOrNull;

    if (report != null && current != null) {
      state =
          AsyncValue<InspectionReportState>.data(current.withReport(report));
      ref.invalidate(plannedWorkDetailProvider(arg));
    }
    return result;
  }

  /// Composes the draft from the finished sub-tasks. Refused with a 400, naming each
  /// unfinished sub-task, while readiness is not met.
  Future<ApiResult<InspectionReportModel>> generate() async {
    return _publish(await _repository.generateInspectionReport(arg));
  }

  Future<ApiResult<InspectionReportModel>> save(
    UpdateInspectionReportRequest request,
  ) async {
    return _publish(
      await _repository.updateInspectionReport(
        plannedWorkId: arg,
        request: request,
      ),
    );
  }

  Future<ApiResult<InspectionReportModel>> submit() async {
    return _publish(await _repository.submitInspectionReport(arg));
  }
}

final AsyncNotifierProviderFamily<InspectionReportNotifier,
        InspectionReportState, String> inspectionReportProvider =
    AsyncNotifierProvider.family<InspectionReportNotifier,
        InspectionReportState, String>(
  InspectionReportNotifier.new,
);

// -- Files -------------------------------------------------------------------

/// Bytes of an evidence photo. `GET /files/:fileId` needs the Bearer header, so a
/// photo cannot be rendered with `Image.network`.
final FutureProviderFamily<Uint8List, String> workFileBytesProvider =
    FutureProvider.family<Uint8List, String>((Ref ref, String fileId) async {
  final WorkRepository repository = ref.watch(workRepositoryProvider);
  return _unwrap(await repository.downloadFile(fileId));
});
