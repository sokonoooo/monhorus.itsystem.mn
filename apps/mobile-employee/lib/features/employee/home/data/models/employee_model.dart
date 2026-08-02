import '../../../../../core/util/json_parse.dart';

/// Mirrors `EmployeeSelfDto`, narrowed to the identity and workload blocks.
///
/// There is no `systemAccess` on the wire any more, and nothing here tries to read
/// one: `GET /employees/me` returns the caller's own card by construction, so a
/// `linkedUserId` to check it against would be a field confirming what the endpoint
/// already guarantees.
class EmployeeDetailModel {
  const EmployeeDetailModel({
    required this.id,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
    required this.email,
    required this.phone,
    required this.positionName,
    required this.departmentName,
    required this.teamId,
    required this.teamName,
    required this.workload,
  });

  final String id;
  final String employeeCode;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String? positionName;
  final String? departmentName;
  final String? teamId;
  final String? teamName;

  final EmployeeWorkloadModel? workload;

  factory EmployeeDetailModel.fromJson(Map<String, dynamic> json) {
    return EmployeeDetailModel(
      id: parseString(json['id']) ?? '',
      employeeCode: parseString(json['employeeCode']) ?? '',
      firstName: parseString(json['firstName']) ?? '',
      lastName: parseString(json['lastName']) ?? '',
      email: parseString(json['email']),
      phone: parseString(json['phone']),
      positionName: NamedRef.fromJson(json['position'])?.name,
      departmentName: NamedRef.fromJson(json['department'])?.name,
      teamId: NamedRef.fromJson(json['team'])?.id,
      teamName: NamedRef.fromJson(json['team'])?.name,
      workload: json['workload'] is Map<String, dynamic>
          ? EmployeeWorkloadModel.fromJson(
              json['workload']! as Map<String, dynamic>)
          : null,
    );
  }

  /// The backend prints staff names surname-first everywhere else, so the home
  /// greeting follows suit.
  String get displayName => <String>[
        if (lastName.isNotEmpty) lastName,
        if (firstName.isNotEmpty) firstName,
      ].join(' ');
}

/// Mirrors `EmployeeWorkloadDto` — the only per-employee performance figures the API
/// exposes. Backend-computed, so the home screen prints them rather than counting
/// records itself.
class EmployeeWorkloadModel {
  const EmployeeWorkloadModel({
    required this.activeAssignments,
    required this.completedAssignments,
    required this.openServiceRequests,
  });

  final int activeAssignments;
  final int completedAssignments;
  final int openServiceRequests;

  factory EmployeeWorkloadModel.fromJson(Map<String, dynamic> json) {
    return EmployeeWorkloadModel(
      activeAssignments: parseInt(json['activeAssignments']) ?? 0,
      completedAssignments: parseInt(json['completedAssignments']) ?? 0,
      openServiceRequests: parseInt(json['openServiceRequests']) ?? 0,
    );
  }

  int get total => activeAssignments + completedAssignments;
}
