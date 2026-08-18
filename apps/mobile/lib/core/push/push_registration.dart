import 'package:flutter/foundation.dart';

import '../network/dio_client.dart';

/// Tells the backend which device this is.
///
/// Deliberately talks to `DioClient` directly rather than going through a feature's data
/// source. Registration happens on sign-in, which lives in `features/auth`, while the
/// `/notifications` endpoints belong to the home feature — routing the call through there
/// would make auth depend on home for no reason other than where a file happens to sit.
///
/// Every method swallows its own failures. A device that could not register still has a
/// working app and a working notification list; failing sign-in because a push registration
/// did not go through would trade a missing convenience for a locked-out user.
class PushRegistration {
  const PushRegistration(this._client);

  final DioClient _client;

  /// The application identifier, so the backend can tell an employee install from a
  /// customer one when both belong to the same person.
  static const String appId = 'mn.monhorus.monhorus_mobile';

  Future<void> register({required String token}) async {
    try {
      await _client.request<void>(
        path: '/notifications/devices',
        method: 'POST',
        data: <String, dynamic>{
          'token': token,
          'platform': 'android',
          'appId': appId,
        },
        decoder: (Object? _) {},
      );
    } catch (error) {
      debugPrint('Push registration failed: $error');
    }
  }

  /// Called at sign-out, so the backend stops sending to a handset the user has left.
  ///
  /// Best-effort by necessity: a sign-out with no network still has to sign the user out
  /// locally, and the row would then stay active until FCM reports the token dead. That is
  /// acceptable — the notification would arrive on a device with no session, which shows the
  /// login screen rather than anybody else's data.
  Future<void> unregister({required String token}) async {
    try {
      await _client.request<void>(
        path: '/notifications/devices/unregister',
        method: 'POST',
        data: <String, dynamic>{'token': token},
        decoder: (Object? _) {},
      );
    } catch (error) {
      debugPrint('Push unregistration failed: $error');
    }
  }
}
