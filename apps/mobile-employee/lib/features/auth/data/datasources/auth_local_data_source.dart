import 'dart:convert';

import '../../../../core/storage/secure_token_storage.dart';
import '../models/user_model.dart';

/// Owns the on-device session cache. Keeping JSON encoding here means the repository
/// deals only in models.
class AuthLocalDataSource {
  const AuthLocalDataSource(this._storage);

  final SecureTokenStorage _storage;

  Future<void> saveSession({
    required String accessToken,
    required String refreshToken,
    required UserModel user,
  }) async {
    await _storage.saveTokens(accessToken: accessToken, refreshToken: refreshToken);
    await _storage.saveCachedUser(jsonEncode(user.toJson()));
  }

  Future<void> saveUser(UserModel user) =>
      _storage.saveCachedUser(jsonEncode(user.toJson()));

  Future<UserModel?> readCachedUser() async {
    final String? raw = await _storage.readCachedUser();
    if (raw == null || raw.isEmpty) return null;
    try {
      return UserModel.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      // A corrupted cache is not fatal; treat it as absent.
      return null;
    }
  }

  Future<String?> readAccessToken() => _storage.readAccessToken();

  Future<String?> readRefreshToken() => _storage.readRefreshToken();

  Future<void> clear() => _storage.clear();
}
