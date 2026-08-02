/// The two things a calendar entry can be a projection of.
///
/// Mirrors `CALENDAR_SOURCES` / `CALENDAR_SOURCE_LABELS` in
/// packages/shared/src/types/calendar.types.ts. There is deliberately no
/// calendar-only entity on the backend, so nothing can appear here that does not
/// already exist as planned work or as a service request.
enum CalendarSource {
  plannedWork('PLANNED_WORK', 'Төлөвлөгөөт ажил', 'Төлөвлөгөөт'),
  serviceRequest('SERVICE_REQUEST', 'Үйлчилгээний хүсэлт', 'Хүсэлт');

  const CalendarSource(this.wireValue, this.label, this.shortLabel);

  final String wireValue;
  final String label;

  /// Fits a segmented filter chip, where the full label wraps.
  final String shortLabel;

  /// Parsed defensively: a source a newer API adds must not crash the grid, and
  /// planned work is the safer of the two to fall back on because it is the one the
  /// employee schedule is actually built from.
  static CalendarSource fromWire(String? value) {
    return CalendarSource.values.firstWhere(
      (CalendarSource source) => source.wireValue == value,
      orElse: () => CalendarSource.plannedWork,
    );
  }
}
