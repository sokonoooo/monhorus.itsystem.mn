/// Wire models for `/planned-work/:plannedWorkId/inspection-report`, mirroring
/// `packages/shared/src/types/inspection-report.types.ts`.
///
/// The consolidated Үзлэгийн нэгдсэн тайлан is a second, separate workflow from the
/// `PlannedWorkReport` in `planned_work_model.dart`: it is produced once every
/// non-skipped sub-task is DONE — NOT when the work is completed — and it carries the
/// printed act's narrative rather than one Дүгнэлт and one Зөвлөмж.
///
/// Everything the server derives — the floor groups, the илэрсэн зөрчил list and the
/// ерөнхий түвшин — is recomputed on every read from the sub-tasks, so nothing here is
/// ever sent back. Only the six narrative fields are writable, which is exactly what
/// `updateInspectionReportSchema` accepts, and it is `.strict()`: an extra key is a 400.
library;

import 'package:flutter/material.dart';

import '../../../../../core/util/json_parse.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/planned_work_enums.dart';

/// Review state, from `INSPECTION_REPORT_STATUSES`.
///
/// A separate enum from [PlannedWorkReportStatus] because the two workflows do not share
/// a state machine: this one has FINALISED, and a finalised report that is reopened
/// starts a new version rather than returning to the same draft.
enum InspectionReportStatus {
  draft('DRAFT', 'Ноорог'),
  submitted('SUBMITTED', 'Админ хянах'),
  approved('APPROVED', 'Батлагдсан'),
  returned('RETURNED', 'Буцаагдсан'),
  finalised('FINALISED', 'Эцэслэгдсэн');

  const InspectionReportStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static InspectionReportStatus fromWire(String? value) {
    return InspectionReportStatus.values.firstWhere(
      (InspectionReportStatus status) => status.wireValue == value,
      orElse: () => InspectionReportStatus.draft,
    );
  }

  /// Mirrors `isInspectionReportLocked`: the states in which the author may no longer
  /// edit. The server refuses the PATCH regardless; this only keeps the sheet honest.
  bool get isLocked =>
      this == InspectionReportStatus.submitted ||
      this == InspectionReportStatus.approved ||
      this == InspectionReportStatus.finalised;

  Color get tone {
    switch (this) {
      case InspectionReportStatus.approved:
      case InspectionReportStatus.finalised:
        return EmployeeTokens.green;
      case InspectionReportStatus.submitted:
        return EmployeeTokens.yellow;
      case InspectionReportStatus.returned:
        return EmployeeTokens.red;
      case InspectionReportStatus.draft:
        return EmployeeTokens.muted;
    }
  }
}

/// Why a report may not be produced yet, from `INSPECTION_REPORT_BLOCKERS`.
///
/// SCORES_MISSING is reported but does NOT withhold generation — the server's readiness
/// rule is only "at least one sub-task, every non-skipped one DONE" — so the label is
/// worded as a note rather than as a refusal.
enum InspectionReportBlocker {
  tasksIncomplete('TASKS_INCOMPLETE', 'Дуусаагүй дэд ажил байна.'),
  noTasks('NO_TASKS', 'Дэд ажил бүртгэгдээгүй байна.'),
  scoresMissing('SCORES_MISSING', 'Үнэлгээ оруулаагүй дэд ажил байна.');

  const InspectionReportBlocker(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static InspectionReportBlocker? fromWire(String? value) {
    if (value == null) return null;
    for (final InspectionReportBlocker blocker in InspectionReportBlocker.values) {
      if (blocker.wireValue == value) return blocker;
    }
    return null;
  }
}

/// What `GET .../inspection-report/readiness` answers.
class InspectionReportReadinessModel {
  const InspectionReportReadinessModel({
    required this.canGenerate,
    required this.blockers,
    required this.outstandingTaskTitles,
    this.existingReportId,
  });

  final bool canGenerate;
  final List<InspectionReportBlocker> blockers;

  /// The sub-tasks still outstanding, named so the blocker is actionable rather than a
  /// count. Rendered verbatim.
  final List<String> outstandingTaskTitles;

  /// Non-null once a report exists, which is what tells the client to fetch it: a plain
  /// `GET .../inspection-report` answers 404 until then.
  final String? existingReportId;

  bool get hasReport => existingReportId != null;

  factory InspectionReportReadinessModel.fromJson(Map<String, dynamic> json) {
    return InspectionReportReadinessModel(
      canGenerate: parseBool(json['canGenerate']),
      // An unrecognised blocker code is dropped rather than rendered raw: a backend that
      // gains one in a later release must not print 'FOO_BAR' at a technician.
      blockers: parseStringList(json['blockers'])
          .map(InspectionReportBlocker.fromWire)
          .whereType<InspectionReportBlocker>()
          .toList(growable: false),
      outstandingTaskTitles: parseStringList(json['outstandingTaskTitles']),
      existingReportId: parseString(json['existingReportId']),
    );
  }
}

/// The consolidated inspection report.
///
/// Only the fields this app renders are parsed. `groups`, `issues` and `attachments` are
/// deliberately absent: the sub-task detail they carry is already on the task cards of
/// the detail screen, which is where the technician reads and writes it, and parsing a
/// second copy nothing displays is how `getReport` became dead code the first time.
class InspectionReportModel {
  const InspectionReportModel({
    required this.id,
    required this.plannedWorkId,
    required this.status,
    required this.version,
    required this.replacementPanels,
    required this.replacementConnections,
    required this.isAutoDraft,
    this.overallLevel,
    this.overallLabel,
    this.actName,
    this.inspectedScope,
    this.issueSummary,
    this.conclusion,
    this.recommendation,
    this.createdByName,
    this.submittedByName,
    this.approvedByName,
    this.finalisedByName,
    this.returnReason,
    this.updatedAt,
  });

  final String id;
  final String plannedWorkId;
  final InspectionReportStatus status;

  /// Advances each time a finalised report is reopened. Not a stored archive.
  final int version;

  /// Ерөнхий түвшин: derived worst-first from the sub-task bands, null when nothing was
  /// scored, and never averaged. Displayed only.
  final RiskLevel? overallLevel;
  final String? overallLabel;

  /// Ил ба далд ажлын актны нэр.
  final String? actName;

  // The six writable narrative fields.
  final String? inspectedScope;
  final String? issueSummary;
  final String? conclusion;
  final String? recommendation;
  final List<String> replacementPanels;
  final List<String> replacementConnections;

  /// True while every narrative field is still exactly as the system composed it. A
  /// regeneration recomposes them only in that state, so the flag is worth showing:
  /// once the technician writes anything, their words survive the next generate.
  final bool isAutoDraft;

  final String? createdByName;
  final String? submittedByName;
  final String? approvedByName;
  final String? finalisedByName;
  final String? returnReason;
  final DateTime? updatedAt;

  /// Mirrors `INSPECTION_REPORT_TRANSITIONS`: only a draft or a returned report may be
  /// sent for review.
  bool get canSubmit =>
      status == InspectionReportStatus.draft ||
      status == InspectionReportStatus.returned;

  factory InspectionReportModel.fromJson(Map<String, dynamic> json) {
    return InspectionReportModel(
      id: parseStringOr(json['id'], ''),
      plannedWorkId: parseStringOr(json['plannedWorkId'], ''),
      status: InspectionReportStatus.fromWire(json['status'] as String?),
      version: parseIntOr(json['version'], 1),
      overallLevel: RiskLevel.fromWire(json['overallLevel'] as String?),
      overallLabel: parseString(json['overallLabel']),
      actName: parseString(json['actName']),
      inspectedScope: parseString(json['inspectedScope']),
      issueSummary: parseString(json['issueSummary']),
      conclusion: parseString(json['conclusion']),
      recommendation: parseString(json['recommendation']),
      replacementPanels: parseStringList(json['replacementPanels']),
      replacementConnections: parseStringList(json['replacementConnections']),
      isAutoDraft: parseBool(json['isAutoDraft']),
      createdByName: parseString(json['createdByName']),
      submittedByName: parseString(json['submittedByName']),
      approvedByName: parseString(json['approvedByName']),
      finalisedByName: parseString(json['finalisedByName']),
      returnReason: parseString(json['returnReason']),
      updatedAt: parseDate(json['updatedAt']),
    );
  }
}

/// Body of `PATCH .../inspection-report`.
///
/// EVERY FIELD IS OMITTED WHEN NULL, which is the whole point of this class.
/// `updateInspectionReportSchema` is a partial update — an absent key leaves the stored
/// value alone — and it is `.strict()`, so sending `{"conclusion": null}` would blank
/// the conclusion rather than leave it. Writing a null on purpose is therefore not
/// expressible here, and does not need to be: the sheet sends the trimmed contents of
/// every field it shows, and an emptied field is sent as `''`.
class UpdateInspectionReportRequest {
  const UpdateInspectionReportRequest({
    this.inspectedScope,
    this.issueSummary,
    this.conclusion,
    this.recommendation,
    this.replacementPanels,
    this.replacementConnections,
  });

  final String? inspectedScope;
  final String? issueSummary;
  final String? conclusion;
  final String? recommendation;

  /// `replacementLineSchema` refuses an empty string, so the caller filters blank rows
  /// out before building this — an empty list clears the whole list and is legal.
  final List<String>? replacementPanels;
  final List<String>? replacementConnections;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      if (inspectedScope != null) 'inspectedScope': inspectedScope,
      if (issueSummary != null) 'issueSummary': issueSummary,
      if (conclusion != null) 'conclusion': conclusion,
      if (recommendation != null) 'recommendation': recommendation,
      if (replacementPanels != null) 'replacementPanels': replacementPanels,
      if (replacementConnections != null)
        'replacementConnections': replacementConnections,
    };
  }
}
