import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/paginated_data.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/datasources/customer_portal_remote_data_source.dart';
import '../../data/models/notification_model.dart';
import '../../data/models/object_master_model.dart';
import '../../data/models/object_node_model.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../data/repositories/customer_portal_repository_impl.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/repositories/customer_portal_repository.dart';

// -- Dependency graph --------------------------------------------------------

final Provider<CustomerPortalRepository> customerPortalRepositoryProvider =
    Provider<CustomerPortalRepository>((Ref ref) {
  return CustomerPortalRepositoryImpl(
    CustomerPortalRemoteDataSource(ref.watch(dioClientProvider)),
  );
});

/// Which customer the signed-in user may read.
///
/// Derived from the authenticated session - `AppUser.customerId`, as reported by
/// `GET /auth/me` - and from nothing else. There is deliberately no setter, no
/// family parameter and no picker: a screen cannot pass an id in, so no code path
/// exists by which a customer id chosen on the device could become the scope. Tests
/// override this provider to stand in for a session; that override is the only way to
/// supply one, which is the point.
///
/// An account with no `customerId` is an account an administrator has not linked yet.
/// It resolves to [UnavailableCustomerScope.accountNotLinked] so the screens explain
/// the situation instead of issuing unscoped requests or rendering an empty portal
/// that looks like an organisation with no buildings.
final Provider<CustomerScope> customerScopeProvider = Provider<CustomerScope>(
  (Ref ref) {
    final AppUser? user = ref.watch(currentUserProvider);
    if (user == null) return UnavailableCustomerScope.noSession;

    final String? customerId = user.customerId;
    if (customerId == null || customerId.isEmpty) {
      return UnavailableCustomerScope.accountNotLinked;
    }

    return ResolvedCustomerScope(
      customerId: customerId,
      customerName: user.customerName,
    );
  },
);

/// Whether the API would accept a service request from this account.
///
/// Read straight from the caller's effective permission set; nothing about the role
/// or the scope is assumed. Both create keys are accepted because the two kinds of
/// account raise a request under different ones: `DEFAULT_ROLE_PERMISSIONS.CUSTOMER`
/// in permissions.ts grants `portal.service_request.create` and no staff key, while a
/// staff account acting in this flow would hold `service_request.create`.
///
/// The permission set is empty until the first `/auth/me` - the login response is a
/// bare `UserDto` - so this reads false until then, and the control stays hidden
/// rather than being shown and refused.
final Provider<bool> canCreateServiceRequestProvider = Provider<bool>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user == null) return false;
  return user.has(PermissionKeys.portalServiceRequestCreate) ||
      user.has(PermissionKeys.serviceRequestCreate);
});

/// Whether the API would serve this account an object's timeline.
///
/// `GET /objects/:objectId/history` is deliberately staff-only and says so in writing:
/// the timeline folds in audit rows, planned-work tasks and internal service-request
/// detail, none of which is customer facing. So there is no portal key to accept here -
/// only the staff `object_master.view` opens it, and a customer holds none.
///
/// This reads false for every customer account, which is the correct answer: the section
/// is hidden rather than rendered and refused.
final Provider<bool> canViewObjectHistoryProvider = Provider<bool>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user == null) return false;
  return user.has(PermissionKeys.objectMasterView);
});

// -- Helpers -----------------------------------------------------------------

/// Unwraps an [ApiResult] for an async provider, throwing the [Failure] so it lands
/// in `AsyncValue.error` with its Mongolian message intact.
T _unwrap<T>(ApiResult<T> result) => result.when(
      success: (T data) => data,
      failure: (Failure failure) => throw failure,
    );

/// Reads the scope, refusing to proceed when it is not resolved.
///
/// A screen checks the scope itself and renders an explanation, so this throw is a
/// backstop: it guarantees no provider can ever issue a request without a customer
/// id, however the widget tree is later rearranged.
ResolvedCustomerScope _requireScope(Ref ref) {
  final CustomerScope scope = ref.watch(customerScopeProvider);
  if (scope is ResolvedCustomerScope) return scope;
  final UnavailableCustomerScope unavailable = scope as UnavailableCustomerScope;
  throw ServerFailure(unavailable.detail, code: 'CUSTOMER_SCOPE_UNAVAILABLE');
}

/// Every building the customer owns, not just the first page of them.
///
/// `buildingListQuerySchema` caps `limit` at 100, so no single request can be assumed
/// to cover an organisation of any size. Both callers here sum or count over the
/// result — the home hero prints how many buildings there are and adds up each one's
/// `riskSummary` — and a first-page sum shown as the whole is a truncated figure with
/// nothing on screen saying so. `PaginatedData.total` says whether one page was
/// enough; when it was not, the remaining pages are read before anything is summed.
///
/// The returned page carries the server's own `total`, so a caller can still print
/// the true count rather than the length of what it happened to receive.
Future<PaginatedData<BuildingModel>> _allBuildings(
  CustomerPortalRepository repository,
  ResolvedCustomerScope scope,
) async {
  final PaginatedData<BuildingModel> first =
      _unwrap(await repository.listBuildings(scope));
  if (first.items.length >= first.total) return first;

  final List<BuildingModel> all = List<BuildingModel>.of(first.items);
  for (int page = first.page + 1; page <= first.totalPages; page++) {
    final PaginatedData<BuildingModel> next =
        _unwrap(await repository.listBuildings(scope, page: page));
    // A page that came back empty means there is nothing further to read; carrying
    // on would loop against a server that disagrees with its own `totalPages`.
    if (next.items.isEmpty) break;
    all.addAll(next.items);
  }

  return PaginatedData<BuildingModel>(
    items: List<BuildingModel>.unmodifiable(all),
    page: 1,
    limit: first.limit,
    total: first.total,
    totalPages: first.totalPages,
  );
}

// -- Buildings ---------------------------------------------------------------

final FutureProvider<List<ProjectModel>> customerProjectsProvider =
    FutureProvider<List<ProjectModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<ProjectModel> page =
      _unwrap(await repository.listProjects(_requireScope(ref)));
  return page.items;
});

final FutureProvider<List<BuildingModel>> customerBuildingsProvider =
    FutureProvider<List<BuildingModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<BuildingModel> page =
      await _allBuildings(repository, _requireScope(ref));
  return page.items;
});

final FutureProviderFamily<BuildingModel, String> buildingProvider =
    FutureProvider.family<BuildingModel, String>((Ref ref, String buildingId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getBuilding(buildingId));
});

/// Floors of a building, ordered top floor first, as the prototype lists them.
final FutureProviderFamily<List<FloorModel>, String> buildingFloorsProvider =
    FutureProvider.family<List<FloorModel>, String>((Ref ref, String buildingId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<FloorModel> page =
      _unwrap(await repository.listFloors(buildingId));

  final List<FloorModel> floors = page.items.toList();
  floors.sort((FloorModel a, FloorModel b) {
    final int? left = a.floorNumber;
    final int? right = b.floorNumber;
    // Floors without a number sink to the bottom rather than pretending to be zero.
    if (left == null && right == null) return a.name.compareTo(b.name);
    if (left == null) return 1;
    if (right == null) return -1;
    return right.compareTo(left);
  });
  return floors;
});

// -- Floors and objects ------------------------------------------------------

final FutureProviderFamily<FloorModel, String> floorProvider =
    FutureProvider.family<FloorModel, String>((Ref ref, String floorId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getFloor(floorId));
});

final FutureProviderFamily<FloorPlanModel?, String> floorPlanProvider =
    FutureProvider.family<FloorPlanModel?, String>((Ref ref, String floorId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getFloorPlan(floorId));
});

/// The Өрөө/Бүс nodes of one floor, as the create-request sheet's zone picker lists
/// them.
///
/// Keyed by floor id, so choosing a different floor is a different provider instance
/// and the previous floor's zones can never be shown against it. An empty list is a
/// real answer — a floor whose zones an administrator has not registered yet — and the
/// caller says so in words rather than offering an empty control.
final FutureProviderFamily<List<ObjectNodeModel>, String> floorZonesProvider =
    FutureProvider.family<List<ObjectNodeModel>, String>(
        (Ref ref, String floorId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.listFloorZones(floorId));
});

final FutureProviderFamily<List<ObjectListItemModel>, String> floorObjectsProvider =
    FutureProvider.family<List<ObjectListItemModel>, String>(
        (Ref ref, String floorId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<ObjectListItemModel> page = _unwrap(
    await repository.listObjects(_requireScope(ref), floorId: floorId),
  );
  return page.items;
});

final FutureProviderFamily<ObjectDetailModel, String> objectDetailProvider =
    FutureProvider.family<ObjectDetailModel, String>((Ref ref, String objectId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getObject(objectId));
});

final FutureProviderFamily<ObjectHistoryModel, String> objectHistoryProvider =
    FutureProvider.family<ObjectHistoryModel, String>((Ref ref, String objectId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getObjectHistory(objectId));
});

// -- Service requests --------------------------------------------------------

/// The customer's own requests, newest first.
///
/// Fetched in one page of 100 - the schema's maximum - and split into active and
/// finished in the UI. The list endpoint accepts a single `status` value and the
/// active set spans twelve of the fourteen statuses, so a server-side filter cannot
/// express it. A customer with more than 100 requests would need paging, which V1
/// does not attempt.
final FutureProvider<List<ServiceRequestListItemModel>> customerServiceRequestsProvider =
    FutureProvider<List<ServiceRequestListItemModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<ServiceRequestListItemModel> page = _unwrap(
    await repository.listServiceRequests(_requireScope(ref), limit: 100),
  );
  return page.items;
});

/// Requests raised against one building. Used for a floor's history tab, which the
/// API has no dedicated endpoint for.
final FutureProviderFamily<List<ServiceRequestListItemModel>, String>
    buildingServiceRequestsProvider =
    FutureProvider.family<List<ServiceRequestListItemModel>, String>(
        (Ref ref, String buildingId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<ServiceRequestListItemModel> page = _unwrap(
    await repository.listServiceRequests(
      _requireScope(ref),
      buildingId: buildingId,
      limit: 100,
    ),
  );
  return page.items;
});

final FutureProviderFamily<ServiceRequestDetailModel, String>
    serviceRequestDetailProvider =
    FutureProvider.family<ServiceRequestDetailModel, String>(
        (Ref ref, String requestId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getServiceRequest(requestId));
});

// -- Notifications -----------------------------------------------------------

final FutureProvider<List<NotificationModel>> customerNotificationsProvider =
    FutureProvider<List<NotificationModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final PaginatedData<NotificationModel> page =
      _unwrap(await repository.listNotifications());
  return page.items;
});

final FutureProvider<int> unreadNotificationCountProvider =
    FutureProvider<int>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final NotificationUnreadCountModel count =
      _unwrap(await repository.getUnreadCount());
  return count.unread;
});

// -- Files -------------------------------------------------------------------

/// Bytes of a stored file. `GET /files/:fileId` needs the Bearer header, so an
/// attachment or floor plan cannot be rendered with `Image.network`.
final FutureProviderFamily<Uint8List, String> fileBytesProvider =
    FutureProvider.family<Uint8List, String>((Ref ref, String fileId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.downloadFile(fileId));
});

// -- Home summary ------------------------------------------------------------

/// The figures behind the home screen's KPI strip and roll-up card.
///
/// Every number here is a sum of values the API supplied. Nothing is estimated: the
/// per-band device counts come from each building's `riskSummary`, which the backend
/// computes, and the request counts come from the request list.
///
/// The sums run over every one of the customer's buildings, read across pages by
/// [_allBuildings], and [buildingTotal] carries the server's own count. Before that
/// the sums covered whatever the first page of 50 held, which past 50 buildings made
/// the hero stair and the headline partial figures presented as complete.
class CustomerHomeSummary {
  const CustomerHomeSummary({
    required this.buildings,
    required this.buildingTotal,
    required this.requests,
    required this.riskCounts,
    required this.unassessedCount,
  });

  final List<BuildingModel> buildings;

  /// How many buildings the customer has, as `GET /buildings` reported it in
  /// `total` — not how many records happened to arrive.
  ///
  /// [buildings] is read across every page, so the two agree; this stays the figure
  /// the screens print because it is the server's own count, and because a
  /// disagreement between them is exactly the truncation this field exists to make
  /// impossible to show silently. See [coversEveryBuilding].
  final int buildingTotal;

  final List<ServiceRequestListItemModel> requests;

  /// Device counts per band, summed across the customer's buildings.
  final Map<RiskLevel, int> riskCounts;
  final int unassessedCount;

  int countOf(RiskLevel level) => riskCounts[level] ?? 0;

  /// True when [riskCounts] and [unassessedCount] were summed over every building
  /// the server says the customer has.
  ///
  /// False only if the server's own `total` outran what paging could fetch, and it
  /// is the guard the band figures are drawn behind: a per-band count summed over
  /// some of the buildings is not a smaller version of the real answer, it is a
  /// different one, and the hero stair has no way to caveat itself.
  bool get coversEveryBuilding => buildings.length >= buildingTotal;

  int get assessedTotal =>
      riskCounts.values.fold(0, (int sum, int count) => sum + count);

  int get deviceTotal => assessedTotal + unassessedCount;

  /// Devices in the green band, as a percent of those that were assessed.
  ///
  /// Null when nothing has been assessed, so the card shows a dash rather than a
  /// misleading 0 percent or 100 percent.
  int? get healthyPercent {
    if (assessedTotal == 0) return null;
    return ((countOf(RiskLevel.normal) / assessedTotal) * 100).round();
  }

  int get attentionCount =>
      countOf(RiskLevel.attention) + countOf(RiskLevel.scheduleRepair);

  int get criticalCount =>
      countOf(RiskLevel.critical) + countOf(RiskLevel.outOfService);

  List<ServiceRequestListItemModel> get activeRequests => requests
      .where((ServiceRequestListItemModel request) =>
          request.status?.isActive ?? true)
      .toList(growable: false);

  List<ServiceRequestListItemModel> get finishedRequests => requests
      .where((ServiceRequestListItemModel request) =>
          request.status?.isTerminal ?? false)
      .toList(growable: false);

  /// Buildings the backend flagged as holding a red or black band device.
  List<BuildingModel> get criticalBuildings => buildings
      .where((BuildingModel building) => building.riskSummary.hasCritical)
      .toList(growable: false);
}

final FutureProvider<CustomerHomeSummary> customerHomeSummaryProvider =
    FutureProvider<CustomerHomeSummary>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final ResolvedCustomerScope scope = _requireScope(ref);

  final PaginatedData<BuildingModel> buildingPage =
      await _allBuildings(repository, scope);
  final PaginatedData<ServiceRequestListItemModel> requestPage =
      _unwrap(await repository.listServiceRequests(scope, limit: 100));

  final Map<RiskLevel, int> counts = <RiskLevel, int>{};
  int unassessed = 0;
  for (final BuildingModel building in buildingPage.items) {
    for (final RiskLevelCountModel entry in building.riskSummary.counts) {
      final RiskLevel? level = entry.level;
      if (level == null) continue;
      counts[level] = (counts[level] ?? 0) + entry.count;
    }
    unassessed += building.riskSummary.unassessedCount;
  }

  return CustomerHomeSummary(
    buildings: buildingPage.items,
    buildingTotal: buildingPage.total,
    requests: requestPage.items,
    riskCounts: counts,
    unassessedCount: unassessed,
  );
});
