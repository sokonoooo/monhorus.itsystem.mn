import '../../../../../core/network/paginated_data.dart';
import '../../../../../core/error/exceptions.dart';
import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../domain/repositories/home_repository.dart';
import '../datasources/home_remote_data_source.dart';
import '../models/dashboard_summary_model.dart';
import '../models/notification_model.dart';
import '../models/work_models.dart';

class HomeRepositoryImpl implements HomeRepository {
  const HomeRepositoryImpl(this._remote);

  final HomeRemoteDataSource _remote;

  /// The single translation point from data-layer exceptions to domain failures,
  /// matching `AuthRepositoryImpl`.
  ///
  /// A 401 or 403 becomes an [AuthFailure] so the home screen can tell "your role
  /// does not include this" apart from "the server failed". That distinction is load
  /// bearing here: the home screen assembles several independently permissioned
  /// blocks, `seedRbac` is prune-only so a deployed role can hold strictly less than
  /// the shipped default, and a block the account may not read has to be explained
  /// rather than presented as an outage.
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
  Future<ApiResult<DashboardSummaryModel>> getDashboardSummary() {
    return _guard(_remote.getDashboardSummary);
  }

  @override
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork(
    String employeeId,
  ) {
    return _guard(() => _remote.listPlannedWork(employeeId: employeeId));
  }

  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>> listServiceRequests(
    String employeeId,
  ) {
    return _guard(() => _remote.listServiceRequests(employeeId: employeeId));
  }

  @override
  Future<ApiResult<CalendarResultModel>> getDayAgenda({
    required DateTime day,
    String? employeeId,
  }) {
    return _guard(() => _remote.getDayAgenda(day: day, employeeId: employeeId));
  }

  @override
  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications() {
    return _guard(_remote.listNotifications);
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
}
