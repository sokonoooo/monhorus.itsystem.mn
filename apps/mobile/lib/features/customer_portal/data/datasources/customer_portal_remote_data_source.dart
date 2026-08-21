import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../../core/error/exceptions.dart';
import '../../../../core/media/photo_capture.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/network/paginated_data.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/object_master_enums.dart';
import '../../domain/entities/server_vocabulary.dart';
import '../../domain/entities/service_request_enums.dart';
import '../models/notification_model.dart';
import '../models/object_master_model.dart';
import '../models/project_model.dart';
import '../models/service_request_model.dart';
import '../models/survey_model.dart';

/// Transport for the customer portal. Throws [ServerException] or
/// [NetworkException]; the repository converts those into failures.
///
/// Every read that returns customer-owned records takes a [ResolvedCustomerScope]
/// and puts its id on the wire. The one exception is `/notifications`, which the
/// backend already scopes to the caller by recipient and which therefore needs no
/// customer parameter.
///
/// The id on the query string is not what makes the read safe. `resolveCustomerScope`
/// on the server discards a customer caller's `customerId` and uses the one on their
/// account, so the parameter is a filter for staff and inert for a customer. It is
/// still sent because the scope it comes from is the session's, so sending it cannot
/// say anything the server did not already know.
class CustomerPortalRemoteDataSource {
  const CustomerPortalRemoteDataSource(this._client);

  final DioClient _client;

  // -- Projects, buildings, floors -------------------------------------------

  /// GET /projects. `projectListQuerySchema` caps `limit` at 100.
  Future<PaginatedData<ProjectModel>> listProjects({
    required ResolvedCustomerScope scope,
    int page = 1,
    int limit = 50,
  }) {
    return _client.request<PaginatedData<ProjectModel>>(
      path: '/projects',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'customerId': scope.customerId,
        'page': page,
        'limit': limit,
        'isActive': true,
      },
      decoder: (Object? json) => PaginatedData<ProjectModel>.fromJson(
        json! as Map<String, dynamic>,
        ProjectModel.fromJson,
      ),
    );
  }

  /// GET /buildings. `buildingListQuerySchema` caps `limit` at 100, which is what
  /// this asks for: the caller sums `riskSummary` across the answer, so a page that
  /// stops short of the customer's buildings is a truncated sum. `total` on the
  /// response says whether one page was enough, and the caller reads the rest when
  /// it was not.
  Future<PaginatedData<BuildingModel>> listBuildings({
    required ResolvedCustomerScope scope,
    String? projectId,
    String? search,
    int page = 1,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<BuildingModel>>(
      path: '/buildings',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'customerId': scope.customerId,
        if (projectId != null) 'projectId': projectId,
        if (search != null && search.isNotEmpty) 'search': search,
        'page': page,
        'limit': limit,
      },
      decoder: (Object? json) => PaginatedData<BuildingModel>.fromJson(
        json! as Map<String, dynamic>,
        BuildingModel.fromJson,
      ),
    );
  }

  Future<BuildingModel> getBuilding(String buildingId) {
    return _client.request<BuildingModel>(
      path: '/buildings/$buildingId',
      method: 'GET',
      decoder: (Object? json) => BuildingModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /floors. The schema has no `customerId` parameter, so a floor list is
  /// always narrowed by its building instead; the caller reaches this only from a
  /// building that was itself fetched inside the scope.
  Future<PaginatedData<FloorModel>> listFloors({
    required String buildingId,
    int page = 1,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<FloorModel>>(
      path: '/floors',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'buildingId': buildingId,
        'page': page,
        'limit': limit,
      },
      decoder: (Object? json) => PaginatedData<FloorModel>.fromJson(
        json! as Map<String, dynamic>,
        FloorModel.fromJson,
      ),
    );
  }

  /// GET /floors/:floorId. Unlike the list, this back-fills `projectName`.
  Future<FloorModel> getFloor(String floorId) {
    return _client.request<FloorModel>(
      path: '/floors/$floorId',
      method: 'GET',
      decoder: (Object? json) => FloorModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /floors/:floorId/plan. Returns `data: null` with a 200 when the floor has
  /// no plan, so an absent plan is not an error.
  Future<FloorPlanModel?> getFloorPlan(String floorId) {
    return _client.request<FloorPlanModel?>(
      path: '/floors/$floorId/plan',
      method: 'GET',
      decoder: (Object? json) => json is Map<String, dynamic>
          ? FloorPlanModel.fromJson(json)
          : null,
    );
  }

  /// GET /floors/:floorId/load.
  Future<FloorLoadSummaryModel> getFloorLoad(String floorId) {
    return _client.request<FloorLoadSummaryModel>(
      path: '/floors/$floorId/load',
      method: 'GET',
      decoder: (Object? json) =>
          FloorLoadSummaryModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Objects ----------------------------------------------------------------

  /// GET /objects-master.
  ///
  /// `unlinkedOnly` is deliberately not exposed: the service overwrites the floor
  /// filter when a buildingId is also supplied, so combining the two silently drops
  /// it. The customer flow never needs unlinked objects anyway.
  Future<PaginatedData<ObjectListItemModel>> listObjects({
    required ResolvedCustomerScope scope,
    String? floorId,
    String? buildingId,
    ObjectCategory? category,
    ObjectStatus? status,
    String? search,
    int page = 1,
    int limit = 100,
    String sortBy = 'code',
    String sortDir = 'asc',
  }) {
    return _client.request<PaginatedData<ObjectListItemModel>>(
      path: '/objects-master',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'customerId': scope.customerId,
        if (floorId != null) 'floorId': floorId,
        if (buildingId != null) 'buildingId': buildingId,
        if (category != null) 'category': category.wireValue,
        if (status != null) 'status': status.wireValue,
        if (search != null && search.isNotEmpty) 'search': search,
        'page': page,
        'limit': limit,
        'sortBy': sortBy,
        'sortDir': sortDir,
      },
      decoder: (Object? json) => PaginatedData<ObjectListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        ObjectListItemModel.fromJson,
      ),
    );
  }

  Future<ObjectDetailModel> getObject(String objectId) {
    return _client.request<ObjectDetailModel>(
      path: '/objects-master/$objectId',
      method: 'GET',
      decoder: (Object? json) =>
          ObjectDetailModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /objects-master/:objectId/history. The timeline arrives newest first.
  Future<ObjectHistoryModel> getObjectHistory(String objectId) {
    return _client.request<ObjectHistoryModel>(
      path: '/objects-master/$objectId/history',
      method: 'GET',
      decoder: (Object? json) =>
          ObjectHistoryModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Service requests -------------------------------------------------------

  /// GET /service-requests.
  ///
  /// `slaState` is deliberately not exposed as a filter: the backend applies it in
  /// memory after paginating, so `total` disagrees with the page contents whenever
  /// it is supplied.
  Future<PaginatedData<ServiceRequestListItemModel>> listServiceRequests({
    required ResolvedCustomerScope scope,
    ServiceRequestStatus? status,
    bool? isUrgent,
    String? buildingId,
    String? projectId,
    String? search,
    int page = 1,
    int limit = 20,
    String sortBy = 'createdAt',
    String sortDir = 'desc',
  }) {
    return _client.request<PaginatedData<ServiceRequestListItemModel>>(
      path: '/service-requests',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'customerId': scope.customerId,
        if (status != null) 'status': status.wireValue,
        if (isUrgent != null) 'isUrgent': isUrgent,
        if (buildingId != null) 'buildingId': buildingId,
        if (projectId != null) 'projectId': projectId,
        if (search != null && search.isNotEmpty) 'search': search,
        'page': page,
        'limit': limit,
        'sortBy': sortBy,
        'sortDir': sortDir,
      },
      decoder: (Object? json) => PaginatedData<ServiceRequestListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        ServiceRequestListItemModel.fromJson,
      ),
    );
  }

  Future<ServiceRequestDetailModel> getServiceRequest(String requestId) {
    return _client.request<ServiceRequestDetailModel>(
      path: '/service-requests/$requestId',
      method: 'GET',
      decoder: (Object? json) =>
          ServiceRequestDetailModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /service-requests/:requestId/report/customer.
  ///
  /// The customer-facing projection of the technician's conclusion: eleven fields, no
  /// report id, no internal notes. Answers **404** when the request carries no report,
  /// when the report is not APPROVED, and when the request is not this customer's —
  /// the three are deliberately indistinguishable. It creates nothing.
  ///
  /// The 404 is a legitimate answer rather than a fault, so the repository turns it
  /// into a null instead of a failure; see
  /// [CustomerPortalRepository.getCustomerWorkReport].
  Future<CustomerWorkReportModel> getCustomerWorkReport(String requestId) {
    return _client.request<CustomerWorkReportModel>(
      path: '/service-requests/$requestId/report/customer',
      method: 'GET',
      decoder: (Object? json) =>
          CustomerWorkReportModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /files/service-request-attachments — multipart, needs
  /// `portal.service_request.create` (or the staff `service_request.create`).
  ///
  /// Step one of two, the same shape the employee app uses for assessment evidence:
  /// the request does not exist yet, so the picture has nothing to belong to. The
  /// server parks the file on the uploading ACCOUNT and [createServiceRequest] claims
  /// it, which is also why an upload that is never followed by a submit leaves an
  /// orphan row nobody can read — including the uploader.
  ///
  /// The returned id is only useful to this account: the create route refuses an
  /// `attachmentIds` entry somebody else uploaded, so a leaked id buys nothing.
  Future<ServiceRequestAttachmentModel> uploadServiceRequestAttachment(
    CapturedPhoto photo,
  ) {
    return _client.upload<ServiceRequestAttachmentModel>(
      path: '/files/service-request-attachments',
      body: () => FormData.fromMap(<String, dynamic>{
        'file': MultipartFile.fromBytes(
          photo.bytes,
          filename: photo.filename,
          contentType: DioMediaType.parse(photo.mimeType),
        ),
      }),
      decoder: (Object? json) =>
          ServiceRequestAttachmentModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /vocabulary.
  ///
  /// The third read on this class that takes no [ResolvedCustomerScope], and the only
  /// one that is not about the caller at all: it answers what this installation calls
  /// its workflow stages and risk bands, which is the same answer for everybody.
  ///
  /// Deliberately NOT `GET /settings`, which holds the same configuration and answers
  /// 403 here - `settings.view` is admin, management and finance only, and a customer
  /// reading the SLA thresholds and the finance keys in order to learn the word for
  /// «Дууссан» is exactly what that route is closed against. `/vocabulary` needs
  /// nothing but a session.
  Future<ServerVocabulary> getVocabulary() {
    return _client.request<ServerVocabulary>(
      path: '/vocabulary',
      method: 'GET',
      decoder: (Object? json) => json is Map<String, dynamic>
          ? ServerVocabulary.fromJson(json)
          : ServerVocabulary.empty,
    );
  }

  /// GET /service-requests/callable-object-types.
  ///
  /// Not the object-type catalogue: reading that needs `object_master.view`, which a
  /// customer account does not hold. This endpoint is gated on being able to CREATE a
  /// request instead, and answers the narrower question the call form actually asks.
  Future<List<CallableObjectTypeModel>> listCallableObjectTypes() {
    return _client.request<List<CallableObjectTypeModel>>(
      path: '/service-requests/callable-object-types',
      method: 'GET',
      decoder: (Object? json) => (json! as List<dynamic>)
          .map((dynamic item) =>
              CallableObjectTypeModel.fromJson(item as Map<String, dynamic>))
          .toList(growable: false),
    );
  }

  /// POST /service-requests. Guarded server-side by `service_request.create`, which
  /// the caller must hold; the UI only offers this when `GET /auth/me` reported it.
  Future<ServiceRequestDetailModel> createServiceRequest(
    CreateServiceRequestRequestModel request,
  ) {
    return _client.request<ServiceRequestDetailModel>(
      path: '/service-requests',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? json) =>
          ServiceRequestDetailModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Survey -----------------------------------------------------------------

  /// GET /surveys/pending.
  ///
  /// The requests this customer has been asked to rate and has not finished rating.
  /// Scoped server-side to the caller, like `/notifications`, so it takes no customer
  /// parameter. Needs `portal.survey.submit`; the UI only asks when `GET /auth/me`
  /// reported that key, so the list is not fetched in order to be refused.
  Future<List<SurveyPendingItemModel>> listPendingSurveys() {
    return _client.request<List<SurveyPendingItemModel>>(
      path: '/surveys/pending',
      method: 'GET',
      decoder: (Object? json) => (json! as List<dynamic>)
          .map((dynamic item) =>
              SurveyPendingItemModel.fromJson(item as Map<String, dynamic>))
          .toList(growable: false),
    );
  }

  /// GET /surveys/requests/:requestId/form.
  ///
  /// The question catalogue as it stands, plus the technicians on this job and what
  /// the customer has already said about each. Answers **404** when there is no survey
  /// to answer — none was raised, it is already finished, or the request is not this
  /// customer's — and those three are deliberately indistinguishable.
  ///
  /// That 404 is a legitimate answer rather than a fault, so the repository turns it
  /// into a null; the precedent is [getCustomerWorkReport].
  Future<SurveyFormModel> getSurveyForm(String requestId) {
    return _client.request<SurveyFormModel>(
      path: '/surveys/requests/$requestId/form',
      method: 'GET',
      decoder: (Object? json) =>
          SurveyFormModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /surveys/requests/:requestId/responses — ONE technician per call.
  ///
  /// The survey is answered per technician, so a job two people attended is two calls
  /// and the caller loops. Nothing is handed back: the response body is the stored
  /// record, and the phone's next question is who is still outstanding, which
  /// `/surveys/pending` and the form endpoint answer.
  Future<void> submitSurveyResponse(
    String requestId,
    SubmitSurveyResponseRequest request,
  ) {
    return _client.request<void>(
      path: '/surveys/requests/$requestId/responses',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? _) {},
    );
  }

  // -- Notifications ----------------------------------------------------------

  /// GET /notifications. Scoped server-side to the calling user by recipient.
  ///
  /// `unreadOnly` is parsed with `z.coerce.boolean()`, under which any non-empty
  /// string is truthy - sending `unreadOnly=false` would mean true. It is therefore
  /// only ever put on the wire when it is true.
  Future<PaginatedData<NotificationModel>> listNotifications({
    bool unreadOnly = false,
    int page = 1,
    int limit = 25,
  }) {
    return _client.request<PaginatedData<NotificationModel>>(
      path: '/notifications',
      method: 'GET',
      queryParameters: <String, dynamic>{
        if (unreadOnly) 'unreadOnly': true,
        'page': page,
        'limit': limit,
      },
      decoder: (Object? json) => PaginatedData<NotificationModel>.fromJson(
        json! as Map<String, dynamic>,
        NotificationModel.fromJson,
      ),
    );
  }

  Future<NotificationUnreadCountModel> getUnreadCount() {
    return _client.request<NotificationUnreadCountModel>(
      path: '/notifications/unread-count',
      method: 'GET',
      decoder: (Object? json) =>
          NotificationUnreadCountModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<NotificationModel> markNotificationRead(String notificationId) {
    return _client.request<NotificationModel>(
      path: '/notifications/$notificationId/read',
      method: 'POST',
      decoder: (Object? json) =>
          NotificationModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<void> markAllNotificationsRead() {
    return _client.request<void>(
      path: '/notifications/read-all',
      method: 'POST',
      decoder: (Object? _) {},
    );
  }

  // -- Files ------------------------------------------------------------------

  /// GET /files/:fileId.
  ///
  /// This endpoint returns raw bytes rather than the JSON envelope, so it bypasses
  /// [DioClient.request] and uses the underlying Dio instance. It still needs the
  /// Bearer header, which the interceptor attaches, so the returned URL cannot be
  /// handed to `Image.network`.
  Future<Uint8List> downloadFile(String fileId) async {
    try {
      final Response<List<int>> response = await _client.raw.get<List<int>>(
        '/files/$fileId',
        options: Options(
          responseType: ResponseType.bytes,
          // The envelope-aware validateStatus on the shared options would let a 404
          // body through as if it were an image.
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
        message: 'Файл татаж чадсангүй.',
        code: 'FILE_DOWNLOAD_FAILED',
        statusCode: error.response?.statusCode ?? 0,
      );
    }
  }
}
