import '../../../../../core/network/dio_client.dart';
import '../../domain/entities/calendar_source.dart';
import '../models/calendar_event_model.dart';

/// Transport for the Хуанли screen. Throws `ServerException` / `NetworkException`; the
/// repository turns those into failures.
///
/// One endpoint, read-only:
///   GET /calendar            — the month window
///
/// The "which employee am I" question is not asked here at all. It is answered once
/// per session by `GET /employees/me` in features/employee/identity, and this tab
/// receives the id already resolved.
///
/// Nothing here writes. The calendar is a projection; a schedule change is made in
/// the module that owns the record.
class CalendarRemoteDataSource {
  const CalendarRemoteDataSource(this._client);

  final DioClient _client;

  /// GET /calendar.
  ///
  /// `from` and `to` are mandatory and the window is capped at
  /// `MAX_CALENDAR_WINDOW_DAYS` (92) — a single month is well inside it.
  ///
  /// Both instants go on the wire as UTC. The server runs `new Date(from)`, so a
  /// bare `YYYY-MM-DD` would be read as UTC midnight while the schedule itself is
  /// kept in Asia/Ulaanbaatar; sending the converted local boundary is what keeps
  /// the first and last evening of the month inside the window.
  ///
  /// `sources` is sent only when the caller narrowed it. The backend already drops
  /// any source the account may not read, so an unfiltered call yields whatever the
  /// permissions allow rather than a 403.
  Future<CalendarResultModel> getCalendar({
    required DateTime from,
    required DateTime to,
    String? employeeId,
    Set<CalendarSource>? sources,
  }) {
    return _client.request<CalendarResultModel>(
      path: '/calendar',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'from': from.toUtc().toIso8601String(),
        'to': to.toUtc().toIso8601String(),
        if (employeeId != null && employeeId.isNotEmpty) 'employeeId': employeeId,
        if (sources != null && sources.isNotEmpty)
          'sources': sources
              .map((CalendarSource source) => source.wireValue)
              .join(','),
      },
      decoder: (Object? json) =>
          CalendarResultModel.fromJson(json! as Map<String, dynamic>),
    );
  }

}
