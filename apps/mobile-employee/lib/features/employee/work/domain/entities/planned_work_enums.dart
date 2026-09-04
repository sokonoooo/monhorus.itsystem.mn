/// The planned-work vocabulary, transcribed from
/// `packages/shared/src/constants/planned-work.ts`.
///
/// Every enum here parses defensively, so a backend that gains a status in a later
/// release does not crash a technician's phone in the field. Where a neutral member
/// exists an unrecognised value degrades to it; where none does — [MaterialUnit],
/// where every member is a real measure — `fromWire` returns null and the caller
/// shows the server's own string rather than inventing one.
///
/// Nothing in this file recomputes a value the server publishes. `effectiveStatus`,
/// `progressPercent`, task `status` and `riskLevel` are all derived server-side; the
/// app renders them. The one thing derived here is colour, which is presentation.
library;

import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../shared/planned_work_vocabulary.dart';
import '../../../shared/service_request_vocabulary.dart' show SeverityBand;

/// The planned-work status vocabulary, which is shared with the Нүүр tab rather than
/// transcribed a second time. See [PlannedWorkEffectiveStatus] below.
export '../../../shared/planned_work_vocabulary.dart' show PlannedWorkStatus;

/// `RiskLevel` is **not** declared here.
///
/// This file used to carry its own copy, with a `tone` that folded ATTENTION into
/// SCHEDULE_REPAIR and CRITICAL into OUT_OF_SERVICE. The same device therefore
/// rendered as two different bands depending on which tab you were standing in. The
/// app has one risk enum; the work feature re-exports it so its own importers keep
/// reading one file.
export '../../../project/domain/entities/risk_level.dart'
    show RiskLevel, riskSemanticLabel, riskShortLabel, riskTone, unassessedLabel;

/// Persisted lifecycle state. Changed only through the transition endpoint.
enum PlannedWorkLifecycleStatus {
  draft('DRAFT'),
  pendingApproval('PENDING_APPROVAL'),
  rejected('REJECTED'),
  planned('PLANNED'),
  started('STARTED'),
  paused('PAUSED'),
  completed('COMPLETED'),
  archived('ARCHIVED'),
  cancelled('CANCELLED');

  const PlannedWorkLifecycleStatus(this.wireValue);

  final String wireValue;

  static PlannedWorkLifecycleStatus fromWire(String? value) {
    return PlannedWorkLifecycleStatus.values.firstWhere(
      (PlannedWorkLifecycleStatus status) => status.wireValue == value,
      orElse: () => PlannedWorkLifecycleStatus.draft,
    );
  }
}

/// The status the UI displays and filters on.
///
/// **Not declared here.** It is `PlannedWorkStatus` in
/// `shared/planned_work_vocabulary.dart`, aliased under the name this feature's forty-odd
/// call sites already use. The home tab used to carry a second copy of the same list with
/// two statuses missing and a different idea of what "finished" means; there is one enum
/// now and neither tab can drift from the other.
///
/// The alias keeps the name because the DISTINCTION it draws is real and worth keeping in
/// the type name: [PlannedWorkLifecycleStatus] is what is persisted and what the transition
/// endpoint accepts, while the effective status adds OVERDUE, which the server derives on
/// read and nobody can select.
typedef PlannedWorkEffectiveStatus = PlannedWorkStatus;

/// The employee palette for a status band.
///
/// Colour is presentation and stays with the feature, which is why the shared enum carries
/// a [SeverityBand] and not a [Color]: `shared/planned_work_vocabulary.dart` is
/// Flutter-free so both features' domain layers can read it.
///
/// Overdue and rejected are the red states; work in flight is yellow; a job that reached
/// its end is green; anything not yet begun, or called off, is neutral.
extension PlannedWorkStatusTone on PlannedWorkStatus {
  Color get tone {
    switch (band) {
      case SeverityBand.red:
        return EmployeeTokens.red;
      case SeverityBand.yellow:
        return EmployeeTokens.yellow;
      case SeverityBand.green:
        return EmployeeTokens.green;
      case SeverityBand.ink:
        return EmployeeTokens.ink;
      case SeverityBand.neutral:
        return EmployeeTokens.muted;
    }
  }
}

/// Sub-task status. Derived server-side from recorded quantity plus the evidence
/// gate — a user can never pick it, which is why there is no setter anywhere here.
enum PlannedWorkTaskStatus {
  pending('PENDING', 'Хүлээгдэж байна'),
  inProgress('IN_PROGRESS', 'Хийгдэж байна'),
  done('DONE', 'Дууссан'),
  skipped('SKIPPED', 'Хийгдээгүй');

  const PlannedWorkTaskStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static PlannedWorkTaskStatus fromWire(String? value) {
    return PlannedWorkTaskStatus.values.firstWhere(
      (PlannedWorkTaskStatus status) => status.wireValue == value,
      orElse: () => PlannedWorkTaskStatus.pending,
    );
  }

  Color get tone {
    switch (this) {
      case PlannedWorkTaskStatus.done:
        return EmployeeTokens.green;
      case PlannedWorkTaskStatus.inProgress:
        return EmployeeTokens.yellow;
      case PlannedWorkTaskStatus.skipped:
      case PlannedWorkTaskStatus.pending:
        return EmployeeTokens.muted;
    }
  }
}

/// Which half of the evidence gate a photo satisfies.
///
/// `photoKindSchema` on `POST .../tasks/:taskId/photos` accepts exactly these two
/// values, and the task's `missingEvidence` names them in the same order, so the
/// labels here are the ones the server's own blocker list uses.
enum TaskPhotoKind {
  before('BEFORE', 'Ажлын өмнөх зураг'),
  after('AFTER', 'Ажлын дараах зураг');

  const TaskPhotoKind(this.wireValue, this.label);

  final String wireValue;
  final String label;
}

/// Consolidated report state.
enum PlannedWorkReportStatus {
  draft('DRAFT', 'Ноорог'),
  submitted('SUBMITTED', 'Хянуулахаар илгээсэн'),
  approved('APPROVED', 'Батлагдсан'),
  returned('RETURNED', 'Буцаагдсан');

  const PlannedWorkReportStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static PlannedWorkReportStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final PlannedWorkReportStatus status in PlannedWorkReportStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }

  Color get tone {
    switch (this) {
      case PlannedWorkReportStatus.approved:
        return EmployeeTokens.green;
      case PlannedWorkReportStatus.submitted:
        return EmployeeTokens.yellow;
      case PlannedWorkReportStatus.returned:
        return EmployeeTokens.red;
      case PlannedWorkReportStatus.draft:
        return EmployeeTokens.muted;
    }
  }
}

/// A user-initiated lifecycle move.
///
/// The app never decides which of these is legal: the record's `availableActions`
/// is computed server-side and is the only thing a button is rendered from. This
/// enum exists to name the permission each action needs, so a control the API would
/// refuse is not offered in the first place.
///
/// ALL EIGHT OF `PLANNED_WORK_ACTIONS` ARE HERE, and two of them are new. This enum
/// carried six, so `fromWire` answered null for APPROVE and REJECT and
/// `PlannedWorkAvailableActionModel` dropped them without a word — the server said the
/// approval gate was open on this record and the app silently threw the sentence away.
/// A dropped action is worse than an unoffered one: an unoffered action can at least be
/// explained on screen, and [assignsCrew] is what lets the screen do that.
enum PlannedWorkAction {
  plan('PLAN', 'planned_work.change_status'),

  /// Accept the request AND staff it, in one decision.
  ///
  /// `PLANNED_WORK_ACTION_RULES.APPROVE.assignsCrew` is true and it is the only rule
  /// that carries the flag: the approver names the employees as part of approving, and
  /// the transition is refused without at least one. A work therefore cannot reach
  /// PLANNED unstaffed — which is also why a PENDING_APPROVAL record has an empty crew,
  /// and why the scope check has to admit `planned_work.approve` (see
  /// [WorkGrants.hasPlannedWorkOversight]).
  ///
  /// It is parsed and it is NOT offered as a button. This app has no crew picker, and
  /// building one is not a rename of an existing control: it needs the employee
  /// directory, a multi-select and the team the work belongs to, none of which the field
  /// app carries. A button that could only ever return "at least one employee is
  /// required" is a promise the app cannot keep, so the screen says where approval is
  /// done instead of pretending it can be done here.
  approve('APPROVE', 'planned_work.approve', assignsCrew: true),

  /// Send it back to its author with a reason, to be corrected and submitted again.
  ///
  /// Offered, unlike APPROVE, because it needs nothing this app cannot collect: the same
  /// `planned_work.approve` key, and a reason, which the transition sheet already prompts
  /// for on every action whose rule sets `requiresReason`.
  reject('REJECT', 'planned_work.approve'),
  start('START', 'planned_work.change_status'),
  pause('PAUSE', 'planned_work.change_status'),
  resume('RESUME', 'planned_work.change_status'),
  complete('COMPLETE', 'planned_work.change_status'),
  cancel('CANCEL', 'planned_work.cancel');

  const PlannedWorkAction(
    this.wireValue,
    this.permission, {
    this.assignsCrew = false,
  });

  final String wireValue;

  /// Mirrors `PLANNED_WORK_ACTION_RULES[...].permission`. The transition route has no
  /// router-level guard; it is enforced per action inside the service.
  final String permission;

  /// The action assigns the crew and the server refuses to run it without one.
  ///
  /// Mirrors `PLANNED_WORK_ACTION_RULES[...].assignsCrew`, which only APPROVE sets. The
  /// transition endpoint takes no employee list from this app, so an action carrying
  /// this flag is parsed, counted and reported — and never drawn as a button.
  final bool assignsCrew;

  /// Whether this app can carry the action through to a server that would accept it.
  ///
  /// False for exactly the actions that need an input this client cannot collect. It is
  /// a capability statement about the app, not a permission check and not a guess about
  /// the record: `availableActions` still says whether the move is legal, and
  /// [WorkGrants.allows] still says whether the caller may make it.
  bool get isOfferable => !assignsCrew;

  static PlannedWorkAction? fromWire(String? value) {
    if (value == null) return null;
    for (final PlannedWorkAction action in PlannedWorkAction.values) {
      if (action.wireValue == value) return action;
    }
    return null;
  }

  /// Drawn as the recessive red button rather than the primary one.
  ///
  /// CANCEL calls the work off. REJECT hands it back to whoever raised it, which is
  /// recoverable — they correct it and submit again — but it is still a refusal of
  /// somebody else's request and not a step forward through the job, so it gets the same
  /// deliberate, secondary treatment rather than sitting under the reader's thumb.
  bool get isDestructive =>
      this == PlannedWorkAction.cancel || this == PlannedWorkAction.reject;
}

/// Quantity unit, from `MATERIAL_UNITS`.
enum MaterialUnit {
  piece('PIECE', 'ширхэг'),
  metre('METRE', 'метр'),
  kilogram('KILOGRAM', 'кг'),
  litre('LITRE', 'литр'),
  set('SET', 'иж бүрдэл'),
  box('BOX', 'хайрцаг'),
  roll('ROLL', 'ороомог');

  const MaterialUnit(this.wireValue, this.label);

  final String wireValue;

  /// Lower-case so it reads inside a sentence: "нийт 20 цэг-с".
  final String label;

  /// Null for a unit added to `MATERIAL_UNITS` after this build shipped, as
  /// `NotificationEvent.fromWire` and `ServiceRequestStatus.fromWire` do it.
  ///
  /// This used to end `orElse: () => MaterialUnit.piece`, which is the one fallback a
  /// unit must not have: a measure is half of what a quantity means, so folding an
  /// unknown value onto PIECE printed 40 metres of cable back to the technician as 40
  /// ширхэг — a wrong reading rather than an unknown one. Read through
  /// [MaterialUnitValue], which keeps the server's own string for display.
  static MaterialUnit? fromWire(String? value) {
    if (value == null) return null;
    for (final MaterialUnit unit in MaterialUnit.values) {
      if (unit.wireValue == value) return unit;
    }
    return null;
  }
}

/// A quantity's unit as the record carries it: the enum member when this build knows
/// the wire value, and the server's own string when it does not.
///
/// The raw value is kept rather than dropped because a technician reading «40 TONNE»
/// learns something true, while «40» alone loses the measure and «40 ширхэг» states a
/// measure nobody recorded. Nothing here guesses: [label] is empty only when the
/// record carried no unit at all.
@immutable
class MaterialUnitValue {
  const MaterialUnitValue(this.known, this.wireValue);

  factory MaterialUnitValue.fromWire(String? value) {
    final String? raw = value?.trim();
    return MaterialUnitValue(
      MaterialUnit.fromWire(raw),
      raw == null || raw.isEmpty ? null : raw,
    );
  }

  /// A unit this build was compiled against, or null.
  final MaterialUnit? known;

  /// Exactly what the server sent, or null when it sent nothing.
  final String? wireValue;

  bool get isKnown => known != null;

  /// «метр» for a known unit, the wire value for one this build does not know, and an
  /// empty string when there is no unit to name. Never a substituted unit.
  String get label => known?.label ?? wireValue ?? '';

  @override
  bool operator ==(Object other) =>
      other is MaterialUnitValue &&
      other.known == known &&
      other.wireValue == wireValue;

  @override
  int get hashCode => Object.hash(known, wireValue);

  @override
  String toString() => 'MaterialUnitValue($label)';
}

