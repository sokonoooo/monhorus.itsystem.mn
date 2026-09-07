// What the app is holding when a second technician signs in on the same handset.
//
// `ProviderScope` sits above `MaterialApp`, so there is ONE container for the life of
// the process, and Riverpod keeps a completed value long after the last listener has
// gone. Signing out unmounts the shell; it does not clear the container. Anything that
// does not watch the session is therefore served to the next person out of the
// previous one's cache, with no request made and nothing on screen saying so.
//
// `employeeSelfProvider` watches the user for exactly this reason and says so in its
// own comment. The conclusion editor did not, and it holds the most sensitive thing on
// the handset: an UNSAVED write-up. A shared van phone is the ordinary case here.
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/paginated_data.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/work/data/models/work_report_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/conclusion_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/profile/domain/repositories/profile_repository.dart';
import 'package:monhorus_employee/features/employee/profile/presentation/providers/profile_providers.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/project/domain/repositories/project_repository.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';

const String _requestId = 'r1';
const ConclusionRef _editor = (requestId: _requestId, buildingId: 'b1');

const AppUser _technicianA = AppUser(
  id: '6a6a1dc9cf308958351efe23',
  fullName: 'Пүрэв Сараа',
  email: 'p.saraa@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'service_request.view', 'service_request.update'},
);

const AppUser _technicianB = AppUser(
  id: '6a6a1dc9cf308958351efe19',
  fullName: 'Доржийн Ганболд',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'service_request.view', 'service_request.update'},
);

/// The saved report the server answers with: a draft nobody has written anything into.
Map<String, dynamic> _savedReport() => <String, dynamic>{
      'id': 'rep1',
      'serviceRequestId': _requestId,
      'status': 'DRAFT',
      'score': null,
      'conclusion': null,
      'recommendation': null,
      'beforePhotos': <Map<String, dynamic>>[],
      'afterPhotos': <Map<String, dynamic>>[],
      'objects': <Map<String, dynamic>>[],
      'objectAssessments': <Map<String, dynamic>>[],
      'missing': <String>['SCORE', 'CONCLUSION', 'RECOMMENDATION'],
      'isComplete': false,
      'actionTaken': null,
    };

class _ReportRepository implements WorkRepository {
  int reads = 0;

  @override
  Future<ApiResult<WorkReportModel>> getWorkReport(String requestId) async {
    reads += 1;
    return Success<WorkReportModel>(WorkReportModel.fromJson(_savedReport()));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// Stands in for the whole auth stack, so the real [AuthController] drives the
/// transitions. Nothing overrides [currentUserProvider] — following the session is the
/// behaviour under test.
class _HandsetAuthRepository implements AuthRepository {
  _HandsetAuthRepository(this.user);

  AppUser? user;

  @override
  Future<ApiResult<AppUser>> login({
    required String email,
    required String password,
  }) async {
    final AppUser? account = user;
    if (account == null) {
      return const FailureResult<AppUser>(
        AuthFailure('Нэвтрэх мэдээлэл буруу байна.', code: 'INVALID_CREDENTIALS'),
      );
    }
    return Success<AppUser>(account);
  }

  @override
  Future<ApiResult<AppUser>> restoreSession() async {
    final AppUser? account = user;
    if (account == null) {
      return const FailureResult<AppUser>(
        AuthFailure('Сесс олдсонгүй.', code: 'NO_SESSION'),
      );
    }
    return Success<AppUser>(account);
  }

  @override
  Future<ApiResult<AppUser>> currentUser() async => login(email: '', password: '');

  @override
  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async =>
      const Success<void>(null);

  @override
  Future<ApiResult<void>> logout() async => const Success<void>(null);
}

/// The Төсөл tab's server, answering with whatever the CURRENT account may see.
///
/// Every reply is stamped with [owner], so a value that reaches the wrong technician is
/// visible in the assertion rather than inferred from a call count alone. The counters
/// are the other half of the same question: whether the app asked at all.
class _ProjectServer implements ProjectRepository {
  /// Which technician the server would be answering right now — 'А' or 'Б'.
  String owner = 'А';

  int projectReads = 0;
  int floorReads = 0;
  int equipmentReads = 0;
  int fileReads = 0;

  @override
  Future<ApiResult<PaginatedData<ProjectModel>>> listProjects({String? search}) async {
    projectReads += 1;
    return Success<PaginatedData<ProjectModel>>(
      PaginatedData<ProjectModel>(
        items: <ProjectModel>[
          ProjectModel.fromJson(<String, dynamic>{
            'id': 'project-$owner',
            'name': 'Төсөл $owner',
          }),
        ],
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<PaginatedData<FloorModel>>> listFloors(String buildingId) async {
    floorReads += 1;
    return Success<PaginatedData<FloorModel>>(
      PaginatedData<FloorModel>(
        items: <FloorModel>[
          FloorModel.fromJson(<String, dynamic>{'id': 'floor-$owner', 'name': 'Давхар $owner'}),
        ],
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<PaginatedData<ObjectListItemModel>>> listFloorObjects(
    String floorId, {
    int page = 1,
  }) async {
    equipmentReads += 1;
    return Success<PaginatedData<ObjectListItemModel>>(
      PaginatedData<ObjectListItemModel>(
        items: <ObjectListItemModel>[
          ObjectListItemModel.fromJson(<String, dynamic>{
            'id': 'object-$owner',
            'code': 'EQ-$owner',
            'name': 'Тоноглол $owner',
          }),
        ],
        page: 1,
        limit: 100,
        total: 1,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) async {
    fileReads += 1;
    // The same fileId deliberately answers differently per account: that is what a
    // tenant-scoped file route does, and it is the case the family cache erases.
    return Success<Uint8List>(Uint8List.fromList(utf8.encode('plan-$owner')));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// `GET /files/:fileId` for the Профайл tab's employee photo.
class _PhotoServer implements ProfileRepository {
  String owner = 'А';
  int reads = 0;

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) async {
    reads += 1;
    return Success<Uint8List>(Uint8List.fromList(utf8.encode('photo-$owner')));
  }
}

void main() {
  late _HandsetAuthRepository auth;
  late _ReportRepository repository;
  late _ProjectServer projects;
  late _PhotoServer photos;
  late ProviderContainer container;

  setUp(() {
    auth = _HandsetAuthRepository(_technicianA);
    repository = _ReportRepository();
    projects = _ProjectServer();
    photos = _PhotoServer();
    container = ProviderContainer(
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(auth),
        workRepositoryProvider.overrideWithValue(repository),
        projectRepositoryProvider.overrideWithValue(projects),
        profileRepositoryProvider.overrideWithValue(photos),
      ],
    );
    addTearDown(container.dispose);
  });

  Future<void> signIn(AppUser account) async {
    auth.user = account;
    // The server starts answering as this account would be answered.
    final String owner = account == _technicianA ? 'А' : 'Б';
    projects.owner = owner;
    photos.owner = owner;
    final bool ok = await container
        .read(authControllerProvider.notifier)
        .login(email: account.email, password: 'passcode');
    expect(ok, isTrue);
  }

  Future<void> signOut() async {
    await container.read(authControllerProvider.notifier).logout();
    auth.user = null;
  }

  test("a second technician does not inherit the first one's unsaved conclusion",
      () async {
    await signIn(_technicianA);
    await container.read(conclusionEditorProvider(_editor).future);
    container.read(conclusionEditorProvider(_editor).notifier)
      ..setScore('41')
      ..setConclusion('Гал хамгаалагч шатсан, түр залгав.')
      ..setRecommendation('Самбарыг бүтнээр нь солих шаардлагатай.');

    await signOut();
    await signIn(_technicianB);

    final ConclusionEditorState forB =
        await container.read(conclusionEditorProvider(_editor).future);
    // B is authoring their own visit. A's half-written finding — which A never saved,
    // and which names what A saw — must not be sitting in B's boxes ready to be sent
    // under B's name.
    expect(forB.conclusion, isEmpty);
    expect(forB.recommendation, isEmpty);
    expect(forB.score, isEmpty);
    // Re-read from the server rather than answered out of the cache.
    expect(repository.reads, 2);
  });

  test('the same technician keeps their draft across a screen they left', () async {
    await signIn(_technicianA);
    await container.read(conclusionEditorProvider(_editor).future);
    container
        .read(conclusionEditorProvider(_editor).notifier)
        .setConclusion('Үргэлжлүүлж бичнэ.');

    // `/auth/me` lands on every mount and produces a NEW AppUser with the same id.
    // Keyed on the object rather than the id, that alone would discard the draft —
    // which is the very data loss this file is about, arriving from the other side.
    await container.read(authControllerProvider.notifier).refreshCurrentUser();

    final ConclusionEditorState still =
        await container.read(conclusionEditorProvider(_editor).future);
    expect(still.conclusion, 'Үргэлжлүүлж бичнэ.');
    expect(repository.reads, 1);
  });

  // -- Төсөл tab -------------------------------------------------------------
  //
  // Every read on this tab goes through one [projectRepositoryProvider], and none of
  // the ~15 futures hanging off it is `autoDispose`. Without a key on the session the
  // container hands the next technician the previous one's project list, floor plan
  // bytes and floor reports, with no request made and nothing on screen saying so.

  test("a second technician is not served the first one's project list", () async {
    await signIn(_technicianA);
    final ProjectListView forA = await container.read(employeeProjectsProvider.future);
    expect(forA.projects.single.name, 'Төсөл А');
    expect(projects.projectReads, 1);

    await signOut();
    await signIn(_technicianB);

    final ProjectListView forB = await container.read(employeeProjectsProvider.future);
    // What B sees is B's catalogue, and it arrived because the app asked for it.
    expect(forB.projects.single.name, 'Төсөл Б');
    expect(projects.projectReads, 2);
  });

  test("a second technician is not served the first one's floor plan bytes", () async {
    const String fileId = 'plan-file-1';

    await signIn(_technicianA);
    expect(
      utf8.decode(await container.read(projectFileBytesProvider(fileId).future)),
      'plan-А',
    );
    expect(projects.fileReads, 1);

    await signOut();
    await signIn(_technicianB);

    // Same fileId, so the family key is unchanged — the cache is keyed on the file, not
    // on who may read it. B must still get an answer fetched under B's session.
    expect(
      utf8.decode(await container.read(projectFileBytesProvider(fileId).future)),
      'plan-Б',
    );
    expect(projects.fileReads, 2);
  });

  test("a second technician is not served the first one's equipment-picker floors",
      () async {
    await signIn(_technicianA);
    List<FloorModel> floors = await container.read(conclusionFloorsProvider('b1').future);
    expect(floors.single.id, 'floor-А');
    expect(projects.floorReads, 1);

    await signOut();
    await signIn(_technicianB);

    floors = await container.read(conclusionFloorsProvider('b1').future);
    expect(floors.single.id, 'floor-Б');
    expect(projects.floorReads, 2);
  });

  test("a second technician is not served the first one's employee photo", () async {
    const String fileId = 'photo-file-1';

    await signIn(_technicianA);
    expect(
      utf8.decode(await container.read(employeePhotoProvider(fileId).future)),
      'photo-А',
    );
    expect(photos.reads, 1);

    await signOut();
    await signIn(_technicianB);

    expect(
      utf8.decode(await container.read(employeePhotoProvider(fileId).future)),
      'photo-Б',
    );
    expect(photos.reads, 2);
  });

  test("a second technician is not served the first one's equipment picker", () async {
    await signIn(_technicianA);
    List<ObjectListItemModel> equipment =
        await container.read(conclusionEquipmentProvider('floor-1').future);
    expect(equipment.single.code, 'EQ-А');
    expect(projects.equipmentReads, 1);

    await signOut();
    await signIn(_technicianB);

    equipment = await container.read(conclusionEquipmentProvider('floor-1').future);
    // This is the list a finding gets recorded against, and two technicians genuinely
    // share a floorId. Offering B the devices resolved under A's session is how a
    // conclusion ends up filed against equipment B was never shown.
    expect(equipment.single.code, 'EQ-Б');
    expect(projects.equipmentReads, 2);
  });

  test('the project list is still cached within one session', () async {
    await signIn(_technicianA);
    await container.read(employeeProjectsProvider.future);
    await container.read(employeeProjectsProvider.future);

    // `/auth/me` lands on mount and answers with a NEW AppUser carrying the same id.
    // Keyed on the object rather than the id, that alone would refetch the catalogue on
    // every screen mount — a fix that trades a leak for a stutter.
    await container.read(authControllerProvider.notifier).refreshCurrentUser();
    await container.read(employeeProjectsProvider.future);

    expect(projects.projectReads, 1);
  });
}
