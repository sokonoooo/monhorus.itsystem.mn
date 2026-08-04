/// JSON readers shared by every feature's data layer.
///
/// The five employee tabs each arrived with their own copy of these (`json_utils
/// .dart` in home and project, `work_json.dart` in work); this is the one surviving
/// implementation and the feature copies were deleted in favour of it.
///
/// Every parser tolerates a missing key and refuses to coerce a wrong shape into a
/// plausible value: an absent number stays null rather than becoming zero, because
/// "no figure was reported" and "the figure is zero" are different facts on a
/// dashboard a technician plans their day from. Where a screen genuinely wants a
/// default, it asks for one through the `...Or` variants, so the substitution is
/// visible at the call site rather than buried here.
library;

/// An ISO timestamp, or null. An empty string parses to null rather than throwing.
DateTime? parseDate(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

/// Deliberately `is num` rather than an `as num?` cast: a field the backend changed
/// to a string would otherwise throw inside a decoder under `strict-casts`, taking
/// down a whole screen over one unreadable field.
int? parseInt(Object? value) => value is num ? value.toInt() : null;

int parseIntOr(Object? value, int fallback) => parseInt(value) ?? fallback;

double? parseDouble(Object? value) => value is num ? value.toDouble() : null;

double parseDoubleOr(Object? value, double fallback) =>
    parseDouble(value) ?? fallback;

/// Absent or non-boolean reads as [fallback]; the wire value is never inferred from
/// a truthy string or a 1.
bool parseBool(Object? value, {bool fallback = false}) =>
    value is bool ? value : fallback;

/// A non-empty string, or null.
///
/// The empty string is folded into null on purpose: several DTOs (`BuildingDto
/// .projectId`, `FloorDto.buildingId`, `FloorDto.projectId`) are typed `string` on
/// the wire and emit `''` rather than null when the relation is missing, so treating
/// `''` as a value would put an empty id into a request path.
String? parseString(Object? value) {
  if (value is! String || value.isEmpty) return null;
  return value;
}

String parseStringOr(Object? value, String fallback) =>
    parseString(value) ?? fallback;

List<T> parseList<T>(Object? raw, T Function(Map<String, dynamic> json) fromJson) {
  if (raw is! List) return const <Never>[];
  return raw.whereType<Map<String, dynamic>>().map(fromJson).toList(growable: false);
}

/// Non-empty strings only, so a blank entry never renders as an empty chip.
List<String> parseStringList(Object? raw) {
  if (raw is! List) return const <String>[];
  return raw
      .whereType<String>()
      .where((String value) => value.isNotEmpty)
      .toList(growable: false);
}

/// A 24-character hexadecimal Mongo id, or null.
///
/// Needed because `PlannedWorkTaskDto.assignedEmployeeId` is not always an id on the
/// wire: when the backend populates the relation it stringifies the whole Mongoose
/// document into the field, so it arrives as
/// `"{\n  _id: new ObjectId('...'),\n  firstName: ...}"`. Accepting only a
/// well-formed id keeps that malformed value out of a request path, where it would
/// otherwise come back as a 400 from the server's own `objectIdSchema`.
String? parseObjectId(Object? value) {
  if (value is! String) return null;
  return _objectId.hasMatch(value) ? value : null;
}

final RegExp _objectId = RegExp(r'^[a-f\d]{24}$', caseSensitive: false);

/// A `{ id, name }` relation, which the API uses for customer, project, building,
/// team and assignee references alike.
class NamedRef {
  const NamedRef({required this.id, required this.name});

  final String id;
  final String name;

  /// Accepts both reference shapes the API sends.
  ///
  /// A team reference carries `name`. An **employee** reference does not:
  /// `EmployeeRefDto` is `{id, employeeCode, firstName, lastName, photoUrl}`
  /// (`packages/shared/src/types/employee.types.ts:15-21`), so reading `name` alone
  /// parsed every assignee as the empty string and any screen printing them showed a
  /// blank - or a bare ", " once there were two.
  ///
  /// Surname first, matching how the app composes a full name everywhere else
  /// (`home/data/models/employee_model.dart`). `employeeCode` is the last resort:
  /// an identifier is worth more to a technician than an empty row.
  static NamedRef? fromJson(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    final String? id = parseString(raw['id']);
    if (id == null) return null;

    final String? name = parseString(raw['name']);
    if (name != null && name.isNotEmpty) return NamedRef(id: id, name: name);

    final String last = parseString(raw['lastName']) ?? '';
    final String first = parseString(raw['firstName']) ?? '';
    final String composed = <String>[
      if (last.isNotEmpty) last,
      if (first.isNotEmpty) first,
    ].join(' ');

    return NamedRef(
      id: id,
      name: composed.isNotEmpty ? composed : (parseString(raw['employeeCode']) ?? ''),
    );
  }

  static List<NamedRef> listFrom(Object? raw) {
    if (raw is! List) return const <NamedRef>[];
    return raw.map(NamedRef.fromJson).whereType<NamedRef>().toList(growable: false);
  }
}
