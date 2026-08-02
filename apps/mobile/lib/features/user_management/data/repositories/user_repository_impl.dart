import '../../../../core/error/exceptions.dart';
import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../domain/repositories/user_repository.dart';
import '../datasources/user_remote_data_source.dart';
import '../models/create_user_request.dart';

class UserRepositoryImpl implements UserRepository {
  const UserRepositoryImpl(this._remote);

  final UserRemoteDataSource _remote;

  Failure _mapException(Object error) {
    if (error is ServerException) {
      if (error.statusCode == 401 || error.statusCode == 403) {
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
    return const ServerFailure('Гэнэтийн алдаа гарлаа.', code: 'UNKNOWN');
  }

  @override
  Future<ApiResult<PaginatedUsers>> list({
    int page = 1,
    int limit = 20,
    UserRole? role,
    AccountStatus? status,
    String? search,
  }) async {
    try {
      final PaginatedUsers result = await _remote.list(
        page: page,
        limit: limit,
        role: role,
        status: status,
        search: search,
      );
      return Success<PaginatedUsers>(result);
    } catch (error) {
      return FailureResult<PaginatedUsers>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<ProvisionedUser>> create(CreateUserRequest request) async {
    try {
      return Success<ProvisionedUser>(await _remote.create(request));
    } catch (error) {
      return FailureResult<ProvisionedUser>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<ProvisionedUser>> resetPasscode(
    String userId,
    ResetPasscodeRequest request,
  ) async {
    try {
      return Success<ProvisionedUser>(await _remote.resetPasscode(userId, request));
    } catch (error) {
      return FailureResult<ProvisionedUser>(_mapException(error));
    }
  }

  @override
  Future<ApiResult<UserModel>> updateStatus(
    String userId,
    AccountStatus status, {
    String? reason,
  }) async {
    try {
      return Success<UserModel>(
        await _remote.updateStatus(userId, status, reason: reason),
      );
    } catch (error) {
      return FailureResult<UserModel>(_mapException(error));
    }
  }
}
