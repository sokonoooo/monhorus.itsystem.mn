import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Android push, via Firebase Cloud Messaging.
///
/// iOS is deliberately not wired up. Push there needs a paid Apple Developer membership and
/// an APNs key, neither of which exists, so an iPhone keeps the in-app notification list and
/// nothing else. Every entry point below no-ops off Android rather than throwing, so the
/// same call sites work on both platforms without a conditional at each one.
///
/// EVERYTHING HERE IS OPTIONAL AT RUNTIME. `google-services.json` is gitignored and absent
/// from a fresh checkout, so `Firebase.initializeApp` will fail on most developer machines.
/// That is not an error worth crashing an app over: notifications still arrive in the list,
/// which is how the app behaved before push existed. `start` reports whether it managed to
/// register and is otherwise silent.
library;

/// Matches the channel declared in AndroidManifest.xml. Android drops a notification whose
/// channel does not exist, silently, so the two must not drift.
const String _channelId = 'monhorus_default';
const String _channelName = 'Мэдэгдэл';
const String _channelDescription = 'Ажил, хүсэлт, хугацааны мэдэгдэл';

/// Called with a freshly issued registration token, to hand to the backend.
typedef PushTokenSink = Future<void> Function(String token);

/// Called when the user taps a notification. Carries the server's `linkPath`, when it sent
/// one, so the app can decide where to go.
typedef PushOpenSink = void Function(String? linkPath);

/**
 * Background isolate handler.
 *
 * Must be a top-level function annotated for the VM entry point, because Android starts a
 * fresh Dart isolate to run it and nothing from the running app is in scope. It deliberately
 * does no work: FCM already displays a `notification` payload while the app is backgrounded,
 * so the only reason this exists is that firebase_messaging requires a registered handler to
 * deliver data alongside it.
 */
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {}

class PushMessaging {
  PushMessaging._();

  static final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

  static bool _started = false;
  static StreamSubscription<String>? _tokenRefresh;
  static StreamSubscription<RemoteMessage>? _foreground;
  static StreamSubscription<RemoteMessage>? _opened;

  /// Only Android is dispatched to, and the plugins are unavailable in a test binding.
  static bool get _supported => !kIsWeb && Platform.isAndroid;

  /// True once a token has been handed to [onToken] at least once this session.
  static bool get isRegistered => _started;

  /// Wires up messaging and registers this install.
  ///
  /// Safe to call repeatedly — a second call while already started is ignored — because the
  /// natural call sites are sign-in AND session restore, and a returning user passes through
  /// only one of them.
  ///
  /// Returns false when push could not be started, which on a developer machine normally
  /// means `google-services.json` is missing. The caller should carry on regardless.
  static Future<bool> start({
    required PushTokenSink onToken,
    required PushOpenSink onOpen,
  }) async {
    if (!_supported || _started) return false;

    try {
      await Firebase.initializeApp();
    } catch (error) {
      debugPrint('Push disabled: Firebase could not start ($error)');
      return false;
    }

    try {
      final FirebaseMessaging messaging = FirebaseMessaging.instance;

      /*
       * Android 13 and above gate notifications behind POST_NOTIFICATIONS. This call is what
       * raises that dialog; on older versions it resolves as already granted. A refusal is
       * not a failure — the token is still worth registering, because the user may enable
       * notifications later in system settings and nothing would re-register at that point.
       */
      await messaging.requestPermission();

      await _local.initialize(
        const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: (NotificationResponse response) {
          onOpen(response.payload);
        },
      );

      await _local
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(
            const AndroidNotificationChannel(
              _channelId,
              _channelName,
              description: _channelDescription,
              importance: Importance.high,
            ),
          );

      FirebaseMessaging.onBackgroundMessage(_onBackgroundMessage);

      /*
       * A message arriving while the app is in the foreground is NOT displayed by Android —
       * FCM hands it to the app instead. Without this the notification would simply vanish
       * for anyone who happened to have the app open, which is the majority of the people it
       * concerns.
       */
      _foreground = FirebaseMessaging.onMessage.listen((RemoteMessage message) {
        final RemoteNotification? notification = message.notification;
        if (notification == null) return;
        _local.show(
          notification.hashCode,
          notification.title,
          notification.body,
          const NotificationDetails(
            android: AndroidNotificationDetails(
              _channelId,
              _channelName,
              channelDescription: _channelDescription,
              importance: Importance.high,
              priority: Priority.high,
            ),
          ),
          payload: message.data['linkPath'] as String?,
        );
      });

      // Tapped while the app was backgrounded but alive.
      _opened = FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        onOpen(message.data['linkPath'] as String?);
      });

      // Tapped while the app was not running at all; delivered once, at startup.
      final RemoteMessage? initial = await messaging.getInitialMessage();
      if (initial != null) onOpen(initial.data['linkPath'] as String?);

      /*
       * Registered before the refresh listener is attached, so the first token is never
       * missed, and again on every rotation. The backend upserts on the token, so repeat
       * registrations of the same value are cheap and also refresh its last-seen stamp.
       */
      final String? token = await messaging.getToken();
      if (token != null) await onToken(token);

      _tokenRefresh = messaging.onTokenRefresh.listen((String next) async {
        await onToken(next);
      });

      _started = true;
      return true;
    } catch (error) {
      debugPrint('Push disabled: messaging could not start ($error)');
      return false;
    }
  }

  /// The token this install currently holds, if any. Used at sign-out, to tell the backend
  /// to stop sending to a device the user is walking away from.
  static Future<String?> currentToken() async {
    if (!_supported || !_started) return null;
    try {
      return await FirebaseMessaging.instance.getToken();
    } catch (_) {
      return null;
    }
  }

  /// Tears down listeners on sign-out, so a subsequent sign-in re-registers cleanly against
  /// the new account rather than leaving the previous user's callbacks attached.
  static Future<void> stop() async {
    await _tokenRefresh?.cancel();
    await _foreground?.cancel();
    await _opened?.cancel();
    _tokenRefresh = null;
    _foreground = null;
    _opened = null;
    _started = false;
  }

  /// Deletes the registration from FCM entirely. Reserved for sign-out on a shared handset,
  /// where the next person must not inherit delivery.
  static Future<void> forget() async {
    if (!_supported) return;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Nothing to undo: the backend row is deactivated separately and independently.
    }
  }
}
