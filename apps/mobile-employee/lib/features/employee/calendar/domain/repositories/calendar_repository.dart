import '../../../../../core/network/api_result.dart';
import '../../data/models/calendar_event_model.dart';
import '../entities/calendar_source.dart';

/// Reads the Хуанли screen needs. Every method returns an [ApiResult]; nothing throws
/// past this boundary.
abstract class CalendarRepository {
  /// The month window, optionally narrowed to one employee and to one source.
  Future<ApiResult<CalendarResultModel>> getCalendar({
    required DateTime from,
    required DateTime to,
    String? employeeId,
    Set<CalendarSource>? sources,
  });

}
