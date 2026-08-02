import '../../../../core/error/exceptions.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../domain/entities/app_user.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_local_data_source.dart';
import '../datasources/auth_remote_data_source.dart';
import '../models/auth_session_model.dart';
import '../models/user_model.dart';

class AuthRepositoryImpl implements AuthRepository {
  const AuthRepositoryImpl({
    required AuthRemoteDataSource remote,
    required AuthLocalDataSource local,
  })  : _remote = remote,
        _local = local;

  final AuthRemoteDataSource _remote;
  final AuthLocalDataSource _local;

  /// Single translation point from data-layer exceptions to domain failures.
  Failure _mapException(Object error) {
    if (error is ServerException) {
      const Set<String> authCodes = <String>{
        'INVALID_CREDENTIALS',
        'ACCOUNT_LOCKED',
        'ACCOUNT_SUSPENDED',
        'UNAUTHENTICATED',
        'TOKEN_EXPIRED',
        'TOKEN_INVALID',
        'REFRESH_TOKEN_INVALID',
        'PASSWORD_CHANGE_REQUIRED',
      };
      if (authCodes.contains(error.code)) {
        return AuthFailure(error.message, code: error.code);
      }
      return ServerFailure(
        error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      );
    }
    if (error is NetworkException) {
      return NetworkFailure(error.message);
    }
    if (error is CacheException) {
      return CacheFailure(error.message);
    }
    return const ServerFailure('Гэнэтийн алдаа гарлаа.', code: 'UNKNOWN');
  }

  @override
  Future<ApiResult<AppUser>> login({
    required String email,
    required String password,
  }) async {
    try {
      final AuthSessionModel session =
          await _remote.login(email: email, password: password);

      await _local.saveSession(
        accessToken: session.tokens.accessToken,
        refreshToken: session.tokens.refreshToken,
        user: session.user,
      );

      return Success<AppUser>(session.user);
    } catch (error) {
      return FailureResult<AppUser>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<AppUser>> restoreSession() async {
    final String? token = await _local.readAccessToken();
    if (token == null || token.isEmpty) {
      return const FailureResult<AppUser>(AuthFailure('Сесс байхгүй.', code: 'NO_SESSION'));
    }

    // Confirm against the server so a role change, suspension or admin passcode reset
    // takes effect on the next cold start rather than lingering behind a stale cache.
    try {
      final UserModel fresh = await _remote.me();
      await _local.saveUser(fresh);
      return Success<AppUser>(fresh);
    } catch (error) {
      final Failure failure = _mapException(error);

      // Offline start: fall back to the cached user so a technician in the field can
      // still open the app. A network failure is not proof the session is invalid.
      if (failure is NetworkFailure) {
        final UserModel? cached = await _local.readCachedUser();
        if (cached != null) {
          return Success<AppUser>(cached);
        }
      } else {
        await _local.clear();
      }

      return FailureResult<AppUser>(failure);
    }
  }

  @override
  Future<ApiResult<AppUser>> currentUser() async {
    try {
      final UserModel user = await _remote.me();
      await _local.saveUser(user);
      return Success<AppUser>(user);
    } catch (error) {
      return FailureResult<AppUser>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  }) async {
    try {
      await _remote.changePassword(
        currentPassword: currentPassword,
        newPassword: newPassword,
      );
      // The backend revokes every session on a password change, so the local
      // credential is already dead. Clear it rather than leave a stale token.
      await _local.clear();
      return const Success<void>(null);
    } catch (error) {
      return FailureResult<void>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<void>> logout() async {
    final String? refreshToken = await _local.readRefreshToken();

    if (refreshToken != null && refreshToken.isNotEmpty) {
      try {
        await _remote.logout(refreshToken);
      } catch (_) {
        // A failed server-side revoke must not trap the user in a signed-in shell.
        // The local credential is cleared regardless.
      }
    }

    await _local.clear();
    return const Success<void>(null);
  }
}
