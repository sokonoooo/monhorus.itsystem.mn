/// JSON translation for `EmployeeSelfDto`, the payload of `GET /employees/me`. Kept
/// out of the domain entities so those stay free of transport concerns.
///
/// Every parser is tolerant of a missing key and intolerant of a wrong shape being
/// coerced into a plausible value: an absent counter stays absent rather than
/// becoming zero, because "no workload reported" and "no work assigned" are not the
/// same fact on a technician's profile.
library;

import '../../domain/entities/employee_profile.dart';

class EmployeeProfileModel extends EmployeeProfile {
  const EmployeeProfileModel({
    required super.id,
    required super.employeeCode,
    required super.firstName,
    required super.lastName,
    required super.status,
    required super.workload,
    super.email,
    super.phone,
    super.photoFileId,
    super.company,
    super.department,
    super.position,
    super.team,
    super.workLocation,
    super.employmentStartDate,
    super.employeeType,
    super.qualificationLevel,
    super.safetyGrade,
    super.skills,
    super.permittedJobTypes,
    super.hasDriverLicense,
    super.gpsVerificationEnabled,
  });

  factory EmployeeProfileModel.fromJson(Map<String, dynamic> json) {
    final Map<String, dynamic> workload = _object(json['workload']);

    return EmployeeProfileModel(
      id: json['id'] as String,
      employeeCode: json['employeeCode'] as String? ?? '',
      firstName: json['firstName'] as String? ?? '',
      lastName: json['lastName'] as String? ?? '',
      email: _nonEmpty(json['email']),
      phone: _nonEmpty(json['phone']),
      photoFileId: _fileIdFromUrl(json['photoUrl']),
      company: _orgRef(json['company']),
      department: _orgRef(json['department']),
      position: _orgRef(json['position']),
      team: _orgRef(json['team']),
      workLocation: _nonEmpty(json['workLocation']),
      employmentStartDate: _date(json['employmentStartDate']),
      employeeType: EmployeeKind.fromWire(json['employeeType'] as String?),
      status: EmployeeRecordStatus.fromWire(json['status'] as String?),
      qualificationLevel:
          QualificationLevel.fromWire(json['qualificationLevel'] as String?),
      safetyGrade: _nonEmpty(json['safetyGrade']),
      skills: _stringList(json['skills']),
      permittedJobTypes: _stringList(json['permittedJobTypes']),
      hasDriverLicense: json['hasDriverLicense'] == true,
      gpsVerificationEnabled: json['gpsVerificationEnabled'] == true,
      workload: EmployeeWorkload(
        activeAssignments: (workload['activeAssignments'] as num?)?.toInt() ?? 0,
        completedAssignments:
            (workload['completedAssignments'] as num?)?.toInt() ?? 0,
        openServiceRequests:
            (workload['openServiceRequests'] as num?)?.toInt() ?? 0,
      ),
    );
  }
}

// -- Parsers -----------------------------------------------------------------

Map<String, dynamic> _object(Object? value) =>
    value is Map<String, dynamic> ? value : const <String, dynamic>{};

String? _nonEmpty(Object? value) {
  if (value is! String) return null;
  final String trimmed = value.trim();
  return trimmed.isEmpty ? null : trimmed;
}

DateTime? _date(Object? value) =>
    value is String ? DateTime.tryParse(value) : null;

List<String> _stringList(Object? value) {
  if (value is! List) return const <String>[];
  return value
      .whereType<String>()
      .map((String entry) => entry.trim())
      .where((String entry) => entry.isNotEmpty)
      .toList(growable: false);
}

OrgRef? _orgRef(Object? value) {
  if (value is! Map<String, dynamic>) return null;
  final String? id = _nonEmpty(value['id']);
  final String? name = _nonEmpty(value['name']);
  if (id == null || name == null) return null;
  return OrgRef(id: id, name: name);
}

/// `photoUrl` arrives as the absolute API path `/api/v1/files/<id>`, but the shared
/// Dio client is already based at `/api/v1`, so only the trailing id is usable here.
/// Anything that does not look like that route yields null rather than a guess.
String? _fileIdFromUrl(Object? value) {
  final String? url = _nonEmpty(value);
  if (url == null) return null;
  final int marker = url.lastIndexOf('/files/');
  if (marker < 0) return null;
  final String id = url.substring(marker + '/files/'.length).trim();
  if (id.isEmpty || id.contains('/')) return null;
  return id;
}
