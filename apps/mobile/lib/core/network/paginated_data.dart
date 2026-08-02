/// Mirrors `PaginatedData<T>` in packages/shared/src/types/api.types.ts.
///
/// The existing `PaginatedUsers` predates this and stays as it is; new list endpoints
/// use this generic form so each one does not restate the same four counters.
class PaginatedData<T> {
  const PaginatedData({
    required this.items,
    required this.page,
    required this.limit,
    required this.total,
    required this.totalPages,
  });

  final List<T> items;
  final int page;
  final int limit;
  final int total;
  final int totalPages;

  factory PaginatedData.fromJson(
    Map<String, dynamic> json,
    T Function(Map<String, dynamic> item) itemFromJson,
  ) {
    final Object? rawItems = json['items'];
    return PaginatedData<T>(
      items: rawItems is List
          ? rawItems
              .whereType<Map<String, dynamic>>()
              .map(itemFromJson)
              .toList(growable: false)
          : const <Never>[],
      page: (json['page'] as num?)?.toInt() ?? 1,
      limit: (json['limit'] as num?)?.toInt() ?? 0,
      total: (json['total'] as num?)?.toInt() ?? 0,
      totalPages: (json['totalPages'] as num?)?.toInt() ?? 1,
    );
  }

  static PaginatedData<T> empty<T>() => PaginatedData<T>(
        items: const <Never>[],
        page: 1,
        limit: 0,
        total: 0,
        totalPages: 1,
      );

  bool get isEmpty => items.isEmpty;

  bool get hasMore => page < totalPages;
}
