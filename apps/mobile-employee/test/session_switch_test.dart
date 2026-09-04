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
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/work/data/models/work_report_model.dart';
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/conclusion_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';

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

void main() {
  late _HandsetAuthRepository auth;
  late _ReportRepository repository;
  late ProviderContainer container;

  setUp(() {
    auth = _HandsetAuthRepository(_technicianA);
    repository = _ReportRepository();
    container = ProviderContainer(
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(auth),
        workRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
  });

  Future<void> signIn(AppUser account) async {
    auth.user = account;
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
}
