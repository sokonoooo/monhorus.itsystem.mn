// What the app says when the BACKEND is down, as opposed to the connection.
//
// `validateStatus` deliberately lets Dio throw on a 5xx so the success path never sees
// one. Falling from there straight to `NetworkException` collapsed two different facts
// into one and cost twice over: the customer was told their own connection had failed
// while the server was demonstrably answering, and `restoreSession` read that as an
// offline start — opening the shell on a cached user whose every subsequent request
// then failed against the same outage.
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/error/exceptions.dart';
import 'package:monhorus_mobile/core/error/failure.dart';
import 'package:monhorus_mobile/core/network/api_result.dart';
import 'package:monhorus_mobile/core/network/dio_client.dart';
import 'package:monhorus_mobile/core/storage/secure_token_storage.dart';
import 'package:monhorus_mobile/features/auth/data/datasources/auth_local_data_source.dart';
import 'package:monhorus_mobile/features/auth/data/datasources/auth_remote_data_source.dart';
import 'package:monhorus_mobile/features/auth/data/models/user_model.dart';
import 'package:monhorus_mobile/features/auth/data/repositories/auth_repository_impl.dart';
import 'package:monhorus_mobile/features/auth/domain/entities/app_user.dart';

/// Answers every request with one fixed status and body, so a test can put a real
/// backend reply in front of the real client without a socket.
class _FixedAdapter implements HttpClientAdapter {
  _FixedAdapter({required this.statusCode, required this.body});

  final int statusCode;
  final Map<String, dynamic> body;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    return ResponseBody.fromString(
      jsonEncode(body),
      statusCode,
      headers: <String, List<String>>{
        Headers.contentTypeHeader: <String>[Headers.jsonContentType],
      },
    );
  }
}

/// Never touches the keychain: every method a test path reaches is overridden, so the
/// platform channel behind [SecureTokenStorage] is never called.
class _FakeTokenStorage extends SecureTokenStorage {
  _FakeTokenStorage() : super(const FlutterSecureStorage());

  bool cleared = false;

  @override
  Future<String?> readAccessToken() async => 'access-token';

  @override
  Future<String?> readRefreshToken() async => 'refresh-token';

  @override
  Future<void> clear() async => cleared = true;
}

/// A session cache holding a user from a previous, successful sign-in.
class _FakeLocal extends AuthLocalDataSource {
  _FakeLocal({required this.cached}) : super(SecureTokenStorage());

  final UserModel? cached;
  bool cleared = false;
  bool cachedUserRead = false;

  @override
  Future<String?> readAccessToken() async => 'access-token';

  @override
  Future<UserModel?> readCachedUser() async {
    cachedUserRead = true;
    return cached;
  }

  @override
  Future<void> saveUser(UserModel user) async {}

  @override
  Future<void> clear() async => cleared = true;
}

DioClient _clientAnswering({required int status, required Map<String, dynamic> body}) {
  final Dio dio = Dio()
    ..httpClientAdapter = _FixedAdapter(statusCode: status, body: body);
  return DioClient(tokenStorage: _FakeTokenStorage(), dio: dio);
}

UserModel _cachedUser() => UserModel.fromJson(<String, dynamic>{
      'id': '5f1b0c2a11b34f68bfc40001',
      'fullName': 'Д. Оюунчимэг',
      'email': 'oyun@centraltower.mn',
      'role': 'CUSTOMER',
      'status': 'ACTIVE',
      'customerId': '6a67013e11b34f68bfc4037f',
      'customerName': 'Central Tower ХХК',
    });

void main() {
  group('a 5xx is an answer from the server, not a failure to reach it', () {
    test('a 500 surfaces as a ServerException carrying the status', () async {
      final DioClient client = _clientAnswering(
        status: 500,
        body: <String, dynamic>{
          'success': false,
          'message': 'Дотоод алдаа гарлаа.',
          'code': 'INTERNAL_ERROR',
        },
      );

      await expectLater(
        client.request<Object?>(
          path: '/buildings',
          method: 'GET',
          decoder: (Object? json) => json,
        ),
        throwsA(
          isA<ServerException>()
              .having((ServerException e) => e.statusCode, 'statusCode', 500)
              .having((ServerException e) => e.code, 'code', 'INTERNAL_ERROR'),
        ),
      );
    });

    test('a 503 with a body this client cannot read is still a server error',
        () async {
      final DioClient client = _clientAnswering(
        status: 503,
        // A gateway's own HTML error page arrives as something that is not the
        // envelope. It is still the server answering.
        body: <String, dynamic>{},
      );

      await expectLater(
        client.request<Object?>(
          path: '/buildings',
          method: 'GET',
          decoder: (Object? json) => json,
        ),
        throwsA(isA<ServerException>()),
      );
    });
  });

  group('session restore during a backend outage', () {
    test('does not take the offline branch, and does not sign the customer out',
        () async {
      final _FakeLocal local = _FakeLocal(cached: _cachedUser());
      final AuthRepositoryImpl repository = AuthRepositoryImpl(
        remote: AuthRemoteDataSource(
          _clientAnswering(
            status: 500,
            body: <String, dynamic>{
              'success': false,
              'message': 'Дотоод алдаа гарлаа.',
              'code': 'INTERNAL_ERROR',
            },
          ),
        ),
        local: local,
      );

      final ApiResult<AppUser> result = await repository.restoreSession();

      // The shell must not open on a stale cached user whose every request will fail
      // against the same outage.
      expect(result, isA<FailureResult<AppUser>>());
      expect((result as FailureResult<AppUser>).failure, isA<ServerFailure>());
      expect(local.cachedUserRead, isFalse);

      // And the credential survives: only the server refusing it proves it is dead,
      // and forcing a re-login over a passing outage is the other way to lose the
      // session for no reason.
      expect(local.cleared, isFalse);
    });

    test('a refused credential still clears the session', () async {
      final _FakeLocal local = _FakeLocal(cached: _cachedUser());
      final AuthRepositoryImpl repository = AuthRepositoryImpl(
        remote: AuthRemoteDataSource(
          _clientAnswering(
            status: 401,
            body: <String, dynamic>{
              'success': false,
              'message': 'Нэвтрэх эрх дууссан байна.',
              'code': 'TOKEN_EXPIRED',
            },
          ),
        ),
        local: local,
      );

      final ApiResult<AppUser> result = await repository.restoreSession();

      expect(result, isA<FailureResult<AppUser>>());
      expect(local.cleared, isTrue);
    });
  });
}
