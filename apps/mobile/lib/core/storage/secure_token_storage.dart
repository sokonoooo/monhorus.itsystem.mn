import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Credentials live in the Keychain on iOS and EncryptedSharedPreferences on Android,
/// never in plain SharedPreferences. A field device is easily lost or stolen, so an
/// attacker holding the handset must not be able to read the refresh token off disk.
class SecureTokenStorage {
  SecureTokenStorage([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock,
              ),
            );

  final FlutterSecureStorage _storage;

  static const String _accessTokenKey = 'monhorus_access_token';
  static const String _refreshTokenKey = 'monhorus_refresh_token';
  static const String _userKey = 'monhorus_cached_user';

  Future<String?> readAccessToken() => _storage.read(key: _accessTokenKey);

  Future<String?> readRefreshToken() => _storage.read(key: _refreshTokenKey);

  Future<String?> readCachedUser() => _storage.read(key: _userKey);

  Future<void> saveTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _accessTokenKey, value: accessToken);
    await _storage.write(key: _refreshTokenKey, value: refreshToken);
  }

  Future<void> saveCachedUser(String userJson) =>
      _storage.write(key: _userKey, value: userJson);

  Future<void> clear() async {
    await _storage.delete(key: _accessTokenKey);
    await _storage.delete(key: _refreshTokenKey);
    await _storage.delete(key: _userKey);
  }
}
