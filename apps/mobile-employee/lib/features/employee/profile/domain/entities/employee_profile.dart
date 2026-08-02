/// The employee (HR) record behind a signed-in account.
///
/// Mirrors `EmployeeSelfDto` — the payload of `GET /employees/me`
/// (apps/backend/src/modules/employee/employee.mapper.ts), which is an allowlist
/// rather than a redaction of the full detail DTO. Salary and bank details,
/// documents, education, work history, emergency contacts, addresses, the Mongolian
/// registration number and the whole `systemAccess` block are not on the wire at all,
/// so there is nothing here to strip and nothing a screen could accidentally show.
///
/// Two fields this class used to carry are gone with that block: `linkedUserId`,
/// which existed only to confirm that a searched-for record really was the caller's,
/// and `accessRoles`, which listed the account's RBAC roles. Neither survives the
/// move to a self endpoint — the record is the caller's by construction, and the role
/// list is an administration concern rather than something a field technician's
/// profile screen needs.
library;

import 'package:equatable/equatable.dart';

/// `EMPLOYEE_STATUSES` with its `EMPLOYEE_STATUS_LABELS`.
///
/// Parsed defensively: an unrecognised value from a newer API degrades to [unknown]
/// and renders the wire value, rather than being silently reported as ACTIVE.
enum EmployeeRecordStatus {
  draft('DRAFT', 'Ноорог'),
  active('ACTIVE', 'Идэвхтэй'),
  onLeave('ON_LEAVE', 'Чөлөөтэй'),
  suspended('SUSPENDED', 'Түр түдгэлзсэн'),
  terminated('TERMINATED', 'Ажлаас гарсан'),
  inactive('INACTIVE', 'Идэвхгүй'),
  unknown('', '—');

  const EmployeeRecordStatus(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static EmployeeRecordStatus fromWire(String? value) {
    return EmployeeRecordStatus.values.firstWhere(
      (EmployeeRecordStatus status) => status.wireValue == value,
      orElse: () => EmployeeRecordStatus.unknown,
    );
  }
}

/// `EMPLOYEE_TYPES` with its `EMPLOYEE_TYPE_LABELS`.
enum EmployeeKind {
  fullTime('FULL_TIME', 'Үндсэн ажилтан'),
  partTime('PART_TIME', 'Цагийн ажилтан'),
  contract('CONTRACT', 'Гэрээт ажилтан'),
  temporary('TEMPORARY', 'Түр ажилтан'),
  intern('INTERN', 'Дадлагажигч');

  const EmployeeKind(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static EmployeeKind? fromWire(String? value) {
    if (value == null) return null;
    for (final EmployeeKind kind in EmployeeKind.values) {
      if (kind.wireValue == value) return kind;
    }
    return null;
  }
}

/// `QUALIFICATION_LEVELS` with its `QUALIFICATION_LEVEL_LABELS`.
enum QualificationLevel {
  junior('JUNIOR', 'Дадлагажигч'),
  middle('MIDDLE', 'Дунд'),
  senior('SENIOR', 'Ахлах'),
  lead('LEAD', 'Багийн ахлагч'),
  expert('EXPERT', 'Мэргэшсэн');

  const QualificationLevel(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static QualificationLevel? fromWire(String? value) {
    if (value == null) return null;
    for (final QualificationLevel level in QualificationLevel.values) {
      if (level.wireValue == value) return level;
    }
    return null;
  }
}

/// A populated `{ id, name }` relation: company, department, position or team.
class OrgRef extends Equatable {
  const OrgRef({required this.id, required this.name});

  final String id;
  final String name;

  @override
  List<Object?> get props => <Object?>[id, name];
}

/// `EmployeeWorkloadDto`.
///
/// These three counters are the only per-employee performance figures the API
/// exposes. There is no month or year completion count and no revisit count, so the
/// tab shows exactly these and captions them for what they are.
class EmployeeWorkload extends Equatable {
  const EmployeeWorkload({
    required this.activeAssignments,
    required this.completedAssignments,
    required this.openServiceRequests,
  });

  static const EmployeeWorkload empty = EmployeeWorkload(
    activeAssignments: 0,
    completedAssignments: 0,
    openServiceRequests: 0,
  );

  final int activeAssignments;
  final int completedAssignments;
  final int openServiceRequests;

  @override
  List<Object?> get props => <Object?>[
        activeAssignments,
        completedAssignments,
        openServiceRequests,
      ];
}

class EmployeeProfile extends Equatable {
  const EmployeeProfile({
    required this.id,
    required this.employeeCode,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.workload,
    this.email,
    this.phone,
    this.photoFileId,
    this.company,
    this.department,
    this.position,
    this.team,
    this.workLocation,
    this.employmentStartDate,
    this.employeeType,
    this.qualificationLevel,
    this.safetyGrade,
    this.skills = const <String>[],
    this.permittedJobTypes = const <String>[],
    this.hasDriverLicense = false,
    this.gpsVerificationEnabled = false,
  });

  final String id;
  final String employeeCode;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;

  /// Id of the stored file behind `photoUrl`, extracted from `/api/v1/files/:id`.
  ///
  /// The URL itself is unusable as-is: `GET /files/:fileId` needs the Bearer header,
  /// so the bytes are fetched through the shared Dio client rather than by handing
  /// the path to `Image.network`.
  ///
  /// That route keys EMPLOYEE-owned files on `employee.view`, which a technician no
  /// longer holds; the backend carries a narrow exemption (`isOwnProfilePhoto` in
  /// storage.routes.ts) matched against the caller's own `Employee.photoDocument`, so
  /// this one file resolves and a colleague's HR documents still do not. If an avatar
  /// ever starts 403-ing, that exemption is where to look — not `employee.view`.
  final String? photoFileId;

  final OrgRef? company;
  final OrgRef? department;
  final OrgRef? position;
  final OrgRef? team;
  final String? workLocation;
  final DateTime? employmentStartDate;
  final EmployeeKind? employeeType;
  final EmployeeRecordStatus status;
  final QualificationLevel? qualificationLevel;

  /// `SAFETY_GRADES` is a free ordinal I..V with no label map, so it is carried as
  /// the raw string the backend stored.
  final String? safetyGrade;

  final List<String> skills;
  final List<String> permittedJobTypes;
  final bool hasDriverLicense;

  /// Whether this employee's field actions are expected to carry a GPS fix.
  ///
  /// On the wire because the app has to know it before starting a job, not because
  /// the profile screen renders it. Nothing in this build captures a location yet, so
  /// it is carried and not shown rather than being dropped and re-added later.
  final bool gpsVerificationEnabled;

  final EmployeeWorkload workload;

  /// Surname first, as Mongolian records are read.
  String get displayName {
    final String surname = lastName.trim();
    final String given = firstName.trim();
    if (surname.isEmpty) return given;
    if (given.isEmpty) return surname;
    return '$surname $given';
  }

  @override
  List<Object?> get props => <Object?>[
        id,
        employeeCode,
        firstName,
        lastName,
        email,
        phone,
        photoFileId,
        company,
        department,
        position,
        team,
        workLocation,
        employmentStartDate,
        employeeType,
        status,
        qualificationLevel,
        safetyGrade,
        skills,
        permittedJobTypes,
        hasDriverLicense,
        gpsVerificationEnabled,
        workload,
      ];
}
