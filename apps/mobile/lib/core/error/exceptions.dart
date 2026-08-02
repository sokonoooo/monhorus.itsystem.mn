/// Thrown by the data layer. Repositories translate these into [Failure] values so
/// the domain and presentation layers never see transport concerns.
class ServerException implements Exception {
  const ServerException({
    required this.message,
    required this.code,
    required this.statusCode,
    this.fieldErrors = const <String, String>{},
  });

  final String message;
  final String code;
  final int statusCode;
  final Map<String, String> fieldErrors;

  @override
  String toString() => 'ServerException($code, $statusCode): $message';
}

class NetworkException implements Exception {
  const NetworkException([this.message = 'Сүлжээний холболт алдаатай байна.']);

  final String message;

  @override
  String toString() => 'NetworkException: $message';
}

class CacheException implements Exception {
  const CacheException([this.message = 'Локал сангийн алдаа.']);

  final String message;

  @override
  String toString() => 'CacheException: $message';
}
