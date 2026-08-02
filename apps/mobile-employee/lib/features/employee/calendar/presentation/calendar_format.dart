/// Formatting specific to the Хуанли screen.
///
/// The patterns every tab needs — `formatDate`, `formatTime`, `formatDateTime` —
/// live in `lib/core/util/format.dart` and are re-exported here, so a call site
/// inside this feature still imports one file. Only the two patterns this tab alone
/// uses are declared below.
library;

import '../../../../core/util/format.dart';

export '../../../../core/util/format.dart';

/// The time run on an agenda row.
///
/// A same-day entry reads `10:00–14:00`, matching the prototype's agenda pill. An
/// entry that spans days says so with dates instead, because `09:00–18:00` on a job
/// that actually runs for a week would be a lie about when it ends.
String formatSpan(DateTime start, DateTime end) {
  final DateTime from = start.toLocal();
  final DateTime to = end.toLocal();

  final bool sameDay =
      from.year == to.year && from.month == to.month && from.day == to.day;

  if (sameDay) {
    return '${formatTime(from)}–${formatTime(to)}';
  }
  return '${formatDate(from)} ${formatTime(from)} → ${formatDate(to)} ${formatTime(to)}';
}

/// `7 хоног` / `1 өдөр` — how much of the span is left, for a multi-day entry.
String formatDayCount(int days) => '$days хоног';
