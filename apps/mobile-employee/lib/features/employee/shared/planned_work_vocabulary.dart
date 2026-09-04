/// The planned-work status vocabulary — the ONE copy.
///
/// This used to be two. `home/domain/entities/work_enums.dart` carried a
/// `PlannedWorkStatus` with eight of the ten values, and
/// `work/domain/entities/planned_work_enums.dart` carried a
/// `PlannedWorkEffectiveStatus` with all ten. They disagreed about what "finished"
/// means — one excluded CANCELLED and the other included it — and the home tab
/// rendered PENDING_APPROVAL and REJECTED as null, which is to say as nothing at all.
/// Two hand-written transcriptions of one list is exactly the failure mode nothing in
/// Dart can detect, so there is now one enum and the work feature aliases it.
///
/// Deliberately free of Flutter, like `service_request_vocabulary.dart` beside it, so
/// both features' domain layers can read it without importing the toolkit. Colour is a
/// presentation decision and lives with the feature: [SeverityBand] is the band, and
/// `planned_work_enums.dart` maps a band onto the employee palette.
library;

import 'service_request_vocabulary.dart' show SeverityBand;

/// `PLANNED_WORK_EFFECTIVE_STATUSES`, all ten, in the backend's own order.
///
/// OVERDUE is derived by the backend on read and is never persisted, so it appears
/// here but is never sent as an input. The other nine are the persisted lifecycle.
enum PlannedWorkStatus {
  draft('DRAFT', 'Төсөл', SeverityBand.neutral),
  pendingApproval('PENDING_APPROVAL', 'Хүлээгдэж буй', SeverityBand.yellow),
  rejected('REJECTED', 'Буцаагдсан', SeverityBand.red),
  planned('PLANNED', 'Төлөвлөгдсөн', SeverityBand.neutral),
  started('STARTED', 'Хэрэгжиж байна', SeverityBand.yellow),
  paused('PAUSED', 'Түр зогссон', SeverityBand.yellow),
  overdue('OVERDUE', 'Хугацаа хэтэрсэн', SeverityBand.red),
  completed('COMPLETED', 'Дууссан', SeverityBand.green),

  /// A planned work whose report has been approved. Green rather than the neutral the
  /// home tab used to paint it: the two copies disagreed here too, and archived is the
  /// end of a job that went well, not a filing state.
  archived('ARCHIVED', 'Архивласан', SeverityBand.green),
  cancelled('CANCELLED', 'Цуцлагдсан', SeverityBand.neutral);

  const PlannedWorkStatus(this.wireValue, this.label, this.band);

  final String wireValue;
  final String label;
  final SeverityBand band;

  /// Null for a status added to `PLANNED_WORK_EFFECTIVE_STATUSES` after this build
  /// shipped, so the caller can render the server's own string rather than a
  /// substituted state.
  static PlannedWorkStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final PlannedWorkStatus status in PlannedWorkStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }

  /// For the one caller that cannot hold a null: `PlannedWorkListItemModel`, whose
  /// `effectiveStatus` is non-nullable because every list row carries one.
  ///
  /// PLANNED is the neutral landing place — it is the state that neither claims a job
  /// is late nor claims it is done.
  static PlannedWorkStatus fromWireOrPlanned(String? value) =>
      fromWire(value) ?? PlannedWorkStatus.planned;

  /// Still outstanding work: it sits in somebody's queue and the day owes it.
  ///
  /// DRAFT, PENDING_APPROVAL and REJECTED are NOT outstanding here, and that is the
  /// same call both copies already made: none of the three has a crew — approval is
  /// what assigns one — so none of them is work anybody has been given yet.
  bool get isOutstanding =>
      this == PlannedWorkStatus.planned ||
      this == PlannedWorkStatus.started ||
      this == PlannedWorkStatus.paused ||
      this == PlannedWorkStatus.overdue;

  /// The work feature's name for [isOutstanding]. One rule, two call-site vocabularies.
  bool get isOpen => isOutstanding;

  bool get isInProgress =>
      this == PlannedWorkStatus.started || this == PlannedWorkStatus.paused;

  /// Done with: nothing further is owed on the record.
  ///
  /// CANCELLED IS FINISHED, which is the half the home tab used to get wrong. The
  /// question is "is this still work the day owes?", and called-off work is not. It is
  /// not a *result* — the calendar paints it neutral grey rather than green for exactly
  /// that reason — but honesty of colour and "is it still owed" are different
  /// questions, and only the second one is this getter's.
  bool get isFinished =>
      this == PlannedWorkStatus.completed ||
      this == PlannedWorkStatus.archived ||
      this == PlannedWorkStatus.cancelled;

  /// Waiting on an approver rather than on a technician. A work in this state has an
  /// empty crew by construction, which is why it never reaches an assigned queue.
  bool get isAwaitingApproval => this == PlannedWorkStatus.pendingApproval;
}
