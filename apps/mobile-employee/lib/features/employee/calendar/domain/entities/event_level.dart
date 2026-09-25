import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../shared/planned_work_vocabulary.dart';
import '../../../shared/service_request_vocabulary.dart';

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

/// Maps a backend status plus its two flags onto a band.
///
/// THE STATUS ARRIVES AS A RAW STRING and it belongs to one of two vocabularies: a
/// `CalendarEventDto` carries whatever its source record's own status field says, and the
/// two sources do not share a word list. That is why this took raw strings — and why it
/// used to compare against hand-written sets, `{'COMPLETED','ARCHIVED'}` and
/// `{'DRAFT','CANCELLED','RETURNED'}` and a bare `'OVERDUE'`, which is a third
/// transcription of two vocabularies the app already has enums for. A status added to
/// either list would have been silently mis-banded here and nowhere else.
///
/// So the string is parsed through BOTH enums and the answer is whichever one recognises
/// it. Nothing is hard-coded that either vocabulary already states.
///
/// The order of the tests is load-bearing and unchanged. A missed deadline outranks
/// everything, including a status that reads calm. A dormant record is checked BEFORE a
/// settled one, which is what paints a cancelled job grey rather than green: it is not a
/// result, and green would claim it was one.
EventLevel levelFor({
  required String status,
  required bool isOverdue,
  required bool isUrgent,
}) {
  final PlannedWorkStatus? work = PlannedWorkStatus.fromWire(status);
  final ServiceRequestStatus? request = ServiceRequestStatus.fromWire(status);

  if (isOverdue || work == PlannedWorkStatus.overdue) return EventLevel.red;
  if (_isDormant(work, request)) return EventLevel.neutral;
  if (work?.isFinished ?? false) return EventLevel.green;
  if (request == ServiceRequestStatus.completed) return EventLevel.green;
  if (isUrgent || request == ServiceRequestStatus.revisitRequired) {
    return EventLevel.red;
  }
  return EventLevel.yellow;
}

/// Neither outstanding nor a result: nothing is owed and nothing was produced.
///
/// A planned work that was never submitted or was called off, and a request that was
/// called off or handed back to the customer. REJECTED is deliberately NOT here: it is a
/// work its author has to correct and resubmit, which is owed rather than dormant, and
/// leaving it to fall through to yellow is what the app did before either status could be
/// parsed at all.
bool _isDormant(PlannedWorkStatus? work, ServiceRequestStatus? request) =>
    work == PlannedWorkStatus.draft ||
    work == PlannedWorkStatus.cancelled ||
    request == ServiceRequestStatus.cancelled ||
    request == ServiceRequestStatus.returned;
