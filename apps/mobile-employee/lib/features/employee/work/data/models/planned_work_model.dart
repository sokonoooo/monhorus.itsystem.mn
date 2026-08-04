/// Wire models for `/planned-work`, mirroring
/// `packages/shared/src/types/planned-work.types.ts`.
///
/// Every derived figure here — `progressPercent`, task `status`, `riskLevel`,
/// `effectiveStatus`, `missingEvidence`, `completionBlockers`, `availableActions` —
/// arrives computed from the server and is stored as sent. Nothing is recalculated
/// on the device: a phone with a skewed clock would otherwise disagree with the
/// dashboard about what is overdue, and a locally derived task status would let the
/// UI claim a task is DONE while the evidence gate still refuses it.
library;

import '../../domain/entities/planned_work_enums.dart';
import '../../../../../core/util/json_parse.dart';

class NamedRefModel {
  const NamedRefModel({required this.id, required this.name});

  final String id;
  final String name;

  factory NamedRefModel.fromJson(Map<String, dynamic> json) {
    return NamedRefModel(
      id: parseStringOr(json['id'], ''),
      name: parseStringOr(json['name'], '-'),
    );
  }

  static NamedRefModel? maybe(Object? json) =>
      json is Map<String, dynamic> ? NamedRefModel.fromJson(json) : null;
}

/// Who did something, and when. All three fields are independently nullable on the
/// wire, so a stamp can exist with a name but no time.
class ActorStampModel {
  const ActorStampModel({this.id, this.name, this.at});

  final String? id;
  final String? name;
  final DateTime? at;

  bool get isEmpty => name == null && at == null;

  factory ActorStampModel.fromJson(Object? json) {
    if (json is! Map<String, dynamic>) return const ActorStampModel();
    return ActorStampModel(
      id: parseString(json['id']),
      name: parseString(json['name']),
      at: parseDate(json['at']),
    );
  }
}

class PlannedWorkPhotoModel {
  const PlannedWorkPhotoModel({
    required this.id,
    required this.name,
    required this.mimeType,
    required this.sizeBytes,
    this.uploadedByName,
    this.uploadedAt,
  });

  final String id;
  final String name;
  final String mimeType;
  final int sizeBytes;
  final String? uploadedByName;
  final DateTime? uploadedAt;

  factory PlannedWorkPhotoModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkPhotoModel(
      id: parseStringOr(json['id'], ''),
      name: parseStringOr(json['name'], 'зураг'),
      mimeType: parseStringOr(json['mimeType'], 'application/octet-stream'),
      sizeBytes: parseIntOr(json['sizeBytes'], 0),
      uploadedByName: parseString(json['uploadedByName']),
      uploadedAt: parseDate(json['uploadedAt']),
    );
  }
}

/// One sub-task: the unit a technician actually reports against.
class PlannedWorkTaskModel {
  const PlannedWorkTaskModel({
    required this.id,
    required this.plannedWorkId,
    required this.title,
    required this.unit,
    required this.totalQuantity,
    required this.completedQuantity,
    required this.remainingQuantity,
    required this.progressPercent,
    required this.status,
    required this.relatedObjects,
    required this.beforePhotos,
    required this.afterPhotos,
    required this.missingEvidence,
    this.floorId,
    this.floorName,
    this.description,
    this.assignedEmployeeId,
    this.assignedEmployeeName,
    this.note,
    this.conclusion,
    this.conclusionById,
    this.conclusionByName,
    this.conclusionAt,
    this.durationMinutes,
    this.score,
    this.riskLevel,
    this.recommendation,
    this.completedAt,
  });

  final String id;
  final String plannedWorkId;
  final String? floorId;
  final String? floorName;
  final String title;
  final String? description;
  final MaterialUnit unit;
  final double totalQuantity;
  final double completedQuantity;
  final double remainingQuantity;
  final double progressPercent;
  final PlannedWorkTaskStatus status;
  final String? assignedEmployeeId;
  final String? assignedEmployeeName;

  /// The equipment this sub-task covers.
  ///
  /// The single score below is fanned out to every one of these on approval — there is no
  /// per-object scoring. Shown to the technician rather than dropped, because a score
  /// recorded without knowing which equipment it lands on is a guess, and an empty list
  /// means the entry reaches no equipment record at all.
  final List<NamedRefModel> relatedObjects;

  /// The performer's Тайлбар — what was observed.
  final String? note;

  /// The performer's Дүгнэлт — the verdict drawn from it, written onto every one of
  /// [relatedObjects]. The consolidated report keeps its own, separate conclusion.
  final String? conclusion;

  /// Who wrote the [conclusion] above, and when the server recorded it.
  ///
  /// Stamped by the backend only when the Дүгнэлт text itself changes. Every member of the
  /// assigned team can write to every sub-task and each write replaces the last, so without
  /// this the verdict on the card is anonymous.
  final String? conclusionById;
  final String? conclusionByName;
  final DateTime? conclusionAt;

  /// Whole minutes from the first reported start to the instant the quantity was
  /// completed, computed on the server. Null while the sub-task is unfinished, and null
  /// when it was skipped.
  ///
  /// The clock stops at quantity completion rather than at DONE: DONE also waits on the
  /// five evidence items, so work finished on Monday and photographed on Wednesday would
  /// otherwise read as two days.
  final int? durationMinutes;
  final int? score;
  final RiskLevel? riskLevel;
  final String? recommendation;
  final List<PlannedWorkPhotoModel> beforePhotos;
  final List<PlannedWorkPhotoModel> afterPhotos;

  /// Mongolian labels of the evidence still missing before this task may be DONE.
  /// Rendered verbatim — these strings are the server's own explanation of the gate.
  final List<String> missingEvidence;
  final DateTime? completedAt;

  bool get isDone => status == PlannedWorkTaskStatus.done;
  bool get isSkipped => status == PlannedWorkTaskStatus.skipped;

  /// True when the quantity is complete but the evidence gate still holds the task
  /// out of DONE. This is the state the UI must explain rather than round up.
  bool get quantityCompleteButBlocked =>
      !isDone && !isSkipped && totalQuantity > 0 && completedQuantity >= totalQuantity;

  factory PlannedWorkTaskModel.fromJson(Map<String, dynamic> json) {
    final double total = parseDoubleOr(json['totalQuantity'], 0);
    final double completed = parseDoubleOr(json['completedQuantity'], 0);

    return PlannedWorkTaskModel(
      id: parseStringOr(json['id'], ''),
      plannedWorkId: parseStringOr(json['plannedWorkId'], ''),
      floorId: parseObjectId(json['floorId']),
      floorName: parseString(json['floorName']),
      title: parseStringOr(json['title'], 'Дэд ажил'),
      description: parseString(json['description']),
      unit: MaterialUnit.fromWire(json['unit'] as String?),
      totalQuantity: total,
      completedQuantity: completed,
      remainingQuantity:
          parseDouble(json['remainingQuantity']) ?? (total - completed).clamp(0, total),
      progressPercent: parseDoubleOr(json['progressPercent'], 0),
      status: PlannedWorkTaskStatus.fromWire(json['status'] as String?),
      // See parseObjectId: this field carries a stringified document when the
      // backend populates the relation, so anything that is not an id is dropped.
      assignedEmployeeId: parseObjectId(json['assignedEmployeeId']),
      assignedEmployeeName: parseString(json['assignedEmployeeName']),
      relatedObjects:
          parseList<NamedRefModel>(json['relatedObjects'], NamedRefModel.fromJson),
      note: parseString(json['note']),
      conclusion: parseString(json['conclusion']),
      conclusionById: parseObjectId(json['conclusionById']),
      conclusionByName: parseString(json['conclusionByName']),
      conclusionAt: parseDate(json['conclusionAt']),
      durationMinutes: parseInt(json['durationMinutes']),
      score: parseInt(json['score']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      recommendation: parseString(json['recommendation']),
      beforePhotos:
          parseList<PlannedWorkPhotoModel>(json['beforePhotos'], PlannedWorkPhotoModel.fromJson),
      afterPhotos:
          parseList<PlannedWorkPhotoModel>(json['afterPhotos'], PlannedWorkPhotoModel.fromJson),
      missingEvidence: parseStringList(json['missingEvidence']),
      completedAt: parseDate(json['completedAt']),
    );
  }
}

class PlannedWorkFloorProgressModel {
  const PlannedWorkFloorProgressModel({
    required this.floorId,
    required this.floorName,
    required this.taskCount,
    required this.totalQuantity,
    required this.completedQuantity,
    required this.remainingQuantity,
    required this.progressPercent,
  });

  final String floorId;
  final String floorName;
  final int taskCount;
  final double totalQuantity;
  final double completedQuantity;
  final double remainingQuantity;
  final double progressPercent;

  factory PlannedWorkFloorProgressModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkFloorProgressModel(
      floorId: parseStringOr(json['floorId'], ''),
      floorName: parseStringOr(json['floorName'], '-'),
      taskCount: parseIntOr(json['taskCount'], 0),
      totalQuantity: parseDoubleOr(json['totalQuantity'], 0),
      completedQuantity: parseDoubleOr(json['completedQuantity'], 0),
      remainingQuantity: parseDoubleOr(json['remainingQuantity'], 0),
      progressPercent: parseDoubleOr(json['progressPercent'], 0),
    );
  }
}

/// A material on the work: a name, a quantity and a unit.
///
/// Requirements 19.2 keeps V1 at "нэр/тоо". There is no catalogue behind the name and no
/// stock ledger, so there is no code, no actual and no variance to carry.
class PlannedWorkMaterialModel {
  const PlannedWorkMaterialModel({
    required this.name,
    required this.quantity,
    required this.unit,
  });

  final String name;
  final double quantity;
  final MaterialUnit unit;

  factory PlannedWorkMaterialModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkMaterialModel(
      name: parseStringOr(json['name'], '-'),
      quantity: parseDoubleOr(json['quantity'], 0),
      unit: MaterialUnit.fromWire(json['unit'] as String?),
    );
  }
}

/// One lifecycle action the calling user may perform right now.
///
/// The list is computed server-side per record and per caller. `action` may be a
/// value this build does not know, in which case [action] is null and the UI skips
/// it rather than sending a verb it cannot reason about.
class PlannedWorkAvailableActionModel {
  const PlannedWorkAvailableActionModel({
    required this.action,
    required this.label,
    required this.requiresReason,
  });

  final PlannedWorkAction? action;
  final String label;
  final bool requiresReason;

  factory PlannedWorkAvailableActionModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkAvailableActionModel(
      action: PlannedWorkAction.fromWire(json['action'] as String?),
      label: parseStringOr(json['label'], 'Үйлдэл'),
      requiresReason: parseBool(json['requiresReason']),
    );
  }
}

class PlannedWorkReportModel {
  const PlannedWorkReportModel({
    required this.id,
    required this.status,
    required this.createdBy,
    required this.submittedBy,
    required this.approvedBy,
    required this.returnedBy,
    required this.submissionBlockers,
    required this.approvalBlockers,
    required this.canApprove,
    required this.visibleToCustomer,
    this.conclusion,
    this.recommendation,
    this.returnReason,
    this.updatedAt,
  });

  final String id;
  final PlannedWorkReportStatus status;
  final String? conclusion;
  final String? recommendation;
  final ActorStampModel createdBy;
  final ActorStampModel submittedBy;
  final ActorStampModel approvedBy;
  final ActorStampModel returnedBy;
  final String? returnReason;

  /// Reasons the report cannot be submitted yet. Empty when submission is allowed.
  final List<String> submissionBlockers;
  final bool canApprove;
  final List<String> approvalBlockers;
  final bool visibleToCustomer;
  final DateTime? updatedAt;

  bool get canSubmit =>
      submissionBlockers.isEmpty &&
      (status == PlannedWorkReportStatus.draft ||
          status == PlannedWorkReportStatus.returned);

  factory PlannedWorkReportModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkReportModel(
      id: parseStringOr(json['id'], ''),
      status: PlannedWorkReportStatus.fromWire(json['status'] as String?) ??
          PlannedWorkReportStatus.draft,
      conclusion: parseString(json['conclusion']),
      recommendation: parseString(json['recommendation']),
      createdBy: ActorStampModel.fromJson(json['createdBy']),
      submittedBy: ActorStampModel.fromJson(json['submittedBy']),
      approvedBy: ActorStampModel.fromJson(json['approvedBy']),
      returnedBy: ActorStampModel.fromJson(json['returnedBy']),
      returnReason: parseString(json['returnReason']),
      submissionBlockers: parseStringList(json['submissionBlockers']),
      canApprove: parseBool(json['canApprove']),
      approvalBlockers: parseStringList(json['approvalBlockers']),
      visibleToCustomer: parseBool(json['visibleToCustomer']),
      updatedAt: parseDate(json['updatedAt']),
    );
  }
}

/// A planned work as it appears in a list.
class PlannedWorkListItemModel {
  const PlannedWorkListItemModel({
    required this.id,
    required this.workNumber,
    required this.title,
    required this.customer,
    required this.project,
    required this.building,
    required this.lifecycleStatus,
    required this.effectiveStatus,
    required this.plannedStartDate,
    required this.plannedEndDate,
    required this.totalQuantity,
    required this.completedQuantity,
    required this.remainingQuantity,
    required this.progressPercent,
    required this.taskCount,
    required this.assignedEmployees,
    required this.completedLate,
    this.actualStartDate,
    this.actualEndDate,
    this.overdueAt,
    this.delayMinutes,
    this.assignedTeam,
    this.reportStatus,
    this.createdAt,
  });

  final String id;
  final String workNumber;
  final String title;
  final NamedRefModel? customer;
  final NamedRefModel? project;
  final NamedRefModel? building;
  final PlannedWorkLifecycleStatus lifecycleStatus;

  /// Authoritative status for display and filtering. Includes OVERDUE.
  final PlannedWorkEffectiveStatus effectiveStatus;
  final DateTime? plannedStartDate;
  final DateTime? plannedEndDate;
  final DateTime? actualStartDate;
  final DateTime? actualEndDate;
  final DateTime? overdueAt;
  final bool completedLate;
  final int? delayMinutes;
  final double totalQuantity;
  final double completedQuantity;
  final double remainingQuantity;
  final double progressPercent;
  final int taskCount;
  final List<NamedRefModel> assignedEmployees;
  final NamedRefModel? assignedTeam;
  final PlannedWorkReportStatus? reportStatus;
  final DateTime? createdAt;

  /// "Central Tower ХХК · Урьдчилан сэргийлэх үйлчилгээ · Төв байр", skipping any
  /// relation the server left unpopulated.
  String get objectPath => <String?>[
        customer?.name,
        project?.name,
        building?.name,
      ].whereType<String>().where((String part) => part != '-').join(' · ');

  factory PlannedWorkListItemModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkListItemModel(
      id: parseStringOr(json['id'], ''),
      workNumber: parseStringOr(json['workNumber'], '-'),
      title: parseStringOr(json['title'], 'Төлөвлөгөөт ажил'),
      customer: NamedRefModel.maybe(json['customer']),
      project: NamedRefModel.maybe(json['project']),
      building: NamedRefModel.maybe(json['building']),
      lifecycleStatus:
          PlannedWorkLifecycleStatus.fromWire(json['lifecycleStatus'] as String?),
      effectiveStatus:
          PlannedWorkEffectiveStatus.fromWire(json['effectiveStatus'] as String?),
      plannedStartDate: parseDate(json['plannedStartDate']),
      plannedEndDate: parseDate(json['plannedEndDate']),
      actualStartDate: parseDate(json['actualStartDate']),
      actualEndDate: parseDate(json['actualEndDate']),
      overdueAt: parseDate(json['overdueAt']),
      completedLate: parseBool(json['completedLate']),
      delayMinutes: parseInt(json['delayMinutes']),
      totalQuantity: parseDoubleOr(json['totalQuantity'], 0),
      completedQuantity: parseDoubleOr(json['completedQuantity'], 0),
      remainingQuantity: parseDoubleOr(json['remainingQuantity'], 0),
      progressPercent: parseDoubleOr(json['progressPercent'], 0),
      taskCount: parseIntOr(json['taskCount'], 0),
      assignedEmployees:
          parseList<NamedRefModel>(json['assignedEmployees'], NamedRefModel.fromJson),
      assignedTeam: NamedRefModel.maybe(json['assignedTeam']),
      reportStatus: PlannedWorkReportStatus.fromWire(json['reportStatus'] as String?),
      createdAt: parseDate(json['createdAt']),
    );
  }
}

/// The full record. Everything the detail screen renders comes from one GET.
class PlannedWorkModel extends PlannedWorkListItemModel {
  const PlannedWorkModel({
    required super.id,
    required super.workNumber,
    required super.title,
    required super.customer,
    required super.project,
    required super.building,
    required super.lifecycleStatus,
    required super.effectiveStatus,
    required super.plannedStartDate,
    required super.plannedEndDate,
    required super.totalQuantity,
    required super.completedQuantity,
    required super.remainingQuantity,
    required super.progressPercent,
    required super.taskCount,
    required super.assignedEmployees,
    required super.completedLate,
    required this.tasks,
    required this.floorProgress,
    required this.materials,
    required this.availableActions,
    required this.completionBlockers,
    required this.pauseHistory,
    required this.totalPausedMinutes,
    super.actualStartDate,
    super.actualEndDate,
    super.overdueAt,
    super.delayMinutes,
    super.assignedTeam,
    super.reportStatus,
    super.createdAt,
    this.description,
    this.originalPlannedEndDate,
    this.currentPauseStartedAt,
    this.cancelReason,
    this.report,
    this.updatedAt,
  });

  final String? description;
  final DateTime? updatedAt;
  final DateTime? originalPlannedEndDate;
  final DateTime? currentPauseStartedAt;
  final int totalPausedMinutes;
  final List<PlannedWorkPauseModel> pauseHistory;
  final String? cancelReason;
  final List<PlannedWorkTaskModel> tasks;
  final List<PlannedWorkFloorProgressModel> floorProgress;
  final List<PlannedWorkMaterialModel> materials;
  final PlannedWorkReportModel? report;

  /// The only thing a lifecycle button is rendered from.
  final List<PlannedWorkAvailableActionModel> availableActions;

  /// Why COMPLETE is unavailable. Rendered verbatim — each line names a task and
  /// what it is short of, which is exactly what the technician needs to go and fix.
  final List<String> completionBlockers;

  int get doneTaskCount =>
      tasks.where((PlannedWorkTaskModel task) => task.isDone).length;

  /// The deadline was moved at least once, so the original is worth showing.
  bool get wasRescheduled =>
      originalPlannedEndDate != null &&
      plannedEndDate != null &&
      originalPlannedEndDate!.isAtSameMomentAs(plannedEndDate!) == false;

  factory PlannedWorkModel.fromJson(Map<String, dynamic> json) {
    final PlannedWorkListItemModel base = PlannedWorkListItemModel.fromJson(json);

    return PlannedWorkModel(
      id: base.id,
      workNumber: base.workNumber,
      title: base.title,
      customer: base.customer,
      project: base.project,
      building: base.building,
      lifecycleStatus: base.lifecycleStatus,
      effectiveStatus: base.effectiveStatus,
      plannedStartDate: base.plannedStartDate,
      plannedEndDate: base.plannedEndDate,
      actualStartDate: base.actualStartDate,
      actualEndDate: base.actualEndDate,
      overdueAt: base.overdueAt,
      completedLate: base.completedLate,
      delayMinutes: base.delayMinutes,
      totalQuantity: base.totalQuantity,
      completedQuantity: base.completedQuantity,
      remainingQuantity: base.remainingQuantity,
      progressPercent: base.progressPercent,
      taskCount: base.taskCount,
      assignedEmployees: base.assignedEmployees,
      assignedTeam: base.assignedTeam,
      reportStatus: base.reportStatus,
      createdAt: base.createdAt,
      description: parseString(json['description']),
      updatedAt: parseDate(json['updatedAt']),
      originalPlannedEndDate: parseDate(json['originalPlannedEndDate']),
      currentPauseStartedAt: parseDate(json['currentPauseStartedAt']),
      totalPausedMinutes: parseIntOr(json['totalPausedMinutes'], 0),
      pauseHistory:
          parseList<PlannedWorkPauseModel>(json['pauseHistory'], PlannedWorkPauseModel.fromJson),
      cancelReason: parseString(json['cancelReason']),
      tasks: parseList<PlannedWorkTaskModel>(json['tasks'], PlannedWorkTaskModel.fromJson),
      floorProgress: parseList<PlannedWorkFloorProgressModel>(
        json['floorProgress'],
        PlannedWorkFloorProgressModel.fromJson,
      ),
      materials: parseList<PlannedWorkMaterialModel>(
        json['materials'],
        PlannedWorkMaterialModel.fromJson,
      ),
      report: json['report'] is Map<String, dynamic>
          ? PlannedWorkReportModel.fromJson(json['report']! as Map<String, dynamic>)
          : null,
      availableActions: parseList<PlannedWorkAvailableActionModel>(
        json['availableActions'],
        PlannedWorkAvailableActionModel.fromJson,
      ),
      completionBlockers: parseStringList(json['completionBlockers']),
    );
  }
}

/// One pause episode, kept so the paused duration is auditable.
class PlannedWorkPauseModel {
  const PlannedWorkPauseModel({
    required this.reason,
    this.pausedAt,
    this.pausedByName,
    this.resumedAt,
    this.resumedByName,
    this.durationMinutes,
  });

  final String reason;
  final DateTime? pausedAt;
  final String? pausedByName;
  final DateTime? resumedAt;
  final String? resumedByName;

  /// Null while the pause is still open.
  final int? durationMinutes;

  bool get isOpen => resumedAt == null;

  factory PlannedWorkPauseModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkPauseModel(
      reason: parseStringOr(json['reason'], '-'),
      pausedAt: parseDate(json['pausedAt']),
      pausedByName: parseString(json['pausedByName']),
      resumedAt: parseDate(json['resumedAt']),
      resumedByName: parseString(json['resumedByName']),
      durationMinutes: parseInt(json['durationMinutes']),
    );
  }
}

// -- Report bundle -----------------------------------------------------------

/// One task line as the assembled report renders it.
class PlannedWorkReportTaskLineModel {
  const PlannedWorkReportTaskLineModel({
    required this.id,
    required this.title,
    required this.floorName,
    required this.unit,
    required this.totalQuantity,
    required this.completedQuantity,
    required this.progressPercent,
    required this.status,
    required this.beforePhotoCount,
    required this.afterPhotoCount,
    this.note,
    this.score,
    this.riskLevel,
    this.recommendation,
  });

  final String id;
  final String title;
  final String floorName;
  final MaterialUnit unit;
  final double totalQuantity;
  final double completedQuantity;
  final double progressPercent;
  final PlannedWorkTaskStatus status;
  final String? note;
  final int? score;
  final RiskLevel? riskLevel;
  final String? recommendation;
  final int beforePhotoCount;
  final int afterPhotoCount;

  factory PlannedWorkReportTaskLineModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkReportTaskLineModel(
      id: parseStringOr(json['id'], ''),
      title: parseStringOr(json['title'], '-'),
      floorName: parseStringOr(json['floorName'], '-'),
      unit: MaterialUnit.fromWire(json['unit'] as String?),
      totalQuantity: parseDoubleOr(json['totalQuantity'], 0),
      completedQuantity: parseDoubleOr(json['completedQuantity'], 0),
      progressPercent: parseDoubleOr(json['progressPercent'], 0),
      status: PlannedWorkTaskStatus.fromWire(json['status'] as String?),
      note: parseString(json['note']),
      score: parseInt(json['score']),
      riskLevel: RiskLevel.fromWire(json['riskLevel'] as String?),
      recommendation: parseString(json['recommendation']),
      beforePhotoCount: parseIntOr(json['beforePhotoCount'], 0),
      afterPhotoCount: parseIntOr(json['afterPhotoCount'], 0),
    );
  }
}

/// The fully assembled report content. Generated even when no report row exists yet,
/// which is what makes it usable as a preview before the work is completed.
class PlannedWorkReportPreviewModel {
  const PlannedWorkReportPreviewModel({
    required this.workNumber,
    required this.title,
    required this.customerName,
    required this.projectName,
    required this.buildingName,
    required this.totalQuantity,
    required this.completedQuantity,
    required this.progressPercent,
    required this.completedLate,
    required this.totalPausedMinutes,
    required this.tasks,
    required this.materials,
    required this.floorProgress,
    this.delayMinutes,
    this.conclusion,
    this.recommendation,
    this.generatedAt,
  });

  final String workNumber;
  final String title;
  final String customerName;
  final String projectName;
  final String buildingName;
  final double totalQuantity;
  final double completedQuantity;
  final double progressPercent;
  final bool completedLate;
  final int? delayMinutes;
  final int totalPausedMinutes;
  final List<PlannedWorkReportTaskLineModel> tasks;
  final List<PlannedWorkMaterialModel> materials;
  final List<PlannedWorkFloorProgressModel> floorProgress;
  final String? conclusion;
  final String? recommendation;
  final DateTime? generatedAt;

  factory PlannedWorkReportPreviewModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkReportPreviewModel(
      workNumber: parseStringOr(json['workNumber'], '-'),
      title: parseStringOr(json['title'], '-'),
      customerName: parseStringOr(json['customerName'], '-'),
      projectName: parseStringOr(json['projectName'], '-'),
      buildingName: parseStringOr(json['buildingName'], '-'),
      totalQuantity: parseDoubleOr(json['totalQuantity'], 0),
      completedQuantity: parseDoubleOr(json['completedQuantity'], 0),
      progressPercent: parseDoubleOr(json['progressPercent'], 0),
      completedLate: parseBool(json['completedLate']),
      delayMinutes: parseInt(json['delayMinutes']),
      totalPausedMinutes: parseIntOr(json['totalPausedMinutes'], 0),
      tasks: parseList<PlannedWorkReportTaskLineModel>(
        json['tasks'],
        PlannedWorkReportTaskLineModel.fromJson,
      ),
      materials: parseList<PlannedWorkMaterialModel>(
        json['materials'],
        PlannedWorkMaterialModel.fromJson,
      ),
      floorProgress: parseList<PlannedWorkFloorProgressModel>(
        json['floorProgress'],
        PlannedWorkFloorProgressModel.fromJson,
      ),
      conclusion: parseString(json['conclusion']),
      recommendation: parseString(json['recommendation']),
      generatedAt: parseDate(json['generatedAt']),
    );
  }
}

/// What `GET /planned-work/:id/report` returns: the report row, which may not exist
/// yet, alongside the preview, which always does.
class PlannedWorkReportBundleModel {
  const PlannedWorkReportBundleModel({required this.report, required this.preview});

  final PlannedWorkReportModel? report;
  final PlannedWorkReportPreviewModel? preview;

  factory PlannedWorkReportBundleModel.fromJson(Map<String, dynamic> json) {
    return PlannedWorkReportBundleModel(
      report: json['report'] is Map<String, dynamic>
          ? PlannedWorkReportModel.fromJson(json['report']! as Map<String, dynamic>)
          : null,
      preview: json['preview'] is Map<String, dynamic>
          ? PlannedWorkReportPreviewModel.fromJson(
              json['preview']! as Map<String, dynamic>,
            )
          : null,
    );
  }
}

// -- Requests ----------------------------------------------------------------

/// Body of `POST /planned-work/:id/tasks/:taskId/progress`.
///
/// The schema is `.strict()`, so an unknown key is a 400 — which is why this builds
/// the map explicitly instead of spreading anything. Two fields are deliberately
/// absent because the server refuses them: `status` (derived from quantity plus the
/// evidence gate) and `riskLevel` (derived from `score` against the configured
/// bands). Sending either would be asking to label a 92 as critical.
class RecordTaskProgressRequest {
  const RecordTaskProgressRequest({
    required this.completedQuantity,
    this.started,
    this.skipped,
    this.note,
    this.conclusion,
    this.score,
    this.recommendation,
  });

  /// The CUMULATIVE completed quantity, not today's increment. The server stores
  /// this value as-is, so the caller adds today's entry to what was already done.
  final double completedQuantity;
  final bool? started;
  final bool? skipped;
  final String? note;

  /// Written onto the ReportItem of every object the sub-task covers, which is what fills
  /// the Дүгнэлт column of Үзлэг ба дүгнэлт for this row.
  final String? conclusion;
  final int? score;
  final String? recommendation;

  Map<String, dynamic> toJson() {
    return <String, dynamic>{
      'completedQuantity': completedQuantity,
      if (started != null) 'started': started,
      if (skipped != null) 'skipped': skipped,
      if (note != null) 'note': note,
      if (conclusion != null) 'conclusion': conclusion,
      if (score != null) 'score': score,
      if (recommendation != null) 'recommendation': recommendation,
    };
  }
}
