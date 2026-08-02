import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';

/// The risk colour a calendar entry carries.
///
/// The prototype's mini calendar draws up to three dots per day in `g` / `y` / `r`.
/// A fourth, [neutral], is added for records that are not outstanding and not a
/// result either — a draft or a cancellation. Painting those green would claim work
/// was finished, and painting them yellow would claim it is still owed; grey says
/// neither, which is what the record means.
///
/// The band is derived here and never sent by the server: `CalendarEventDto` reports
/// `status`, `isOverdue` and `isUrgent`, and the mapping from those to a colour is a
/// presentation decision.
enum EventLevel {
  red,
  yellow,
  green,
  neutral;

  Color get color => switch (this) {
        EventLevel.red => EmployeeTokens.red,
        EventLevel.yellow => EmployeeTokens.yellow,
        EventLevel.green => EmployeeTokens.green,
        EventLevel.neutral => EmployeeTokens.line,
      };

  Color get background => switch (this) {
        EventLevel.red => EmployeeTokens.redBg,
        EventLevel.yellow => EmployeeTokens.yellowBg,
        EventLevel.green => EmployeeTokens.greenBg,
        EventLevel.neutral => EmployeeTokens.soft2,
      };

  Color get border => switch (this) {
        EventLevel.red => EmployeeTokens.redBorder,
        EventLevel.yellow => EmployeeTokens.yellowBorder,
        EventLevel.green => EmployeeTokens.greenBorder,
        EventLevel.neutral => EmployeeTokens.faint,
      };

  Color get foreground => switch (this) {
        EventLevel.neutral => EmployeeTokens.muted,
        _ => color,
      };

  /// The triad a chip drawn in this band uses, so the calendar reaches the one
  /// shared pill widget rather than carrying a `StatusPill` of its own.
  Tone get tone => switch (this) {
        EventLevel.red => Tone.red,
        EventLevel.yellow => Tone.yellow,
        EventLevel.green => Tone.green,
        EventLevel.neutral => Tone.neutral,
      };

  /// Sort key so the worst band leads a day's dot row and its agenda.
  int get severity => switch (this) {
        EventLevel.red => 0,
        EventLevel.yellow => 1,
        EventLevel.green => 2,
        EventLevel.neutral => 3,
      };
}

/// Statuses that mean the record produced its result and is no longer owed.
///
/// `ARCHIVED` is a planned work whose report was approved; `COMPLETED` is shared by
/// both vocabularies (packages/shared/src/constants/planned-work.ts and
/// .../service-request.ts).
const Set<String> settledStatuses = <String>{'COMPLETED', 'ARCHIVED'};

/// Statuses that are neither outstanding nor a result.
const Set<String> dormantStatuses = <String>{'DRAFT', 'CANCELLED', 'RETURNED'};

/// Maps a backend status plus its two flags onto a band.
EventLevel levelFor({
  required String status,
  required bool isOverdue,
  required bool isUrgent,
}) {
  // A missed deadline outranks everything, including a status that reads calm.
  if (isOverdue || status == 'OVERDUE') return EventLevel.red;
  if (dormantStatuses.contains(status)) return EventLevel.neutral;
  if (settledStatuses.contains(status)) return EventLevel.green;
  if (isUrgent || status == 'REVISIT_REQUIRED') return EventLevel.red;
  return EventLevel.yellow;
}
