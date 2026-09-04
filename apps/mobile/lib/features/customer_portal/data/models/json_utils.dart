/// Shared JSON helpers for the customer portal models.
///
/// Every parser here is deliberately tolerant of a missing key but never of a wrong
/// shape being silently coerced into a plausible value: an absent number stays null
/// rather than becoming zero, because a zero reading and no reading are different
/// facts on an electrical report.
library;

DateTime? parseDate(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

int? parseInt(Object? value) => (value as num?)?.toInt();

double? parseDouble(Object? value) => (value as num?)?.toDouble();

List<T> parseList<T>(Object? raw, T Function(Map<String, dynamic> json) fromJson) {
  if (raw is! List) return const <Never>[];
  return raw
      .whereType<Map<String, dynamic>>()
      .map(fromJson)
      .toList(growable: false);
}

List<String> parseStringList(Object? raw) {
  if (raw is! List) return const <String>[];
  return raw.whereType<String>().toList(growable: false);
}

/// `BuildingDto.projectId`, `FloorDto.buildingId` and `FloorDto.projectId` are typed
/// `string` on the wire but the backend emits an empty string, never null, when the
/// relation is missing. Normalising here keeps every screen from restating the rule.
String? emptyToNull(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return value;
}

/// An untyped attribute bag — `Record<string, ObjectAttributeValue>` on the wire.
///
/// Values are kept as they arrived rather than coerced: what a value MEANS is decided by
/// the type's own definition of that key, and a bag parsed without one would have to
/// guess. A body that is not an object at all reads as no answers, which is what every
/// object written before per-type attributes existed sends.
Map<String, Object?> parseAttributeValues(Object? raw) {
  if (raw is! Map) return const <String, Object?>{};
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in raw.entries)
      if (entry.key is String) entry.key! as String: entry.value,
  };
}
