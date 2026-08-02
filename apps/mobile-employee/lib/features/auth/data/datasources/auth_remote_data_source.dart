import '../../../../core/network/dio_client.dart';
import '../models/auth_session_model.dart';
import '../models/user_model.dart';

/// Thin transport wrapper. Throws ServerException or NetworkException; the repository
/// converts those into Failure values.
class AuthRemoteDataSource {
  const AuthRemoteDataSource(this._client);

  final DioClient _client;

  Future<AuthSessionModel> login({
    required String email,
    required String password,
  }) {
    return _client.request<AuthSessionModel>(
      path: '/auth/login',
      method: 'POST',
      data: <String, dynamic>{'email': email, 'password': password},
      decoder: (Object? json) =>
          AuthSessionModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<UserModel> me() {
    return _client.request<UserModel>(
      path: '/auth/me',
      method: 'GET',
      decoder: (Object? json) => UserModel.fromJson(json! as Map<String, dynamic>),
    );
  }

  Future<void> changePassword({
    required String currentPassword,
    required String newPassword,
  }) {
    return _client.request<void>(
      path: '/auth/change-password',
      method: 'POST',
      data: <String, dynamic>{
        'currentPassword': currentPassword,
        'newPassword': newPassword,
      },
      decoder: (Object? _) {},
    );
  }

  Future<void> logout(String refreshToken) {
    return _client.request<void>(
      path: '/auth/logout',
      method: 'POST',
      data: <String, dynamic>{'refreshToken': refreshToken},
      decoder: (Object? _) {},
    );
  }
}
