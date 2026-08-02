/// Formatting specific to the Ажил tab.
///
/// The patterns every tab needs — `formatDate`, `formatTime`, `formatDateTime`,
/// `formatPercent`, `initialsOf` — live in `lib/core/util/format.dart` and are
/// re-exported here, so a call site inside this feature still imports one file. Only
/// the phrasings this tab alone uses are declared below.
library;

import '../../../../core/util/format.dart';

export '../../../../core/util/format.dart';

/// `07.29 14:30` — the compact stamp a list row uses, where the year is noise.
String formatShortStamp(DateTime? value) {
  if (value == null) return kNoValue;
  final DateTime local = value.toLocal();
  return '${two(local.month)}.${two(local.day)} ${formatTime(local)}';
}

/// `2026.07.28 09:00 → 2026.08.05 18:00`, collapsing to one date when the window
/// opens and closes on the same day.
String formatWindow(DateTime? start, DateTime? end) {
  if (start == null && end == null) return kNoValue;
  if (start == null) return 'Дуусах: ${formatDateTime(end)}';
  if (end == null) return '${formatDateTime(start)} →';

  final DateTime a = start.toLocal();
  final DateTime b = end.toLocal();
  final bool sameDay = a.year == b.year && a.month == b.month && a.day == b.day;

  if (sameDay) {
    return '${formatDate(a)} ${formatTime(a)} → ${formatTime(b)}';
  }
  return '${formatDateTime(a)} → ${formatDateTime(b)}';
}

/// How the deadline reads against now: "Өнөөдөр 18:00", "3 хоног үлдсэн",
/// "2 хоног хэтэрсэн".
///
/// Phrased in whole days once past 24 hours, because a technician plans by the day
/// and "71 цаг үлдсэн" is harder to act on than "3 хоног үлдсэн".
String formatDeadline(DateTime? deadline, {DateTime? now}) {
  if (deadline == null) return kNoValue;

  final DateTime reference = (now ?? DateTime.now()).toLocal();
  final DateTime local = deadline.toLocal();
  final Duration delta = local.difference(reference);

  final DateTime today = DateTime(reference.year, reference.month, reference.day);
  final DateTime day = DateTime(local.year, local.month, local.day);
  final int dayDelta = day.difference(today).inDays;

  if (delta.isNegative) {
    final Duration late = delta.abs();
    if (late.inHours < 1) return '${late.inMinutes} минут хэтэрсэн';
    if (late.inHours < 24) return '${late.inHours} цаг хэтэрсэн';
    return '${late.inDays} хоног хэтэрсэн';
  }

  if (dayDelta == 0) return 'Өнөөдөр ${formatTime(local)}';
  if (dayDelta == 1) return 'Маргааш ${formatTime(local)}';
  if (delta.inDays < 14) return '${delta.inDays} хоног үлдсэн';
  return formatDate(local);
}

/// A quantity with no trailing `.0`, so 20 pieces reads as "20" while 2.5 metres
/// keeps its digit.
String formatQuantity(double value) {
  if (value == value.roundToDouble()) return value.round().toString();
  return value
      .toStringAsFixed(2)
      .replaceAll(RegExp(r'0+$'), '')
      .replaceAll(RegExp(r'\.$'), '');
}

/// `2 цаг 30 мин`, for a paused duration.
String formatMinutes(int minutes) {
  if (minutes <= 0) return '0 мин';
  final int hours = minutes ~/ 60;
  final int rest = minutes % 60;
  if (hours == 0) return '$rest мин';
  if (rest == 0) return '$hours цаг';
  return '$hours цаг $rest мин';
}
