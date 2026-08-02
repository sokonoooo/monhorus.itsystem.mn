import '../../../../core/network/api_result.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../../data/models/create_user_request.dart';

abstract interface class UserRepository {
  Future<ApiResult<PaginatedUsers>> list({
    int page,
    int limit,
    UserRole? role,
    AccountStatus? status,
    String? search,
  });

  Future<ApiResult<ProvisionedUser>> create(CreateUserRequest request);

  Future<ApiResult<ProvisionedUser>> resetPasscode(
    String userId,
    ResetPasscodeRequest request,
  );

  Future<ApiResult<UserModel>> updateStatus(
    String userId,
    AccountStatus status, {
    String? reason,
  });
}
