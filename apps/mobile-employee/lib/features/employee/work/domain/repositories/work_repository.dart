import '../../../../../core/network/paginated_data.dart';
import 'dart:typed_data';

import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/api_result.dart';
import '../../../shared/service_request_models.dart';
import '../../data/models/inspection_report_model.dart';
import '../../data/models/planned_work_model.dart';
import '../../data/models/task_material_model.dart';
import '../../data/models/work_report_model.dart';
import '../entities/planned_work_enums.dart';

/// What the Ажил tab may ask of the backend.
///
/// The contract is deliberately narrow on the WRITE side. There is no
/// `assignPlannedWork`, no `claimWork` and no `createPlannedWork`: a technician does
/// not raise or self-assign work in this system, and the only routes that could —
/// `PATCH /planned-work/:id` with `assignedEmployeeIds` and `POST
/// /service-requests/:id/assign` — are dispatcher-grade (`dispatch.assign`, which the
/// field tier never holds) and would let the caller assign anyone at all, not merely
/// themselves.
///
/// Reading the unclaimed pool is a different question, and the answer is yes:
/// [listOpenServiceRequests] lists it off `GET /service-requests`, which TECHNICIAN
/// reaches with `service_request.view`. An earlier version of this comment said no such
/// read existed, and the "Нээлттэй" segment showed a notice instead of a list on the
/// strength of it. What is genuinely missing is the equivalent for planned work:
/// `plannedWorkListQuerySchema` has only positive `employeeId`/`teamId` filters and no
/// way to ask for the unassigned ones, so the pool this contract can answer for is
/// service requests alone.
abstract class WorkRepository {
  Future<ApiResult<PaginatedData<PlannedWorkListItemModel>>> listPlannedWork({
    String? employeeId,
    String? teamId,
    PlannedWorkEffectiveStatus? status,
    String? search,
  });

  /// The service requests nobody is assigned to — NEW and UNASSIGNED together,
  /// ordered by SLA urgency. Read-only: nothing in this contract can claim one.
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listOpenServiceRequests();

  /// Claims one open request for the signed-in employee.
  Future<ApiResult<void>> claimServiceRequest(String requestId);

  // -- Service-request conclusion --------------------------------------------

  /// Reads the conclusion, CREATING the draft if none exists. Only ever from an explicit
  /// "Дүгнэлт бичих" — see the note on the data source.
  Future<ApiResult<WorkReportModel>> getWorkReport(String requestId);

  Future<ApiResult<WorkReportModel>> saveWorkReport(
    String requestId,
    SaveWorkReportRequest request,
  );

  Future<ApiResult<WorkReportModel>> submitWorkReport(String requestId);

  Future<ApiResult<WorkReportPhotoModel>> uploadWorkReportPhoto(CapturedPhoto photo);

  // -- Sub-task materials ----------------------------------------------------

  Future<ApiResult<PaginatedData<MaterialItemModel>>> listMaterialItems();

  Future<ApiResult<List<TaskMaterialUsageModel>>> listTaskMaterials({
    required String plannedWorkId,
    required String taskId,
  });

  Future<ApiResult<TaskMaterialUsageModel>> addTaskMaterial({
    required String plannedWorkId,
    required String taskId,
    required String materialItemId,
    required double quantity,
    required MaterialUnit unit,
    String? note,
  });

  Future<ApiResult<void>> removeTaskMaterial({
    required String plannedWorkId,
    required String taskId,
    required String usageId,
  });

  Future<ApiResult<PlannedWorkModel>> getPlannedWork(String plannedWorkId);

  Future<ApiResult<PlannedWorkModel>> transition({
    required String plannedWorkId,
    required PlannedWorkAction action,
    String? reason,
  });

  Future<ApiResult<PlannedWorkModel>> recordTaskProgress({
    required String plannedWorkId,
    required String taskId,
    required RecordTaskProgressRequest request,
  });

  /// Attaches one evidence photo to a sub-task and returns the re-read record.
  ///
  /// Separate from [recordTaskProgress] because the API is: a photo is stored the
  /// moment it is uploaded, not held until a progress entry is saved. The sheet says
  /// so, so a technician is never surprised by a picture that persisted after they
  /// tapped "Болих".
  Future<ApiResult<PlannedWorkModel>> attachTaskPhoto({
    required String plannedWorkId,
    required String taskId,
    required TaskPhotoKind kind,
    required CapturedPhoto photo,
  });

  /// The report row plus the server's fully assembled `preview`.
  ///
  /// Separate from the detail read because the preview is generated on every call even
  /// when no report row exists, which is what makes the write-up readable while the job
  /// is still running rather than only after it has been signed off.
  Future<ApiResult<PlannedWorkReportBundleModel>> getReport(String plannedWorkId);

  Future<ApiResult<PlannedWorkModel>> updateReport({
    required String plannedWorkId,
    String? conclusion,
    String? recommendation,
  });

  Future<ApiResult<PlannedWorkModel>> submitReport(String plannedWorkId);

  // -- Consolidated inspection report ----------------------------------------
  //
  // The second, separate report workflow. Only the five calls a performer can reach are
  // here: approve, return, finalise and reopen are keyed on
  // `planned_work.approve_report`, which the field tier never holds.

  Future<ApiResult<InspectionReportReadinessModel>> getInspectionReportReadiness(
    String plannedWorkId,
  );

  /// Answers `Success(null)` when no report has been generated yet — that is a state, not
  /// a failure, and the route's 404 is mapped to it in the data source.
  Future<ApiResult<InspectionReportModel?>> getInspectionReport(String plannedWorkId);

  Future<ApiResult<InspectionReportModel>> generateInspectionReport(
    String plannedWorkId,
  );

  Future<ApiResult<InspectionReportModel>> updateInspectionReport({
    required String plannedWorkId,
    required UpdateInspectionReportRequest request,
  });

  Future<ApiResult<InspectionReportModel>> submitInspectionReport(String plannedWorkId);

  Future<ApiResult<Uint8List>> downloadFile(String fileId);
}
