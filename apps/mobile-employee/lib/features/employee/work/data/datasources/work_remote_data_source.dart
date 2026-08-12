import 'dart:typed_data';

import 'package:dio/dio.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/dio_client.dart';
import '../../../shared/service_request_models.dart';
import '../../../shared/service_request_vocabulary.dart';
import '../../domain/entities/planned_work_enums.dart';
import '../models/inspection_report_model.dart';
import '../models/planned_work_model.dart';
import '../models/task_material_model.dart';
import '../models/work_report_model.dart';

/// Transport for the Ажил tab. Throws [ServerException] or [NetworkException]; the
/// repository turns those into failures.
///
/// Uses the app's single [DioClient], so the Bearer header, the one-shot 401 refresh
/// and the `{ success, data, message }` unwrapping are all inherited rather than
/// reimplemented.
///
/// Read this note before adding a call here: `GET /planned-work` applies NO
/// server-side "assigned to me" scoping. `listPlannedWork(query)` takes no auth
/// context, so `planned_work.view` exposes every planned work in the system. The
/// `employeeId` filter is the entire mechanism by which this app shows a technician
/// their own queue, which is why [listPlannedWork] takes it as a named argument and
/// the providers never call it without one they have resolved and confirmed.
///
/// [listOpenServiceRequests] is the one read here that deliberately sends no such
/// filter, and it is not planned work at all: it lists the service requests nobody has
/// been assigned to yet. See its own note for why the pool needs two calls and why
/// nothing in this tab can claim a row from it.
class WorkRemoteDataSource {
  const WorkRemoteDataSource(this._client);

  final DioClient _client;

  // -- Planned work ----------------------------------------------------------

  /// GET /planned-work. `limit` is capped at 100 by the schema.
  ///
  /// `status` filters on the EFFECTIVE status, so `OVERDUE` is a legal value here
  /// even though it is never persisted.
  ///
  /// `includeArchived` defaults to ON here, which is the opposite of the home screen's
  /// read. The endpoint drops ARCHIVED records unless asked, and a planned work is
  /// archived the moment its report is approved — so leaving the flag off made the
  /// board's "Дууссан" section unable to hold the very rows it enumerates, and a
  /// technician's finished job disappeared the day it was signed off. Home leaves it
  /// off deliberately, because there the rows are a counter rather than a list.
  Future<PaginatedData<PlannedWorkListItemModel>> listPlannedWork({
    String? employeeId,
    String? teamId,
    PlannedWorkEffectiveStatus? status,
    String? search,
    bool includeArchived = true,
    int page = 1,
    int limit = 100,
    String sortBy = 'plannedEndDate',
    String sortDir = 'asc',
  }) {
    return _client.request<PaginatedData<PlannedWorkListItemModel>>(
      path: '/planned-work',
      method: 'GET',
      queryParameters: <String, dynamic>{
        if (employeeId != null) 'employeeId': employeeId,
        if (teamId != null) 'teamId': teamId,
        if (status != null) 'status': status.wireValue,
        if (search != null && search.isNotEmpty) 'search': search,
        if (includeArchived) 'includeArchived': true,
        'page': page,
        'limit': limit,
        'sortBy': sortBy,
        'sortDir': sortDir,
      },
      decoder: (Object? json) => PaginatedData<PlannedWorkListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        PlannedWorkListItemModel.fromJson,
      ),
    );
  }

  // -- Unclaimed service requests --------------------------------------------

  /// The unclaimed service-request pool, for the "Нээлттэй" segment.
  ///
  /// Two calls, because `serviceRequestListQuerySchema` takes ONE `status` value and
  /// the pool is spread over two of them: NEW is what intake writes and UNASSIGNED is
  /// what a dispatcher leaves behind, so querying either alone would hide half the
  /// backlog. The pages are merged here rather than in the provider, so the caller
  /// receives one [PaginatedData] shaped like every other list read in this file.
  ///
  /// No `employeeId` filter, and that is the point rather than an omission: this list
  /// is the work nobody is assigned to. `resolveCustomerScope` returns `{mode: 'STAFF'}`
  /// with no customer narrowing for any non-customer account, so a technician holding
  /// `service_request.view` sees the whole organisation's pool — which is what the
  /// segment claims to show.
  ///
  /// `slaState` is deliberately NOT sent even though the rows are ordered by urgency:
  /// the backend applies that filter in memory AFTER paginating, so `total` stops
  /// agreeing with the page. Same caveat the Нүүр tab's data source documents; the
  /// urgency ordering is done below, on the `slaState` each row already carries.
  // -- Service-request conclusion --------------------------------------------
  //
  // The same routes the web editor uses. There is no mobile-only endpoint and no second
  // report shape: a conclusion written here and one written on the web are the same record,
  // and the canonical Report + ReportItem rows are derived from it server-side.
  //
  // READ, WRITE, SUBMIT — AND STOP. `POST /service-requests/:id/report/approve` exists on
  // the backend and the web admin calls it, but this file deliberately has no method for
  // it. Approval is an office act on somebody else's work, and this app is where the
  // conclusion is written; a client here would let the author sign off their own report.
  // The same goes for the return route, for the same reason.

  /// GET /service-requests/:id/report — the conclusion, CREATED on first read.
  ///
  /// This route is `getOrCreate`: the first call writes a DRAFT attributed to the caller.
  /// It must therefore only ever be issued from an explicit "Дүгнэлт бичих" and never
  /// while rendering a list, or every technician who scrolled past a request would become
  /// the author of an empty conclusion on it.
  Future<WorkReportModel> getWorkReport(String requestId) {
    return _client.request<WorkReportModel>(
      path: '/service-requests/$requestId/report',
      method: 'GET',
      decoder: (Object? json) => WorkReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// PUT /service-requests/:id/report — replaces the conclusion outright.
  Future<WorkReportModel> saveWorkReport(
    String requestId,
    SaveWorkReportRequest request,
  ) {
    return _client.request<WorkReportModel>(
      path: '/service-requests/$requestId/report',
      method: 'PUT',
      data: request.toJson(),
      decoder: (Object? json) => WorkReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /service-requests/:id/report/submit.
  ///
  /// Refused with the server's own field list when something mandatory is missing, which
  /// the editor prints against the item it belongs to rather than as one banner.
  Future<WorkReportModel> submitWorkReport(String requestId) {
    return _client.request<WorkReportModel>(
      path: '/service-requests/$requestId/report/submit',
      method: 'POST',
      data: const <String, dynamic>{},
      decoder: (Object? json) => WorkReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /files/work-report-photos — parks a file on the uploader.
  ///
  /// Two-step, exactly as the object-assessment upload is: the file belongs to nothing
  /// until a save names its id, so a photo captured and then abandoned stays unreferenced
  /// rather than attaching itself to the conclusion.
  Future<WorkReportPhotoModel> uploadWorkReportPhoto(CapturedPhoto photo) {
    return _client.upload<WorkReportPhotoModel>(
      path: '/files/work-report-photos',
      body: () => FormData.fromMap(<String, dynamic>{
        'file': MultipartFile.fromBytes(
          photo.bytes,
          filename: photo.filename,
          contentType: DioMediaType.parse(photo.mimeType),
        ),
      }),
      decoder: (Object? json) =>
          WorkReportPhotoModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Material catalogue ----------------------------------------------------

  /// GET /materials — the catalogue, active rows only.
  Future<PaginatedData<MaterialItemModel>> listMaterialItems({int limit = 200}) {
    return _client.request<PaginatedData<MaterialItemModel>>(
      path: '/materials',
      method: 'GET',
      queryParameters: <String, dynamic>{'isActive': true, 'limit': limit},
      decoder: (Object? json) => PaginatedData<MaterialItemModel>.fromJson(
        json! as Map<String, dynamic>,
        MaterialItemModel.fromJson,
      ),
    );
  }

  /// POST /service-requests/:id/claim — takes an open request for the caller.
  ///
  /// Sends no body on purpose. The endpoint resolves the claimer from the session, so
  /// there is no employee id for this client to get wrong or for anyone to tamper with,
  /// and the request cannot be used to put a colleague on a job.
  ///
  /// A 409 is the ordinary outcome of two technicians tapping at once, not a failure:
  /// the server refuses the loser because somebody else won the race. The caller turns
  /// that into a message rather than an error state.
  Future<void> claimServiceRequest(String requestId) {
    return _client.request<void>(
      path: '/service-requests/$requestId/claim',
      method: 'POST',
      data: const <String, dynamic>{},
      decoder: (Object? _) {},
    );
  }

  /// POST /service-requests/:id/status — where the job has got to.
  ///
  /// The endpoint accepts two populations. `service_request.change_status` is the office's
  /// full authority; `service_request.self_progress` is the field's, and is bounded
  /// server-side to `SELF_PROGRESS_STATUSES` on a request that names the caller or their
  /// team. This transport does not know which the caller is and must not guess: it sends
  /// what it was given and lets the server refuse.
  ///
  /// `reason` is sent only when there is one. WAITING is the single state a technician can
  /// reach that requires it, and the server answers a missing one with a 400 naming the
  /// `reason` field — which the screen prints against the input rather than as a banner.
  Future<ServiceRequestDetailModel> changeServiceRequestStatus({
    required String requestId,
    required ServiceRequestStatus status,
    String? reason,
  }) {
    return _client.request<ServiceRequestDetailModel>(
      path: '/service-requests/$requestId/status',
      method: 'POST',
      data: <String, dynamic>{
        'status': status.wireValue,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
      decoder: (Object? json) =>
          ServiceRequestDetailModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /service-requests/:id — one request in full, or null when the caller may not
  /// see it.
  ///
  /// This is the only read that carries `description`, `contactName`, `contactPhone`
  /// and `attachments`; none of the four is on `ServiceRequestListItemDto`, so a detail
  /// screen built from a list row can only ever show a location.
  ///
  /// THE 404 IS AN ORDINARY OUTCOME, not a fault. The route is assignment-scoped: a
  /// staff caller without an oversight permission is bounded to their own and their
  /// team's requests plus the unclaimed pool, and anything else is reported as missing
  /// rather than as forbidden — deliberately, so a by-id endpoint cannot be used to
  /// probe for other people's request ids. It is mapped to null here, exactly as
  /// [getInspectionReport] maps its own, so the screen can say "this is no longer
  /// yours" instead of apologising for a server error.
  ///
  /// The unclaimed pool is admitted by that same scope (`includeUnclaimed: true`),
  /// which is what keeps opening a "Нээлттэй" row working.
  Future<ServiceRequestDetailModel?> getServiceRequestDetail(String requestId) async {
    try {
      return await _client.request<ServiceRequestDetailModel>(
        path: '/service-requests/$requestId',
        method: 'GET',
        decoder: (Object? json) =>
            ServiceRequestDetailModel.fromJson(json! as Map<String, dynamic>),
      );
    } on ServerException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  /// GET /service-requests, as the server scopes it — the reader's own requests.
  ///
  /// NO `employeeId` FILTER, for the same reason [listPlannedWork] is now called
  /// without one: `resolveAssignedWorkFilter` bounds a non-oversight
  /// caller to the work assigned to them OR to their team, and a client-supplied
  /// `employeeId` ANDs with that predicate — it can only subtract, and what it
  /// subtracts is every request handed to the reader's team.
  ///
  /// NO `status` filter either: a request assigned to somebody moves through nine
  /// statuses and this list is not a queue of one of them.
  ///
  /// WHAT COMES BACK IS NOT ONLY THE READER'S. The service-request read passes
  /// `includeUnclaimed: true` server-side, so the response also carries the open pool —
  /// the rows the "Нээлттэй" segment exists for. The caller must subtract them; see
  /// [ServiceRequestListItemModel.isUnclaimed]. That is done in the provider rather
  /// than here, because this transport must not decide what a list means.
  Future<PaginatedData<ServiceRequestListItemModel>> listAssignedServiceRequests({
    int limit = 100,
  }) {
    return _client.request<PaginatedData<ServiceRequestListItemModel>>(
      path: '/service-requests',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': 1,
        'limit': limit,
        // Newest first, so a request assigned a minute ago is on the first page even
        // when the reader carries more than `limit` of them.
        'sortBy': 'createdAt',
        'sortDir': 'desc',
      },
      decoder: (Object? json) =>
          PaginatedData<ServiceRequestListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        ServiceRequestListItemModel.fromJson,
      ),
    );
  }

  Future<PaginatedData<ServiceRequestListItemModel>> listOpenServiceRequests({
    int limit = 100,
  }) async {
    final List<PaginatedData<ServiceRequestListItemModel>> pages =
        await Future.wait<PaginatedData<ServiceRequestListItemModel>>(
      ServiceRequestStatus.unclaimed.map(
        (ServiceRequestStatus status) => _listServiceRequestsByStatus(
          status: status,
          limit: limit,
        ),
      ),
    );

    // De-duplicated by id: a request re-assigned between the two round trips can be
    // answered by both, and the same card twice reads as two jobs.
    final Map<String, ServiceRequestListItemModel> unique =
        <String, ServiceRequestListItemModel>{};
    for (final PaginatedData<ServiceRequestListItemModel> page in pages) {
      for (final ServiceRequestListItemModel item in page.items) {
        unique.putIfAbsent(item.id, () => item);
      }
    }

    final List<ServiceRequestListItemModel> merged =
        unique.values.toList(growable: false)..sort(compareByUrgency);

    return PaginatedData<ServiceRequestListItemModel>(
      items: merged,
      page: 1,
      limit: limit,
      // The sum of both counters, because the pool IS the two statuses together. A
      // record that moved between the round trips is counted twice here while being
      // rendered once, which is why the de-duplication above is on the items and not
      // on this figure — the server's own count is not something the app may restate.
      total: pages.fold<int>(
        0,
        (int sum, PaginatedData<ServiceRequestListItemModel> page) =>
            sum + page.total,
      ),
      totalPages: pages.fold<int>(
        1,
        (int most, PaginatedData<ServiceRequestListItemModel> page) =>
            page.totalPages > most ? page.totalPages : most,
      ),
    );
  }

  /// One `GET /service-requests` page for a single status.
  ///
  /// Sorted server-side by `slaDueAt` ascending, which is one of the three values
  /// `sortBy` accepts, so the first page is the most urgent slice rather than an
  /// arbitrary one when the pool is longer than `limit`.
  Future<PaginatedData<ServiceRequestListItemModel>> _listServiceRequestsByStatus({
    required ServiceRequestStatus status,
    required int limit,
  }) {
    return _client.request<PaginatedData<ServiceRequestListItemModel>>(
      path: '/service-requests',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'status': status.wireValue,
        'page': 1,
        'limit': limit,
        'sortBy': 'slaDueAt',
        'sortDir': 'asc',
      },
      decoder: (Object? json) =>
          PaginatedData<ServiceRequestListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        ServiceRequestListItemModel.fromJson,
      ),
    );
  }

  /// How the merged pool is ordered: what will breach first, first.
  ///
  /// Urgent ahead of non-urgent, matching how the Нүүр tab bands the same rows —
  /// `HomeUrgentItem.fromRequest` treats `isUrgent` as red regardless of the SLA state.
  /// Then the earliest deadline, with a request that carries no `slaDueAt` sinking to
  /// the bottom rather than posing as due now. `requestNumber` breaks the remaining
  /// ties so the order is stable between refreshes.
  ///
  /// Public so the ordering can be asserted directly rather than through a rendered
  /// list; it is a pure comparator and decides nothing the server sent.
  static int compareByUrgency(
    ServiceRequestListItemModel a,
    ServiceRequestListItemModel b,
  ) {
    if (a.isUrgent != b.isUrgent) return a.isUrgent ? -1 : 1;

    final DateTime? left = a.slaDueAt;
    final DateTime? right = b.slaDueAt;
    if (left != null && right != null && left != right) {
      return left.compareTo(right);
    }
    if (left == null && right != null) return 1;
    if (left != null && right == null) return -1;

    return a.requestNumber.compareTo(b.requestNumber);
  }

  // -- Planned work detail ---------------------------------------------------

  /// GET /planned-work/:id. One request returns the tasks, the floor roll-up, the
  /// materials, the report state, the available actions and the completion blockers,
  /// so the detail screen never fans out.
  Future<PlannedWorkModel> getPlannedWork(String plannedWorkId) {
    return _client.request<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId',
      method: 'GET',
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /planned-work/:id/transition.
  ///
  /// The route carries no `requirePermission`; each action is checked inside the
  /// service against `PLANNED_WORK_ACTION_RULES`. PAUSE and CANCEL require a reason,
  /// and COMPLETE auto-creates the consolidated report in DRAFT.
  Future<PlannedWorkModel> transition({
    required String plannedWorkId,
    required PlannedWorkAction action,
    String? reason,
  }) {
    return _client.request<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId/transition',
      method: 'POST',
      data: <String, dynamic>{
        'action': action.wireValue,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /planned-work/:id/tasks/:taskId/progress.
  ///
  /// Despite the name, the live backend answers with the whole re-read
  /// [PlannedWorkModel] rather than the single task, so one call refreshes the task
  /// list, the roll-up percentage, the completion blockers and the action list
  /// together. Decoding the full record is what keeps the screen consistent after a
  /// save without a second GET.
  Future<PlannedWorkModel> recordTaskProgress({
    required String plannedWorkId,
    required String taskId,
    required RecordTaskProgressRequest request,
  }) {
    return _client.request<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId/tasks/$taskId/progress',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /planned-work/:id/report. `report` is null until the work is completed;
  /// `preview` is assembled on every call.
  Future<PlannedWorkReportBundleModel> getReport(String plannedWorkId) {
    return _client.request<PlannedWorkReportBundleModel>(
      path: '/planned-work/$plannedWorkId/report',
      method: 'GET',
      decoder: (Object? json) =>
          PlannedWorkReportBundleModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// PATCH /planned-work/:id/report — the Дүгнэлт and Зөвлөмж of the consolidated
  /// report. Needs `planned_work.submit_report`.
  Future<PlannedWorkModel> updateReport({
    required String plannedWorkId,
    String? conclusion,
    String? recommendation,
  }) {
    return _client.request<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId/report',
      method: 'PATCH',
      data: <String, dynamic>{
        'conclusion': conclusion,
        'recommendation': recommendation,
      },
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /planned-work/:id/report/submit. Refused while `submissionBlockers` is
  /// non-empty, so the UI only offers it when that list is clear.
  Future<PlannedWorkModel> submitReport(String plannedWorkId) {
    return _client.request<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId/report/submit',
      method: 'POST',
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Consolidated inspection report ----------------------------------------
  //
  // Nine routes are mounted at /planned-work/:plannedWorkId/inspection-report; these are
  // the five a performer can reach. The other four — approve, return, finalise, reopen —
  // are keyed on `planned_work.approve_report`, an oversight permission the field tier
  // never holds, so they are deliberately absent rather than added and hidden.
  //
  // Readiness is NOT the same gate as work completion: the server generates the report as
  // soon as every non-skipped sub-task is DONE, which is typically well before anybody
  // presses "Дуусгах".

  /// GET /planned-work/:id/inspection-report/readiness. Needs `planned_work.view`, so it
  /// answers for any caller who can open the detail screen.
  Future<InspectionReportReadinessModel> getInspectionReportReadiness(
    String plannedWorkId,
  ) {
    return _client.request<InspectionReportReadinessModel>(
      path: '/planned-work/$plannedWorkId/inspection-report/readiness',
      method: 'GET',
      decoder: (Object? json) => InspectionReportReadinessModel.fromJson(
        json! as Map<String, dynamic>,
      ),
    );
  }

  /// GET /planned-work/:id/inspection-report, or null when none has been generated.
  ///
  /// The route answers 404 with 'Үзлэгийн нэгдсэн тайлан үүсээгүй байна.' in that case,
  /// which is a legitimate state rather than a failure — it is the state every planned
  /// work starts in — so it is mapped to null here instead of being surfaced as an error
  /// the screen would have to apologise for.
  Future<InspectionReportModel?> getInspectionReport(String plannedWorkId) async {
    try {
      return await _client.request<InspectionReportModel>(
        path: '/planned-work/$plannedWorkId/inspection-report',
        method: 'GET',
        decoder: (Object? json) =>
            InspectionReportModel.fromJson(json! as Map<String, dynamic>),
      );
    } on ServerException catch (error) {
      if (error.statusCode == 404) return null;
      rethrow;
    }
  }

  /// POST /planned-work/:id/inspection-report — composes the draft.
  ///
  /// Refused with a 400 while any non-skipped sub-task is unfinished, and the issues name
  /// each one. Re-running it on an existing report refreshes the derived sections and,
  /// once anybody has edited the prose, leaves the prose alone.
  Future<InspectionReportModel> generateInspectionReport(String plannedWorkId) {
    return _client.request<InspectionReportModel>(
      path: '/planned-work/$plannedWorkId/inspection-report',
      method: 'POST',
      decoder: (Object? json) =>
          InspectionReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// PATCH /planned-work/:id/inspection-report — the narrative only.
  ///
  /// The body omits every field the caller left null; see
  /// [UpdateInspectionReportRequest.toJson] for why that is load-bearing.
  Future<InspectionReportModel> updateInspectionReport({
    required String plannedWorkId,
    required UpdateInspectionReportRequest request,
  }) {
    return _client.request<InspectionReportModel>(
      path: '/planned-work/$plannedWorkId/inspection-report',
      method: 'PATCH',
      data: request.toJson(),
      decoder: (Object? json) =>
          InspectionReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /planned-work/:id/inspection-report/submit. Legal from DRAFT and RETURNED only.
  Future<InspectionReportModel> submitInspectionReport(String plannedWorkId) {
    return _client.request<InspectionReportModel>(
      path: '/planned-work/$plannedWorkId/inspection-report/submit',
      method: 'POST',
      decoder: (Object? json) =>
          InspectionReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Task evidence photos --------------------------------------------------

  /// POST /planned-work/:id/tasks/:taskId/photos — multipart.
  ///
  /// The only route in the API that attaches a picture to a sub-task. It needs
  /// `planned_work.record_progress`, refuses a non-image mime type and refuses a work
  /// that is already ARCHIVED or CANCELLED, and it re-derives the task's status on
  /// the way out — which is the point: a task whose quantity is already complete can
  /// move to DONE the moment its last photo lands.
  ///
  /// Like the progress call, the reply is the whole re-read [PlannedWorkModel] rather
  /// than the photo, so one upload refreshes the task list, the roll-up and the
  /// completion blockers together.
  Future<PlannedWorkModel> attachTaskPhoto({
    required String plannedWorkId,
    required String taskId,
    required TaskPhotoKind kind,
    required CapturedPhoto photo,
  }) {
    return _client.upload<PlannedWorkModel>(
      path: '/planned-work/$plannedWorkId/tasks/$taskId/photos',
      body: () => FormData.fromMap(<String, dynamic>{
        'kind': kind.wireValue,
        'file': MultipartFile.fromBytes(
          photo.bytes,
          filename: photo.filename,
          contentType: DioMediaType.parse(photo.mimeType),
        ),
      }),
      decoder: (Object? json) =>
          PlannedWorkModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Files -----------------------------------------------------------------

  /// GET /files/:fileId.
  ///
  /// Returns raw bytes rather than the JSON envelope, so it bypasses
  /// [DioClient.request] and uses the underlying Dio instance. The Bearer header is
  /// still attached by the interceptor, which is why an evidence photo cannot be
  /// handed to `Image.network`. A `PLANNED_WORK_TASK`-owned file needs
  /// `planned_work.view`, which any caller who can see this screen already holds.
  Future<Uint8List> downloadFile(String fileId) async {
    try {
      final Response<List<int>> response = await _client.raw.get<List<int>>(
        '/files/$fileId',
        options: Options(
          responseType: ResponseType.bytes,
          // The envelope-aware validateStatus on the shared options would otherwise
          // let a 404 body through as if it were an image.
          validateStatus: (int? status) => status != null && status < 400,
        ),
      );

      final List<int>? bytes = response.data;
      if (bytes == null || bytes.isEmpty) {
        throw const ServerException(
          message: 'Файл хоосон байна.',
          code: 'EMPTY_FILE',
          statusCode: 200,
        );
      }
      return Uint8List.fromList(bytes);
    } on DioException catch (error) {
      final Object? inner = error.error;
      if (inner is NetworkException) throw inner;
      throw ServerException(
        message: 'Зураг татаж чадсангүй.',
        code: 'FILE_DOWNLOAD_FAILED',
        statusCode: error.response?.statusCode ?? 0,
      );
    }
  }
}
