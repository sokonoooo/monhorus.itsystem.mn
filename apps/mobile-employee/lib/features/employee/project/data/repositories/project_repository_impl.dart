import '../../../../../core/network/paginated_data.dart';
import 'dart:typed_data';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/repositories/project_repository.dart';
import '../datasources/project_remote_data_source.dart';
import '../models/inspection_models.dart';
import '../models/object_models.dart';
import '../models/project_models.dart';

class ProjectRepositoryImpl implements ProjectRepository {
  const ProjectRepositoryImpl(this._remote);

  final ProjectRemoteDataSource _remote;

  /// Single translation point from data-layer exceptions to domain failures.
  ///
  /// A 403 is worth distinguishing: a field technician's role is assembled by hand
  /// (no seeded role is technician-shaped), so it is entirely ordinary for an account
  /// to reach this tab without `object.view` or `object_master.view`. "Энэ үйлдлийг
  /// хийх эрх байхгүй байна." from the server tells the user far more than a generic
  /// failure line, and [AuthFailure] lets the screen frame it as a permission
  /// problem rather than an outage.
  Failure _mapException(Object error) {
    if (error is ServerException) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        return AuthFailure(error.message, code: error.code);
      }
      return ServerFailure(
        error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      );
    }
    if (error is NetworkException) {
      return NetworkFailure(error.message);
    }
    return const ServerFailure('Гэнэтийн алдаа гарлаа.', code: 'UNKNOWN');
  }

  Future<ApiResult<T>> _guard<T>(Future<T> Function() call) async {
    try {
      return Success<T>(await call());
    } catch (error) {
      return FailureResult<T>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects({String? search}) {
    return _guard(() => _remote.listProjects(search: search));
  }

  @override
  Future<ApiResult<ProjectModel>> getProject(String projectId) {
    return _guard(() => _remote.getProject(projectId));
  }

  @override
  Future<ApiResult<PaginatedData<BuildingModel>>> listProjectBuildings(String projectId) {
    return _guard(() => _remote.listProjectBuildings(projectId));
  }

  @override
  Future<ApiResult<BuildingModel>> getBuilding(String buildingId) {
    return _guard(() => _remote.getBuilding(buildingId));
  }

  @override
  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(String buildingId) {
    return _guard(() => _remote.listFloors(buildingId: buildingId));
  }

  @override
  Future<ApiResult<FloorModel>> getFloor(String floorId) {
    return _guard(() => _remote.getFloor(floorId));
  }

  @override
  Future<ApiResult<FloorPlanModel?>> getFloorPlan(String floorId) {
    return _guard(() => _remote.getFloorPlan(floorId));
  }

  @override
  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listFloorObjects(String floorId) {
    return _guard(() => _remote.listFloorObjects(floorId: floorId));
  }

  @override
  Future<ApiResult<ObjectDetailModel>> getObject(String objectId) {
    return _guard(() => _remote.getObject(objectId));
  }

  @override
  Future<ApiResult<ObjectHistoryModel>> getObjectHistory(String objectId) {
    return _guard(() => _remote.getObjectHistory(objectId));
  }

  @override
  Future<ApiResult<ObjectPhotoModel>> uploadAssessmentPhoto(CapturedPhoto photo) {
    return _guard(() => _remote.uploadAssessmentPhoto(photo));
  }

  @override
  Future<ApiResult<ObjectAssessmentModel>> recordAssessment({
    required String objectId,
    required CreateAssessmentRequest request,
  }) {
    return _guard(
      () => _remote.recordAssessment(objectId: objectId, request: request),
    );
  }

  @override
  Future<ApiResult<PaginatedData<InspectionListItemModel>>> listFloorInspections(
    String floorId, {
    RiskLevel? riskLevel,
  }) {
    return _guard(
      () => _remote.listFloorInspections(floorId: floorId, riskLevel: riskLevel),
    );
  }

  @override
  Future<ApiResult<InspectionSummaryModel>> getFloorInspectionSummary(String floorId) {
    return _guard(() => _remote.getFloorInspectionSummary(floorId));
  }

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) {
    return _guard(() => _remote.downloadFile(fileId));
  }
}
