import '../../../../../core/network/paginated_data.dart';
import '../../../../../core/network/api_result.dart';
import '../../data/models/dashboard_summary_model.dart';
import '../../data/models/notification_model.dart';
import '../../data/models/work_models.dart';

/// What the Нүүр tab needs from the API, stated without any transport detail.
abstract class HomeRepository {
  Future<ApiResult<DashboardSummaryModel>> getDashboardSummary();

  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork(
    String employeeId,
  );

  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>> listServiceRequests(
    String employeeId,
  );

  Future<ApiResult<CalendarResultModel>> getDayAgenda({
    required DateTime day,
    String? employeeId,
  });

  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications();

  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount();

  Future<ApiResult<NotificationModel>> markNotificationRead(String notificationId);

  Future<ApiResult<void>> markAllNotificationsRead();
}
