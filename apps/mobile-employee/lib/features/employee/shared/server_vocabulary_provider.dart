import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../auth/domain/entities/app_user.dart';
import '../../auth/presentation/providers/auth_provider.dart';
import 'server_vocabulary.dart';
import 'server_vocabulary_data_source.dart';

/// The transport, as a provider so a test can stand in for the network.
///
/// Separate from the [FutureProvider] below because the interesting behaviour of that
/// provider is what it does when this one throws, and a test cannot demonstrate that
/// against a real socket.
final Provider<ServerVocabularyRemoteDataSource> serverVocabularyDataSourceProvider =
    Provider<ServerVocabularyRemoteDataSource>(
  (Ref ref) => ServerVocabularyRemoteDataSource(ref.watch(dioClientProvider)),
);

/// Reads `GET /vocabulary` once per session and installs the answer.
///
/// Riverpod caches the future, so the four tabs share one request the way they share
/// one `employeeSelfProvider`. Watched by the shell, which is what starts it: there is
/// nothing to fetch before somebody is signed in, and the endpoint is authenticated.
///
/// Keyed on the account id rather than on the whole [AppUser]. `/auth/me` is
/// re-requested on several mounts to refresh the permission set, and each answer is a
/// new object; watching the object itself would re-fetch the vocabulary every time one
/// landed, for words that cannot have changed.
///
/// **Every failure is swallowed on purpose.** A 401, a 403, a 500, a timeout, a phone
/// with no signal, a body this binary could not parse — all of them resolve to
/// [ServerVocabulary.empty], nothing is installed, and every label and colour in the
/// app stays the one it was compiled with. There is no error state to render and no
/// retry to offer, because there is nothing for a technician to do about it and
/// nothing missing from their screen: this call decides what the words are called, not
/// whether there are any. Reporting it would be reporting a problem the reader cannot
/// see and cannot fix.
final FutureProvider<ServerVocabulary> serverVocabularyProvider =
    FutureProvider<ServerVocabulary>((Ref ref) async {
  final String? userId =
      ref.watch(currentUserProvider.select((AppUser? user) => user?.id));
  if (userId == null) return ServerVocabulary.empty;

  final ServerVocabularyRemoteDataSource source =
      ref.watch(serverVocabularyDataSourceProvider);

  try {
    final ServerVocabulary vocabulary = await source.fetch();
    installServerVocabulary(vocabulary);
    return vocabulary;
  } catch (_) {
    return ServerVocabulary.empty;
  }
});
