/// Formatting specific to the Төсөл tab.
///
/// The patterns every tab needs — `formatDate`, `formatDateTime`, `formatEventStamp`
/// — live in `lib/core/util/format.dart` and are re-exported here, so a call site
/// inside this feature still imports one file. Only the patterns this tab alone uses
/// are declared below.
library;

import '../../../../core/util/format.dart';

export '../../../../core/util/format.dart';

/// `2026.01` — the month stamp the prototype uses on a project's date range.
String formatMonth(DateTime? value) {
  if (value == null) return kNoValue;
  final DateTime local = value.toLocal();
  return '${local.year}.${two(local.month)}';
}

/// `2026.01–2026.12`, or a single bound when only one is set, or null when neither is.
String? formatMonthRange(DateTime? from, DateTime? to) {
  if (from == null && to == null) return null;
  if (from != null && to != null) return '${formatMonth(from)}–${formatMonth(to)}';
  return formatMonth(from ?? to);
}

/// Trims a trailing `.0`, so 12.0 kW reads as 12 kW while 12.5 keeps its digit.
String formatDecimal(double? value) {
  if (value == null) return kNoValue;
  if (value == value.roundToDouble()) return value.round().toString();
  return value.toStringAsFixed(2);
}

/// Thousands separated with a comma, matching the prototype's "1,248".
String formatCount(int value) {
  final String digits = value.abs().toString();
  final StringBuffer buffer = StringBuffer();
  for (int i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(',');
    buffer.write(digits[i]);
  }
  return value < 0 ? '-$buffer' : buffer.toString();
}

/// Byte count as KB or MB, for a plan or photo caption.
String formatBytes(int bytes) {
  if (bytes < 1024) return '$bytes B';
  if (bytes < 1024 * 1024) return '${(bytes / 1024).round()} KB';
  return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
}

/// Joins the non-empty parts of a subtitle with the prototype's middle dot.
String joinParts(List<String?> parts) => parts
    .whereType<String>()
    .where((String part) => part.isNotEmpty)
    .join(' · ');
