import 'dart:async';

import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../error/exceptions.dart';
import '../storage/secure_token_storage.dart';

/// Single Dio instance for the app.
///
/// Three responsibilities:
///   1. Attach the Bearer access token to every outbound request.
///   2. On a 401, refresh once and replay the original request.
///   3. Normalise every transport and API error into a typed exception.
class DioClient {
  DioClient({required SecureTokenStorage tokenStorage, Dio? dio})
      : _tokenStorage = tokenStorage,
        _dio = dio ?? Dio() {
    _dio.options = BaseOptions(
      baseUrl: AppConfig.apiBaseUrl,
      connectTimeout: AppConfig.connectTimeout,
      receiveTimeout: AppConfig.receiveTimeout,
      contentType: Headers.jsonContentType,
      headers: const <String, String>{'X-Client-Channel': 'MOBILE'},
      // Non-5xx statuses are handled in `request` rather than thrown by Dio, so the
      // 401 refresh path can inspect the body instead of unwrapping an exception.
      validateStatus: (int? status) => status != null && status < 500,
    );

    _dio.interceptors.add(
      InterceptorsWrapper(onRequest: _onRequest, onError: _onError),
    );
  }

  final Dio _dio;
  final SecureTokenStorage _tokenStorage;

  /// Invoked when a refresh fails terminally, so the auth notifier can sign out.
  void Function()? onSessionExpired;

  /// Guards against a stampede of refreshes when several calls 401 at once.
  Completer<String?>? _refreshCompleter;

  Dio get raw => _dio;

  static const List<String> _noAuthPaths = <String>['/auth/login', '/auth/refresh'];

  Future<void> _onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    // The token-minting endpoints must not carry a stale Bearer header.
    if (!_noAuthPaths.any(options.path.contains)) {
      final String? token = await _tokenStorage.readAccessToken();
      if (token != null && token.isNotEmpty) {
        options.headers['Authorization'] = 'Bearer $token';
      }
    }
    handler.next(options);
  }

  void _onError(DioException error, ErrorInterceptorHandler handler) {
    // Transport failures never reached the API, so there is nothing to refresh.
    const Set<DioExceptionType> transportFailures = <DioExceptionType>{
      DioExceptionType.connectionTimeout,
      DioExceptionType.receiveTimeout,
      DioExceptionType.sendTimeout,
      DioExceptionType.connectionError,
    };

    if (transportFailures.contains(error.type)) {
      handler.reject(
        DioException(
          requestOptions: error.requestOptions,
          error: const NetworkException(),
          type: error.type,
        ),
      );
      return;
    }

    handler.next(error);
  }

  /// Performs a request and unwraps the { success, data, message } envelope.
  ///
  /// Throws [ServerException] for an API-level failure and [NetworkException] when
  /// the request never reached the server.
  Future<T> request<T>({
    required String path,
    required String method,
    required T Function(Object? json) decoder,
    Object? data,
    Map<String, dynamic>? queryParameters,
    bool allowRetry = true,
  }) async {
    try {
      final Response<dynamic> response = await _dio.request<dynamic>(
        path,
        data: data,
        queryParameters: queryParameters,
        options: Options(method: method),
      );

      final int status = response.statusCode ?? 0;
      final dynamic body = response.data;

      if (status == 401 && allowRetry && !_noAuthPaths.any(path.contains)) {
        final String? refreshed = await _refreshAccessToken();
        if (refreshed != null) {
          // Replay exactly once. allowRetry: false prevents an infinite loop.
          return request<T>(
            path: path,
            method: method,
            decoder: decoder,
            data: data,
            queryParameters: queryParameters,
            allowRetry: false,
          );
        }
        await _tokenStorage.clear();
        onSessionExpired?.call();
      }

      if (status >= 200 &&
          status < 300 &&
          body is Map<String, dynamic> &&
          body['success'] == true) {
        return decoder(body['data']);
      }

      throw _toServerException(status, body);
    } on DioException catch (error) {
      final Object? inner = error.error;
      if (inner is NetworkException) throw inner;
      if (inner is ServerException) throw inner;
      throw const NetworkException();
    }
  }

  ServerException _toServerException(int status, dynamic body) {
    if (body is! Map<String, dynamic>) {
      return ServerException(
        message: 'Серверийн хариу танигдсангүй.',
        code: 'UNKNOWN',
        statusCode: status,
      );
    }

    final Map<String, String> fieldErrors = <String, String>{};
    final Object? issues = body['issues'];
    if (issues is List) {
      for (final Object? issue in issues) {
        if (issue is Map<String, dynamic>) {
          final String field = issue['field']?.toString() ?? '_';
          final String message = issue['message']?.toString() ?? '';
          fieldErrors.putIfAbsent(field, () => message);
        }
      }
    }

    return ServerException(
      message: body['message']?.toString() ?? 'Тодорхойгүй алдаа гарлаа.',
      code: body['code']?.toString() ?? 'UNKNOWN',
      statusCode: status,
      fieldErrors: fieldErrors,
    );
  }

  /// Returns the new access token, or null when the session is unrecoverable.
  /// Concurrent callers share a single in-flight refresh.
  Future<String?> _refreshAccessToken() async {
    final Completer<String?>? inFlight = _refreshCompleter;
    if (inFlight != null) {
      return inFlight.future;
    }

    final Completer<String?> completer = Completer<String?>();
    _refreshCompleter = completer;

    try {
      final String? refreshToken = await _tokenStorage.readRefreshToken();
      if (refreshToken == null || refreshToken.isEmpty) {
        completer.complete(null);
        return null;
      }

      final Response<dynamic> response = await _dio.post<dynamic>(
        '/auth/refresh',
        data: <String, dynamic>{'refreshToken': refreshToken},
      );

      final dynamic body = response.data;
      if (response.statusCode == 200 &&
          body is Map<String, dynamic> &&
          body['success'] == true) {
        final Map<String, dynamic> payload = body['data'] as Map<String, dynamic>;
        final Map<String, dynamic> tokens = payload['tokens'] as Map<String, dynamic>;
        final String accessToken = tokens['accessToken'] as String;

        await _tokenStorage.saveTokens(
          accessToken: accessToken,
          refreshToken: tokens['refreshToken'] as String,
        );

        completer.complete(accessToken);
        return accessToken;
      }

      completer.complete(null);
      return null;
    } catch (_) {
      completer.complete(null);
      return null;
    } finally {
      _refreshCompleter = null;
    }
  }
}
