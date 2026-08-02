import 'dart:io' show Platform;

/// Build-time configuration.
///
/// Override for a real device or staging with:
///   flutter run --dart-define=API_BASE_URL=https://api.monhorus.mn/api/v1
///
/// Without that override the host is resolved per platform at runtime, so a local
/// backend on port 4000 is reachable out of the box: the Android emulator sees the
/// host machine as 10.0.2.2, while the iOS simulator, macOS and desktop share the
/// host's own loopback. A physical handset is a different machine altogether and
/// still needs --dart-define pointed at the development machine's LAN address.
///
/// `dart:io` is imported unconditionally, which is fine because only the iOS target
/// is configured. Adding Flutter web would mean moving this behind a conditional
/// import, since `Platform` does not exist there.
class AppConfig {
  const AppConfig._();

  /// Empty unless --dart-define=API_BASE_URL was supplied at build time.
  static const String _apiBaseUrlOverride = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: '',
  );

  /// Loopback alias the Android emulator maps back to the host machine.
  static const String _androidEmulatorOrigin = 'http://10.0.2.2:4000';

  /// Every other local target reaches the backend on its own loopback.
  static const String _loopbackOrigin = 'http://127.0.0.1:4000';

  /// The --dart-define value when one was given, otherwise the platform default.
  static String get apiBaseUrl {
    if (_apiBaseUrlOverride.isNotEmpty) {
      return _apiBaseUrlOverride;
    }
    final String origin =
        Platform.isAndroid ? _androidEmulatorOrigin : _loopbackOrigin;
    return '$origin/api/v1';
  }

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 20);

  /// Minimum password length enforced by the backend policy.
  static const int passwordMinLength = 10;
}
