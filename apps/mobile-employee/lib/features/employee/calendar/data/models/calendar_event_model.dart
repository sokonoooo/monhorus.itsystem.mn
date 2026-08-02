import 'package:equatable/equatable.dart';

import '../../domain/entities/calendar_source.dart';
import '../../domain/entities/event_level.dart';

/// `CalendarEventDto` from packages/shared/src/types/calendar.types.ts.
///
/// Parsed tolerantly of a missing key but never coercing a wrong shape into a
/// plausible value: `progressPercent` stays null when the source does not track
/// quantity, because "no progress figure" and "0%" are different facts.
class CalendarEventModel extends Equatable {
  const CalendarEventModel({
    required this.id,
    required this.source,
    required this.sourceId,
    required this.reference,
    required this.title,
    required this.start,
    required this.end,
    required this.status,
    required this.statusLabel,
    required this.isOverdue,
    required this.isUrgent,
    required this.assignedNames,
    this.customerName,
    this.buildingName,
    this.progressPercent,
  });

  factory CalendarEventModel.fromJson(Map<String, dynamic> json) {
    final DateTime start =
        DateTime.tryParse(json['start']?.toString() ?? '')?.toLocal() ??
            DateTime.now();
    final DateTime? parsedEnd =
        DateTime.tryParse(json['end']?.toString() ?? '')?.toLocal();

    return CalendarEventModel(
      id: json['id']?.toString() ?? '',
      source: CalendarSource.fromWire(json['source']?.toString()),
      sourceId: json['sourceId']?.toString() ?? '',
      reference: json['reference']?.toString() ?? '',
      title: json['title']?.toString() ?? '',
      start: start,
      // A malformed end must not produce a span that runs backwards and paints
      // every earlier day of the month.
      end: parsedEnd != null && !parsedEnd.isBefore(start) ? parsedEnd : start,
      status: json['status']?.toString() ?? '',
      statusLabel: json['statusLabel']?.toString() ?? '',
      isOverdue: json['isOverdue'] == true,
      isUrgent: json['isUrgent'] == true,
      customerName: _text(json['customerName']),
      buildingName: _text(json['buildingName']),
      assignedNames: json['assignedNames'] is List
          ? (json['assignedNames']! as List<dynamic>)
              .whereType<String>()
              .toList(growable: false)
          : const <String>[],
      progressPercent: (json['progressPercent'] as num?)?.toInt(),
    );
  }

  static String? _text(Object? value) {
    if (value is! String || value.trim().isEmpty) return null;
    return value.trim();
  }

  final String id;
  final CalendarSource source;

  /// Id of the underlying planned work or service request.
  final String sourceId;

  /// `PW-202607-0001` / `SR-202607-0005`.
  final String reference;
  final String title;

  /// Local-time span. A planned work often runs over several days; a request runs
  /// from its creation to its SLA deadline.
  final DateTime start;
  final DateTime end;

  final String status;
  final String statusLabel;
  final bool isOverdue;
  final bool isUrgent;
  final String? customerName;
  final String? buildingName;
  final List<String> assignedNames;

  /// Null for a service request, which has no quantity-based progress.
  final int? progressPercent;

  EventLevel get level =>
      levelFor(status: status, isOverdue: isOverdue, isUrgent: isUrgent);

  /// True when the span touches [day] at all, not only when it starts on it.
  bool coversDay(DateTime day) {
    final DateTime target = DateTime(day.year, day.month, day.day);
    final DateTime first = DateTime(start.year, start.month, start.day);
    final DateTime last = DateTime(end.year, end.month, end.day);
    return !target.isBefore(first) && !target.isAfter(last);
  }

  bool get spansMultipleDays =>
      DateTime(start.year, start.month, start.day) !=
      DateTime(end.year, end.month, end.day);

  @override
  List<Object?> get props => <Object?>[id, status, start, end, progressPercent];
}

/// `CalendarResultDto`.
class CalendarResultModel extends Equatable {
  const CalendarResultModel({
    required this.timezone,
    required this.events,
  });

  factory CalendarResultModel.fromJson(Map<String, dynamic> json) {
    return CalendarResultModel(
      timezone: json['timezone']?.toString() ?? '',
      events: json['events'] is List
          ? (json['events']! as List<dynamic>)
              .whereType<Map<String, dynamic>>()
              .map(CalendarEventModel.fromJson)
              .toList(growable: false)
          : const <CalendarEventModel>[],
    );
  }

  /// The zone the server renders in, e.g. `Asia/Ulaanbaatar`. Shown to the user only
  /// when it disagrees with the device, so a technician abroad is not misled about
  /// which clock a deadline is measured on.
  final String timezone;

  final List<CalendarEventModel> events;

  @override
  List<Object?> get props => <Object?>[timezone, events];
}
