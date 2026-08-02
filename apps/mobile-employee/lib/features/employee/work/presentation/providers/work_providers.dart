import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../identity/employee_self.dart';
import '../../../identity/employee_self_provider.dart';
import '../../../shared/service_request_models.dart';
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
  /// apps/backend/src/modules/planned-work/planned-work.scope.ts. Holding any one of
  /// these lifts the assignment scope server-side, so the app must not narrow its own
  /// controls for a dispatcher or a manager who is legitimately acting on somebody
  /// else's job.
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
enum WorkScope {
  mine('Миний'),
  team('Багийн'),

  /// The unclaimed pool — and the one segment that is NOT planned work.
  ///
  /// `plannedWorkListQuerySchema` has no "unassigned" filter, so there is no way to ask
  /// `GET /planned-work` for the jobs nobody holds. `GET /service-requests` does answer
  /// that question, for requests, which is what this segment lists: see
  /// [openRequestPoolProvider]. The two are not interchangeable and are not merged into
  /// one board — [PlannedWorkBoard] could not hold these rows.
  open('Нээлттэй');

  const WorkScope(this.label);

  final String label;

  /// True for the two segments [plannedWorkBoardProvider] serves.
  bool get isPlannedWork => this != WorkScope.open;
}

final NotifierProvider<WorkScopeController, WorkScope> workScopeProvider =
    NotifierProvider<WorkScopeController, WorkScope>(WorkScopeController.new);

class WorkScopeController extends Notifier<WorkScope> {
  @override
  WorkScope build() => WorkScope.mine;

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
    this.isUnfiltered = false,
  });

  final List<PlannedWorkListItemModel> overdue;
  final List<PlannedWorkListItemModel> active;
  final List<PlannedWorkListItemModel> upcoming;
  final List<PlannedWorkListItemModel> finished;

  /// True when no `employeeId` filter could be applied and this is every planned
  /// work in the system rather than the caller's own. The screen must say so:
  /// unlabelled, it is indistinguishable from a very busy technician's queue.
  final bool isUnfiltered;

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
    bool isUnfiltered = false,
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
      isUnfiltered: isUnfiltered,
    );
  }
}

/// Raised, and rendered, when the selected scope has nothing behind it.
///
/// Deliberately not a [Failure]: nothing failed. Either the account is not linked to an
/// employee card yet, or it is not in a team, or it does not hold the permission the
/// segment's read needs. All three are situations to explain, not errors to apologise
/// for, so they carry their own type and get their own presentation.
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

/// Whether the user has explicitly asked to see the unfiltered system-wide list.
///
/// Off by default and never set automatically. It exists because an account that
/// cannot be matched to an employee card would otherwise have a completely dead tab,
/// while `planned_work.view` already exposes every planned work in the system to it.
/// So the data is offered — but only on a deliberate tap, and only under a banner
/// that says what it is. The dishonest version of this feature is the one that
/// silently drops the `employeeId` filter and keeps the heading "Миний ажил".
final NotifierProvider<UnfilteredWorkController, bool>
    showUnfilteredWorkProvider =
    NotifierProvider<UnfilteredWorkController, bool>(
        UnfilteredWorkController.new);

class UnfilteredWorkController extends Notifier<bool> {
  @override
  bool build() => false;

  void enable() => state = true;
  void disable() => state = false;
}

/// The board for the currently selected planned-work scope.
///
/// Both server-side filters this can send — `employeeId` and `teamId` — come from
/// the resolved identity. When the identity is unresolved the provider raises rather
/// than quietly dropping the filter: an unfiltered `GET /planned-work` returns every
/// planned work in the system, and presenting that as "Миний ажил" would be a lie
/// the user has no way to detect. The unfiltered list is reachable, but only through
/// [showUnfilteredWorkProvider] and only labelled as what it is.
///
/// [WorkScope.open] is not served here — the pool that segment names is service
/// requests, which [PlannedWorkBoard] cannot hold — so the screen watches
/// [openRequestPoolProvider] for it instead and this provider is not read while it is
/// selected. The filter below therefore only has to tell "багийн" from "миний", and an
/// open scope arriving anyway reads as "миний": narrowed to the caller's own id, never
/// as the unfiltered system-wide list.
final FutureProvider<PlannedWorkBoard> plannedWorkBoardProvider =
    FutureProvider<PlannedWorkBoard>((Ref ref) async {
  final WorkScope scope = ref.watch(workScopeProvider);
  final bool unfiltered = ref.watch(showUnfilteredWorkProvider);
  final bool teamScope = scope == WorkScope.team;

  if (unfiltered) {
    final WorkRepository repository = ref.watch(workRepositoryProvider);
    final PaginatedData<PlannedWorkListItemModel> all =
        _unwrap(await repository.listPlannedWork());
    return PlannedWorkBoard.from(all.items, isUnfiltered: true);
  }

  final WorkIdentity identity = await ref.watch(workIdentityProvider.future);
  if (identity is! ResolvedWorkIdentity) {
    final UnresolvedWorkIdentity unresolved =
        identity as UnresolvedWorkIdentity;
    throw WorkScopeUnavailable(unresolved.title, detail: unresolved.detail);
  }

  if (teamScope && identity.teamId == null) {
    throw const WorkScopeUnavailable(
      'Та багт бүртгэгдээгүй байна',
      detail:
          'Таны ажилтны карт ямар нэг багт хамааруулагдаагүй тул багийн ажлыг '
          'шүүх боломжгүй. Багийн бүртгэлээ администратороор хийлгэнэ үү.',
    );
  }

  final WorkRepository repository = ref.watch(workRepositoryProvider);
  final PaginatedData<PlannedWorkListItemModel> page = _unwrap(
    await repository.listPlannedWork(
      employeeId: teamScope ? null : identity.employeeId,
      teamId: teamScope ? identity.teamId : null,
    ),
  );

  return PlannedWorkBoard.from(page.items);
});

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
      },
      failure: (Failure failure) {
        state = ClaimState(message: _claimMessage(failure), failed: true);
      },
    );

    // Re-read either way. On success the row has left the pool; on failure the usual
    // cause is that it left the pool a moment earlier, in somebody else's hands.
    ref.invalidate(openRequestPoolProvider);
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

// -- Sub-task materials ------------------------------------------------------

/// The catalogue, loaded once per session and shared by every sub-task sheet.
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

/// Which sub-task's materials to load. A record so the family key compares by value.
typedef TaskRef = ({String plannedWorkId, String taskId});

/// What one sub-task consumed, and the writes that change it.
///
/// Re-reads after every write rather than patching the list in memory. A usage row is an
/// event the server stamps — with who used it and when — so the row that comes back is not
/// the row that was sent, and echoing the local guess would show a technician a date and a
/// name the server did not actually record.
final AsyncNotifierProviderFamily<TaskMaterialsNotifier, List<TaskMaterialUsageModel>, TaskRef>
    taskMaterialsProvider = AsyncNotifierProvider.family<TaskMaterialsNotifier,
        List<TaskMaterialUsageModel>, TaskRef>(TaskMaterialsNotifier.new);

class TaskMaterialsNotifier
    extends FamilyAsyncNotifier<List<TaskMaterialUsageModel>, TaskRef> {
  @override
  Future<List<TaskMaterialUsageModel>> build(TaskRef arg) async {
    final AppUser? user = ref.watch(currentUserProvider);
    if (!(user?.has(PermissionKeys.materialView) ?? false)) {
      return const <TaskMaterialUsageModel>[];
    }
    return _unwrap(
      await ref.watch(workRepositoryProvider).listTaskMaterials(
            plannedWorkId: arg.plannedWorkId,
            taskId: arg.taskId,
          ),
    );
  }

  Future<String?> add({
    required String materialItemId,
    required double quantity,
    required MaterialUnit unit,
    String? note,
  }) async {
    final ApiResult<TaskMaterialUsageModel> result =
        await ref.read(workRepositoryProvider).addTaskMaterial(
              plannedWorkId: arg.plannedWorkId,
              taskId: arg.taskId,
              materialItemId: materialItemId,
              quantity: quantity,
              unit: unit,
              note: note,
            );

    return result.when(
      success: (_) {
        ref.invalidateSelf();
        return null;
      },
      failure: (Failure failure) => failure.message,
    );
  }

  Future<String?> remove(String usageId) async {
    final ApiResult<void> result = await ref.read(workRepositoryProvider).removeTaskMaterial(
          plannedWorkId: arg.plannedWorkId,
          taskId: arg.taskId,
          usageId: usageId,
        );

    return result.when(
      success: (_) {
        ref.invalidateSelf();
        return null;
      },
      failure: (Failure failure) => failure.message,
    );
  }
}

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
