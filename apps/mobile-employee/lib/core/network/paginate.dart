import 'paginated_data.dart';

/// Reads every page of a paginated endpoint into one result.
///
/// THE PROBLEM THIS EXISTS FOR. Every list datasource here defaults to `limit: 100` (some
/// to 20, 25 or 50) and every provider then returned `page.items`, dropping `total` and
/// `totalPages` on the floor. A floor with 101 objects showed 100 of them and said nothing
/// — and because the floor plan draws its markers from that same list, the 101st piece of
/// equipment was simply absent from the drawing. Silent truncation that presents as
/// completeness is the worst shape a data bug can take: nothing looks wrong.
///
/// WHY FETCH-ALL RATHER THAN A PAGER. These surfaces need the whole set to be correct, not
/// a window onto it. You cannot page a floor plan — a marker is either on the drawing or
/// the drawing is lying. The same goes for the object list behind it, which is sorted by
/// score client-side, so a partial fetch would sort the wrong population and mis-rank the
/// worst device on the floor. Where a surface genuinely is a window (a long feed the user
/// scrolls), a pager is the right answer and this helper is not.
///
/// TRUNCATION IS REPORTED, NEVER HIDDEN. [maxPages] is a backstop against an endpoint that
/// reports `totalPages` badly, not a limit anybody should hit. When it does bite, the
/// returned `total` still carries the server's real count while `items` is short, so
/// [PaginatedDataTruncation.isTruncated] is true and the caller can say so. That is the
/// whole point: the previous code could not tell "100 objects" from "100 of 340".
///
/// The first page is awaited alone, so the common case — one page, which is almost every
/// floor — costs exactly one request, as it did before.
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
    // Collapsed to a single logical page: the caller asked for everything and got
    // everything, so a page number would only invite someone to ask for the next one.
    page: 1,
    limit: items.length,
    // The SERVER's count, not `items.length`. If the backstop bit, these disagree, and
    // that disagreement is the signal the caller renders.
    total: latest.total,
    totalPages: 1,
  );
}

extension PaginatedDataTruncation<T> on PaginatedData<T> {
  /// True when the server holds more rows than this result carries.
  ///
  /// Only reachable through the [fetchAllPages] backstop. A screen showing a set that can
  /// be incomplete has to say so rather than presenting a short list as the whole truth.
  bool get isTruncated => total > items.length;
}
