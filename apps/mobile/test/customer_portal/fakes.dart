import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/core/media/photo_capture.dart';
import 'package:monhorus_mobile/core/network/api_result.dart';
import 'package:monhorus_mobile/core/network/paginated_data.dart';
import 'package:monhorus_mobile/core/theme/app_theme.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_mobile/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/notification_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/object_master_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/service_request_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/customer_scope.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/service_request_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/repositories/customer_portal_repository.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';

/// Fixtures and fakes for the customer portal tests.
///
/// The JSON maps below are shaped exactly as the API sends them, so a screen test
/// also exercises the model parsers rather than hand-built objects that could drift
/// away from the wire format.

const String testCustomerId = '6a67013e11b34f68bfc4037f';
const String testCustomerName = 'Central Tower ХХК';

/// The scope a linked account resolves to. Not injected anywhere by itself - it is
/// what [customerScopeProvider] derives from [testCustomer] - and exists so a test can
/// state the expected value and so the sheet, which takes a scope as a widget
/// argument, can be built in isolation.
const ResolvedCustomerScope testScope = ResolvedCustomerScope(
  customerId: testCustomerId,
  customerName: testCustomerName,
);

/// A customer account an administrator has linked to an organisation.
const AppUser testCustomer = AppUser(
  id: '5f1b0c2a11b34f68bfc40001',
  fullName: 'Д. Оюунчимэг',
  email: 'oyun@centraltower.mn',
  phone: '9911-2233',
  role: UserRole.customer,
  status: AccountStatus.active,
  customerId: testCustomerId,
  customerName: testCustomerName,
);

/// A customer account nobody has linked yet: `GET /auth/me` reports a null
/// `customerId`, which is the condition the portal explains instead of loading.
const AppUser unlinkedCustomer = AppUser(
  id: '5f1b0c2a11b34f68bfc40002',
  fullName: 'С. Батжаргал',
  email: 'batjargal@nowhere.mn',
  phone: '8811-4455',
  role: UserRole.customer,
  status: AccountStatus.active,
);

/// The default customer role grants `portal.service_request.create`, so this is the
/// permission set a linked customer actually signs in with.
AppUser customerWithCreateRight() => AppUser(
      id: testCustomer.id,
      fullName: testCustomer.fullName,
      email: testCustomer.email,
      phone: testCustomer.phone,
      role: testCustomer.role,
      status: testCustomer.status,
      customerId: testCustomer.customerId,
      customerName: testCustomer.customerName,
      permissions: const <String>{PermissionKeys.portalServiceRequestCreate},
    );

/// A customer account that also holds the staff `object_master.view`, which is what
/// opens the object timeline. No production customer role grants it - the endpoint is
/// staff-only by decision - so this exists to prove the section appears when, and only
/// when, the permission is present.
AppUser customerWithObjectMasterView() => AppUser(
      id: testCustomer.id,
      fullName: testCustomer.fullName,
      email: testCustomer.email,
      phone: testCustomer.phone,
      role: testCustomer.role,
      status: testCustomer.status,
      customerId: testCustomer.customerId,
      customerName: testCustomer.customerName,
      permissions: const <String>{PermissionKeys.objectMasterView},
    );

/// The message `resolveCustomerScope` returns with a 403 when a customer account has
/// no organisation, copied from apps/backend/src/common/security/customer-scope.ts.
const String serverNotLinkedMessage =
    'Таны бүртгэл харилцагч байгууллагад холбогдоогүй байна. Админд хандана уу.';

/// What the API answers a caller who lacks the permission an endpoint requires,
/// mapped exactly as `CustomerPortalRepositoryImpl` maps a 403.
const AuthFailure forbiddenFailure = AuthFailure(
  'Энэ үйлдлийг хийх эрх байхгүй байна.',
  code: 'FORBIDDEN',
);

// -- Wire fixtures -----------------------------------------------------------

Map<String, dynamic> riskSummaryJson({
  int normal = 40,
  int attention = 3,
  int critical = 0,
  int unassessed = 2,
  bool hasCritical = false,
}) {
  return <String, dynamic>{
    'counts': <Map<String, dynamic>>[
      if (normal > 0) <String, dynamic>{'level': 'NORMAL', 'count': normal},
      if (attention > 0)
        <String, dynamic>{'level': 'ATTENTION', 'count': attention},
      if (critical > 0)
        <String, dynamic>{'level': 'CRITICAL', 'count': critical},
    ],
    'unassessedCount': unassessed,
    'hasCritical': hasCritical,
    'lastAssessedAt': '2026-07-20T04:12:00.000Z',
  };
}

BuildingModel buildingFixture({
  String id = '6b0000000000000000000001',
  String name = 'Төв цамхаг',
  String code = 'MAIN',
  bool hasCritical = false,
  int critical = 0,
}) {
  return BuildingModel.fromJson(<String, dynamic>{
    'id': id,
    'code': code,
    'name': name,
    'projectId': '6c0000000000000000000001',
    'projectName': 'Урьдчилан сэргийлэх үйлчилгээ',
    'customerId': testScope.customerId,
    'address': 'Сүхбаатар дүүрэг, Улаанбаатар',
    'gpsLatitude': null,
    'gpsLongitude': null,
    'description': null,
    'isActive': true,
    'floorCount': 8,
    'objectCount': 312,
    'riskSummary': riskSummaryJson(
      critical: critical,
      hasCritical: hasCritical,
    ),
    'createdAt': '2026-01-04T00:00:00.000Z',
    'updatedAt': '2026-07-20T04:12:00.000Z',
    'deleteBlockers': <String>[],
  });
}

FloorModel floorFixture({
  String id = '6d0000000000000000000002',
  String name = '2-р давхар',
  int? floorNumber = 2,
  bool hasPlanImage = true,
}) {
  return FloorModel.fromJson(<String, dynamic>{
    'id': id,
    'code': 'F2',
    'name': name,
    // The backend sends an empty string, not null, when a relation is missing;
    // the fixture keeps a real id so the normalisation is exercised elsewhere.
    'buildingId': '6b0000000000000000000001',
    'buildingName': 'Төв цамхаг',
    'projectId': '6c0000000000000000000001',
    'projectName': null,
    'customerId': testScope.customerId,
    'floorNumber': floorNumber,
    'areaSqm': 640.5,
    'purpose': 'Лобби, оффис',
    'description': null,
    'isActive': true,
    'hasPlanImage': hasPlanImage,
    'objectCount': 46,
    'riskSummary': riskSummaryJson(normal: 40, attention: 4, critical: 2,
        unassessed: 0, hasCritical: true),
    'createdAt': '2026-01-04T00:00:00.000Z',
    'updatedAt': '2026-07-20T04:12:00.000Z',
    'deleteBlockers': <String>[],
  });
}

ObjectDetailModel objectFixture({
  String id = '6e0000000000000000000003',
  String name = 'LDB-2F-02',
  int? score = 38,
  String? riskLevel = 'CRITICAL',
}) {
  return ObjectDetailModel.fromJson(<String, dynamic>{
    'id': id,
    'code': 'LDB-2F-02',
    'name': name,
    'category': 'PANEL',
    'objectType': <String, dynamic>{
      'id': '6f0000000000000000000004',
      'code': 'SUBPANEL',
      'name': 'Дэд самбар',
      'icon': 'PANEL',
    },
    'customerId': testScope.customerId,
    'customerName': 'Central Tower ХХК',
    'floorId': '6d0000000000000000000002',
    'floorName': '2-р давхар',
    'buildingName': 'Төв цамхаг',
    'status': 'ACTIVE',
    'latestAssessment': score == null
        ? null
        : <String, dynamic>{
            'id': '700000000000000000000005',
            'score': score,
            'riskLevel': riskLevel,
            'assessedAt': '2026-07-20T04:12:00.000Z',
            'assessedByName': 'Б. Энхтөр',
            'conclusion': 'Таслуур хэт халалттай байна.',
            'recommendation': 'Холбогч хэсгийг яаралтай шалгаж, ачааллыг салгана.',
            'repairRequired': true,
            'revisitRequired': false,
            'revisitDate': null,
          },
    'calculatedLoad': <String, dynamic>{
      'valueKw': 52.4,
      'complete': true,
      'reasons': <String>[],
    },
    'measuredLoadKw': 55.1,
    'loadVariance': <String, dynamic>{
      'valueKw': 2.7,
      'complete': true,
      'reasons': <String>[],
    },
    'createdAt': '2026-01-04T00:00:00.000Z',
    'description': null,
    'notes': null,
    'updatedAt': '2026-07-20T04:12:00.000Z',
    'photos': <Map<String, dynamic>>[],
    'panel': <String, dynamic>{
      'capacityKw': 60.0,
      'location': 'Коридор B',
      'protection': 'MCCB 100A',
    },
    'circuit': null,
    'equipment': null,
    'childCircuits': <Map<String, dynamic>>[],
    'childEquipment': <Map<String, dynamic>>[],
    'loadPercent': <String, dynamic>{
      'valueKw': 96.0,
      'complete': true,
      'reasons': <String>[],
    },
    'reserveKw': <String, dynamic>{
      'valueKw': null,
      'complete': false,
      'reasons': <String>['MISSING_CAPACITY'],
    },
    'canAssess': true,
    'deleteBlockers': <String>[],
  });
}

ObjectHistoryModel objectHistoryFixture() {
  return ObjectHistoryModel.fromJson(<String, dynamic>{
    'assessments': <Map<String, dynamic>>[],
    'timeline': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': '750000000000000000000011',
        'kind': 'ASSESSMENT',
        'occurredAt': '2026-07-20T04:12:00.000Z',
        'title': 'Үнэлгээ бүртгэгдлээ',
        'detail': null,
        'actorName': 'Б. Энхтөр',
        'previousScore': null,
        'newScore': 38,
        'riskLevel': 'CRITICAL',
        'linkPath': null,
      },
    ],
  });
}

ServiceRequestDetailModel serviceRequestFixture({
  String id = '710000000000000000000006',
  String requestNumber = 'SR-202607-0012',
  String status = 'ASSIGNED',
  bool isUrgent = true,
}) {
  return ServiceRequestDetailModel.fromJson(<String, dynamic>{
    'id': id,
    'requestNumber': requestNumber,
    'customer': <String, dynamic>{
      'id': testScope.customerId,
      'name': 'Central Tower ХХК',
    },
    'project': <String, dynamic>{
      'id': '6c0000000000000000000001',
      'name': 'Урьдчилан сэргийлэх үйлчилгээ',
    },
    'building': <String, dynamic>{
      'id': '6b0000000000000000000001',
      'name': 'Төв цамхаг',
    },
    'floor': <String, dynamic>{
      'id': '6d0000000000000000000002',
      'name': '2-р давхар',
    },
    'room': null,
    'device': <String, dynamic>{
      'id': '6e0000000000000000000003',
      'name': 'LDB-2F-02',
    },
    'requestType': 'URGENT_CALL',
    'isUrgent': isUrgent,
    'status': status,
    'assignedEmployees': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': '720000000000000000000007',
        'employeeCode': 'EMP-014',
        'firstName': 'Энхтөр',
        'lastName': 'Батбаяр',
        'photoUrl': null,
      },
    ],
    'assignedTeam': null,
    'createdAt': '2026-07-27T01:34:00.000Z',
    'slaDueAt': '2026-07-27T07:34:00.000Z',
    'slaState': 'NEAR_BREACH',
    'slaRemainingMinutes': 95,
    'panel': null,
    'circuit': null,
    'branch': null,
    'description': 'Хэт ачаалал илэрсэн, таслуур солих шаардлагатай.',
    'contactName': 'Д. Оюунчимэг',
    'contactPhone': '9911-2233',
    'attachments': <Map<String, dynamic>>[],
    'statusHistory': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': '730000000000000000000008',
        'fromStatus': 'NEW',
        'toStatus': 'ASSIGNED',
        'reason': null,
        'changedByName': 'Диспетчер',
        'changedAt': '2026-07-27T02:10:00.000Z',
      },
      <String, dynamic>{
        'id': '730000000000000000000009',
        'fromStatus': null,
        'toStatus': 'NEW',
        'reason': null,
        'changedByName': 'Д. Оюунчимэг',
        'changedAt': '2026-07-27T01:34:00.000Z',
      },
    ],
    'locationPath': <Map<String, dynamic>>[
      <String, dynamic>{
        'id': '6b0000000000000000000001',
        'kind': 'BUILDING',
        'name': 'Төв цамхаг',
      },
      <String, dynamic>{
        'id': '6d0000000000000000000002',
        'kind': 'FLOOR',
        'name': '2-р давхар',
      },
    ],
    'teamLeaderEmployeeId': null,
    'slaStartedAt': '2026-07-27T01:34:00.000Z',
    'slaExtendedMinutes': 0,
    'slaExtensionReason': null,
    'revisitReason': null,
    'revisitDueAt': null,
    'parentRequestId': null,
    'createdByName': 'Д. Оюунчимэг',
    'updatedAt': '2026-07-27T02:10:00.000Z',
  });
}

NotificationModel notificationFixture({
  String id = '740000000000000000000010',
  bool unread = true,
}) {
  return NotificationModel.fromJson(<String, dynamic>{
    'id': id,
    'event': 'RISK_ASSESSMENT_RAISED',
    'severity': 'CRITICAL',
    'title': 'LDB-2F-02 ноцтой эрсдэлтэй боллоо',
    'body': null,
    'entityType': 'Work',
    'entityId': '710000000000000000000006',
    'linkPath': '/service-requests/710000000000000000000006',
    'readAt': unread ? null : '2026-07-27T03:00:00.000Z',
    'createdAt': '2026-07-27T02:55:00.000Z',
  });
}

/// What `POST /files/service-request-attachments` answers: the stored file, as
/// `ServiceRequestAttachmentDto`. The upload response and the attachment embedded in a
/// request detail are the same shape server-side, so one fixture serves both.
ServiceRequestAttachmentModel attachmentFixture({
  String id = 'aa00000000000000000000a1',
  String name = 'gemtel.png',
}) {
  return ServiceRequestAttachmentModel.fromJson(<String, dynamic>{
    'id': id,
    'name': name,
    'downloadUrl': '/api/v1/files/$id',
    'mimeType': 'image/png',
    'sizeBytes': 2048,
    'uploadedByName': testCustomer.fullName,
    'uploadedAt': '2026-07-27T02:55:00.000Z',
  });
}

// -- Fake repositories -------------------------------------------------------

/// In-memory stand-in for the portal API.
///
/// Failures are opt-in per method so a test can assert the error branch without a
/// second fake.
class FakeCustomerPortalRepository implements CustomerPortalRepository {
  FakeCustomerPortalRepository({
    List<BuildingModel>? buildings,
    List<FloorModel>? floors,
    List<ObjectListItemModel>? objects,
    List<ServiceRequestListItemModel>? requests,
    List<NotificationModel>? notifications,
    ObjectDetailModel? objectDetail,
    ServiceRequestDetailModel? requestDetail,
    this.floorPlan,
    this.objectHistory,
    this.failure,
    this.uploadFailure,
  })  : buildings = buildings ?? <BuildingModel>[buildingFixture()],
        floors = floors ?? <FloorModel>[floorFixture()],
        objects = objects ?? <ObjectListItemModel>[objectFixture()],
        requests =
            requests ?? <ServiceRequestListItemModel>[serviceRequestFixture()],
        notifications = notifications ?? <NotificationModel>[notificationFixture()],
        objectDetail = objectDetail ?? objectFixture(),
        requestDetail = requestDetail ?? serviceRequestFixture();

  final List<BuildingModel> buildings;
  final List<FloorModel> floors;
  final List<ObjectListItemModel> objects;
  final List<ServiceRequestListItemModel> requests;
  final List<NotificationModel> notifications;
  final ObjectDetailModel objectDetail;
  final ServiceRequestDetailModel requestDetail;
  final FloorPlanModel? floorPlan;

  /// The object timeline, for the accounts that are entitled to one.
  ///
  /// Null - the default - means the endpoint refuses, which is what
  /// `GET /objects/:objectId/history` does for a customer: it is staff-only by decision
  /// and accepts no portal key. The fake used to answer success unconditionally, so a
  /// screen that rendered the timeline for every account looked healthy in the suite and
  /// 403'd on every device page in the running app.
  final ObjectHistoryModel? objectHistory;

  /// When set, every read fails with it.
  final Failure? failure;

  /// Records the scopes the screens asked with, so a test can assert that no call
  /// went out without one.
  final List<String> requestedCustomerIds = <String>[];

  /// Object ids a screen asked a timeline for, so a test can assert it never asked.
  final List<String> historyRequestedFor = <String>[];

  /// Bodies passed to [createServiceRequest].
  final List<CreateServiceRequestRequestModel> created =
      <CreateServiceRequestRequestModel>[];

  /// Photos handed to [uploadServiceRequestAttachment], in order. A test asserts on
  /// this to prove the picture went up BEFORE the request was created: the server
  /// needs the file to exist before `attachmentIds` can name it.
  final List<CapturedPhoto> uploadedPhotos = <CapturedPhoto>[];

  /// When set, an attachment upload fails with it while every read still succeeds, so
  /// a test can exercise the upload's own error path without failing the whole screen.
  final Failure? uploadFailure;

  ApiResult<T> _result<T>(T value) {
    final Failure? error = failure;
    if (error != null) return FailureResult<T>(error);
    return Success<T>(value);
  }

  PaginatedData<T> _page<T>(List<T> items) => PaginatedData<T>(
        items: items,
        page: 1,
        limit: 100,
        total: items.length,
        totalPages: 1,
      );

  @override
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects(
    ResolvedCustomerScope scope,
  ) async {
    requestedCustomerIds.add(scope.customerId);
    return _result(_page(<ProjectModel>[]));
  }

  @override
  Future<ApiResult<PaginatedData<BuildingModel>>> listBuildings(
    ResolvedCustomerScope scope, {
    String? projectId,
    String? search,
  }) async {
    requestedCustomerIds.add(scope.customerId);
    return _result(_page(buildings));
  }

  @override
  Future<ApiResult<BuildingModel>> getBuilding(String buildingId) async =>
      _result(buildings.first);

  @override
  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(
          String buildingId) async =>
      _result(_page(floors));

  @override
  Future<ApiResult<FloorModel>> getFloor(String floorId) async =>
      _result(floors.first);

  @override
  Future<ApiResult<FloorPlanModel?>> getFloorPlan(String floorId) async =>
      _result(floorPlan);

  @override
  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listObjects(
    ResolvedCustomerScope scope, {
    String? floorId,
    String? buildingId,
  }) async {
    requestedCustomerIds.add(scope.customerId);
    return _result(_page(objects));
  }

  @override
  Future<ApiResult<ObjectDetailModel>> getObject(String objectId) async =>
      _result(objectDetail);

  @override
  Future<ApiResult<ObjectHistoryModel>> getObjectHistory(String objectId) async {
    historyRequestedFor.add(objectId);
    final ObjectHistoryModel? history = objectHistory;
    if (history == null) {
      return const FailureResult<ObjectHistoryModel>(forbiddenFailure);
    }
    return _result(history);
  }

  @override
  Future<ApiResult<PaginatedData<ServiceRequestListItemModel>>>
      listServiceRequests(
    ResolvedCustomerScope scope, {
    ServiceRequestStatus? status,
    String? buildingId,
    int page = 1,
    int limit = 20,
  }) async {
    requestedCustomerIds.add(scope.customerId);
    return _result(_page(requests));
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel>> getServiceRequest(
          String requestId) async =>
      _result(requestDetail);

  @override
  Future<ApiResult<ServiceRequestAttachmentModel>> uploadServiceRequestAttachment(
    CapturedPhoto photo,
  ) async {
    uploadedPhotos.add(photo);
    final Failure? error = uploadFailure;
    if (error != null) {
      return FailureResult<ServiceRequestAttachmentModel>(error);
    }
    return _result(attachmentFixture(id: 'aa000000000000000000000${uploadedPhotos.length}'));
  }

  @override
  Future<ApiResult<ServiceRequestDetailModel>> createServiceRequest(
    CreateServiceRequestRequestModel request,
  ) async {
    created.add(request);
    return _result(requestDetail);
  }

  @override
  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications({
    bool unreadOnly = false,
  }) async =>
      _result(_page(notifications));

  @override
  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount() async =>
      _result(NotificationUnreadCountModel(
        unread: notifications.where((NotificationModel n) => n.isUnread).length,
      ));

  @override
  Future<ApiResult<NotificationModel>> markNotificationRead(
          String notificationId) async =>
      _result(notifications.first);

  @override
  Future<ApiResult<void>> markAllNotificationsRead() async =>
      _result<void>(null);

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) async =>
      _result(Uint8List(0));
}

/// Keeps [AuthController] off the secure-storage plugin, which has no
/// implementation under `flutter test`.
class FakeAuthRepository implements AuthRepository {
  FakeAuthRepository(this.user);

  final AppUser user;

  @override
  Future<ApiResult<AppUser>> login({
    required String email,
    required String password,
  }) async =>
      Success<AppUser>(user);

  @override
  Future<ApiResult<AppUser>> restoreSession() async => Success<AppUser>(user);

  @override
  Future<ApiResult<AppUser>> currentUser() async => Success<AppUser>(user);

  @override
  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async =>
      const Success<void>(null);

  @override
  Future<ApiResult<void>> logout() async => const Success<void>(null);
}

// -- Harness -----------------------------------------------------------------

/// Wraps a screen in the overrides every customer-portal test needs.
///
/// The signed-in account is the only thing injected. [customerScopeProvider] is
/// deliberately NOT overridden here, so every screen test runs through the real
/// resolution path: a test asks for the blocked state by passing an account with no
/// `customerId` ([unlinkedCustomer]), exactly as the server would report one, rather
/// than by handing the app a scope it has no way of being handed in production.
Widget wrapCustomerScreen(
  Widget child, {
  required FakeCustomerPortalRepository repository,
  AppUser? user,
  List<Override> overrides = const <Override>[],
}) {
  final AppUser account = user ?? testCustomer;

  return ProviderScope(
    overrides: <Override>[
      customerPortalRepositoryProvider.overrideWithValue(repository),
      currentUserProvider.overrideWithValue(account),
      authRepositoryProvider.overrideWithValue(FakeAuthRepository(account)),
      // Last, so a test can replace one of the above for the case it is about.
      ...overrides,
    ],
    child: MaterialApp(theme: AppTheme.light, home: child),
  );
}
