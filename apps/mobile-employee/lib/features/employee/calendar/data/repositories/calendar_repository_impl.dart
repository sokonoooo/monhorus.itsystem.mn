import '../../../../../core/error/exceptions.dart';
import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../domain/entities/calendar_source.dart';
import '../../domain/repositories/calendar_repository.dart';
import '../datasources/calendar_remote_data_source.dart';
import '../models/calendar_event_model.dart';

class CalendarRepositoryImpl implements CalendarRepository {
  const CalendarRepositoryImpl(this._remote);

  final CalendarRemoteDataSource _remote;

  /// Single translation point from data-layer exceptions to domain failures, the
  /// same shape the customer portal uses.
  ///
  /// A 403 is kept distinct: `GET /calendar` is gated on holding at least one of
  /// `planned_work.view` / `service_request.view`, and "you have not been granted
  /// this" is a different sentence from "the server failed".
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
  Future<ApiResult<CalendarResultModel>> getCalendar({
    required DateTime from,
    required DateTime to,
    String? employeeId,
    Set<CalendarSource>? sources,
  }) {
    return _guard(
      () => _remote.getCalendar(
        from: from,
        to: to,
        employeeId: employeeId,
        sources: sources,
      ),
    );
  }
}
