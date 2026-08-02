# ADR 0001 - Authentication and session model

Status: Accepted
Date: 2026-07-27

## Context

The requirements document (Цахилгааны үйлчилгээний системийн шаардлага) specifies role
based access control, organization isolation, password hashing and expiring sessions
(section 16.2), but never describes a signup screen. Section 5.1 states that the admin
creates the customer organization, and the permission matrix in 14.2 grants neither
`Хэрэглэгч` nor `Ажилтан` any registration right. None of the three wireframe
prototypes contains a login or signup screen.

## Decisions

1. **No public signup.** Accounts are provisioned by an admin through
   `POST /api/v1/auth/invitations`. The invitee receives a one-time token and sets
   their own password via `POST /api/v1/auth/accept-invitation`. This matches
   requirements 5.1 and 14.2. A `bootstrap-admin` script creates the very first
   `SYSTEM_ADMIN` and refuses to run once any admin exists.

2. **Email plus password** is the sole credential. Both wireframe profile screens show
   an email as the account identifier. OAuth2, although named in the target tech stack,
   is deferred: the requirements name no provider.

3. **Access token 15 minutes, refresh token 30 days, rotating.** Requirement 16.3
   requires the employee app to function offline for extended periods, so a short
   refresh window would strand queued field data. Refresh tokens are opaque 48-byte
   random strings stored only as SHA-256 digests, which makes them revocable and
   renders a database leak unusable for replay.

4. **Refresh reuse revokes the whole family.** Each login starts a rotation family.
   Presenting an already-rotated token means the token was captured, so every token in
   that family is revoked and a `TokenReuseDetected` audit row is written.

5. **Argon2id** with OWASP parameters (19 MiB, t=2, p=1) for password hashing.

6. **The authenticate middleware re-reads the user on every request.** A 15-minute
   token would otherwise let a suspended account or a revoked permission keep acting on
   stale claims. For a system gating electrical safety approvals and invoicing, one
   indexed read per request is the correct trade.

7. **Tenant isolation is enforced at the model layer,** not only in queries. The User
   schema rejects a `CUSTOMER` without an organization and an `ADMIN`/`EMPLOYEE` with
   one, so no service or script can create a tenant-less customer (req 17.2, TC-015).

8. **Login enumeration is not possible.** An unknown email consumes an equivalent
   Argon2 cycle and returns the identical `INVALID_CREDENTIALS` response as a wrong
   password. Account status is only revealed after the password verifies.

## Consequences

- A forgotten-password flow is still required and reuses the invitation token
  machinery. It is not yet implemented.
- The notification transport is a stub (`consoleNotificationAdapter`). An email
  provider must be chosen before production; the invitation token is returned in the
  API response outside production only.
- `AuditLog` blocks updates and deletes at the Mongoose layer. Before production, also
  revoke update and delete privileges on that collection at the database user level.
