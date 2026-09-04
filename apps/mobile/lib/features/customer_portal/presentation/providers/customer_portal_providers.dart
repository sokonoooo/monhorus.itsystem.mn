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
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../data/models/survey_model.dart';
import '../../data/repositories/customer_portal_repository_impl.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/entities/server_vocabulary.dart';
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

// -- Vocabulary ---------------------------------------------------------------

/// Reads `GET /vocabulary` once per session and installs the answer.
///
/// Riverpod caches the future, so the four tabs share one request. Watched by the
/// shell, which is what starts it: there is nothing to fetch before somebody is signed
/// in, and the endpoint is authenticated.
///
/// Keyed on the account id rather than on the whole [AppUser]. `/auth/me` is
/// re-requested on mount to refresh the permission set and each answer is a new object;
/// watching the object itself would re-fetch the vocabulary every time one landed, for
/// words that cannot have changed.
///
/// **Every failure resolves to [ServerVocabulary.empty] on purpose.** A 401, a 403, a
/// 500, a timeout, a phone with no signal, a body this binary could not parse - none of
/// them is installed, and every label and colour in the portal stays the one it was
/// compiled with. There is no error state to render and no retry to offer, because
/// there is nothing for the reader to do about it and nothing missing from their
/// screen: this call decides what the words are called, not whether there are any.
/// Note the deliberate absence of [_unwrap]: unwrapping would throw the failure into
/// `AsyncValue.error`, and an error is exactly what this must not become.
final FutureProvider<ServerVocabulary> serverVocabularyProvider =
    FutureProvider<ServerVocabulary>((Ref ref) async {
  final String? userId =
      ref.watch(currentUserProvider.select((AppUser? user) => user?.id));
  if (userId == null) return ServerVocabulary.empty;

  final ApiResult<ServerVocabulary> result =
      await ref.watch(customerPortalRepositoryProvider).getVocabulary();

  final ServerVocabulary? vocabulary = result.dataOrNull;
  if (vocabulary == null) return ServerVocabulary.empty;

  installServerVocabulary(vocabulary);
  return vocabulary;
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

/// A ceiling on every paging loop below, and on none of the things being counted.
///
/// `totalPages` is the server's own arithmetic; an unbounded loop against a server
/// that miscounts it would never return. Twenty pages of 100 is the same ceiling the
/// admin web's floor screen walks under.
const int _maxPagesWalked = 20;

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

/// Every object on the floor, not the first hundred.
///
/// `objectListQuerySchema` caps `limit` at 100, so a single request silently lost every
/// object past the first page — a floor with 120 of them drew 100 pins and gave no hint
/// that twenty were missing. Worse, the plan tab counts the unplaced from this same
/// list: «Планд байрлуулаагүй N төхөөрөмж байна» computed over a truncated read is a
/// figure that reads as an all-clear about objects nobody was ever shown. Pages are
/// walked in order because the first response is what says how many there are.
final FutureProviderFamily<List<ObjectListItemModel>, String> floorObjectsProvider =
    FutureProvider.family<List<ObjectListItemModel>, String>(
        (Ref ref, String floorId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final ResolvedCustomerScope scope = _requireScope(ref);

  final List<ObjectListItemModel> all = <ObjectListItemModel>[];
  for (int page = 1; page <= _maxPagesWalked; page++) {
    final PaginatedData<ObjectListItemModel> slice = _unwrap(
      await repository.listObjects(scope, floorId: floorId, page: page),
    );
    all.addAll(slice.items);
    // An empty page means there is nothing further to read; carrying on would loop
    // against a server that disagrees with its own `totalPages`.
    if (slice.items.isEmpty || page >= slice.totalPages) break;
  }
  return List<ObjectListItemModel>.unmodifiable(all);
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

/// What a walk over a set of service requests came back with.
///
/// [complete] is the point of the type. A caller has to be able to say either "there
/// are no more" or "no more turned up in what we read", and those are different
/// statements: only a walk that reached the end of the list has earned the first one.
/// A bare list cannot tell the caller which it is holding, and every screen that got
/// one guessed — always the confident one.
///
/// [total] is the server's own count, which is a different figure from
/// `requests.length` whenever the walk fell short, and the only honest thing to print
/// as "how many requests you have".
typedef CustomerServiceRequests = ({
  List<ServiceRequestListItemModel> requests,
  int total,
  bool complete,
});

/// Every service request in scope, not the first hundred.
///
/// `serviceRequestListQuerySchema` caps `limit` at 100 and the list endpoint takes a
/// single `status` value, while "active" spans twelve of the fourteen statuses — so the
/// split has to happen on the device, over the whole set. Read as one page it was not
/// the whole set: a customer with 150 requests saw 100 of them under tabs that carried
/// no total, no pager and no hint that a third of their history was missing.
///
/// Pages are walked in order, because the first response is what says how many there
/// are, and under [_maxPagesWalked], because `totalPages` is the server's own
/// arithmetic. Falling out at that ceiling is what makes [CustomerServiceRequests
/// .complete] false, so the screen qualifies what it prints instead of passing a
/// partial read off as the lot.
Future<CustomerServiceRequests> _allServiceRequests(
  CustomerPortalRepository repository,
  ResolvedCustomerScope scope, {
  String? buildingId,
}) async {
  final List<ServiceRequestListItemModel> all = <ServiceRequestListItemModel>[];
  int total = 0;
  bool complete = false;

  for (int page = 1; page <= _maxPagesWalked; page++) {
    final PaginatedData<ServiceRequestListItemModel> slice = _unwrap(
      await repository.listServiceRequests(
        scope,
        buildingId: buildingId,
        page: page,
        limit: 100,
      ),
    );
    if (page == 1) total = slice.total;
    all.addAll(slice.items);
    // Reaching the last page — or one the server answered empty — is what makes the
    // read exhaustive. Falling out of the loop at the ceiling does not.
    if (slice.items.isEmpty || page >= slice.totalPages) {
      complete = true;
      break;
    }
  }

  return (
    requests: List<ServiceRequestListItemModel>.unmodifiable(all),
    // A walk that read more than the first page said it would is still describing the
    // set it read; never report fewer than are in hand.
    total: total < all.length ? all.length : total,
    complete: complete,
  );
}

/// The customer's own requests, newest first, split into active and finished in the UI.
final FutureProvider<CustomerServiceRequests> customerServiceRequestsProvider =
    FutureProvider<CustomerServiceRequests>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _allServiceRequests(repository, _requireScope(ref));
});

/// What a walk over a building's requests came back with, and whether that is all of
/// them. The floor history tab's own view of [CustomerServiceRequests].
typedef BuildingServiceHistory = ({
  List<ServiceRequestListItemModel> requests,
  bool complete,
});

/// Requests raised against one building. Used for a floor's history tab, which the
/// API has no dedicated endpoint for.
///
/// `serviceRequestListQuerySchema` has no `floorId`, so a floor's history can only be
/// found by reading the building's requests and narrowing them here. Read as a single
/// page of 100 — newest first — a floor whose work is older than the building's most
/// recent hundred requests came back empty, and the tab printed «Энэ давхарт
/// бүртгэгдсэн үйлчилгээний хүсэлт алга байна»: an assertion of zero about a floor
/// with a full service record. Every page is therefore walked, up to
/// [_maxPagesWalked]; when the ceiling cuts the walk short, [BuildingServiceHistory
/// .complete] is false and the screen qualifies what it says instead of claiming a
/// zero it has not earned.
final FutureProviderFamily<BuildingServiceHistory, String>
    buildingServiceRequestsProvider =
    FutureProvider.family<BuildingServiceHistory, String>(
        (Ref ref, String buildingId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  final CustomerServiceRequests walked = await _allServiceRequests(
    repository,
    _requireScope(ref),
    buildingId: buildingId,
  );
  return (requests: walked.requests, complete: walked.complete);
});

final FutureProviderFamily<ServiceRequestDetailModel, String>
    serviceRequestDetailProvider =
    FutureProvider.family<ServiceRequestDetailModel, String>(
        (Ref ref, String requestId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getServiceRequest(requestId));
});

/// The technician's approved conclusion for one request, or null when there is none.
///
/// Deliberately NOT watched by the request detail screen unconditionally. The detail
/// response carries `hasApprovedReport`, and the report tab reads that flag first:
/// watching this provider is what issues the HTTP call, so a request with no approved
/// conclusion never makes one. A null here therefore means the flag and the endpoint
/// disagreed — a report un-approved between the two reads, or a race — and the screen
/// shows the same not-ready state either way.
final FutureProviderFamily<CustomerWorkReportModel?, String>
    customerWorkReportProvider =
    FutureProvider.family<CustomerWorkReportModel?, String>(
        (Ref ref, String requestId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getCustomerWorkReport(requestId));
});

// -- Survey ------------------------------------------------------------------

/// The requests this customer has been asked to rate and has not finished rating.
///
/// Scoped to the caller by the server, so it takes no [ResolvedCustomerScope] — the
/// same arrangement `/notifications` has. An empty list is the ordinary answer and the
/// screens say nothing at all when it comes back that way; a survey prompt shown to
/// somebody with nothing to answer is worse than no prompt.
///
/// Only watched behind [canSubmitSurveyProvider]. The endpoint needs
/// `portal.survey.submit`, so an account without it would be answered 403 and the
/// prompt would render an error where there is no problem.
final FutureProvider<List<SurveyPendingItemModel>> pendingSurveysProvider =
    FutureProvider<List<SurveyPendingItemModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.listPendingSurveys());
});

/// The survey form for one request, or null when there is nothing to rate.
///
/// Deliberately NOT watched unconditionally by the request screen. Watching it is what
/// issues `GET /surveys/requests/:id/form`, and that endpoint answers 404 for every
/// request with no open survey — which is most of them — so the screen reads
/// [pendingSurveysProvider] first and only asks for a form it has been told exists.
/// The same rule the report tab follows with `hasApprovedReport`.
final FutureProviderFamily<SurveyFormModel?, String> surveyFormProvider =
    FutureProvider.family<SurveyFormModel?, String>(
        (Ref ref, String requestId) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.getSurveyForm(requestId));
});

/// Whether the API would accept a survey response from this account.
///
/// Read straight from the caller's effective permission set, exactly as
/// [canCreateServiceRequestProvider] is. One key only: `DEFAULT_ROLE_PERMISSIONS`
/// grants `portal.survey.submit` to the customer role, and the two staff survey keys
/// (`survey.manage_questions`, `survey.view_results`) configure and read the survey
/// rather than answer it, so neither belongs here.
///
/// The permission set is empty until the first `/auth/me`, so this reads false until
/// then and the prompt stays hidden rather than being shown and refused.
final Provider<bool> canSubmitSurveyProvider = Provider<bool>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user == null) return false;
  return user.has(PermissionKeys.portalSurveySubmit);
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

  /// Devices in the healthiest configured band, as a percent of those assessed.
  ///
  /// Null when nothing has been assessed, so the card shows a dash rather than a
  /// misleading 0 percent or 100 percent — and null too on an installation whose
  /// ladder this build could make no sense of, because there is then no band that
  /// means "nothing to do here".
  int? get healthyPercent {
    if (assessedTotal == 0) return null;
    final RiskLevel? healthy = healthiestRiskBand();
    if (healthy == null) return null;
    return ((countOf(healthy) / assessedTotal) * 100).round();
  }

  /// Both figures are the same rule the per-building `riskSummary` uses, called rather
  /// than restated: they were spelled out as `ATTENTION + SCHEDULE_REPAIR` and
  /// `CRITICAL + OUT_OF_SERVICE` in two files at once, and the hero headline reads off
  /// these.
  int get attentionCount => attentionTotalOver(countOf);

  int get criticalCount => severeTotalOver(countOf);

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
  final CustomerServiceRequests requestWalk =
      await _allServiceRequests(repository, scope);

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
    requests: requestWalk.requests,
    riskCounts: counts,
    unassessedCount: unassessed,
  );
});

/// The equipment types a call may be raised against.
///
/// Not scoped to the customer: the catalogue is global, and which types are callable is an
/// administrator's decision rather than a per-organisation one. Kept a plain FutureProvider
/// so the sheet gets the same `.when(data/loading/error)` shape as the building list beside
/// it.
final FutureProvider<List<CallableObjectTypeModel>> callableObjectTypesProvider =
    FutureProvider<List<CallableObjectTypeModel>>((Ref ref) async {
  final CustomerPortalRepository repository =
      ref.watch(customerPortalRepositoryProvider);
  return _unwrap(await repository.listCallableObjectTypes());
});
