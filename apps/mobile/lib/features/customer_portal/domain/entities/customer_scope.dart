/// Which харилцагч байгууллага the signed-in user is allowed to see.
///
/// Every customer-owned read in this feature takes a [ResolvedCustomerScope] rather
/// than a bare optional `customerId`, so it is not possible to write a screen that
/// issues an unscoped list request by forgetting a parameter. The type is the
/// enforcement.
///
/// -- Where the scope comes from ----------------------------------------------
///
/// From the authenticated session and nowhere else. `GET /auth/me` returns a
/// `CurrentUserDto`, which extends `UserDto` and carries `customerId` and
/// `customerName` (packages/shared/src/types/user.types.ts); a customer account is
/// linked to exactly one organisation and staff carry null.
///
/// The server is the real boundary. `resolveCustomerScope`
/// (apps/backend/src/common/security/customer-scope.ts) resolves the tenant of a
/// customer caller from the account and discards any `customerId` the client sent, so
/// a value chosen on the device could never widen what the caller receives. That is
/// exactly why this app still refuses to let one be chosen: a picker would suggest the
/// user is selecting something that matters, and it would put a boundary decision in
/// the one place that has no authority over it.
sealed class CustomerScope {
  const CustomerScope();
}

/// The signed-in user's own customer, as reported by `GET /auth/me`.
class ResolvedCustomerScope extends CustomerScope {
  const ResolvedCustomerScope({required this.customerId, this.customerName});

  final String customerId;

  /// Display name, when the server populated the relation. Never used to decide
  /// anything; [customerId] alone carries the meaning.
  final String? customerName;
}

/// There is no customer to scope to, and the portal says so instead of loading.
class UnavailableCustomerScope extends CustomerScope {
  const UnavailableCustomerScope({required this.reason, required this.detail});

  /// Short line for the screen heading.
  final String reason;

  /// The specific reason, so the message is actionable rather than a generic failure.
  final String detail;

  /// The signed-in account carries no `customerId`.
  ///
  /// An administrator has not linked it to an organisation yet. The wording matches
  /// the message the server returns for the same condition in `resolveCustomerScope`,
  /// so a customer is told the same thing whether the app noticed it from `/auth/me`
  /// or the server refused a request outright.
  static const UnavailableCustomerScope accountNotLinked = UnavailableCustomerScope(
    reason: 'Байгууллагын хамаарал тодорхойгүй байна',
    detail: 'Таны бүртгэл харилцагч байгууллагад холбогдоогүй байна. Админд '
        'хандана уу. Байгууллага холбогдсоны дараа танай барилга, төхөөрөмж, '
        'хүсэлтийн мэдээлэл энд харагдана.',
  );

  /// No signed-in user is available yet, so there is nothing to resolve from.
  ///
  /// Reached only while a session restore is in flight or immediately after a sign
  /// out; the router replaces the portal in both cases, so this is a backstop rather
  /// than a screen anyone should sit on.
  static const UnavailableCustomerScope noSession = UnavailableCustomerScope(
    reason: 'Нэвтэрсэн хэрэглэгч олдсонгүй',
    detail: 'Хэрэглэгчийн мэдээлэл ачаалагдаагүй байна. Дахин нэвтэрч орно уу.',
  );
}
