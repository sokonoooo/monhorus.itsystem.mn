/// Date and number formatting for the customer portal.
///
/// Written by hand rather than pulling in `intl`: the app needs one date pattern and
/// one relative phrasing, and a package would be a heavier dependency than the two
/// functions below. Everything renders in the device's local time zone, since the
/// API sends UTC and a customer reads these against their own clock.
library;

String _two(int value) => value < 10 ? '0$value' : '$value';

/// `2026.07.29`
String formatDate(DateTime? value) {
  if (value == null) return '-';
  final DateTime local = value.toLocal();
  return '${local.year}.${_two(local.month)}.${_two(local.day)}';
}

/// `2026.07.29 14:30`
String formatDateTime(DateTime? value) {
  if (value == null) return '-';
  final DateTime local = value.toLocal();
  return '${formatDate(local)} ${_two(local.hour)}:${_two(local.minute)}';
}

/// `14:30`
String formatTime(DateTime? value) {
  if (value == null) return '-';
  final DateTime local = value.toLocal();
  return '${_two(local.hour)}:${_two(local.minute)}';
}

/// "Өнөөдөр 09:12", "Өчигдөр 18:44", otherwise the full stamp.
///
/// The relative words are only used for today and yesterday. Anything older gets a
/// date, because "3 өдрийн өмнө" reads as vaguer than the date it replaces.
String formatEventStamp(DateTime? value, {DateTime? now}) {
  if (value == null) return '-';
  final DateTime local = value.toLocal();
  final DateTime reference = (now ?? DateTime.now()).toLocal();

  final DateTime today = DateTime(reference.year, reference.month, reference.day);
  final DateTime day = DateTime(local.year, local.month, local.day);
  final int dayDelta = today.difference(day).inDays;

  if (dayDelta == 0) return 'Өнөөдөр ${formatTime(local)}';
  if (dayDelta == 1) return 'Өчигдөр ${formatTime(local)}';
  return formatDateTime(local);
}

/// "5 минутын өмнө", "2 цагийн өмнө", otherwise a date stamp.
String formatRelative(DateTime? value, {DateTime? now}) {
  if (value == null) return '-';
  final Duration elapsed = (now ?? DateTime.now()).difference(value);

  if (elapsed.isNegative) return formatDateTime(value);
  if (elapsed.inMinutes < 1) return 'Саяхан';
  if (elapsed.inMinutes < 60) return '${elapsed.inMinutes} минутын өмнө';
  if (elapsed.inHours < 24) return '${elapsed.inHours} цагийн өмнө';
  if (elapsed.inDays == 1) return 'Өчигдөр ${formatTime(value)}';
  return formatDateTime(value);
}

/// Trims a trailing `.0` so 12.0 kW reads as 12 kW while 12.5 keeps its digit.
String formatDecimal(double? value) {
  if (value == null) return '-';
  if (value == value.roundToDouble()) return value.round().toString();
  return value.toStringAsFixed(2);
}

/// Byte count as KB or MB, for an attachment row.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}
