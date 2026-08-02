import 'dart:typed_data';

import 'package:dio/dio.dart';
import '../../../../../core/network/paginated_data.dart';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/media/photo_capture.dart';
import '../../../../../core/network/dio_client.dart';
import '../../domain/entities/risk_level.dart';
import '../models/inspection_models.dart';
import '../models/object_models.dart';
import '../models/project_models.dart';

/// Transport for the employee project drill-down: project → building → floor →
/// device. Throws [ServerException] or [NetworkException]; the repository converts
/// those into failures.
///
/// All reads are GETs except the device write the prototype puts on the device
/// screen, which takes two calls in a fixed order: `POST
/// /files/object-assessment-photos` mints a file id, then `POST
/// /objects-master/:id/assessments` records the score with that id in `photoIds`.
/// The order is not a choice — `createObjectAssessmentSchema.photoIds.min(1)` means
/// an assessment cannot be written before its evidence exists.
///
/// No `customerId` is put on the wire. A staff caller's scope resolves to every
/// customer, so narrowing to one would hide the other projects the technician is
/// attached to; the drill-down narrows by parent id instead, which is also what the
/// floor and object endpoints expect.
class ProjectRemoteDataSource {
  const ProjectRemoteDataSource(this._client);

  final DioClient _client;

  // -- Projects, buildings, floors -------------------------------------------

  /// GET /projects. `projectListQuerySchema` caps `limit` at 100.
  ///
  /// `isActive` is deliberately not filtered: a technician may still need to read a
  /// closed project's history, and the row prints the state instead.
  Future<PaginatedData<ProjectModel>> listProjects({
    String? search,
    int page = 1,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<ProjectModel>>(
      path: '/projects',
      method: 'GET',
      queryParameters: <String, dynamic>{
        if (search != null && search.isNotEmpty) 'search': search,
        'page': page,
        'limit': limit,
        'sortBy': 'name',
        'sortDir': 'asc',
      },
      decoder: (Object? json) => PaginatedData<ProjectModel>.fromJson(
        json! as Map<String, dynamic>,
        ProjectModel.fromJson,
      ),
    );
  }

  Future<ProjectModel> getProject(String projectId) {
    return _client.request<ProjectModel>(
      path: '/projects/$projectId',
      method: 'GET',
      decoder: (Object? json) => ProjectModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// GET /projects/:projectId/buildings. The convenience child list; the backend
  /// hardcodes page 1 with a limit of 100 there, so no paging parameters are sent.
  Future<PaginatedData<BuildingModel>> listProjectBuildings(String projectId) {
    return _client.request<PaginatedData<BuildingModel>>(
      path: '/projects/$projectId/buildings',
      method: 'GET',
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

  /// GET /floors, narrowed by building.
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

  /// GET /floors/:floorId/plan. Returns `data: null` with a 200 when the floor has no
  /// plan, so an absent plan is not an error.
  Future<FloorPlanModel?> getFloorPlan(String floorId) {
    return _client.request<FloorPlanModel?>(
      path: '/floors/$floorId/plan',
      method: 'GET',
      decoder: (Object? json) =>
          json is Map<String, dynamic> ? FloorPlanModel.fromJson(json) : null,
    );
  }

  // -- Devices ----------------------------------------------------------------

  /// GET /floors/:floorId/objects — the devices linked to a floor.
  ///
  /// Preferred over `/objects-master?floorId=`: this route is the floor's own child
  /// list, so it cannot be confused by the `buildingId` precedence rule in the object
  /// service, which silently overwrites a floor filter when both are supplied.
  Future<PaginatedData<ObjectListItemModel>> listFloorObjects({
    required String floorId,
    int page = 1,
    int limit = 100,
  }) {
    return _client.request<PaginatedData<ObjectListItemModel>>(
      path: '/floors/$floorId/objects',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'limit': limit,
        'sortBy': 'code',
        'sortDir': 'asc',
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
  ///
  /// Staff-only by design — the route accepts no portal permission because the
  /// timeline folds in audit rows and internal request detail.
  Future<ObjectHistoryModel> getObjectHistory(String objectId) {
    return _client.request<ObjectHistoryModel>(
      path: '/objects-master/$objectId/history',
      method: 'GET',
      decoder: (Object? json) =>
          ObjectHistoryModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Assessment -------------------------------------------------------------

  /// POST /files/object-assessment-photos — multipart, needs `object_master.assess`.
  ///
  /// Step one of two. The assessment is written in one shot with its `photoIds`, so
  /// the picture has no assessment to belong to yet; the server parks the file on the
  /// uploader and [recordAssessment] transfers ownership to the object. An upload
  /// that is never followed by an assessment therefore leaves an orphan row the
  /// object never shows, which is the same behaviour the web client has.
  ///
  /// The route refuses a non-image mime type outright, which is why
  /// [CapturedPhoto] is only ever produced with one the server allows.
  Future<ObjectPhotoModel> uploadAssessmentPhoto(CapturedPhoto photo) {
    return _client.upload<ObjectPhotoModel>(
      path: '/files/object-assessment-photos',
      body: () => FormData.fromMap(<String, dynamic>{
        'file': MultipartFile.fromBytes(
          photo.bytes,
          filename: photo.filename,
          contentType: DioMediaType.parse(photo.mimeType),
        ),
      }),
      decoder: (Object? json) =>
          ObjectPhotoModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  /// POST /objects-master/:objectId/assessments — needs `object_master.assess`.
  ///
  /// Step two. Append-only by design: there is no PATCH and no DELETE for an
  /// assessment anywhere in the API, so a mistake is corrected by recording another
  /// one, and the sheet warns before sending.
  ///
  /// The server resolves the risk band from the score, may move the object to
  /// DECOMMISSIONED on a black band, and raises the section 14.3 notifications. None
  /// of that is mirrored here; the screen re-reads the object instead.
  Future<ObjectAssessmentModel> recordAssessment({
    required String objectId,
    required CreateAssessmentRequest request,
  }) {
    return _client.request<ObjectAssessmentModel>(
      path: '/objects-master/$objectId/assessments',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? json) =>
          ObjectAssessmentModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Consolidated conclusion reports ----------------------------------------

  /// GET /inspections, narrowed to one floor.
  ///
  /// Gated on `object_master.view` rather than `report.view`: these are the assessment
  /// records themselves, so anyone who may read a device's conclusions may read them
  /// here too.
  Future<PaginatedData<InspectionListItemModel>> listFloorInspections({
    required String floorId,
    RiskLevel? riskLevel,
    int page = 1,
    int limit = 50,
  }) {
    return _client.request<PaginatedData<InspectionListItemModel>>(
      path: '/inspections',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'floorId': floorId,
        if (riskLevel != null) 'riskLevel': riskLevel.wireValue,
        'page': page,
        'limit': limit,
      },
      decoder: (Object? json) => PaginatedData<InspectionListItemModel>.fromJson(
        json! as Map<String, dynamic>,
        InspectionListItemModel.fromJson,
      ),
    );
  }

  /// GET /inspections/summary — the per-band counts behind the filter chips.
  Future<InspectionSummaryModel> getFloorInspectionSummary(String floorId) {
    return _client.request<InspectionSummaryModel>(
      path: '/inspections/summary',
      method: 'GET',
      queryParameters: <String, dynamic>{'floorId': floorId},
      decoder: (Object? json) =>
          InspectionSummaryModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  // -- Files ------------------------------------------------------------------

  /// GET /files/:fileId.
  ///
  /// Returns raw bytes rather than the JSON envelope, so it bypasses
  /// [DioClient.request] and uses the underlying Dio instance. It still needs the
  /// Bearer header, which the interceptor attaches, so a `downloadUrl` cannot be
  /// handed to `Image.network`.
  ///
  /// The permission the server demands is chosen by the file's owner type: a floor
  /// plan needs `object.view`, a device photo needs `object_master.view`.
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
