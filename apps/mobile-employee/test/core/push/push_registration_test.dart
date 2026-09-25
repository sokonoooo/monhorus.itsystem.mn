// Whether this install is still registered for push after a session ends badly.
//
// The symptom in production is zero registered customer devices, with nothing logged
// anywhere the server can see. The path: a refresh token expires, an administrator
// resets a passcode, or the password is changed on another device; the app returns to
// the login screen WITHOUT going through `logout()`; the user signs in again — and
// `POST /notifications/devices` is never sent again, because `start()` skipped
// everything on a flag that only `stop()` cleared and only sign-out reached. FCM
// rotates a token on the order of months, so in practice that lasts the life of the
// install and the `DeviceToken` row goes on naming the previous session's user.
//
// The push plugins cannot run under `flutter test` — `Platform.isAndroid` is false and
// `Firebase.initializeApp` throws — so the platform calls are swapped for the fake FCM
// below. Everything above them is the real code: the real `PushMessaging`, the real
// `AuthController`, the real `PushRegistration`, and a Dio client that records the
// request instead of sending it. The assertion is on the CALL, not on a flag.
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/core/network/dio_client.dart';
import 'package:monhorus_employee/core/push/push_messaging.dart';
import 'package:monhorus_employee/core/push/push_registration.dart';
import 'package:monhorus_employee/core/storage/secure_token_storage.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/domain/repositories/auth_repository.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';

const AppUser _technician = AppUser(
  id: '6a6a1dc9cf308958351efe23',
  fullName: 'Пүрэв Сараа',
  email: 'p.saraa@monhorus.mn',
  phone: '8811-9922',
  role: UserRole.technician,
  status: AccountStatus.active,
);

/// FCM as it behaves on a handset: one registration token per install, stable across
/// sign-ins, reissued to whoever asks.
class _FakeFcm {
  String? token = 'fcm-token-1';
  int wirings = 0;
  int tokenReads = 0;

  void install() {
    PushMessaging.supported = () => true;
    PushMessaging.attachPlatform = () async {
      wirings += 1;
      return true;
    };
    PushMessaging.readToken = () async {
      tokenReads += 1;
      return token;
    };
    PushMessaging.tokenRefreshes = () => const Stream<String>.empty();
  }
}

/// Records what would have gone over the wire.
class _RecordingClient extends DioClient {
  _RecordingClient() : super(tokenStorage: SecureTokenStorage(), dio: Dio());

  final List<String> calls = <String>[];
  final List<Object?> bodies = <Object?>[];

  @override
  Future<T> request<T>({
    required String path,
    required String method,
    required T Function(Object? json) decoder,
    Object? data,
    Map<String, dynamic>? queryParameters,
    bool allowRetry = true,
  }) async {
    calls.add('$method $path');
    bodies.add(data);
    return decoder(null);
  }

  List<String> get deviceRegistrations => calls
      .where((String call) => call == 'POST /notifications/devices')
      .toList(growable: false);
}

class _StubAuthRepository implements AuthRepository {
  _StubAuthRepository(this.user);

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

  /// No stored session: the cold start settles as unauthenticated, so every sign-in in
  /// this file is an explicit one through the login screen.
  @override
  Future<ApiResult<AppUser>> restoreSession() async =>
      const FailureResult<AppUser>(AuthFailure('Сесс олдсонгүй.', code: 'NO_SESSION'));

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
  late _FakeFcm fcm;
  late _RecordingClient client;
  late ProviderContainer container;

  setUp(() {
    fcm = _FakeFcm()..install();
    client = _RecordingClient();
    container = ProviderContainer(
      overrides: <Override>[
        dioClientProvider.overrideWithValue(client),
        authRepositoryProvider.overrideWithValue(_StubAuthRepository(_technician)),
      ],
    );
    addTearDown(container.dispose);
    addTearDown(PushMessaging.debugReset);
  });

  /// Signs in and lets the fire-and-forget registration finish. `_registerForPush` is
  /// deliberately never awaited by the app — a push failure must not hold up the first
  /// frame — so the test waits for the microtasks it left behind.
  Future<void> signIn() async {
    await container
        .read(authControllerProvider.notifier)
        .login(email: _technician.email, password: 'passcode');
    await pumpEventQueue();
  }

  test('signing in registers this device', () async {
    await signIn();

    expect(client.deviceRegistrations, hasLength(1));
    expect(client.bodies.last, containsPair('token', 'fcm-token-1'));
    // The employee install registers under its own application id, so a person who is
    // both a customer and a technician keeps two rows rather than overwriting one.
    expect(client.bodies.last, containsPair('appId', PushRegistration.appId));
  });

  test('a re-login after a session expiry registers the device again', () async {
    await signIn();
    expect(client.deviceRegistrations, hasLength(1));

    // The refresh token expired, or an administrator reset the passcode. The Dio client
    // calls this; there is no logout, and the shell is replaced by the login screen.
    container.read(authControllerProvider.notifier).handleSessionExpired();
    await pumpEventQueue();

    await signIn();

    // Was one: the row went on naming the previous session's user, and nothing said so.
    expect(client.deviceRegistrations, hasLength(2));
    expect(fcm.tokenReads, 2);
    // The plugins are wired up once per process, not once per sign-in.
    expect(fcm.wirings, 1);
  });

  test('a re-login after a password change registers the device again', () async {
    await signIn();
    expect(client.deviceRegistrations, hasLength(1));

    // Every session was revoked server-side, so this too ends at the login screen
    // without passing through logout().
    await container.read(authControllerProvider.notifier).changePassword(
          currentPassword: 'old-passcode',
          newPassword: 'new-passcode',
        );
    await pumpEventQueue();

    await signIn();

    expect(client.deviceRegistrations, hasLength(2));
  });

  test('a sign-out unregisters, and the next sign-in registers again', () async {
    await signIn();

    await container.read(authControllerProvider.notifier).logout();
    await pumpEventQueue();
    expect(
      client.calls,
      contains('POST /notifications/devices/unregister'),
    );

    await signIn();
    expect(client.deviceRegistrations, hasLength(2));
  });

  test('an install FCM issues no token for is reported as unregistered', () async {
    fcm.token = null;

    final bool registered = await PushMessaging.start(
      onToken: (String _) async {},
      onOpen: (String? _) {},
    );

    // False rather than true-with-nothing-sent: a registration that never happened must
    // not be indistinguishable from one that succeeded.
    expect(registered, isFalse);
  });
}
