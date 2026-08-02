import 'dart:typed_data';

import 'package:dio/dio.dart';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/network/dio_client.dart';

/// Transport for the Профайл tab. Throws [ServerException] or [NetworkException];
/// the repository converts those into failures.
///
/// Uses the shared [DioClient] — the same instance that carries the session and
/// performs the 401 refresh. No second Dio and no second token store exist here.
class ProfileRemoteDataSource {
  const ProfileRemoteDataSource(this._client);

  final DioClient _client;

  /// GET /files/:fileId — raw bytes, still behind the Bearer header.
  Future<Uint8List> downloadFile(String fileId) async {
    try {
      final Response<List<int>> response = await _client.raw.get<List<int>>(
        '/files/$fileId',
        options: Options(
          responseType: ResponseType.bytes,
          // The envelope-aware validateStatus on the shared options would let a 404
          // body through as if it were an image.
          validateStatus: (int? status) => status != null && status < 400,
        ),
      );

      final List<int>? bytes = response.data;
      if (bytes == null || bytes.isEmpty) {
        throw const ServerException(
          message: 'Зураг хоосон байна.',
          code: 'EMPTY_FILE',
          statusCode: 200,
        );
      }
      return Uint8List.fromList(bytes);
    } on DioException catch (error) {
      final Object? inner = error.error;
      if (inner is NetworkException) throw inner;
      if (inner is ServerException) throw inner;
      throw ServerException(
        message: 'Зураг татаж чадсангүй.',
        code: 'FILE_DOWNLOAD_FAILED',
        statusCode: error.response?.statusCode ?? 0,
      );
    }
  }
}
