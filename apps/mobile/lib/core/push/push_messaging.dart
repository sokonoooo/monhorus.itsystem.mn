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
///
/// -- Why the plugin calls sit behind swappable functions ----------------------
///
/// The rule this file exists to keep — every authenticated session hands the server a
/// token, so the `DeviceToken` row names the account signed in NOW — was wrong for the life
/// of an install and no test could see it: `Platform.isAndroid` is false under
/// `flutter test` and `Firebase.initializeApp` throws there, so `start` returned at its
/// first line and everything behind it was unreachable. The four functions marked
/// [visibleForTesting] below are the plugin calls and nothing else; the rules stay here, in
/// the app, where a test can hold them to account.
library;

import 'dart:async';
import 'dart:io';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// Matches the channel declared in AndroidManifest.xml. Android drops a notification whose
/// channel does not exist, silently, so the two must not drift.
const String _channelId = 'monhorus_default';
const String _channelName = 'Мэдэгдэл';
const String _channelDescription = 'Ажил, хүсэлт, хугацааны мэдэгдэл';

/// Called with a freshly issued registration token, to hand to the backend.
typedef PushTokenSink = Future<void> Function(String token);

/// Called when a push arrives or is tapped, so a badge can re-ask the server.
typedef PushArrivalListener = void Function();

/// Called when the user taps a notification. Carries the server's `linkPath`, when it sent
/// one, so the app can decide where to go.
typedef PushOpenSink = void Function(String? linkPath);

/// Background isolate handler.
///
/// Must be a top-level function annotated for the VM entry point, because Android starts a
/// fresh Dart isolate to run it and nothing from the running app is in scope. It deliberately
/// does no work: FCM already displays a `notification` payload while the app is backgrounded,
/// so the only reason this exists is that firebase_messaging requires a registered handler
/// to deliver data alongside it.
@pragma('vm:entry-point')
Future<void> _onBackgroundMessage(RemoteMessage message) async {}

class PushMessaging {
  PushMessaging._();

  static final FlutterLocalNotificationsPlugin _local = FlutterLocalNotificationsPlugin();

  static final Set<PushArrivalListener> _arrivals = <PushArrivalListener>{};

  /// Subscribes to push arrivals. Returns the unsubscribe function.
  ///
  /// Carries no payload deliberately: subscribers refetch rather than adjusting a local
  /// number, so a badge stays the server's answer instead of drifting from it on a
  /// notification the caller may not even be a recipient of.
  static VoidCallback onPushArrived(PushArrivalListener listener) {
    _arrivals.add(listener);
    return () => _arrivals.remove(listener);
  }

  static void _announceArrival() {
    // Copied before iterating: a listener may unsubscribe itself while being called.
    for (final PushArrivalListener listener in List<PushArrivalListener>.of(_arrivals)) {
      listener();
    }
  }

  static bool _started = false;
  static StreamSubscription<String>? _tokenRefresh;
  static StreamSubscription<RemoteMessage>? _foreground;
  static StreamSubscription<RemoteMessage>? _opened;

  /*
   * The sinks belong to the SESSION, not to the wiring.
   *
   * Held in fields rather than captured by the listeners, so signing in again replaces
   * them: a token that rotates months later is then handed to the account signed in at that
   * moment rather than to a closure built by whoever signed in first.
   */
  static PushTokenSink? _tokenSink;
  static PushOpenSink? _openSink;

  // -- The plugin calls, and nothing else -------------------------------------

  /// Only Android is dispatched to, and the plugins are unavailable in a test binding.
  @visibleForTesting
  static bool Function() supported = _androidOnly;

  /// The one-time wiring: Firebase, the notification permission, the local-notification
  /// channel and the three message listeners. False when push cannot run here.
  @visibleForTesting
  static Future<bool> Function() attachPlatform = _attachFirebase;

  /// This install's current FCM registration token.
  @visibleForTesting
  static Future<String?> Function() readToken = _firebaseToken;

  /// Rotations of that token, which FCM issues on the order of months.
  @visibleForTesting
  static Stream<String> Function() tokenRefreshes = _firebaseTokenRefreshes;

  /// Restores the real plugin calls and forgets this process's state.
  @visibleForTesting
  static Future<void> debugReset() async {
    await stop();
    supported = _androidOnly;
    attachPlatform = _attachFirebase;
    readToken = _firebaseToken;
    tokenRefreshes = _firebaseTokenRefreshes;
    _arrivals.clear();
  }

  static bool _androidOnly() => !kIsWeb && Platform.isAndroid;

  static Future<String?> _firebaseToken() => FirebaseMessaging.instance.getToken();

  static Stream<String> _firebaseTokenRefreshes() =>
      FirebaseMessaging.instance.onTokenRefresh;

  /// True once messaging has been wired up on this install and not torn down again.
  static bool get isRegistered => _started;

  /// Wires up messaging and registers this install for whoever is signed in now.
  ///
  /// Safe to call repeatedly, and NOT a no-op when it is: the two call sites are sign-in
  /// and session restore, and both of them mean a session has just begun. A second call
  /// re-issues the token, so `POST /notifications/devices` re-attributes the row to the
  /// account now holding the handset. The backend upserts on the token, so a repeat
  /// registration of the same value is cheap and also refreshes its last-seen stamp.
  ///
  /// THIS IS THE FIX for a bug that cost the product every customer registration it had.
  /// The guard used to skip everything once started, and only [stop] cleared that flag,
  /// and only sign-out reached [stop]. A session that ended any other way — a refresh
  /// token that expired, an administrator's passcode reset, a password changed on another
  /// device — put the user back on the login screen with the flag still set, so the next
  /// sign-in registered nothing at all and the `DeviceToken` row went on naming the
  /// previous session's user. FCM rotates a token on the order of months, so that lasted
  /// the life of the install, and nothing was logged where anyone could see it.
  ///
  /// Re-issuing here rather than clearing the flag at each session-ending call site is
  /// deliberate: the flag was left set by a path nobody had enumerated, and enumerating
  /// paths is exactly what produced the bug. This holds however the previous session
  /// ended, including for a path added later by somebody who never read this comment.
  ///
  /// Returns false when this install could not be registered, which on a developer machine
  /// normally means `google-services.json` is missing. The caller should carry on
  /// regardless — and should say so somewhere, because a registration that never happened
  /// is otherwise indistinguishable from one that failed.
  static Future<bool> start({
    required PushTokenSink onToken,
    required PushOpenSink onOpen,
  }) async {
    if (!supported()) return false;

    // Whoever is signing in now owns the sinks from here, including the rotation listener
    // attached by an earlier session.
    _tokenSink = onToken;
    _openSink = onOpen;

    // Already wired up, by a session that has since ended. The plugins are wired once per
    // process; the registration is per session.
    if (_started) return _issueToken();

    if (!await attachPlatform()) return false;

    /*
     * Registered before the refresh listener is attached, so the first token is never
     * missed, and again on every rotation. The backend upserts on the token, so repeat
     * registrations of the same value are cheap and also refresh its last-seen stamp.
     */
    final bool issued = await _issueToken();

    _tokenRefresh = tokenRefreshes().listen((String next) async {
      await _tokenSink?.call(next);
    });

    _started = true;
    return issued;
  }

  /// Reads the registration token and hands it to the current session's sink.
  static Future<bool> _issueToken() async {
    try {
      final String? token = await readToken();
      if (token == null) {
        debugPrint('Push not registered: FCM issued no token for this install');
        return false;
      }
      await _tokenSink?.call(token);
      return true;
    } catch (error) {
      debugPrint('Push not registered: the token could not be issued ($error)');
      return false;
    }
  }

  static void _announceOpen(String? linkPath) => _openSink?.call(linkPath);

  /// The token this install currently holds, if any. Used at sign-out, to tell the backend
  /// to stop sending to a device the user is walking away from.
  static Future<String?> currentToken() async {
    if (!supported() || !_started) return null;
    try {
      return await readToken();
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
    _tokenSink = null;
    _openSink = null;
    _started = false;
  }

  /// Deletes the registration from FCM entirely. Reserved for sign-out on a shared handset,
  /// where the next person must not inherit delivery.
  static Future<void> forget() async {
    if (!supported()) return;
    try {
      await FirebaseMessaging.instance.deleteToken();
    } catch (_) {
      // Nothing to undo: the backend row is deactivated separately and independently.
    }
  }

  /// Firebase, the permission dialog, the notification channel and the message listeners.
  ///
  /// Everything here is a plugin call, which is why it is one function: it is the part a
  /// test binding cannot run, and it is swapped out whole rather than in pieces.
  static Future<bool> _attachFirebase() async {
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
        settings: const InitializationSettings(
          android: AndroidInitializationSettings('@mipmap/ic_launcher'),
        ),
        onDidReceiveNotificationResponse: (NotificationResponse response) {
          _announceOpen(response.payload);
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
          id: notification.hashCode,
          title: notification.title,
          body: notification.body,
          notificationDetails: const NotificationDetails(
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
        // The badge is stale the instant this lands; tell it to re-ask.
        _announceArrival();
      });

      // Tapped while the app was backgrounded but alive.
      _opened = FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
        _announceArrival();
        _announceOpen(message.data['linkPath'] as String?);
      });

      // Tapped while the app was not running at all; delivered once, at startup.
      final RemoteMessage? initial = await messaging.getInitialMessage();
      if (initial != null) _announceOpen(initial.data['linkPath'] as String?);

      return true;
    } catch (error) {
      debugPrint('Push disabled: messaging could not start ($error)');
      return false;
    }
  }
}
