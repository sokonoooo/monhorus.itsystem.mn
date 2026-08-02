/// The slice of `EmployeeSelfDto` the calendar needs in order to say whose schedule
/// it is showing.
///
/// Only the naming fields are parsed. Everything else on the payload belongs to the
/// Профайл tab, which owns its own model.
///
/// There is no `systemAccess` here any longer. `GET /employees/me` returns the
/// caller's own record chosen server-side, so there is nothing left to confirm the
/// match against — the match is the endpoint.
library;

/// The subset of `EmployeeSelfDto` used to label the calendar.
class EmployeeDetailModel {
  const EmployeeDetailModel({
    required this.id,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
  });

  factory EmployeeDetailModel.fromJson(Map<String, dynamic> json) {
    return EmployeeDetailModel(
      id: json['id']?.toString() ?? '',
      employeeCode: json['employeeCode']?.toString() ?? '',
      firstName: json['firstName']?.toString() ?? '',
      lastName: json['lastName']?.toString() ?? '',
    );
  }

  final String id;
  final String employeeCode;
  final String firstName;
  final String lastName;

  String get displayName => '$lastName $firstName'.trim();
}
