import '../../../../../core/network/paginated_data.dart';
import 'dart:typed_data';

import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../data/models/inspection_models.dart';
import '../../data/models/object_models.dart';
import '../../data/models/report_record_models.dart';
import '../../data/models/project_models.dart';
import '../entities/risk_level.dart';

/// What the employee project tab may ask of the backend.
///
/// Every method returns an [ApiResult] rather than throwing, so no screen can forget
/// the failure path. Everything is a read except the two calls behind a device
/// үнэлгээ — [uploadAssessmentPhoto] and [recordAssessment] — which must be made in
/// that order because the assessment carries the file id.
abstract class ProjectRepository {
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects({String? search});

  Future<ApiResult<ProjectModel>> getProject(String projectId);

  Future<ApiResult<PaginatedData<BuildingModel>>> listProjectBuildings(String projectId);

  Future<ApiResult<BuildingModel>> getBuilding(String buildingId);

  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(String buildingId);

  Future<ApiResult<FloorModel>> getFloor(String floorId);

  Future<ApiResult<FloorPlanModel?>> getFloorPlan(String floorId);

  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listFloorObjects(String floorId);

  Future<ApiResult<ObjectDetailModel>> getObject(String objectId);

  Future<ApiResult<ObjectHistoryModel>> getObjectHistory(String objectId);

  /// Every report that recorded a finding on one piece of equipment, newest first.
  Future<ApiResult<List<ReportRecordModel>>> listObjectReports(String objectId);

  /// One report with the per-equipment findings behind it.
  Future<ApiResult<ReportRecordDetailModel>> getReport(String reportId);

  /// Uploads one evidence photo and returns its stored-file metadata.
  ///
  /// The `id` on the result is what goes into [CreateAssessmentRequest.photoIds].
  Future<ApiResult<ObjectPhotoModel>> uploadAssessmentPhoto(CapturedPhoto photo);

  /// Records an assessment against a device. Append-only; there is no update or
  /// delete for one anywhere in the API.
  Future<ApiResult<ObjectAssessmentModel>> recordAssessment({
    required String objectId,
    required CreateAssessmentRequest request,
  });

  Future<ApiResult<PaginatedData<InspectionListItemModel>>> listFloorInspections(
    String floorId, {
    RiskLevel? riskLevel,
  });

  Future<ApiResult<InspectionSummaryModel>> getFloorInspectionSummary(String floorId);

  Future<ApiResult<Uint8List>> downloadFile(String fileId);
}
