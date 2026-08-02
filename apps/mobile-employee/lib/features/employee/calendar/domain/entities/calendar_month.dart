import 'package:equatable/equatable.dart';

/// One month of the grid, plus the query window it implies.
///
/// The prototype's `buildCal` / `renderMcal` start the week on MONDAY
/// (`offset = first === 0 ? 6 : first - 1`). Dart's `DateTime.weekday` is already
/// 1 = Monday .. 7 = Sunday, so the same offset is `(weekday + 6) % 7`.
///
/// [windowStart] and [windowEnd] are local wall-clock instants converted to UTC by
/// the caller. That matters: `GET /calendar` runs `new Date(from)` on a bare
/// `YYYY-MM-DD`, which is UTC midnight, and the server renders in Asia/Ulaanbaatar
/// (UTC+8). Sending a bare date would therefore shift the window by eight hours and
/// drop or add an evening's work at each edge.
class CalendarMonth extends Equatable {
  const CalendarMonth(this.year, this.month);

  factory CalendarMonth.of(DateTime date) =>
      CalendarMonth(date.year, date.month);

  final int year;

  /// 1 = January .. 12 = December.
  final int month;

  DateTime get firstDay => DateTime(year, month);

  /// Day 0 of the following month is the last day of this one.
  DateTime get lastDay => DateTime(year, month + 1, 0);

  int get dayCount => lastDay.day;

  /// Empty cells before the 1st, with the week starting on Monday.
  int get leadingBlanks => (firstDay.weekday + 6) % 7;

  DateTime get windowStart => firstDay;

  DateTime get windowEnd =>
      DateTime(year, month + 1, 0, 23, 59, 59, 999);

  CalendarMonth get previous =>
      month == 1 ? CalendarMonth(year - 1, 12) : CalendarMonth(year, month - 1);

  CalendarMonth get next =>
      month == 12 ? CalendarMonth(year + 1, 1) : CalendarMonth(year, month + 1);

  bool contains(DateTime day) => day.year == year && day.month == month;

  DateTime dayAt(int dayOfMonth) => DateTime(year, month, dayOfMonth);

  /// `2026 оны 7-р сар`, verbatim from the prototype's `#mcal-label`.
  String get label => '$year оны $month-р сар';

  @override
  List<Object?> get props => <Object?>[year, month];
}

/// Weekday captions of the prototype's mini calendar (`renderMcal`), which uses the
/// two-letter forms rather than the full-screen grid's longer ones.
const List<String> weekdayCaptions = <String>[
  'Да',
  'Мя',
  'Лх',
  'Пү',
  'Ба',
  'Бя',
  'Ня',
];

/// Strips the time so two instants on the same calendar day compare equal.
DateTime dayOf(DateTime value) =>
    DateTime(value.year, value.month, value.day);
