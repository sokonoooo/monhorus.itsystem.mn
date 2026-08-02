/// Date, number and name formatting shared by every employee tab.
///
/// All five tabs arrived with their own copy of `formatDate`, `formatTime`,
/// `formatDateTime` and friends. This is the one surviving implementation; each
/// feature's `format.dart` now re-exports this file and keeps only the patterns that
/// are genuinely its own (the work tab's deadline phrasing, the project tab's byte
/// caption, the calendar's agenda span).
///
/// Written by hand rather than pulling in `intl`: the app needs a handful of fixed
/// patterns and no locale negotiation, and the package would weigh more than the
/// functions below. Everything renders in the device's local time zone, because the
/// API sends UTC and a technician reads a deadline against the clock on the wall.
///
/// The absent value renders as an em dash throughout. The five tabs disagreed on
/// this — three printed a hyphen, two an em dash — and one had to win, because the
/// same missing figure showing as `-` on one screen and `—` on the next reads as two
/// different states rather than one.
library;

/// Zero-padded two-digit number, exposed so a feature's own pattern can reuse it.
String two(int value) => value < 10 ? '0$value' : '$value';

/// What every formatter here prints when there is nothing to print.
const String kNoValue = '—';

/// `2026.07.29`
String formatDate(DateTime? value) {
  if (value == null) return kNoValue;
  final DateTime local = value.toLocal();
  return '${local.year}.${two(local.month)}.${two(local.day)}';
}

/// `14:30`
String formatTime(DateTime? value) {
  if (value == null) return kNoValue;
  final DateTime local = value.toLocal();
  return '${two(local.hour)}:${two(local.minute)}';
}

/// `2026.07.29 14:30`
String formatDateTime(DateTime? value) {
  if (value == null) return kNoValue;
  return '${formatDate(value)} ${formatTime(value)}';
}

/// "Өнөөдөр 09:12", "Өчигдөр 18:44", otherwise the full stamp.
///
/// The relative words are used for today and yesterday only. Anything older gets a
/// date, because "3 өдрийн өмнө" reads vaguer than the date it replaces.
String formatEventStamp(DateTime? value, {DateTime? now}) {
  if (value == null) return kNoValue;
  final DateTime local = value.toLocal();
  final DateTime reference = (now ?? DateTime.now()).toLocal();

  final DateTime today = DateTime(reference.year, reference.month, reference.day);
  final DateTime day = DateTime(local.year, local.month, local.day);
  final int dayDelta = today.difference(day).inDays;

  if (dayDelta == 0) return 'Өнөөдөр ${formatTime(local)}';
  if (dayDelta == 1) return 'Өчигдөр ${formatTime(local)}';
  return formatDateTime(local);
}

/// `2.7%` for a fractional reading, `100%` for a whole one.
///
/// Clamped rather than rounded at the ends. The server caps a percentage below 100
/// until the quantity is genuinely complete, so a value arriving as 99.9 is
/// deliberately not rounded up — a reviewer seeing "100%" on unfinished work is
/// exactly the confusion that cap exists to prevent.
String formatPercent(double? value) {
  if (value == null) return kNoValue;
  if (value >= 100) return '100%';
  if (value <= 0) return '0%';
  if (value == value.roundToDouble()) return '${value.round()}%';
  return '${value.toStringAsFixed(1)}%';
}

/// A deadline as a countdown: "2 ц 15 мин үлдсэн", "45 мин хоцорсон".
///
/// Takes the backend's own `slaRemainingMinutes` rather than subtracting dates on the
/// device, because that figure already accounts for authorised SLA extensions and for
/// a clock the phone may not agree with.
///
/// Here rather than in one tab's `format.dart` because two of them print it: the Нүүр
/// tab on an assigned request, and the Ажил tab on the unclaimed pool. A tab-local copy
/// would be a second phrasing of the same figure.
String formatSlaRemaining(int? minutes) {
  if (minutes == null) return kNoValue;
  final int absolute = minutes.abs();
  final int hours = absolute ~/ 60;
  final int rest = absolute % 60;

  final String span = hours > 0
      ? (rest > 0 ? '$hours ц $rest мин' : '$hours цаг')
      : '$rest мин';

  return minutes < 0 ? '$span хоцорсон' : '$span үлдсэн';
}

/// Initials for an avatar: "Батаа Энхтөр" -> "БЭ", "Батаа" -> "БА".
///
/// Falls back to `?` for an empty name, so the circle is never rendered blank.
String initialsOf(String? fullName) {
  final String value = (fullName ?? '').trim();
  if (value.isEmpty) return '?';

  final List<String> parts = value
      .split(RegExp(r'\s+'))
      .where((String part) => part.isNotEmpty)
      .toList(growable: false);
  if (parts.isEmpty) return '?';
  if (parts.length == 1) return parts.first._takeLetters(2);
  return '${parts[0]._takeLetters(1)}${parts[1]._takeLetters(1)}';
}

extension on String {
  /// The leading [count] characters, upper-cased.
  ///
  /// Cyrillic is single-code-unit in UTF-16, so a plain substring is safe for the
  /// names this app renders; the helper exists to avoid a RangeError on a
  /// one-character name.
  String _takeLetters(int count) =>
      (length <= count ? this : substring(0, count)).toUpperCase();
}
