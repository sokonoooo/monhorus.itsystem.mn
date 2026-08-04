import 'package:equatable/equatable.dart';

/// Which employee record the signed-in account belongs to.
///
/// NO LONGER THE THING THAT MAKES "МИНИЙ" WORK. It used to be: `GET /planned-work`
/// took no auth context, so the only way to show a technician their own work was to
/// send `employeeId=<my employee record>` — and that filter could not express the
/// server's actual rule, which admits a caller named individually OR on the assigned
/// team. `listPlannedWork` now takes the caller and bounds the query itself, so the
/// list asks for nothing and gets the right answer.
///
/// What the identity is still for, and it is enough to keep it:
///
///   - Telling an account with NO employee card that this is why it sees nothing. A
///     scoped caller the server cannot match to an employee is answered the empty
///     list, which is correct and unreadable without this.
///   - [ResolvedWorkIdentity.teamId], which the "Багийн" segment narrows by and which
///     `resolvePlannedWorkAssignment` compares against a record's `assignedTeam` to
///     decide which controls it is honest to offer.
///
/// The id comes from `GET /employees/me`, which the server resolves from the current
/// `Employee.systemUser` link on the authenticated session. It is a read, not a
/// search: the request carries no identifier, so there is no candidate to confirm and
/// no way for the app to land on somebody else's card.
sealed class WorkIdentity extends Equatable {
  const WorkIdentity();
}

class ResolvedWorkIdentity extends WorkIdentity {
  const ResolvedWorkIdentity({
    required this.employeeId,
    required this.employeeCode,
    required this.fullName,
    this.positionName,
    this.teamId,
    this.teamName,
  });

  final String employeeId;
  final String employeeCode;
  final String fullName;
  final String? positionName;

  /// The team the "Багийн" segment filters on. Null when the employee record is not
  /// attached to a team, in which case that segment has nothing it could ask for.
  final String? teamId;
  final String? teamName;

  @override
  List<Object?> get props => <Object?>[
        employeeId,
        employeeCode,
        fullName,
        positionName,
        teamId,
        teamName,
      ];
}

/// Why the identity could not be established, phrased for the person holding the
/// phone rather than for a developer.
enum WorkIdentityProblem {
  /// `GET /employees/me` answered 404: no employee card is linked to this login.
  notLinked(
    'Ажилтны карт холбогдоогүй байна',
    'Таны нэвтрэх эрх ямар ч ажилтны карттай холбогдоогүй байна. Администратор '
        'таны бүртгэлийг ажилтны картад холбосны дараа "Миний ажил" харагдана.',
  ),

  /// The read itself failed (network, 5xx). Distinguished from `notLinked` so the
  /// user is told to retry rather than to call an administrator.
  lookupFailed(
    'Ажилтны бүртгэл ачаалж чадсангүй',
    'Сүлжээ эсвэл серверийн алдаанаас болж таны ажилтны картыг тодорхойлж чадсангүй. '
        'Дахин оролдоно уу.',
  );

  const WorkIdentityProblem(this.title, this.detail);

  final String title;
  final String detail;
}

class UnresolvedWorkIdentity extends WorkIdentity {
  const UnresolvedWorkIdentity(this.problem);

  final WorkIdentityProblem problem;

  String get title => problem.title;
  String get detail => problem.detail;

  @override
  List<Object?> get props => <Object?>[problem];
}
