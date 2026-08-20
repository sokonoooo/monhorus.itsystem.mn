import 'dart:typed_data';

import '../../../../core/error/exceptions.dart';
import '../../../../core/media/photo_capture.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/paginated_data.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/service_request_enums.dart';
import '../../domain/repositories/customer_portal_repository.dart';
import '../datasources/customer_portal_remote_data_source.dart';
import '../models/notification_model.dart';
import '../models/object_master_model.dart';
import '../models/project_model.dart';
import '../models/service_request_model.dart';
import '../models/survey_model.dart';

class CustomerPortalRepositoryImpl implements CustomerPortalRepository {
  const CustomerPortalRepositoryImpl(this._remote);

  final CustomerPortalRemoteDataSource _remote;

  /// Single translation point from data-layer exceptions to domain failures, the
  /// same shape `UserRepositoryImpl` uses.
  ///
  /// A 403 is worth distinguishing here: the customer flow reaches endpoints the
  /// signed-in account may simply not be granted, and "you do not have permission"
  /// is a different message from "the server failed".
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
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects(
    ResolvedCustomerScope scope,
  ) {
    return _guard(() => _remote.listProjects(scope: scope));
  }

  @override
  Future<ApiResult<PaginatedData<BuildingModel>>> listBuildings(
    ResolvedCustomerScope scope, {
    String? projectId,
    String? search,
    int page = 1,
  }) {
    return _guard(
      () => _remote.listBuildings(
        scope: scope,
        projectId: projectId,
        search: search,
        page: page,
      ),
    );
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
  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listObjects(
    ResolvedCustomerScope scope, {
    String? floorId,
    String? buildingId,
  }) {
    return _guard(
      () => _remote.listObjects(
        scope: scope,
        floorId: floorId,
        buildingId: buildingId,
      ),
    );
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
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>> listServiceRequests(
    ResolvedCustomerScope scope, {
    ServiceRequestStatus? status,
    String? buildingId,
    int page = 1,
    int limit = 20,
  }) {
    return _guard(
      () => _remote.listServiceRequests(
        scope: scope,
        status: status,
        buildingId: buildingId,
        page: page,
        limit: limit,
      ),
    );
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel>> getServiceRequest(String requestId) {
    return _guard(() => _remote.getServiceRequest(requestId));
  }

  /// A 404 here is an answer, not a fault: the endpoint uses it for "no approved
  /// conclusion" as well as for "not your request", and both mean the same thing to
  /// the reader — there is nothing to show yet. It is turned into a null so the screen
  /// renders the not-ready line rather than an error card. Every other status still
  /// travels through [_mapException].
  @override
  Future<ApiResult<CustomerWorkReportModel?>> getCustomerWorkReport(
    String requestId,
  ) async {
    try {
      return Success<CustomerWorkReportModel?>(
        await _remote.getCustomerWorkReport(requestId),
      );
    } on ServerException catch (error) {
      if (error.statusCode == 404) {
        return const Success<CustomerWorkReportModel?>(null);
      }
      return FailureResult<CustomerWorkReportModel?>(_mapException(error));
    } catch (error) {
      return FailureResult<CustomerWorkReportModel?>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<ServiceRequestAttachmentModel>> uploadServiceRequestAttachment(
    CapturedPhoto photo,
  ) {
    return _guard(() => _remote.uploadServiceRequestAttachment(photo));
  }

  @override
  Future<ApiResult<List<CallableObjectTypeModel>>> listCallableObjectTypes() {
    return _guard(() => _remote.listCallableObjectTypes());
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel>> createServiceRequest(
    CreateServiceRequestRequestModel request,
  ) {
    return _guard(() => _remote.createServiceRequest(request));
  }

  @override
  Future<ApiResult<List<SurveyPendingItemModel>>> listPendingSurveys() {
    return _guard(() => _remote.listPendingSurveys());
  }

  /// A 404 here is an answer, not a fault — the same rule [getCustomerWorkReport]
  /// follows. The endpoint uses it for "no survey to answer" as well as for "not your
  /// request", and both mean the same thing to the reader: there is nothing to rate.
  /// Every other status still travels through [_mapException].
  @override
  Future<ApiResult<SurveyFormModel?>> getSurveyForm(String requestId) async {
    try {
      return Success<SurveyFormModel?>(await _remote.getSurveyForm(requestId));
    } on ServerException catch (error) {
      if (error.statusCode == 404) {
        return const Success<SurveyFormModel?>(null);
      }
      return FailureResult<SurveyFormModel?>(_mapException(error));
    } catch (error) {
      return FailureResult<SurveyFormModel?>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<void>> submitSurveyResponse(
    String requestId,
    SubmitSurveyResponseRequest request,
  ) {
    return _guard(() => _remote.submitSurveyResponse(requestId, request));
  }

  @override
  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications({
    bool unreadOnly = false,
  }) {
    return _guard(() => _remote.listNotifications(unreadOnly: unreadOnly));
  }

  @override
  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount() {
    return _guard(_remote.getUnreadCount);
  }

  @override
  Future<ApiResult<NotificationModel>> markNotificationRead(String notificationId) {
    return _guard(() => _remote.markNotificationRead(notificationId));
  }

  @override
  Future<ApiResult<void>> markAllNotificationsRead() {
    return _guard(_remote.markAllNotificationsRead);
  }

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) {
    return _guard(() => _remote.downloadFile(fileId));
  }
}
