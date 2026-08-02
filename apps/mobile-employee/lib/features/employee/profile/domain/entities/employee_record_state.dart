import 'employee_profile.dart';

/// Outcome of reading the HR record behind the signed-in account.
///
/// A first-class result rather than a nullable profile, because the two ways it can
/// come back without a record are different facts the user deserves to be told apart:
///
///   * the record exists and was returned;
///   * the account is linked to no employee card at all — a configuration state, not
///     a failure, and the one an administrator can act on.
///
/// A third case used to live here: `EmployeeRecordForbidden`, for an account without
/// `employee.view`. It is gone with the directory search. `GET /employees/me` needs
/// no permission — the server picks the record from the session — so "you may not
/// read the staff directory" is no longer an answer to "who am I", and a technician
/// who cannot list colleagues still sees their own card.
///
/// A transport or unexpected server failure is NOT modelled here. It is not an answer
/// about the account, and reporting "you have no employee card" because the network
/// dropped would state a fact the app does not have; those reach the screen as an
/// `AsyncValue.error` with the backend's own message and a retry.
sealed class EmployeeRecordState {
  const EmployeeRecordState();
}

/// The caller's own employee record, as the server chose it.
class EmployeeRecordResolved extends EmployeeRecordState {
  const EmployeeRecordResolved(this.profile);

  final EmployeeProfile profile;
}

/// The account is linked to no employee card — the endpoint's 404.
///
/// There is no "the search was capped" caveat any more. The old bounded directory
/// scan could report "not found" when it simply stopped looking, and the screen had
/// to say which; a 404 from `/employees/me` is the server's definite answer about
/// this account, so the screen can state it plainly.
class EmployeeRecordUnlinked extends EmployeeRecordState {
  const EmployeeRecordUnlinked({this.message});

  /// The backend's own Mongolian message, which names the remedy ("Системийн админд
  /// хандана уу") more precisely than a local string could. Null only if the server
  /// sent a 404 with no body.
  final String? message;
}
