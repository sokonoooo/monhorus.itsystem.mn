/// The slice of `EmployeeSelfDto` this tab reads off the resolved identity.
///
/// The `GET /employees/me` read that produces it lives in features/employee/identity
/// and is shared with the other tabs; this file only parses the fields the Ажил tab
/// needs. The full employee profile belongs to the Профайл tab, which owns its own
/// models.
///
/// `team` matters here beyond display: it is one half of the backend's planned-work
/// assignment scope, which admits a caller either because the work names them
/// directly or because the work is assigned to their team.
library;

import '../../../../../core/util/json_parse.dart';

class EmployeeDetailModel {
  const EmployeeDetailModel({
    required this.id,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
    this.positionName,
    this.teamId,
    this.teamName,
  });

  final String id;
  final String employeeCode;
  final String firstName;
  final String lastName;
  final String? positionName;
  final String? teamId;
  final String? teamName;

  String get fullName => <String>[lastName, firstName]
      .where((String part) => part.isNotEmpty)
      .join(' ');

  factory EmployeeDetailModel.fromJson(Map<String, dynamic> json) {
    final Object? team = json['team'];
    final Object? position = json['position'];

    return EmployeeDetailModel(
      id: parseStringOr(json['id'], ''),
      employeeCode: parseStringOr(json['employeeCode'], '-'),
      firstName: parseStringOr(json['firstName'], ''),
      lastName: parseStringOr(json['lastName'], ''),
      positionName: position is Map<String, dynamic>
          ? parseString(position['name'])
          : null,
      teamId: team is Map<String, dynamic> ? parseObjectId(team['id']) : null,
      teamName:
          team is Map<String, dynamic> ? parseString(team['name']) : null,
    );
  }
}
