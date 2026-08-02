import '../../../../../core/network/paginated_data.dart';
import '../../../../../core/network/dio_client.dart';
import '../models/dashboard_summary_model.dart';
import '../models/notification_model.dart';
import '../models/work_models.dart';

/// Transport for the Нүүр tab. Throws `ServerException` or `NetworkException`; the
/// repository converts those into failures.
///
/// Every "my work" read passes `employeeId` explicitly. That is not a formality: the
/// backend applies NO self-scoping to `/planned-work` or `/service-requests` — the
/// list services take no auth context at all — so a call without the filter returns
/// every colleague's work. The id therefore has to be resolved first, and if it
/// cannot be, the correct behaviour is to show nothing rather than to show
/// everything.
class HomeRemoteDataSource {
  const HomeRemoteDataSource(this._client);

  final DioClient _client;

  // -- Dashboard --------------------------------------------------------------

  /// GET /dashboard/summary. Blocks the caller lacks permission for are omitted from
  /// the payload rather than zeroed, which the model preserves as nulls.
  Future<DashboardSummaryModel> getDashboardSummary() {
    return _client.request<DashboardSummaryModel>(
      path: '/dashboard/summary',
      method: 'GET',
      decoder: (Object? json) =>
          DashboardSummaryModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Assigned work ----------------------------------------------------------

  /// GET /planned-work, narrowed to one employee.
  ///
  /// `includeArchived` is left off so finished-and-filed work does not inflate the
  /// home counters. `limit` is the schema's maximum; a technician with more than a
  /// hundred live planned works is outside what this screen tries to summarise.
  Future<PaginatedData<PlannedWorkListItemModel>> listPlannedWork({
    required String employeeId,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<PlannedWorkListItemModel>>(
      path: '/planned-work',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'employeeId': employeeId,
        'page': 1,
        'limit': limit,
        'sortBy': 'plannedEndDate',
        'sortDir': 'asc',
      },
      decoder: (Object? json) => PaginatedData<PlannedWorkListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        PlannedWorkListItemModel.fromJson,
      ),
    );
  }

  /// GET /service-requests, narrowed to one employee.
  ///
  /// `slaState` is deliberately not sent as a filter even though the home screen
  /// cares about it: the backend applies that one in memory after paginating, so
  /// `total` stops agreeing with the page. The banding is done here instead, on the
  /// `slaState` each row already carries.
  Future<PaginatedData<ServiceRequestListItemModel>> listServiceRequests({
    required String employeeId,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<ServiceRequestListItemModel>>(
      path: '/service-requests',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'employeeId': employeeId,
        'page': 1,
        'limit': limit,
        'sortBy': 'createdAt',
        'sortDir': 'desc',
      },
      decoder: (Object? json) =>
          PaginatedData<ServiceRequestListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        ServiceRequestListItemModel.fromJson,
      ),
    );
  }

  // -- Agenda -----------------------------------------------------------------

  /// GET /calendar for a single day.
  ///
  /// The window is mandatory and bounded server-side at 92 days; one day is what the
  /// home agenda shows. `employeeId` is omitted when the account could not be linked
  /// to an employee record, and the screen then labels the result as the whole
  /// organisation's day rather than as the reader's own.
  Future<CalendarResultModel> getDayAgenda({
    required DateTime day,
    String? employeeId,
  }) {
    final String key = _dateKey(day);
    return _client.request<CalendarResultModel>(
      path: '/calendar',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'from': key,
        'to': key,
        if (employeeId != null) 'employeeId': employeeId,
      },
      decoder: (Object? json) =>
          CalendarResultModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Notifications ----------------------------------------------------------

  /// GET /notifications. Scoped server-side to the calling user by recipient.
  ///
  /// `unreadOnly` is parsed with `z.coerce.boolean()`, under which any non-empty
  /// string is truthy — sending `unreadOnly=false` would mean true — so it only ever
  /// goes on the wire when it is true.
  Future<PaginatedData<NotificationModel>> listNotifications({
    bool unreadOnly = false,
    int limit = 25,
  }) {
    return _client.request<PaginatedData<NotificationModel>>(
      path: '/notifications',
      method: 'GET',
      queryParameters: <String, dynamic>{
        if (unreadOnly) 'unreadOnly': true,
        'page': 1,
        'limit': limit,
      },
      decoder: (Object? json) => PaginatedData<NotificationModel>.fromJson(
        json! as Map<String, dynamic>,
        NotificationModel.fromJson,
      ),
    );
  }

  Future<NotificationUnreadCountModel> getUnreadCount() {
    return _client.request<NotificationUnreadCountModel>(
      path: '/notifications/unread-count',
      method: 'GET',
      decoder: (Object? json) =>
          NotificationUnreadCountModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<NotificationModel> markNotificationRead(String notificationId) {
    return _client.request<NotificationModel>(
      path: '/notifications/$notificationId/read',
      method: 'POST',
      decoder: (Object? json) =>
          NotificationModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<void> markAllNotificationsRead() {
    return _client.request<void>(
      path: '/notifications/read-all',
      method: 'POST',
      decoder: (Object? _) {},
    );
  }

  /// `YYYY-MM-DD` in the device's local calendar, which is what `isoDateSchema`
  /// accepts and what a technician means by "today".
  static String _dateKey(DateTime day) {
    final DateTime local = day.toLocal();
    final String month = local.month.toString().padLeft(2, '0');
    final String date = local.day.toString().padLeft(2, '0');
    return '${local.year}-$month-$date';
  }
}
