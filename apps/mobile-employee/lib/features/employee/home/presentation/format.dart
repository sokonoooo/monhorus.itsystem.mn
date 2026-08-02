/// Formatting specific to the Нүүр tab.
///
/// The patterns every tab needs — `formatDate`, `formatTime`, `formatDateTime`,
/// `formatEventStamp`, `formatPercent`, `formatSlaRemaining`, `initialsOf` — live in
/// `lib/core/util/format.dart` and are re-exported here, so a call site inside this
/// feature still imports one file. Only the phrasings this tab alone uses are
/// declared below.
///
/// `formatSlaRemaining` was one of those phrasings until the Ажил tab's unclaimed pool
/// started printing the same countdown; it moved to the shared file rather than being
/// copied.
///
/// The prototype's demo clock was deliberately inconsistent — status bar 09:41, home
/// date 2026.06.30, calendar May 2024. None of that is reproduced: every stamp here
/// comes from a value the API supplied or from `DateTime.now()`.
library;

import '../../../../core/util/format.dart';

export '../../../../core/util/format.dart';

/// Mongolian weekday names, `DateTime.monday` == 1 first.
const List<String> _weekdayNames = <String>[
  'Даваа',
  'Мягмар',
  'Лхагва',
  'Пүрэв',
  'Баасан',
  'Бямба',
  'Ням',
];

/// `2026.07.30 (Пүрэв)` — the home header's date line.
String formatDateWithWeekday(DateTime value) {
  final DateTime local = value.toLocal();
  return '${formatDate(local)} (${_weekdayNames[local.weekday - 1]})';
}

/// `09:00 – 18:00`, or a single time when the two ends fall in the same minute.
String formatTimeRange(DateTime? start, DateTime? end) {
  if (start == null && end == null) return kNoValue;
  if (start == null) return formatTime(end);
  if (end == null) return formatTime(start);
  final String from = formatTime(start);
  final String to = formatTime(end);
  return from == to ? from : '$from – $to';
}

/// The span of one agenda entry.
///
/// A planned work can run for a week, and printing "09:00 – 18:00" for a window that
/// opened last Tuesday would read as a shift that ends this evening. When the two
/// ends fall on different local days the dates are carried too: `07.28 09:00 →
/// 08.05 18:00`.
String formatAgendaSpan(DateTime? start, DateTime? end) {
  if (start == null || end == null) return formatTimeRange(start, end);

  final DateTime from = start.toLocal();
  final DateTime to = end.toLocal();
  final bool sameDay =
      from.year == to.year && from.month == to.month && from.day == to.day;
  if (sameDay) return formatTimeRange(from, to);

  String short(DateTime value) =>
      '${two(value.month)}.${two(value.day)} ${formatTime(value)}';
  return '${short(from)} → ${short(to)}';
}

/// The reader's first name, for the greeting.
///
/// Staff names are printed surname-first throughout the backend, so the given name
/// is the last token. A single-token name is returned whole.
String givenNameOf(String fullName) {
  final List<String> parts = fullName
      .split(RegExp(r'\s+'))
      .where((String part) => part.isNotEmpty)
      .toList(growable: false);
  if (parts.isEmpty) return fullName;
  return parts.last;
}
