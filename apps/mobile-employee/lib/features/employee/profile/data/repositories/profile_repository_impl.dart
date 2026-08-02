import 'dart:typed_data';

import '../../../../../core/error/exceptions.dart';
import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../domain/repositories/profile_repository.dart';
import '../datasources/profile_remote_data_source.dart';

class ProfileRepositoryImpl implements ProfileRepository {
  const ProfileRepositoryImpl(this._remote);

  final ProfileRemoteDataSource _remote;

  @override
  Future<ApiResult<Uint8List>> downloadFile(String fileId) async {
    try {
      return Success<Uint8List>(await _remote.downloadFile(fileId));
    } catch (error) {
      return FailureResult<Uint8List>(_mapException(error));
    }
  }

  /// Single translation point from data-layer exceptions to domain failures, the
  /// same shape the customer portal's repository uses.
  Failure _mapException(Object error) {
    if (error is ServerException) {
      if (error.statusCode == 401 || error.statusCode == 403) {
        return AuthFailure(error.message, code: error.code);
      }
      return ServerFailure(
        error.message,
        code: error.code,
        fieldErrors: error.fieldErrors,
      );
    }
    if (error is NetworkException) {
      return NetworkFailure(error.message);
    }
    return const ServerFailure('Гэнэтийн алдаа гарлаа.', code: 'UNKNOWN');
  }
}
