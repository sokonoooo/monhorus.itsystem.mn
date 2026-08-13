import 'dart:typed_data';

import '../../../../core/media/photo_capture.dart';
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

  /// One page of the customer's buildings. [page] is exposed because a caller that
  /// sums over the result — the home summary — has to be able to read past the
  /// first page; `PaginatedData.total` says whether it must.
  Future<ApiResult<PaginatedData<BuildingModel>>> listBuildings(
    ResolvedCustomerScope scope, {
    String? projectId,
    String? search,
    int page,
  });

  Future<ApiResult<BuildingModel>> getBuilding(String buildingId);

  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(String buildingId);

  Future<ApiResult<FloorModel>> getFloor(String floorId);

  Future<ApiResult<FloorPlanModel?>> getFloorPlan(String floorId);

  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listObjects(
    ResolvedCustomerScope scope, {
    String? floorId,
    String? buildingId,
    int page,
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

  /// The technician's approved conclusion, or **null** when there is not one.
  ///
  /// Nullable rather than failing, because `GET /:requestId/report/customer` answers
  /// 404 for every state that is not an approved report — none written, one still in
  /// draft, one submitted, one returned — and "the conclusion is not ready" is not an
  /// error the customer can act on. A genuine fault (no network, a 500, a session that
  /// expired) still comes back as a [Failure], so the screen can tell the two apart.
  ///
  /// Takes no scope: the route resolves the customer from the session and answers 404
  /// for a request that is not theirs, so there is nothing for the client to narrow.
  Future<ApiResult<CustomerWorkReportModel?>> getCustomerWorkReport(String requestId);

  /// Uploads one picture and returns the attachment the create call must name.
  ///
  /// Takes no scope for the same reason the endpoint asks for none: nothing about the
  /// upload names an organisation. The server parks the file on the calling account
  /// and only [createServiceRequest] — which IS scoped — decides whose request claims
  /// it, so the "at whose records" question is asked exactly once, where it has an
  /// answer.
  Future<ApiResult<ServiceRequestAttachmentModel>> uploadServiceRequestAttachment(
    CapturedPhoto photo,
  );

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
