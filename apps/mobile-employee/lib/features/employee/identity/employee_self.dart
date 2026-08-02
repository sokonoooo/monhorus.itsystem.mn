/// Which employee record the signed-in account is.
///
/// This is the pivot every "my anything" screen in the app turns on, and the API now
/// answers it directly: `GET /api/v1/employees/me` returns the caller's own employee
/// card, chosen server-side from the `Employee.systemUser` link that
/// `authenticate.middleware` resolves on every request. The request carries no
/// identifier at all, so there is nothing for this app to search for, guess at or
/// confirm.
///
/// It used to be a search. `GET /auth/me` reported no `employeeId`, so the app read
/// the staff directory — `GET /employees?email=`, then `GET /employees/:id` on every
/// candidate that had a login — until one record's `systemAccess` claimed the account.
/// That is gone, together with the bounded directory scan, the probe budget and the
/// "matched by e-mail but unconfirmed" outcome. A field technician no longer holds
/// `employee.view` and every one of those calls would now be a 403.
///
/// There is deliberately no setter and no picker. The link is a property of the
/// account, established by an administrator through `POST /employees/:id/system-access`.
/// A control that let the reader choose an employee id would be a control that decides
/// who the app thinks you are.
library;

sealed class EmployeeSelf {
  const EmployeeSelf();
}

/// The server returned the caller's own employee card.
///
/// There is no "confirmed" flag any more, and there should never be one again: the
/// record is the caller's by construction, because the server picked it from the
/// authenticated session rather than from anything the client sent.
class EmployeeSelfResolved extends EmployeeSelf {
  const EmployeeSelfResolved({required this.employeeId, required this.record});

  final String employeeId;

  /// The raw `EmployeeSelfDto`, so each feature parses the fields it needs with its
  /// own model rather than this file carrying the union of all four tabs' needs.
  ///
  /// The payload is an allowlist on the server — no salary, no documents, no
  /// registration number, no `systemAccess` block — so nothing here needs redacting
  /// before it reaches a screen.
  final Map<String, dynamic> record;
}

/// Why the record could not be read. Each case is something a person can act on,
/// which is why they are separate rather than one generic failure.
enum EmployeeSelfProblem {
  /// No signed-in user yet. Transient; the shell only renders tabs when there is one.
  noSession,

  /// The account is linked to no employee card — the endpoint's 404.
  ///
  /// A configuration state, not an error: admin, finance and system accounts commonly
  /// have no card. It is the administrator's job to link one, and the screens say so.
  notLinked,

  /// The read itself failed — network, or the server refused unexpectedly.
  ///
  /// `GET /employees/me` needs no permission beyond being signed in, so a 403 here is
  /// not the ordinary "you lack `employee.view`" case it used to be. It is a genuine
  /// surprise and is reported as one rather than as an answer about the account.
  lookupFailed,
}

class EmployeeSelfUnavailable extends EmployeeSelf {
  const EmployeeSelfUnavailable(this.problem, {this.serverMessage});

  final EmployeeSelfProblem problem;

  /// The backend's own Mongolian message, kept verbatim because it is usually more
  /// specific than anything this app could phrase — the 404 body, for instance, reads
  /// "Таны бүртгэл ажилтны картад холбогдоогүй байна. Системийн админд хандана уу."
  final String? serverMessage;
}
