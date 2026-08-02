import '../../../../core/network/dio_client.dart';
import '../../../auth/data/models/user_model.dart';
import '../../../auth/domain/entities/app_user.dart';
import '../models/create_user_request.dart';

class UserRemoteDataSource {
  const UserRemoteDataSource(this._client);

  final DioClient _client;

  Future<PaginatedUsers> list({
    int page = 1,
    int limit = 20,
    UserRole? role,
    AccountStatus? status,
    String? search,
  }) {
    return _client.request<PaginatedUsers>(
      path: '/users',
      method: 'GET',
      queryParameters: <String, dynamic>{
        'page': page,
        'limit': limit,
        if (role != null) 'role': role.wireValue,
        if (status != null) 'status': status.wireValue,
        if (search != null && search.isNotEmpty) 'search': search,
      },
      decoder: (Object? json) => PaginatedUsers.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<ProvisionedUser> create(CreateUserRequest request) {
    return _client.request<ProvisionedUser>(
      path: '/users',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? json) => ProvisionedUser.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<ProvisionedUser> resetPasscode(String userId, ResetPasscodeRequest request) {
    return _client.request<ProvisionedUser>(
      path: '/users/$userId/reset-passcode',
      method: 'POST',
      data: request.toJson(),
      decoder: (Object? json) => ProvisionedUser.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<UserModel> updateStatus(String userId, AccountStatus status, {String? reason}) {
    return _client.request<UserModel>(
      path: '/users/$userId/status',
      method: 'PATCH',
      data: <String, dynamic>{
        'status': status.wireValue,
        if (reason != null && reason.isNotEmpty) 'reason': reason,
      },
      decoder: (Object? json) => UserModel.fromJson(json! as Map<String, dynamic>),
    );
  }
}
