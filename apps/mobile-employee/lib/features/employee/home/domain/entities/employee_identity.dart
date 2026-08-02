import '../../data/models/employee_model.dart';

/// Which employee record the signed-in account is.
///
/// This is the pivot the whole tab turns on. Neither `/planned-work` nor
/// `/service-requests` applies server-side self-scoping to its LIST — the list
/// services take no auth context at all — so "my work" exists only as a
/// client-supplied `employeeId` filter, and if that id cannot be established the
/// honest outcome is to show no personal figures at all. Showing the unfiltered lists
/// would be showing every colleague's work under the heading "Миний ажил".
///
/// The id comes from `GET /employees/me`, which the server resolves from the session.
/// There is deliberately no setter and no picker: the link is a property of the
/// account, established by an administrator through `POST
/// /employees/:id/system-access`. A control that let the reader choose an employee id
/// would be a control that decides who the app thinks you are.
sealed class EmployeeIdentity {
  const EmployeeIdentity();
}

/// The account is linked to exactly one employee record and that record confirmed it.
class ResolvedEmployeeIdentity extends EmployeeIdentity {
  const ResolvedEmployeeIdentity(this.employee);

  final EmployeeDetailModel employee;

  String get employeeId => employee.id;
  String get employeeCode => employee.employeeCode;
  String get displayName => employee.displayName;
  EmployeeWorkloadModel? get workload => employee.workload;
}

/// Why the link could not be established. Each case is something a person can act
/// on, which is why the reasons are separate rather than one generic failure.
enum EmployeeIdentityProblem {
  /// No signed-in user yet. Transient; the shell only renders tabs when there is one.
  noSession(
    'Хэрэглэгчийн мэдээлэл ачаалагдаагүй байна.',
    'Дахин нэвтэрч орно уу.',
  ),

  /// `GET /employees/me` answered 404: no employee card is linked to this account.
  notLinked(
    'Хэрэглэгч ажилтны карттай холбогдоогүй байна.',
    'Таны нэвтрэх бүртгэлийг ажилтны картад холбож өгснөөр танд оногдсон ажил, '
        'гүйцэтгэл харагдана.',
  ),

  /// The read itself failed — network, or the server refused unexpectedly.
  lookupFailed(
    'Ажилтны мэдээлэл татаж чадсангүй.',
    'Сүлжээгээ шалгаад дахин оролдоно уу.',
  );

  const EmployeeIdentityProblem(this.reason, this.detail);

  /// One line, suitable as a card heading.
  final String reason;

  /// What to do about it.
  final String detail;
}

class UnresolvedEmployeeIdentity extends EmployeeIdentity {
  const UnresolvedEmployeeIdentity(this.problem, {this.serverMessage});

  final EmployeeIdentityProblem problem;

  /// The backend's own Mongolian message when it refused, kept verbatim because it
  /// is usually more specific than anything this app could phrase.
  final String? serverMessage;

  String get reason => problem.reason;

  String get detail => serverMessage ?? problem.detail;
}
