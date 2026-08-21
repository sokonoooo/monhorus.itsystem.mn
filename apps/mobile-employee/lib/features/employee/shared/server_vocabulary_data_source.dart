import '../../../core/network/dio_client.dart';
import 'server_vocabulary.dart';

/// Transport for the one endpoint that answers "what does this installation call
/// things".
///
///   GET /vocabulary
///
/// Throws [ServerException] or [NetworkException] from the shared [DioClient]; the
/// provider beside this turns either into the compiled-in words.
///
/// Takes no parameters and needs no permission. It is deliberately NOT `GET /settings`
/// — that route answers 403 for a technician, because `settings.view` is admin,
/// management and finance only, and asking for it here would be the old mistake of
/// gating a person's own screen on a grant they should not hold.
class ServerVocabularyRemoteDataSource {
  const ServerVocabularyRemoteDataSource(this._client);

  final DioClient _client;

  Future<ServerVocabulary> fetch() {
    return _client.request<ServerVocabulary>(
      path: '/vocabulary',
      method: 'GET',
      decoder: (Object? json) => json is Map<String, dynamic>
          ? ServerVocabulary.fromJson(json)
          : ServerVocabulary.empty,
    );
  }
}
