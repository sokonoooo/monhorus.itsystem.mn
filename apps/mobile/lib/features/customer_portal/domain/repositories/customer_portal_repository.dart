import 'dart:typed_data';

import '../../../../core/network/api_result.dart';
import '../../../../core/network/paginated_data.dart';
import '../../data/models/notification_model.dart';
import '../../data/models/object_master_model.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../entities/customer_scope.dart';
import '../entities/service_request_enums.dart';

/// Read surface of the customer portal.
///
/// Every customer-owned read takes a [ResolvedCustomerScope]. That is the whole
/// point of the type: there is no overload that omits it, so no screen can issue an
/// unscoped list request by accident.
abstract interface class CustomerPortalRepository {
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects(
    ResolvedCustomerScope scope,
  );

  Future<ApiResult<PaginatedData<BuildingModel>>> listBuildings(
    ResolvedCustomerScope scope, {
    String? projectId,
    String? search,
  });

  Future<ApiResult<BuildingModel>> getBuilding(String buildingId);

  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(String buildingId);

  Future<ApiResult<FloorModel>> getFloor(String floorId);

  Future<ApiResult<FloorPlanModel?>> getFloorPlan(String floorId);

  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listObjects(
    ResolvedCustomerScope scope, {
    String? floorId,
    String? buildingId,
  });

  Future<ApiResult<ObjectDetailModel>> getObject(String objectId);

  Future<ApiResult<ObjectHistoryModel>> getObjectHistory(String objectId);

  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>> listServiceRequests(
    ResolvedCustomerScope scope, {
    ServiceRequestStatus? status,
    String? buildingId,
    int page,
    int limit,
  });

  Future<ApiResult<ServiceRequestDetailModel>> getServiceRequest(String requestId);

  Future<ApiResult<ServiceRequestDetailModel>> createServiceRequest(
    CreateServiceRequestRequestModel request,
  );

  /// Already scoped to the caller server-side, so this one takes no scope.
  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications({
    bool unreadOnly,
  });

  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount();

  Future<ApiResult<NotificationModel>> markNotificationRead(String notificationId);

  Future<ApiResult<void>> markAllNotificationsRead();

  Future<ApiResult<Uint8List>> downloadFile(String fileId);
}
