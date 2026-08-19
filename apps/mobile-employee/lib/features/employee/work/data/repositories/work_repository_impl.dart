import '../../../../../core/network/paginated_data.dart';
import 'dart:typed_data';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/error/failure.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../shared/service_request_models.dart';
import '../../../shared/service_request_vocabulary.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../../domain/repositories/work_repository.dart';
import '../datasources/work_remote_data_source.dart';
import '../models/inspection_report_model.dart';
import '../models/planned_work_model.dart';
import '../models/task_material_model.dart';
import '../models/work_report_model.dart';

class WorkRepositoryImpl implements WorkRepository {
  const WorkRepositoryImpl(this._remote);

  final WorkRemoteDataSource _remote;

  /// The single translation point from data-layer exceptions to domain failures,
  /// matching the shape the customer app's repository uses.
  ///
  /// 401 and 403 become [AuthFailure] so a screen can tell "the server failed" apart
  /// from "you do not hold this permission" — a live distinction here, because a
  /// technician account whose system role was never assigned resolves to an empty
  /// permission set and is refused at every guard while still being able to log in.
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
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork({
    String? employeeId,
    String? teamId,
    PlannedWorkEffectiveStatus? status,
    String? search,
  }) {
    return _guard(
      () => _remote.listPlannedWork(
        employeeId: employeeId,
        teamId: teamId,
        status: status,
        search: search,
      ),
    );
  }

  /// Both round trips are inside one [_guard], so a failure on either half is reported
  /// once instead of the segment rendering half a pool beside an error.
  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listOpenServiceRequests() {
    return _guard(() => _remote.listOpenServiceRequests());
  }

  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listAssignedServiceRequests() {
    return _guard(() => _remote.listAssignedServiceRequests());
  }

  @override
  Future<ApiResult<void>> claimServiceRequest(String requestId) {
    return _guard(() => _remote.claimServiceRequest(requestId));
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel?>> getServiceRequestDetail(
    String requestId,
  ) {
    return _guard(() => _remote.getServiceRequestDetail(requestId));
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel>> changeServiceRequestStatus({
    required String requestId,
    required ServiceRequestStatus status,
    String? reason,
  }) {
    return _guard(
      () => _remote.changeServiceRequestStatus(
        requestId: requestId,
        status: status,
        reason: reason,
      ),
    );
  }

  @override
  Future<ApiResult<WorkReportModel>> getWorkReport(String requestId) {
    return _guard(() => _remote.getWorkReport(requestId));
  }

  @override
  Future<ApiResult<WorkReportModel>> saveWorkReport(
    String requestId,
    SaveWorkReportRequest request,
  ) {
    return _guard(() => _remote.saveWorkReport(requestId, request));
  }

  @override
  Future<ApiResult<WorkReportModel>> submitWorkReport(String requestId) {
    return _guard(() => _remote.submitWorkReport(requestId));
  }

  @override
  Future<ApiResult<WorkReportPhotoModel>> uploadWorkReportPhoto(CapturedPhoto photo) {
    return _guard(() => _remote.uploadWorkReportPhoto(photo));
  }

  @override
  Future<ApiResult<PaginatedData<MaterialItemModel>>> listMaterialItems() {
    return _guard(() => _remote.listMaterialItems());
  }

  @override
  Future<ApiResult<PlannedWorkModel>> getPlannedWork(String plannedWorkId) {
    return _guard(() => _remote.getPlannedWork(plannedWorkId));
  }

  @override
  Future<ApiResult<PlannedWorkModel>> transition({
    required String plannedWorkId,
    required PlannedWorkAction action,
    String? reason,
  }) {
    return _guard(
      () => _remote.transition(
        plannedWorkId: plannedWorkId,
        action: action,
        reason: reason,
      ),
    );
  }

  @override
  Future<ApiResult<PlannedWorkModel>> recordTaskProgress({
    required String plannedWorkId,
    required String taskId,
    required RecordTaskProgressRequest request,
  }) {
    return _guard(
      () => _remote.recordTaskProgress(
        plannedWorkId: plannedWorkId,
        taskId: taskId,
        request: request,
      ),
    );
  }

  @override
  Future<ApiResult<PlannedWorkModel>> recordTaskMaterialUsage({
    required String plannedWorkId,
    required String taskId,
    required RecordTaskMaterialUsageRequest request,
  }) {
    return _guard(
      () => _remote.recordTaskMaterialUsage(
        plannedWorkId: plannedWorkId,
        taskId: taskId,
        request: request,
      ),
    );
  }

  @override
  Future<ApiResult<PlannedWorkModel>> attachTaskPhoto({
    required String plannedWorkId,
    required String taskId,
    required TaskPhotoKind kind,
    required CapturedPhoto photo,
  }) {
    return _guard(
      () => _remote.attachTaskPhoto(
        plannedWorkId: plannedWorkId,
        taskId: taskId,
        kind: kind,
        photo: photo,
      ),
    );
  }

  @override
  Future<ApiResult<PlannedWorkReportBundleModel>> getReport(String plannedWorkId) {
    return _guard(() => _remote.getReport(plannedWorkId));
  }

  @override
  Future<ApiResult<PlannedWorkModel>> updateReport({
    required String plannedWorkId,
    String? conclusion,
    String? recommendation,
  }) {
    return _guard(
      () => _remote.updateReport(
        plannedWorkId: plannedWorkId,
        conclusion: conclusion,
        recommendation: recommendation,
      ),
    );
  }

  @override
  Future<ApiResult<PlannedWorkModel>> submitReport(String plannedWorkId) {
    return _guard(() => _remote.submitReport(plannedWorkId));
  }

  @override
  Future<ApiResult<InspectionReportReadinessModel>> getInspectionReportReadiness(
    String plannedWorkId,
  ) {
    return _guard(() => _remote.getInspectionReportReadiness(plannedWorkId));
  }

  @override
  Future<ApiResult<InspectionReportModel?>> getInspectionReport(String plannedWorkId) {
    return _guard(() => _remote.getInspectionReport(plannedWorkId));
  }

  @override
  Future<ApiResult<InspectionReportModel>> generateInspectionReport(
    String plannedWorkId,
  ) {
    return _guard(() => _remote.generateInspectionReport(plannedWorkId));
  }

  @override
  Future<ApiResult<InspectionReportModel>> updateInspectionReport({
    required String plannedWorkId,
    required UpdateInspectionReportRequest request,
  }) {
    return _guard(
      () => _remote.updateInspectionReport(
        plannedWorkId: plannedWorkId,
        request: request,
      ),
    );
  }

  @override
  Future<ApiResult<InspectionReportModel>> submitInspectionReport(String plannedWorkId) {
    return _guard(() => _remote.submitInspectionReport(plannedWorkId));
  }

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) {
    return _guard(() => _remote.downloadFile(fileId));
  }
}
