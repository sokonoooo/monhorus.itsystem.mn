import '../../../../../core/network/paginated_data.dart';
import '../../../../../core/network/api_result.dart';
import '../../data/models/dashboard_summary_model.dart';
import '../../data/models/notification_model.dart';
import '../../data/models/work_models.dart';

/// What the Нүүр tab needs from the API, stated without any transport detail.
abstract class HomeRepository {
  Future<ApiResult<DashboardSummaryModel>> getDashboardSummary();

  /// The reader's own work. Takes no employee id: the server scopes a non-oversight
  /// caller to work assigned to them or to their team, and narrowing further here
  /// would hide team-assigned work.
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork();

  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listServiceRequests();

  Future<ApiResult<CalendarResultModel>> getDayAgenda({
    required DateTime day,
    String? employeeId,
  });

  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications();

  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount();

  Future<ApiResult<NotificationModel>> markNotificationRead(String notificationId);

  Future<ApiResult<void>> markAllNotificationsRead();
}
