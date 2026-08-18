import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../../core/network/dio_client.dart';
import '../../../../core/push/push_messaging.dart';
import '../../../../core/push/push_registration.dart';
import '../../../../core/storage/secure_token_storage.dart';
import '../../data/datasources/auth_local_data_source.dart';
import '../../data/datasources/auth_remote_data_source.dart';
import '../../data/repositories/auth_repository_impl.dart';
import '../../domain/entities/app_user.dart';
import '../../domain/repositories/auth_repository.dart';

// -- Dependency graph --------------------------------------------------------

final Provider<SecureTokenStorage> secureTokenStorageProvider =
    Provider<SecureTokenStorage>((Ref ref) => SecureTokenStorage());

final Provider<DioClient> dioClientProvider = Provider<DioClient>((Ref ref) {
  final DioClient client = DioClient(
    tokenStorage: ref.watch(secureTokenStorageProvider),
  );
  // A terminal refresh failure signs the user out of the UI, not just the transport.
  client.onSessionExpired = () {
    ref.read(authControllerProvider.notifier).handleSessionExpired();
  };
  return client;
});

final Provider<AuthRepository> authRepositoryProvider = Provider<AuthRepository>((Ref ref) {
  return AuthRepositoryImpl(
    remote: AuthRemoteDataSource(ref.watch(dioClientProvider)),
    local: AuthLocalDataSource(ref.watch(secureTokenStorageProvider)),
  );
});

// -- State -------------------------------------------------------------------

enum AuthStatus {
  /// Cold start; the session restore has not settled yet.
  initialising,
  unauthenticated,

  /// Signed in, but holding an admin-issued passcode that must be replaced.
  mustChangePassword,
  authenticated,
}

class AuthState {
  const AuthState({
    this.status = AuthStatus.initialising,
    this.user,
    this.failure,
    this.busy = false,
  });

  final AuthStatus status;
  final AppUser? user;
  final Failure? failure;

  /// True while a login, logout or password change is in flight.
  final bool busy;

  bool get isAuthenticated => status == AuthStatus.authenticated;

  AuthState copyWith({
    AuthStatus? status,
    AppUser? user,
    Failure? failure,
    bool? busy,
    bool clearUser = false,
    bool clearFailure = false,
  }) {
    return AuthState(
      status: status ?? this.status,
      user: clearUser ? null : (user ?? this.user),
      failure: clearFailure ? null : (failure ?? this.failure),
      busy: busy ?? this.busy,
    );
  }
}

// -- Controller --------------------------------------------------------------

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() {
    // Kick off the restore without blocking provider construction.
    Future<void>.microtask(restoreSession);
    return const AuthState();
  }

  AuthRepository get _repository => ref.read(authRepositoryProvider);

  /// Maps a user onto the correct status, so the router has a single source of truth.
  AuthStatus _statusFor(AppUser user) =>
      user.mustChangePassword ? AuthStatus.mustChangePassword : AuthStatus.authenticated;

  /*
   * Push registration hangs off the authenticated transition, not off login().
   *
   * A returning user never calls login() — restoreSession() authenticates them from stored
   * credentials at launch — so hooking only the sign-in form would leave every warm start
   * unregistered, which is the overwhelming majority of launches. Both paths funnel through
   * here instead.
   *
   * Never awaited by the caller and never allowed to throw: a device that cannot register
   * still has a working app, and a push failure must not hold up the first frame.
   */
  void _registerForPush() {
    final PushRegistration registration = PushRegistration(ref.read(dioClientProvider));
    unawaited(
      PushMessaging.start(
        onToken: (String token) => registration.register(token: token),
        onOpen: (String? _) {
          // Routing to the linked entity needs a router this app does not have; the
          // notification list is the reliable destination until it does.
        },
      ),
    );
  }

  Future<void> _unregisterFromPush() async {
    final String? token = await PushMessaging.currentToken();
    if (token != null) {
      await PushRegistration(ref.read(dioClientProvider)).unregister(token: token);
    }
    await PushMessaging.stop();
  }

  Future<void> restoreSession() async {
    final ApiResult<AppUser> result = await _repository.restoreSession();

    state = result.when(
      success: (AppUser user) => AuthState(status: _statusFor(user), user: user),
      failure: (Failure _) => const AuthState(status: AuthStatus.unauthenticated),
    );

    if (state.status == AuthStatus.authenticated) _registerForPush();
  }

  Future<bool> login({required String email, required String password}) async {
    state = state.copyWith(busy: true, clearFailure: true);

    final ApiResult<AppUser> result =
        await _repository.login(email: email, password: password);

    return result.when(
      success: (AppUser user) {
        state = AuthState(status: _statusFor(user), user: user);
        if (state.status == AuthStatus.authenticated) _registerForPush();
        return true;
      },
      failure: (Failure failure) {
        state = const AuthState(status: AuthStatus.unauthenticated)
            .copyWith(failure: failure);
        return false;
      },
    );
  }

  Future<bool> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    state = state.copyWith(busy: true, clearFailure: true);

    final ApiResult<void> result = await _repository.changePassword(
      currentPassword: currentPassword,
      newPassword: newPassword,
    );

    return result.when(
      success: (_) {
        // All sessions were revoked server-side, so the user signs in again.
        state = const AuthState(status: AuthStatus.unauthenticated);
        return true;
      },
      failure: (Failure failure) {
        state = state.copyWith(busy: false, failure: failure);
        return false;
      },
    );
  }

  /// Re-reads GET /auth/me for the signed-in user.
  ///
  /// The login response carries a plain UserDto with no permission list, so a user
  /// who has just signed in holds an empty permission set until something asks the
  /// server again. Screens that gate a control on a permission call this once on
  /// mount rather than presenting the control on stale information.
  ///
  /// A failure is deliberately swallowed: this is a refinement of state the app
  /// already has, and losing the session over it would be a worse outcome than
  /// briefly hiding an action.
  Future<void> refreshCurrentUser() async {
    if (state.status != AuthStatus.authenticated) return;

    final ApiResult<AppUser> result = await _repository.currentUser();
    result.when(
      success: (AppUser user) {
        state = state.copyWith(status: _statusFor(user), user: user);
      },
      failure: (Failure _) {},
    );
  }

  Future<void> logout() async {
    state = state.copyWith(busy: true);
    // Before the session is torn down, while the token still authenticates the call.
    await _unregisterFromPush();
    await _repository.logout();
    state = const AuthState(status: AuthStatus.unauthenticated);
  }

  /// Called by the Dio client when a refresh fails terminally.
  void handleSessionExpired() {
    state = const AuthState(status: AuthStatus.unauthenticated).copyWith(
      failure: const AuthFailure(
        'Сессийн хугацаа дууссан. Дахин нэвтэрнэ үү.',
        code: 'REFRESH_TOKEN_INVALID',
      ),
    );
  }

  void clearFailure() {
    state = state.copyWith(clearFailure: true, busy: false);
  }
}

final NotifierProvider<AuthController, AuthState> authControllerProvider =
    NotifierProvider<AuthController, AuthState>(AuthController.new);

/// Convenience selector for widgets that only need the signed-in user.
final Provider<AppUser?> currentUserProvider = Provider<AppUser?>(
  (Ref ref) => ref.watch(authControllerProvider).user,
);
