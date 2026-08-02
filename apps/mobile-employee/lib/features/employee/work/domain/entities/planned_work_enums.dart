/// The planned-work vocabulary, transcribed from
/// `packages/shared/src/constants/planned-work.ts`.
///
/// Every enum here parses defensively: an unrecognised wire value degrades to a
/// neutral member rather than throwing, so a backend that gains a status in a later
/// release does not crash a technician's phone in the field.
///
/// Nothing in this file recomputes a value the server publishes. `effectiveStatus`,
/// `progressPercent`, task `status` and `riskLevel` are all derived server-side; the
/// app renders them. The one thing derived here is colour, which is presentation.
library;

import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';

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

/// The status the UI displays and filters on. Adds OVERDUE, which is derived on
/// read by the server and is never persisted or selectable.
enum PlannedWorkEffectiveStatus {
  draft('DRAFT', 'Төсөл'),
  planned('PLANNED', 'Төлөвлөгдсөн'),
  started('STARTED', 'Хэрэгжиж байна'),
  paused('PAUSED', 'Түр зогссон'),
  overdue('OVERDUE', 'Хугацаа хэтэрсэн'),
  completed('COMPLETED', 'Дууссан'),
  archived('ARCHIVED', 'Архивласан'),
  cancelled('CANCELLED', 'Цуцлагдсан');

  const PlannedWorkEffectiveStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static PlannedWorkEffectiveStatus fromWire(String? value) {
    return PlannedWorkEffectiveStatus.values.firstWhere(
      (PlannedWorkEffectiveStatus status) => status.wireValue == value,
      orElse: () => PlannedWorkEffectiveStatus.planned,
    );
  }

  /// Still outstanding work: it sits in a technician's queue.
  bool get isOpen =>
      this == PlannedWorkEffectiveStatus.planned ||
      this == PlannedWorkEffectiveStatus.started ||
      this == PlannedWorkEffectiveStatus.paused ||
      this == PlannedWorkEffectiveStatus.overdue;

  bool get isFinished =>
      this == PlannedWorkEffectiveStatus.completed ||
      this == PlannedWorkEffectiveStatus.archived ||
      this == PlannedWorkEffectiveStatus.cancelled;

  /// Risk colour. Overdue is the only red state; a finished record is green; work in
  /// flight is yellow; anything not yet begun is neutral.
  Color get tone {
    switch (this) {
      case PlannedWorkEffectiveStatus.overdue:
        return EmployeeTokens.red;
      case PlannedWorkEffectiveStatus.started:
      case PlannedWorkEffectiveStatus.paused:
        return EmployeeTokens.yellow;
      case PlannedWorkEffectiveStatus.completed:
      case PlannedWorkEffectiveStatus.archived:
        return EmployeeTokens.green;
      case PlannedWorkEffectiveStatus.draft:
      case PlannedWorkEffectiveStatus.planned:
      case PlannedWorkEffectiveStatus.cancelled:
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
enum PlannedWorkAction {
  plan('PLAN', 'planned_work.change_status'),
  start('START', 'planned_work.change_status'),
  pause('PAUSE', 'planned_work.change_status'),
  resume('RESUME', 'planned_work.change_status'),
  complete('COMPLETE', 'planned_work.change_status'),
  cancel('CANCEL', 'planned_work.cancel');

  const PlannedWorkAction(this.wireValue, this.permission);

  final String wireValue;

  /// Mirrors `PLANNED_WORK_ACTION_RULES[...].permission`. The transition route has no
  /// router-level guard; it is enforced per action inside the service.
  final String permission;

  static PlannedWorkAction? fromWire(String? value) {
    if (value == null) return null;
    for (final PlannedWorkAction action in PlannedWorkAction.values) {
      if (action.wireValue == value) return action;
    }
    return null;
  }

  /// CANCEL is destructive; everything else is a routine move.
  bool get isDestructive => this == PlannedWorkAction.cancel;
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

  static MaterialUnit fromWire(String? value) {
    return MaterialUnit.values.firstWhere(
      (MaterialUnit unit) => unit.wireValue == value,
      orElse: () => MaterialUnit.piece,
    );
  }
}

