import 'dart:typed_data';

import '../../../../../core/network/api_result.dart';

/// Domain contract for the Профайл tab. The presentation layer depends on this,
/// never on Dio.
abstract interface class ProfileRepository {
  /// Bytes behind `GET /files/:fileId`, for the employee photo.
  Future<ApiResult<Uint8List>> downloadFile(String fileId);
}
