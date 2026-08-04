import 'package:equatable/equatable.dart';

/// Which employee record the signed-in account is.
///
/// `GET /calendar` scopes itself now: `buildCalendar` bounds both of its sources by the
/// assigned-or-team predicate read from the session, so the id below is no longer what
/// keeps a colleague's work off the screen. This type survives because the id is still
/// worth having — it narrows the request to the caller alone even for an account that
/// holds an oversight key — and because an account with no employee card gets an EMPTY
/// calendar rather than everybody's, which is a fact the screen has to be able to explain.
///
/// The id comes from `GET /employees/me`, which the server resolves from the session.
/// A resolution is therefore either the caller's own record or nothing at all; there
/// is no longer a weaker "matched by e-mail address" outcome for the screen to
/// disclaim, because the app no longer guesses.
sealed class EmployeeIdentity extends Equatable {
  const EmployeeIdentity();
}

class ResolvedEmployeeIdentity extends EmployeeIdentity {
  const ResolvedEmployeeIdentity({
    required this.employeeId,
    required this.displayName,
    required this.employeeCode,
  });

  final String employeeId;
  final String displayName;
  final String employeeCode;

  @override
  List<Object?> get props => <Object?>[employeeId, displayName, employeeCode];
}

/// Why the account could not be tied to an employee record.
enum IdentityGap {
  /// No signed-in user yet.
  noSession,

  /// The account is linked to no employee card — the endpoint's 404.
  notFound,

  /// The read itself failed (network, or the server refused).
  lookupFailed,
}

class UnresolvedEmployeeIdentity extends EmployeeIdentity {
  const UnresolvedEmployeeIdentity(this.gap, this.detail);

  final IdentityGap gap;

  /// A sentence the screen can show as-is. Never an exception string.
  final String detail;

  static const UnresolvedEmployeeIdentity noSession = UnresolvedEmployeeIdentity(
    IdentityGap.noSession,
    'Нэвтэрсэн хэрэглэгч олдсонгүй.',
  );

  static const UnresolvedEmployeeIdentity notFound = UnresolvedEmployeeIdentity(
    IdentityGap.notFound,
    'Таны нэвтрэх бүртгэл ажилтны картад холбогдоогүй байна. Тиймээс хуваарь '
    'хоосон харагдаж болзошгүй. Админд хандана уу.',
  );

  static const UnresolvedEmployeeIdentity lookupFailed = UnresolvedEmployeeIdentity(
    IdentityGap.lookupFailed,
    'Ажилтны бүртгэлийг уншиж чадсангүй. Хуваарь дутуу харагдаж болзошгүй.',
  );

  @override
  List<Object?> get props => <Object?>[gap, detail];
}
