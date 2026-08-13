import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_mobile/core/network/paginate.dart';
import 'package:monhorus_mobile/core/network/paginated_data.dart';

/// [fetchAllPages] is the one pattern every "this set must be complete" read goes through.
///
/// The bug it exists for: a floor's object list was fetched with a fixed `limit` and the
/// provider returned `page.items`, so a floor holding more objects than the limit lost the
/// remainder — from the list AND from the floor plan, which draws its markers from the
/// same read. Nothing on screen said so.
PaginatedData<int> _page(List<int> items, {required int page, required int totalPages, required int total}) =>
    PaginatedData<int>(
      items: items,
      page: page,
      limit: items.length,
      total: total,
      totalPages: totalPages,
    );

void main() {
  group('fetchAllPages', () {
    test('a single-page answer costs exactly one request', () async {
      final List<int> asked = <int>[];
      final PaginatedData<int> result = await fetchAllPages<int>((int page) async {
        asked.add(page);
        return _page(<int>[1, 2, 3], page: page, totalPages: 1, total: 3);
      });

      expect(asked, <int>[1], reason: 'the common case must not cost extra round trips');
      expect(result.items, <int>[1, 2, 3]);
    });

    test('walks every page and concatenates them in order', () async {
      final List<int> asked = <int>[];
      final PaginatedData<int> result = await fetchAllPages<int>((int page) async {
        asked.add(page);
        return _page(
          <int>[page * 10, page * 10 + 1],
          page: page,
          totalPages: 3,
          total: 6,
        );
      });

      expect(asked, <int>[1, 2, 3]);
      expect(result.items, <int>[10, 11, 20, 21, 30, 31]);
      expect(result.total, 6);
      expect(result.isTruncated, isFalse);
    });

    test('a 101st object is not lost, which is the whole point', () async {
      // The exact shape of the reported bug: limit 100, 101 rows on the floor.
      final PaginatedData<int> result = await fetchAllPages<int>((int page) async {
        final List<int> items =
            page == 1 ? List<int>.generate(100, (int i) => i) : <int>[100];
        return _page(items, page: page, totalPages: 2, total: 101);
      });

      expect(result.items, hasLength(101));
      expect(result.items.last, 100);
    });

    test('reports truncation rather than presenting a short set as the whole', () async {
      // An endpoint claiming far more pages than the backstop allows. The result is short
      // BY DESIGN, and must admit it — the previous code could not tell 100 from 100-of-340.
      final PaginatedData<int> result = await fetchAllPages<int>(
        (int page) async => _page(<int>[page], page: page, totalPages: 999, total: 999),
        maxPages: 3,
      );

      expect(result.items, hasLength(3));
      expect(result.total, 999);
      expect(result.isTruncated, isTrue);
    });

    test('an empty set is not mistaken for more pages', () async {
      final PaginatedData<int> result = await fetchAllPages<int>(
        (int page) async => _page(<int>[], page: 1, totalPages: 1, total: 0),
      );

      expect(result.items, isEmpty);
      expect(result.isTruncated, isFalse);
    });
  });
}
