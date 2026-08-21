import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../data/datasources/project_remote_data_source.dart';
import '../../data/models/inspection_models.dart';
import '../../data/models/object_models.dart';
import '../../data/models/report_record_models.dart';
import '../../data/models/project_models.dart';
import '../../data/repositories/project_repository_impl.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/repositories/project_repository.dart';

// -- Dependency graph --------------------------------------------------------

/// Built on the app's single [DioClient], so this tab shares the one Bearer token,
/// the one refresh queue and the one session-expiry hook with everything else.
final Provider<ProjectRepository> projectRepositoryProvider =
    Provider<ProjectRepository>((Ref ref) {
  return ProjectRepositoryImpl(
    ProjectRemoteDataSource(ref.watch(dioClientProvider)),
  );
});

// -- Permission gates --------------------------------------------------------

/// Whether the caller's effective permission set is known yet.
///
/// The login response is a bare `UserDto` with no permission list, so the set is
/// empty until the first `GET /auth/me`. An empty set therefore means "not known
/// yet", never "holds nothing", and the gates below must not treat it as a refusal.
final Provider<bool> permissionsKnownProvider = Provider<bool>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  return user != null && user.permissions.isNotEmpty;
});

/// `object.view` — projects, buildings, floors and the floor-plan file.
///
/// Reads true while the permission set is still unknown, so the drill-down attempts
/// the request and shows the server's own refusal rather than pre-emptively locking a
/// technician out during the first frame after login.
final Provider<bool> canViewObjectsProvider = Provider<bool>((Ref ref) {
  if (!ref.watch(permissionsKnownProvider)) return true;
  return ref.watch(currentUserProvider)!.has(PermissionKeys.objectView);
});

/// `object_master.view` — the device list, a device's detail and its history, and
/// the consolidated conclusion reports.
final Provider<bool> canViewDevicesProvider = Provider<bool>((Ref ref) {
  if (!ref.watch(permissionsKnownProvider)) return true;
  return ref.watch(currentUserProvider)!.has(PermissionKeys.objectMasterView);
});

/// `object_master.assess` — the permission behind the prototype's "Дүгнэлт тайлан
/// бичих" on a device.
///
/// Reads false rather than true while the set is unknown, unlike the view gates
/// above: a write control that appears for a moment and then vanishes is worse than
/// one that appears a beat late, and the object type must also allow a conclusion
/// (`canAssess` on the record) before the button is drawn at all.
final Provider<bool> canAssessDevicesProvider = Provider<bool>((Ref ref) {
  if (!ref.watch(permissionsKnownProvider)) return false;
  return ref.watch(currentUserProvider)!.has(PermissionKeys.objectMasterAssess);
});

// -- Helpers -----------------------------------------------------------------

/// Unwraps an [ApiResult] for an async provider, throwing the [Failure] so it lands
/// in `AsyncValue.error` with its Mongolian message intact.
T _unwrap<T>(ApiResult<T> result) => result.when(
      success: (T data) => data,
      failure: (Failure failure) => throw failure,
    );

// -- Projects ----------------------------------------------------------------

/// The project list plus the server's total, for the tab's two KPI tiles.
///
/// [deviceCount] is a sum of each project's own `objectCount`, which the backend
/// computes; nothing here is estimated. It is a sum over the fetched page rather than
/// over every project, so it is only complete while the list fits in one page of 100.
class ProjectListView {
  const ProjectListView({required this.projects, required this.total});

  final List<ProjectModel> projects;

  /// `PaginatedData.total` — the count of projects matching the query, which can
  /// exceed `projects.length` once there is more than one page.
  final int total;

  int get deviceCount => projects.fold(
        0,
        (int sum, ProjectModel project) => sum + project.objectCount,
      );

  bool get isComplete => projects.length >= total;
}

/// Every project the API will show this account.
///
/// There is no "my projects" filter anywhere in the API: `projectListQuerySchema`
/// accepts `customerId` and `search` but nothing that scopes to an employee, and
/// `GET /auth/me` does not report an `employeeId` to filter by even if it did. This
/// is therefore the full catalogue the caller's permissions allow, and the screen
/// says so rather than labelling it "Миний төслүүд".
final FutureProvider<ProjectListView> employeeProjectsProvider =
    FutureProvider<ProjectListView>((Ref ref) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  final PaginatedData<ProjectModel> page = _unwrap(await repository.listProjects());
  return ProjectListView(projects: page.items, total: page.total);
});

final FutureProviderFamily<ProjectModel, String> projectDetailProvider =
    FutureProvider.family<ProjectModel, String>((Ref ref, String projectId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getProject(projectId));
});

/// A project's buildings, name-ordered.
final FutureProviderFamily<List<BuildingModel>, String> projectBuildingsProvider =
    FutureProvider.family<List<BuildingModel>, String>(
        (Ref ref, String projectId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  final PaginatedData<BuildingModel> page =
      _unwrap(await repository.listProjectBuildings(projectId));

  final List<BuildingModel> buildings = page.items.toList();
  buildings.sort((BuildingModel a, BuildingModel b) => a.name.compareTo(b.name));
  return buildings;
});

// -- Buildings and floors ----------------------------------------------------

final FutureProviderFamily<BuildingModel, String> buildingDetailProvider =
    FutureProvider.family<BuildingModel, String>((Ref ref, String buildingId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getBuilding(buildingId));
});

/// Floors of a building, top floor first, as the prototype lists them.
final FutureProviderFamily<List<FloorModel>, String> buildingFloorsProvider =
    FutureProvider.family<List<FloorModel>, String>(
        (Ref ref, String buildingId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  final PaginatedData<FloorModel> page = _unwrap(await repository.listFloors(buildingId));

  final List<FloorModel> floors = page.items.toList();
  floors.sort((FloorModel a, FloorModel b) {
    final int? left = a.floorNumber;
    final int? right = b.floorNumber;
    // A floor with no number sinks to the bottom rather than pretending to be zero.
    if (left == null && right == null) return a.name.compareTo(b.name);
    if (left == null) return 1;
    if (right == null) return -1;
    return right.compareTo(left);
  });
  return floors;
});

final FutureProviderFamily<FloorModel, String> floorDetailProvider =
    FutureProvider.family<FloorModel, String>((Ref ref, String floorId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getFloor(floorId));
});

/// The floor's plan image, or null when none has been imported.
final FutureProviderFamily<FloorPlanModel?, String> floorPlanProvider =
    FutureProvider.family<FloorPlanModel?, String>((Ref ref, String floorId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getFloorPlan(floorId));
});

// -- Devices -----------------------------------------------------------------

/// Devices linked to a floor, worst band first so the ones needing work lead.
///
/// An unassessed device sorts after every assessed one: it is an unknown, not a
/// fault, and putting it at the top would read as an alarm.
final FutureProviderFamily<List<ObjectListItemModel>, String> floorObjectsProvider =
    FutureProvider.family<List<ObjectListItemModel>, String>(
        (Ref ref, String floorId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  final PaginatedData<ObjectListItemModel> page =
      _unwrap(await repository.listFloorObjects(floorId));

  final List<ObjectListItemModel> objects = page.items.toList();
  objects.sort((ObjectListItemModel a, ObjectListItemModel b) {
    final int? left = a.score;
    final int? right = b.score;
    if (left == null && right == null) return a.code.compareTo(b.code);
    if (left == null) return 1;
    if (right == null) return -1;
    if (left != right) return left.compareTo(right);
    return a.code.compareTo(b.code);
  });
  return objects;
});

final FutureProviderFamily<ObjectDetailModel, String> objectDetailProvider =
    FutureProvider.family<ObjectDetailModel, String>(
        (Ref ref, String objectId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getObject(objectId));
});

final FutureProviderFamily<ObjectHistoryModel, String> objectHistoryProvider =
    FutureProvider.family<ObjectHistoryModel, String>(
        (Ref ref, String objectId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getObjectHistory(objectId));
});

/// Every report that recorded a finding on one piece of equipment.
///
/// The device screen's own list, replacing the mixed timeline it used to show. That
/// timeline folded measurements, audit rows and request events in beside the written
/// conclusions, which is a change log rather than a set of reports; a technician
/// standing at the equipment is asking what was concluded about it.
final FutureProviderFamily<List<ReportRecordModel>, String> objectReportsProvider =
    FutureProvider.family<List<ReportRecordModel>, String>(
        (Ref ref, String objectId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.listObjectReports(objectId));
});

/// One report, with the per-equipment findings the list rows omit.
///
/// Fetched only when a report is actually opened: the list endpoint leaves `items` out
/// so a device with a long history does not drag every narrative of every visit down
/// the wire to draw a handful of rows.
final FutureProviderFamily<ReportRecordDetailModel, String> reportRecordProvider =
    FutureProvider.family<ReportRecordDetailModel, String>(
        (Ref ref, String reportId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getReport(reportId));
});

// -- Device assessment -------------------------------------------------------

/// The two writes behind a device үнэлгээ, and the refresh that has to follow them.
///
/// A controller rather than a notifier because there is no state to hold: an
/// assessment is append-only, so nothing is edited, and the screen's own
/// [objectDetailProvider] is the record of what happened. What this does own is the
/// invalidation, which is not obvious and must not be left to each call site — one
/// assessment moves the device's score and band, its history, and the sorted device
/// list on the floor above it, and `recordAssessment` can additionally move an
/// object to DECOMMISSIONED on a black band.
class DeviceAssessmentController {
  const DeviceAssessmentController(this._ref, this.objectId);

  final Ref _ref;
  final String objectId;

  ProjectRepository get _repository => _ref.read(projectRepositoryProvider);

  /// Uploads one evidence photo. The `id` on the result goes into `photoIds`.
  ///
  /// Until [submit] claims it the file is parked on the uploader, so abandoning the
  /// sheet after uploading leaves an unreferenced file rather than a half-written
  /// assessment. That is the server's design, not a leak this app can close: there is
  /// no route to delete an unclaimed upload.
  Future<ApiResult<ObjectPhotoModel>> uploadPhoto(CapturedPhoto photo) {
    return _repository.uploadAssessmentPhoto(photo);
  }

  Future<ApiResult<ObjectAssessmentModel>> submit(
    CreateAssessmentRequest request,
  ) async {
    final ApiResult<ObjectAssessmentModel> result =
        await _repository.recordAssessment(objectId: objectId, request: request);

    if (result.isSuccess) {
      _ref
        ..invalidate(objectDetailProvider(objectId))
        ..invalidate(objectHistoryProvider(objectId))
        // The whole family: the device screen does not know which floor it was
        // reached through, and the band that just changed is what that list sorts on.
        ..invalidate(floorObjectsProvider)
        ..invalidate(floorReportsProvider)
        ..invalidate(floorReportSummaryProvider);
    }
    return result;
  }
}

final ProviderFamily<DeviceAssessmentController, String> deviceAssessmentProvider =
    Provider.family<DeviceAssessmentController, String>(
  (Ref ref, String objectId) => DeviceAssessmentController(ref, objectId),
);

// -- Floor conclusion reports ------------------------------------------------

/// Family key for the floor report list: the floor, plus the band chip in effect.
///
/// A value type with equality, because a `FutureProvider.family` caches on `==` and a
/// record of two fields would work but reads worse at the call sites.
@immutable
class FloorReportQuery {
  const FloorReportQuery({required this.floorId, this.riskLevel});

  final String floorId;

  /// Null means the "Бүгд" chip: no band filter on the wire.
  final RiskLevel? riskLevel;

  @override
  bool operator ==(Object other) =>
      other is FloorReportQuery &&
      other.floorId == floorId &&
      other.riskLevel == riskLevel;

  @override
  int get hashCode => Object.hash(floorId, riskLevel);
}

final FutureProviderFamily<List<InspectionListItemModel>, FloorReportQuery>
    floorReportsProvider =
    FutureProvider.family<List<InspectionListItemModel>, FloorReportQuery>(
        (Ref ref, FloorReportQuery query) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  final PaginatedData<InspectionListItemModel> page = _unwrap(
    await repository.listFloorInspections(query.floorId, riskLevel: query.riskLevel),
  );
  return page.items;
});

/// The per-band counts behind the filter chips. Always unfiltered, so the chip labels
/// keep their counts when a band is selected.
final FutureProviderFamily<InspectionSummaryModel, String> floorReportSummaryProvider =
    FutureProvider.family<InspectionSummaryModel, String>(
        (Ref ref, String floorId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.getFloorInspectionSummary(floorId));
});

// -- Files -------------------------------------------------------------------

/// Bytes of a stored file. `GET /files/:fileId` needs the Bearer header, so a floor
/// plan or a device photo cannot be rendered with `Image.network`.
final FutureProviderFamily<Uint8List, String> projectFileBytesProvider =
    FutureProvider.family<Uint8List, String>((Ref ref, String fileId) async {
  final ProjectRepository repository = ref.watch(projectRepositoryProvider);
  return _unwrap(await repository.downloadFile(fileId));
});
