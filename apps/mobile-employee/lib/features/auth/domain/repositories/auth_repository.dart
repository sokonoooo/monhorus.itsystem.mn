import '../../../../core/network/api_result.dart';
import '../entities/app_user.dart';

/// Domain contract. The presentation layer depends on this, never on Dio.
abstract interface class AuthRepository {
  Future<ApiResult<AppUser>> login({
    required String email,
    required String password,
  });

  /// Restores a session from secure storage on cold start. Returns a failure when no
  /// usable credential is present.
  Future<ApiResult<AppUser>> restoreSession();

  Future<ApiResult<AppUser>> currentUser();

  Future<ApiResult<void>> changePassword({
    required String currentPassword,
    required String newPassword,
  });

  Future<ApiResult<void>> logout();
}
