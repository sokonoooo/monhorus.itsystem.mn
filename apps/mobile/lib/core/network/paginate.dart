import 'paginated_data.dart';

/// Reads every page of a paginated endpoint into one result.
///
/// The customer app's half of the same helper the employee app carries, for the same
/// reason: every list datasource here defaults to a fixed `limit` (20, 25, 50 or 100) and
/// the providers returned `page.items`, dropping `total` and `totalPages`. A building with
/// more objects than the limit showed a short list and said nothing — and since the floor
/// plan draws its markers from that list, the missing equipment was absent from the
/// drawing too. Silent truncation that presents as completeness.
///
/// A pager is the right answer for a long feed the reader scrolls. It is the wrong answer
/// for a floor plan: a marker is either on the drawing or the drawing is lying.
///
/// [maxPages] is a backstop against an endpoint that reports `totalPages` badly, not a
/// limit anybody should reach. If it bites, `total` still carries the server's real count
/// while `items` is short, so [PaginatedDataTruncation.isTruncated] is true and the caller
/// can say so rather than presenting a partial set as the whole.
Future<PaginatedData<T>> fetchAllPages<T>(
  Future<PaginatedData<T>> Function(int page) fetchPage, {
  int maxPages = 50,
}) async {
  final PaginatedData<T> first = await fetchPage(1);
  if (!first.hasMore) return first;

  final List<T> items = <T>[...first.items];
  PaginatedData<T> latest = first;
  int pagesRead = 1;

  while (latest.hasMore && pagesRead < maxPages) {
    latest = await fetchPage(latest.page + 1);
    items.addAll(latest.items);
    pagesRead += 1;
  }

  return PaginatedData<T>(
    items: items,
    page: 1,
    limit: items.length,
    // The server's count, not `items.length`: if the backstop bit, the two disagree and
    // that disagreement is the signal.
    total: latest.total,
    totalPages: 1,
  );
}

extension PaginatedDataTruncation<T> on PaginatedData<T> {
  /// True when the server holds more rows than this result carries.
  bool get isTruncated => total > items.length;
}
