import type { UserRole } from '@monhorus/shared';

/**
 * Where "home" is for a given account.
 *
 * `/dashboard` is hardcoded in four places — the login redirect, the already-signed-in
 * short circuit, the `/` route and the 404 page's way back. Every one of them sends a
 * customer to a screen gated on `dashboard.view`, a key no customer holds, so signing in
 * and pressing "back to home" both land on the same forbidden panel. This is the one place
 * that decision is made.
 *
 * KEYED ON THE TIER, NOT ON A PERMISSION, which is the opposite of how the rest of this app
 * decides things — so, deliberately: this is not an authorization decision. Nothing is
 * granted or refused here, the route arrived at is permission-gated exactly as before, and
 * a wrong answer costs a redirect rather than access. `customer` is also the tier the
 * SERVER branches on — `resolveCustomerScope` reads `auth.role === 'customer'` to decide
 * whose records a request may see — so asking about it here keeps the client's idea of who
 * somebody is identical to the server's.
 */
export function homePathFor(role: UserRole | null | undefined): string {
  return role === 'customer' ? '/portal' : '/dashboard';
}

/**
 * Areas a CUSTOMER can actually land on.
 *
 * An allowlist rather than a list of staff areas to avoid: a blocklist is wrong the moment
 * somebody adds a route and forgets, and wrong in the direction that breaks signing in.
 * Mirrors the CUSTOMER permission set — the portal, the notification centre
 * (`notification.view`, the one staff key the role holds) and the forced password change.
 */
const CUSTOMER_LANDING_PREFIXES = ['/portal', '/notifications', '/change-password'];

function isCustomerReachable(path: string): boolean {
  return CUSTOMER_LANDING_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Where to send someone the moment they sign in.
 *
 * `from` is the deep link `ProtectedRoute` bounced them off, and honouring it is the point
 * of capturing it — a customer who followed a link to one of their own requests should
 * arrive at that request, not at their home page.
 *
 * BUT NOT BLINDLY. `from` is whatever URL the browser happened to be on, and for a customer
 * that is very often `/dashboard`: it is where they get dumped before a portal exists, so
 * it is what their history and their bookmarks hold. Honouring it unconditionally sends
 * them straight back to the one screen guaranteed to refuse them, and the refusal reads as
 * a permissions fault rather than a redirect fault. So: follow `from` only where the caller
 * can actually land.
 */
export function resolvePostLoginPath(
  role: UserRole | null | undefined,
  from: string | null | undefined,
): string {
  const home = homePathFor(role);

  // `from` must be an in-app path. `//host` passes a bare `startsWith('/')` and is a
  // protocol-relative URL, so it is rejected explicitly rather than left to the router.
  const inApp = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//');
  if (!inApp || from === '/login') return home;

  if (role === 'customer') return isCustomerReachable(from) ? from : home;

  // The mirror image: no staff account can hold a portal key — the RBAC assignment
  // chokepoint refuses one on a staff tier — so a staff member restored to a `/portal` deep
  // link would meet the same forbidden panel from the other side.
  return from.startsWith('/portal') ? home : from;
}
