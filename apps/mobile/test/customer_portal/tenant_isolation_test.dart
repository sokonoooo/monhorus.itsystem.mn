// What the portal serves after a second person signs in on the same handset.
//
// `ProviderScope` sits above `MaterialApp`, so there is ONE container for the life of
// the process, and Riverpod keeps a completed value long after the last listener has
// gone. A provider that depends only on the Dio client - which never rebuilds - is
// therefore answered out of the previous account's cache, with no request made and
// nothing on screen saying so.
//
// `/notifications`, `/notifications/unread-count` and `/surveys/pending` are scoped by
// the bearer token rather than by a customer id in the URL, so nothing in the call
// itself ties the answer to an account. The fake below is scoped the way the server is:
// it answers for whoever is signed in at the moment it is asked. That is what makes a
// stale answer visible here - the wrong data could only have come from the cache.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/core/network/api_result.dart';
import 'package:monhorus_mobile/core/network/paginated_data.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_mobile/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_mobile/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/notification_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/survey_model.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';

import 'fakes.dart';

/// Two customers who share a handset. Different organisations, different accounts:
/// the case `device-token.model.ts` names when it explains why a registration row is
/// re-attributed on sign-in rather than kept.
const AppUser _customerA = AppUser(
  id: '5f1b0c2a11b34f68bfc4000a',
  fullName: 'Д. Оюунчимэг',
  email: 'oyun@centraltower.mn',
  phone: '9911-2233',
  role: UserRole.customer,
  status: AccountStatus.active,
  customerId: '6a67013e11b34f68bfc4037f',
  customerName: 'Central Tower ХХК',
  permissions: <String>{PermissionKeys.portalSurveySubmit},
);

const AppUser _customerB = AppUser(
  id: '5f1b0c2a11b34f68bfc4000b',
  fullName: 'Б. Тэмүүлэн',
  email: 'temuulen@sokobuild.mn',
  phone: '9955-6677',
  role: UserRole.customer,
  status: AccountStatus.active,
  customerId: '6a67013e11b34f68bfc40380',
  customerName: 'Соко Билд ХХК',
  permissions: <String>{PermissionKeys.portalSurveySubmit},
);

NotificationModel _notification(String title) =>
    NotificationModel.fromJson(<String, dynamic>{
      'id': '74000000000000000000${title.hashCode.abs() % 10000}',
      'event': 'RISK_ASSESSMENT_RAISED',
      'severity': 'CRITICAL',
      'title': title,
      'body': null,
      'entityType': 'Work',
      'entityId': '710000000000000000000006',
      'linkPath': null,
      'readAt': null,
      'createdAt': '2026-07-27T02:55:00.000Z',
    });

SurveyPendingItemModel _pending(String requestNumber, String buildingName) =>
    SurveyPendingItemModel.fromJson(<String, dynamic>{
      'serviceRequestId': '710000000000000000000006',
      'requestNumber': requestNumber,
      'buildingName': buildingName,
      'completedAt': '2026-07-28T02:15:00.000Z',
      'employees': <Map<String, dynamic>>[surveyEmployeeJson()],
    });

/// A portal repository scoped the way the token-scoped endpoints are: every answer is
/// about whoever is signed in when the call is made.
class _PerAccountRepository extends FakeCustomerPortalRepository {
  _PerAccountRepository(this.signedInAs);

  AppUser signedInAs;

  /// How many times each token-scoped endpoint was actually called, so a test can tell
  /// a fresh read from a cached one.
  int notificationReads = 0;
  int unreadReads = 0;
  int pendingSurveyReads = 0;

  bool get _isA => signedInAs.id == _customerA.id;

  @override
  Future<ApiResult<PaginatedData<NotificationModel>>> listNotifications({
    bool unreadOnly = false,
  }) async {
    notificationReads++;
    final List<NotificationModel> items = _isA
        ? <NotificationModel>[_notification('Central Tower: LDB-2F-02 ноцтой эрсдэлтэй')]
        : <NotificationModel>[_notification('Соко Билд: DB-1A-01 хэвийн болов')];
    return Success<PaginatedData<NotificationModel>>(
      PaginatedData<NotificationModel>(
        items: items,
        page: 1,
        limit: 100,
        total: items.length,
        totalPages: 1,
      ),
    );
  }

  @override
  Future<ApiResult<NotificationUnreadCountModel>> getUnreadCount() async {
    unreadReads++;
    return Success<NotificationUnreadCountModel>(
      NotificationUnreadCountModel(unread: _isA ? 7 : 0),
    );
  }

  @override
  Future<ApiResult<List<SurveyPendingItemModel>>> listPendingSurveys() async {
    pendingSurveyReads++;
    return Success<List<SurveyPendingItemModel>>(
      _isA
          ? <SurveyPendingItemModel>[_pending('SR-202607-0012', 'Төв цамхаг')]
          : const <SurveyPendingItemModel>[],
    );
  }
}

/// Stands in for the whole auth stack, so the real [AuthController] drives the
/// transitions: a sign-out and a sign-in as somebody else, exactly as the app does
/// them. Nothing here overrides [currentUserProvider] — the point is that the portal
/// follows the session on its own.
class _HandsetAuthRepository implements AuthRepository {
  _HandsetAuthRepository(this.user);

  /// Whoever is at the keyboard. Null once nobody is signed in.
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
  late _PerAccountRepository repository;
  late ProviderContainer container;

  setUp(() {
    auth = _HandsetAuthRepository(_customerA);
    repository = _PerAccountRepository(_customerA);
    container = ProviderContainer(
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(auth),
        customerPortalRepositoryProvider.overrideWithValue(repository),
      ],
    );
    addTearDown(container.dispose);
  });

  /// Signs [account] in through the real controller, the way the login screen does.
  Future<void> signIn(AppUser account) async {
    auth.user = account;
    repository.signedInAs = account;
    final bool ok = await container
        .read(authControllerProvider.notifier)
        .login(email: account.email, password: 'passcode');
    expect(ok, isTrue);
  }

  Future<void> signOut() async {
    await container.read(authControllerProvider.notifier).logout();
    auth.user = null;
  }

  test('a second customer is not served the first one\'s notifications', () async {
    await signIn(_customerA);
    final List<NotificationModel> forA =
        await container.read(customerNotificationsProvider.future);
    expect(forA.single.title, contains('Central Tower'));

    await signOut();
    await signIn(_customerB);

    final List<NotificationModel> forB =
        await container.read(customerNotificationsProvider.future);
    // The building names in A's list are A's, and B has no business reading them.
    expect(forB.single.title, contains('Соко Билд'));
    expect(repository.notificationReads, 2);
  });

  test('a second customer is not served the first one\'s unread badge', () async {
    await signIn(_customerA);
    expect(await container.read(unreadNotificationCountProvider.future), 7);

    await signOut();
    await signIn(_customerB);

    expect(await container.read(unreadNotificationCountProvider.future), 0);
    expect(repository.unreadReads, 2);
  });

  test('a second customer is not prompted to rate the first one\'s visit', () async {
    await signIn(_customerA);
    final List<SurveyPendingItemModel> forA =
        await container.read(pendingSurveysProvider.future);
    expect(forA.single.requestNumber, 'SR-202607-0012');

    await signOut();
    await signIn(_customerB);

    // A card naming SR-202607-0012 and Төв цамхаг on B's home screen is a request
    // number and a building B has never heard of.
    expect(await container.read(pendingSurveysProvider.future), isEmpty);
    expect(repository.pendingSurveyReads, 2);
  });

  test('the same account signing in again does not re-read what has not changed',
      () async {
    await signIn(_customerA);
    await container.read(customerNotificationsProvider.future);
    expect(repository.notificationReads, 1);

    // `/auth/me` lands on every mount and produces a NEW AppUser object with the same
    // id. Keyed on the object rather than on the id, that would refetch every list in
    // the portal on every screen mount.
    await container.read(authControllerProvider.notifier).refreshCurrentUser();
    await container.read(customerNotificationsProvider.future);
    expect(repository.notificationReads, 1);
  });
}
