> Төлөвлөгөө боловсруулсан: **2026-08-14**. Статус: **батлагдсан, хэрэгжүүлээгүй**.

> Production төлөвийг `docs/PRODUCTION_STATUS.md`-ээс биш, амьд серверээс шалгасан (2026-08-14).

# Monhorus → Multi-Tenant SaaS + Platform Operator Console

## Context

Monhorus (`C:\Ajil\monhorus\monhorus.itsystem.mn`) is a live production system at
`https://monhorus.itsystem.mn` serving a single organisation. The owner wants to turn it into a
multi-tenant SaaS: a platform operator (ITSystem, "ITS") provisions tenant organisations, each
with its own superadmin, its own workers, its own clients, and its own projects/reports/invoices,
walled off from every other tenant. They also want a test tenant running alongside the real
Monhorus tenant on the production server, so new work can be exercised against production.

The request was phrased as "a new window that can create super admins, company workers and
clients." Exploration showed that surface mostly **already exists**. The genuinely missing piece
is the tenant boundary underneath it.

### What already exists — do not rebuild

| Requirement | Current state |
| --- | --- |
| "Superadmin" role | `head_admin` **is** it. Short-circuits to `ALL_PERMISSIONS` at `apps/backend/src/modules/rbac/rbac.service.ts:163`. No `superadmin` identifier exists in the repo. |
| Creating a superadmin | `POST /api/v1/users` → `user.service.ts:112` `createUser()`. `assertCanManageRole` (line 118) already permits head_admin → head_admin. Returns the temp password once (line 185). |
| First superadmin | `apps/backend/src/scripts/bootstrap-head-admin.ts` — one-shot, refuses if any head_admin exists (lines 29-37). |
| Worker logins | `employee-access.service.ts:151` `manageSystemAccess()` (`LINK_EXISTING` / `CREATE_NEW`); UI `apps/web/src/features/employees/EmployeeSystemAccessPanel.tsx`. |
| Client logins | `POST /api/v1/users` with `role:'customer'` + `customerId`; UI `apps/web/src/features/customers/CustomerPortalAccessTab.tsx`. |
| Password reset by admin | `user.service.ts:375` `resetPasscode()` — hashes, sets `passwordChangedAt`, forces `must_change_password`, clears lockout, revokes all sessions, audits, returns plaintext once. |
| User admin screen | `/access?tab=users` — `apps/web/src/features/access/AccessPage.tsx`. |

### What is missing — the actual work

**There is no tenant boundary for staff data.** `Company` (`apps/backend/src/modules/org/org.models.ts:12`)
is the service provider's *own* legal entity — HR/org-chart master data only. `User` has no company
field. Every staff account reads across every company.

The only tenant boundary that exists is `User.customer` → `Customer`, enforced by
`apps/backend/src/common/security/customer-scope.ts`, and it applies **only to portal accounts**.
That file's own comment names the gap (lines 55-56):

> *"Staff without a requested customer get `{}`, which preserves their existing cross-tenant access exactly."*

### Intended outcome

1. A platform-operator console where ITS can create tenants, superadmins, workers and clients, and
   change any account's credentials.
2. A real tenant boundary so tenant A's staff cannot see tenant B's data.
3. A test tenant alongside the real Monhorus tenant on the production server.

---

## Confirmed decisions

| Question | Decision |
| --- | --- |
| Isolation architecture | **Database-per-tenant.** Each tenant gets its own MongoDB database; models become per-connection factories. |
| Worker vs client model | **Shared `User` login, separate profiles.** `Employee` and `Customer` stay distinct collections — already the design. |
| Multi-company | **Real tenant isolation.** |
| Console route | New `/admin` section for the platform operator. |
| ITS login | **A normal email address** (`its@monhorus.mn`) with a real password. No `username` field, no schema change to login. |
| Test tenant in prod | Owner declined an `isTest` flag. Under database-per-tenant the flag is unnecessary — the tenant *is* the discriminator. |
| Sequencing | Delivered as one project, but staged so each phase is separately deployable and revertible. |

### Why database-per-tenant, recorded so it is not relitigated

Row-level isolation would require a `tenant` filter at **519 query call sites and 92 `populate()`
sites**, with no existing chokepoint to widen — `customerScopeFilter()` returns `{}` for staff, so
every site is a fresh judgement call.

The deciding argument is verifiability. **TypeScript cannot fail a build for a missing `tenant:` in
a filter object.** It *can* fail a build for a model imported outside the per-connection registry.
This repo already learned this lesson at 7 role-write sites and answered it with
`role-assignment.invariant.test.ts`, whose header reads *"A code review cannot be relied on to catch
the eighth."* That scanner works because a role write is one syntactic shape; a scoped query is not
a shape. With no CI and manual `git pull` deploys, an unverifiable 519-site change is the wrong bet.

Database-per-tenant also removes work outright:

- **No backfill and no index swap.** The existing database *becomes* the Monhorus tenant unchanged.
- Every global unique index stays correct as-is — `User.email`, `Counter.key`, `Setting.key`,
  `Role.key`, and all five document-number sequences.
- `Counter` becomes per-tenant automatically, so a test tenant cannot consume Monhorus's
  invoice/report numbering (otherwise permanent, un-purgeable damage).
- `Setting` becomes per-tenant automatically, so a test tenant cannot repaint the real company's
  PDF letterhead via `COMPANY_LOGO` (`modules/report-pdf/report-branding.ts`).
- Purging a tenant is `db.dropDatabase()`.

Estimated **25–36 focused engineering days**, versus 38–60 for row-level, with a categorically
better failure mode.

---

## Hard constraints

Violating any of these breaks production silently. All verified in the codebase.

- **No migration framework.** "Migrations" are idempotent `tsx` scripts in `apps/backend/src/scripts/`
  with npm aliases. Convention is dry-run default + `--apply`. Note `backfill-user-roles.ts` inverts
  this and applies by default — `DEPLOYMENT_UBUNTU.md` §8.4 flags it in bold as a hazard. Do not copy it.
- **Role-write chokepoint.** Every write to `user.roles` goes through
  `apps/backend/src/modules/rbac/role-assignment.service.ts`, enforced at build time by
  `role-assignment.invariant.test.ts`. That test pins *exactly one* `.roles =` and *exactly one*
  `User.create(` in the service, and instructs at lines 249-257: *"If this fails, do NOT add the
  offending file to the allowlist."* New provisioning code calls `createAccountWithRoles` instead.
- **`seedRbac()` runs on every server boot** (`rbac.service.ts:65`) and is **prune-only** for
  non-SYSTEM_ADMIN roles. It issues `Permission.deleteMany` and `Role.updateMany({}, {$pull})`
  globally. Under per-tenant databases it must run **per tenant connection**. Missing this has no
  visible failure mode — the role just quietly loses a permission.
- **`autoIndex: !env.isProduction`** (`config/database.ts`). Indexes reach production only via
  `npm run sync:indexes`, which also **drops** indexes absent from the schema.
- **`migrate:system-role-permissions --apply` is required on every release that adds a permission
  key**, because `seedRbac` never grants. Skipping it means the new button never appears, with no error.
- **Two Flutter apps** (`apps/mobile`, `apps/mobile-employee`) consume the same API, are distributed
  as APKs with no update mechanism, and compile the API base URL in at build time. They cannot be
  force-updated. See the mobile rules below.
- **Manual deploys, no CI.** `.github/` does not exist. 1135 tests run in ~5 minutes.
- **`origin/HEAD` points at `feat/inspection-module-and-mobile-flows`, not `main`**, plus 7 stale
  `worktree-*` remotes. Deploy by **tag**, never by branch name.
- **The `.env` CWD trap.** `config/env.ts` does a bare `import 'dotenv/config'`, resolving `.env` from
  the process CWD. A `.env` exists at the repo **root** and none in `apps/backend/`. The documented
  procedure works because it exports vars into the shell. **Never run a script from the repo root** —
  it will silently pick up a developer's `MONGODB_URI` and operate on the wrong database.
- **`npm ci --omit=dev` breaks the scripts** — `tsx` is a devDependency.
- **Backend test suite runs `fileParallelism: false`** against one shared `monhorus_test` DB
  (`apps/backend/vitest.config.ts`) — load-bearing. Every new test *file* costs a full collection
  wipe plus a full `seedRbac()`. Add cases, not files.
- **`mongodb-memory-server` is standalone**, so transactions do not run in tests
  (`transaction.util.ts` detects and falls back). Assert outcomes, not atomicity.
- **Validation schemas are not shared.** `createUserSchema`, `loginSchema`, `strongPasswordSchema`
  and `emailSchema` live in `apps/backend/src/modules/{user,auth}/*.validation.ts` and are not
  re-exported. A **second, different `emailSchema`** exists at `packages/shared/src/schemas/common.schema.ts`.
  This is why `CreateUserModal.tsx:478-486` hand-rolls its checks. Consolidating is a prerequisite task.
- **UI conventions.** Tailwind only, no component library. Control classes come from
  `apps/web/src/components/ui/control-styles.ts` — never inlined; the `_ERROR` variants are whole
  strings, not appended (Tailwind resolves conflicts by stylesheet order). Forms are plain `useState`
  + `safeParse`. Routes are declared in `apps/web/src/App.tsx`; the sidebar is a **separate** registry
  at `apps/web/src/config/navigation.ts`. `NavIcon` is a closed union rendered by `NavGlyph.tsx`.
  All UI strings are Mongolian Cyrillic, hardcoded; enum labels live in `packages/shared/src/constants/`.
- **Dead code to resolve, not duplicate.** `apps/web/src/features/users/UsersPage.tsx` +
  `CreateUserModal.tsx` + `ResetPasscodeModal.tsx` exist and are tested, but `UsersPage` has no route.
  Absorb `CreateUserModal` into the console, delete `UsersPage`, and leave `ResetPasscodeModal` where
  it is (`EmployeeSystemAccessPanel.tsx:24` imports it).

### Mobile compatibility rules

- **Safe:** adding response fields (both apps use explicit decoders and ignore unknown keys); new
  endpoints under `/api/v1`; optional request fields with server defaults.
- **Never:** require a `tenantId` field or `X-Tenant` header (an installed APK cannot send one);
  introduce `/api/v2` (the base URL is compiled in — every installed APK would 404 permanently);
  replace `email` in `loginSchema`.
- **Return 403, not 401, for a suspended tenant.** The Dio interceptor refreshes-and-replays on 401;
  a 401 puts every mobile client into a refresh-fail loop and signs users out with no explanation.
- **Return 404, not 403, for a cross-tenant id** — matches `assertInCustomerScope` and avoids an
  existence oracle.
- **The tenant is always resolved server-side from the authenticated account.** This is what lets the
  mobile apps need zero changes. It follows the doctrine already written into
  `common/types/express.d.ts`, where `customerId`, `employeeId` and `permissions` are deliberately
  resolved per request rather than carried in the JWT.
- Pin the Flutter version before any rebuild — there is no `.fvmrc`, so a "no code change" rebuild
  can still change behaviour.

---

## Architecture

### Two kinds of database

**Control database** (`monhorus_platform`) — one, global. Holds:

- `Tenant { code (unique, uppercase), name, dbName, status, createdAt }`
- `Directory { email (unique, lowercase), tenantId }` — the login routing table
- The platform operator's own `User` record

**Tenant databases** (`monhorus_<code>`) — one per tenant, each a complete copy of the existing
37-collection schema. **The current production database becomes the Monhorus tenant unchanged** —
its `Tenant` row simply records the existing `dbName`. No backfill, no index swap, no data rewrite.

### Login routing — the one genuinely new mechanism

Login stays email-only and the request shape is unchanged, so mobile is unaffected:

1. `POST /auth/login` with `{ email, password }`.
2. Look up `Directory` by email in the control DB → get `tenantId` (or the platform operator).
3. Open/reuse that tenant's connection; load the `User` from the tenant DB.
4. Everything downstream — bcrypt compare, `burnPasswordCycle` on a miss, failed-attempt lockout,
   suspended check, `issueTokens`, audit rows — is unchanged.

`Directory` keeps email globally unique across the platform, which means **no tenant selector on the
login screen** and no mobile change. The trade-off, to be recorded in the ADR: one person cannot hold
accounts in two tenants under the same address.

**`burnPasswordCycle` must still run when the directory lookup misses**, or the new code path becomes
an email-enumeration oracle that the existing design (`auth.service.ts:100`) deliberately closed.

### Connection registry

`apps/backend/src/common/db/connection-registry.ts` — `mongoose.createConnection(uri, { dbName })`,
lazily created, LRU-evicted, `maxPoolSize` reduced from 20 to ~5 per tenant (the host has 7.4 GB RAM
and four neighbouring sites).

`apps/backend/src/common/db/models.ts` — `models(conn)` returns the compiled model set for a
connection, cached per connection. Every service takes models from here instead of importing module
singletons. **This is the change TypeScript verifies for you.**

### Platform operator

No new role tier. `platform_admin` as a fifth `USER_ROLES` member was considered and rejected: it is
unnecessary once the operator lives in a separate control database, and adding it silently breaks
`canManageRole` (`roles.ts:43` returns `true` for any head_admin, so any tenant's head_admin could
mint a platform admin) and leaks `platform.*` into every tenant head_admin via the `ALL_PERMISSIONS`
short-circuit at `rbac.service.ts:163`.

Instead: the operator is an ordinary `head_admin` **in the control database**, holding a new
`platform.manage` permission. Tenant users physically cannot reach the control DB.

New permission key `PLATFORM_MANAGE: 'platform.manage'` in `packages/shared/src/constants/permissions.ts`,
plus three edits the compiler will not all catch:
- Add `'platform'` to `PERMISSION_MODULES` — `permissionModuleOf` **silently falls back to `'dashboard'`**
  (line 421) for an unregistered prefix.
- Add to `PERMISSION_MODULE_LABELS` — compiler-enforced.
- Add to `PERMISSION_LABELS` — compiler-enforced.

---

## How to use this plan

Each phase ends at a **CHECKPOINT** — a gate with a runnable verification. Do not begin the next
phase until it passes. With no CI and manual deploys, the checkpoint is the only thing standing in
for a pipeline.

---

## Phase 0 — Stabilise production *(~half a day, no feature work)*

**Goal:** make the server a safe place to deploy to.

> **Verified on 2026-08-14, not taken from `docs/PRODUCTION_STATUS.md`.** That doc is dated
> 2026-08-13 and is **stale** — several items it lists as outstanding were fixed by commits
> `1fca229`, `8fcabfa` and `c53a75c` after it was written. The status below is from the live
> server and the current working tree.

### Already done — do not redo

| Item | Evidence |
| --- | --- |
| The 6 "git-only" commits are **deployed** | `POST https://monhorus.itsystem.mn/api/v1/auth/forgot-password` returns **200** (the doc's own proof-of-absence was a 404) |
| `APP_WEB_BASE_URL` is **set correctly** | `1fca229` added `assertProductionOverrides` (`env.ts:133`), which refuses to boot in production on a localhost value. The server is running, so it is set. |
| Backup + restore **installed and exercised** | `1fca229` added `backup-monhorus.sh`, `restore-monhorus.sh`, `monhorus-backup.service`, `monhorus-backup.timer`; `8fcabfa` fixed two faults found by installing the timer on the server and running it once |
| CRLF shebang hazard closed | `.gitattributes` now pins `*.sh` / `*.service` / `*.timer` / `*.conf` to `eol=lf` |
| Local branch state | `main`, in sync with `origin/main` |

### Steps still outstanding

1. **Back up the Android signing key from `C:\Ajil\monhorus-keys\`** to a password manager or
   encrypted archive. Unverifiable from here — confirm it was done. It exists on one computer, and
   losing it means never shipping an app update again: every user would have to uninstall and
   reinstall, losing on-device data. Five minutes, unrecoverable if skipped.
2. **Add `skipSuccessfulRequests: true` to `credentialLimiter`** (`apps/backend/src/modules/auth/auth.routes.ts:26-32`).
   Verified absent today. Then restore a sane `RATE_LIMIT_CREDENTIAL_MAX` / `RATE_LIMIT_REFRESH_MAX`
   in the server env — they were set to `1000000000` on 2026-08-05 because the limiter counted
   **successful** logins and locked out correct-password users on their 11th sign-in. Re-enabling
   without this flag reintroduces exactly that bug. See `IMPROVEMENTS.md` §16.
3. **Add a `HOST` env var defaulting to `127.0.0.1`** and pass it to `app.listen` (`server.ts:60`
   currently binds every interface; only `ufw` keeps the API off the internet).
4. **Tag a known-good commit** — `git tag -l` is empty, so there is no named rollback target today:
   `git tag prod-2026-08-14-known-good && git push --tags`.
5. **Check disk** — unverifiable from here. Target ≥15 GB free before Phase 4 creates a second
   database with its own 207-index copy.
6. **Rehearse a restore once** if it has not been done end-to-end:
   `sudo scripts/restore-monhorus.sh latest --confirm --db monhorus_rehearsal --uploads-dir /tmp/rehearsal-uploads`
7. Optional but cheap: add CI. `.github/` still does not exist, and 1135 tests run in ~5 minutes.

### CHECKPOINT 0
- A login attempt storm does **not** lock out a user supplying the correct password.
- `ss -tlnp | grep 4000` shows a bind on `127.0.0.1`, not `0.0.0.0`.
- `git tag -l 'prod-*'` shows the known-good tag.
- `df -h` shows ≥15 GB free.
- The rehearsal restore completed and `monhorus_rehearsal` contains collections.
- A copy of the signing key exists somewhere other than that one computer.
- All four neighbouring sites still respond.

### Rollback
`git checkout <previous tag>`, rebuild, restart.

---

## Phase 1 — Per-connection model registry *(6–9 days)*

**Goal:** convert all 37 models from module-level singletons to per-connection factories, with **zero
behaviour change** — still one connection, still one database.

This is the largest phase and the one the compiler verifies for you.

### Steps

1. Create `apps/backend/src/common/db/connection-registry.ts`: `getConnection(dbName)` with a lazy
   LRU cache, `maxPoolSize: 5`, and a `getControlConnection()` helper.
2. Create `apps/backend/src/common/db/models.ts` exporting `models(conn)`, returning every compiled
   model, memoised per connection.
3. Convert each model file from `export const User = model<IUser>('User', userSchema)` to exporting
   the **schema** plus a factory registered in `models.ts`. Discover model files the way
   `sync-indexes.ts:39` does — it walks both `*.model.ts` **and** `*.models.ts`; a singular-only glob
   silently skips five modules including `planned-work`.
4. Thread a connection through every service. Add `req.db` in `authenticate.middleware.ts` alongside
   the existing `req.auth`; for now it is always the single default connection.
5. Update `apps/backend/src/test/helpers.ts` to hand tests a connection. It is already on the
   invariant allowlist.
6. Add an invariant test: no file outside `common/db/` may import a model singleton directly.

### CHECKPOINT 1
- `npm run typecheck` and `npm run lint` pass. **A missed call site is a compile error** — that is the
  entire point of this phase.
- `npm test` — all 1135 tests pass with no modifications to their assertions.
- Deploy to production and smoke-test: log in on web, open the dashboard, open one report PDF,
  log in on the employee APK, open one planned work. **Behaviour must be identical.**

### Rollback
`git revert` + restart. No data touched at any point in this phase.

---

## Phase 2 — Control database and tenant catalogue *(3–4 days)*

**Goal:** introduce the control DB and login routing, with exactly one tenant (Monhorus) pointing at
the existing database.

### Steps

1. `apps/backend/src/modules/tenant/tenant.model.ts` — `Tenant` and `Directory`, compiled against the
   control connection only.
2. `apps/backend/src/scripts/bootstrap-control-db.ts` (`npm run bootstrap:control`, dry-run default):
   creates `monhorus_platform`, inserts the `MONHORUS` tenant row pointing at the **existing** dbName,
   and populates `Directory` from every existing `User.email`. Idempotent. **Reads the tenant DB,
   writes only the control DB** — no change to live data.
3. Extend `login()` in `auth.service.ts` with the directory lookup described in Architecture.
   Preserve `burnPasswordCycle` on a directory miss.
4. Add `tenantId` and the resolved connection to `req.auth` / `req.db`, re-read per request.
5. Add a suspended-tenant gate beside the existing `status === 'suspended'` check at
   `authenticate.middleware.ts:48`, returning **403** (not 401 — see mobile rules).
6. Make `seedRbac()` run per tenant connection rather than once globally.
7. Write `docs/adr/0002-multi-tenancy.md` recording the DB-per-tenant decision, the globally-unique
   email constraint, and the rejection of a fifth role tier.

### CHECKPOINT 2
- `npm run bootstrap:control` dry run reports the expected tenant and directory-entry counts.
- After `--apply`, every existing user still logs in on web **and** on both APKs.
- A login with an unknown email still takes measurably the same time as a known-email/wrong-password
  login — the enumeration defence survives.
- `npm test` passes.
- Deploy and smoke-test. Still one tenant; behaviour unchanged.

### Rollback
`git revert` + restart. Drop `monhorus_platform`. The tenant database was never modified.

---

## Phase 3 — Platform console, read-only *(3–4 days)*

**Goal:** ITS can log in and see the platform. First visible value.

### Steps

1. `PLATFORM_MANAGE` permission key + `'platform'` module + both label maps (see Architecture).
2. `apps/backend/src/scripts/bootstrap-platform-operator.ts` (`npm run bootstrap:platform-operator`):
   creates the operator in the **control DB** from `PLATFORM_OPERATOR_EMAIL` / `_PASSWORD` / `_NAME`.
   Idempotent; exits **non-zero** on refusal (unlike `bootstrap-head-admin.ts:36`, which exits 0 and
   so cannot be distinguished from success). Calls `createAccountWithRoles` so it needs **no**
   invariant-allowlist entry. Ends with the "Remove PLATFORM_OPERATOR_PASSWORD from .env now." line.
3. Add the production guard to `assertProductionOverrides` (`env.ts:133`) — refuse to boot if
   `PLATFORM_OPERATOR_PASSWORD` is set but fails the `strongPasswordSchema` policy (≥10 chars, a
   letter, a digit). Same shape and reasoning as the existing `APP_WEB_BASE_URL` guard.
   While in this file, add the `JWT_ACCESS_SECRET !== JWT_REFRESH_SECRET` refine — it does not exist
   today, contrary to assumption.
4. `apps/backend/src/modules/platform/platform.{routes,controller,service}.ts`, mounted in
   `routes/index.ts`, guarded by `authenticate, enforcePasswordChange, requirePermission(PLATFORM_MANAGE)`.
   Read-only: list tenants, per-tenant counts.
5. Web: `PlatformShell` (visually distinct chrome — a reader must never be unsure whether they are in
   the operator console or a tenant app), `PLATFORM_NAVIGATION` as a **separate** exported constant
   (not a `tiers`-restricted section inside `NAVIGATION`, which would put the console in every
   head_admin's normal sidebar), `PlatformPage` helper in `App.tsx`, `/admin` and `/admin/tenants`.
   Add `'PLATFORM' | 'TENANT'` to the `NavIcon` union and the matching cases in `NavGlyph.tsx`.

### CHECKPOINT 3
- ITS logs in at `/admin` with the email + password and sees the Monhorus tenant with correct counts.
- A `head_admin` of the Monhorus tenant hitting `/admin` gets `ForbiddenState`; `/api/v1/platform/tenants`
  returns 403 for every non-operator account.
- `npm test` passes, including a new `security/platform-console.security.api.test.ts`.
- Deploy; confirm normal users see no change and no new sidebar entry.

### Rollback
`git revert` + restart. `seedRbac` prunes the new permission keys automatically on the next boot;
one orphan role document remains and is inert.

---

## Phase 4 — Tenant provisioning *(5–7 days)*

**Goal:** ITS can create a tenant and everything inside it. **This is the point of no return** — the
first phase that creates data outside the original database.

### Steps

1. `provisionTenant(code, name)` in the platform service: create the `Tenant` row, create the
   database, run `syncIndexes()` on every model against the new connection, run `seedRbac()` against
   it, create its first `head_admin`, and add that account to `Directory` — as one operation with
   compensating cleanup on failure.
2. Console write paths, all delegating to **existing** services rather than reimplementing them:
   create tenant; create tenant superadmin (`createUser`); create worker
   (`manageSystemAccess` mode `CREATE_NEW`); create client (`createUser` with `role:'customer'`);
   reset password (`resetPasscode`); suspend/restore (`updateUserStatus`).
3. One genuinely new endpoint: `PATCH /api/v1/platform/users/:userId/credentials` for changing a
   login email. It must, in order: refuse self-target; `assertCanManageRole`; pre-check uniqueness
   (or the unique index throws a raw E11000 that surfaces as a 500); update the `Directory` row;
   revoke every live `Session`; **revoke every outstanding `PasswordResetToken`**; audit with old and
   new values plus a required reason.
   - Do **not** touch `passwordChangedAt` — the password did not change. Consequence to state in the
     UI: outstanding access tokens survive up to `JWT_ACCESS_TTL` (15 min). Suspend or reset the
     password for immediate eviction.
4. **Fix a pre-existing gap while here:** `resetPasscode` does not revoke outstanding
   `PasswordResetToken` rows, so a reset link mailed before an admin reset stays redeemable. One
   `updateMany`, exactly as `resetPassword` does at line 505. Benefits every existing caller.
5. Add `'LoginIdentifierChanged'` to `AUDIT_ACTIONS`. **The enum is closed and `recordAudit` swallows
   its own failures by design** (`audit.service.ts:50-55`) — an unlisted action produces zero audit
   rows, a green test suite, and one error line nobody reads.
6. Web: `PlatformTenantsPage` (copy `features/org/PositionsPage.tsx` — the most complete admin CRUD
   template), `PlatformAccountsPage` (copy `AccessPage.tsx`, tabbed `?kind=`), `AccountFormDrawer`,
   `CredentialsDrawer`. Move `CreateUserModal.tsx` into `features/platform/`; delete `UsersPage.tsx`
   and its test.
7. Mongolian copy for every new screen, written by someone who writes Mongolian. This is not a
   rounding error at 61 existing routes' worth of precedent.

### CHECKPOINT 4
- Provision a tenant `ZZTEST` on a **local** machine. Verify: a new database exists with the full
  index set, `seedRbac` populated its roles, and its head_admin can log in.
- Log in as the `ZZTEST` head_admin and confirm **zero** Monhorus records are visible anywhere —
  users, employees, customers, projects, invoices, reports, audit log, notifications.
- Create a worker and a client in `ZZTEST`; both log in; both see only `ZZTEST` data.
- Create an invoice in `ZZTEST`, then one in Monhorus, and confirm **Monhorus's invoice number did
  not skip** — this is the `Counter` regression test.
- Change `COMPANY_LOGO` in `ZZTEST` and confirm a Monhorus report PDF is **unchanged** — the
  `Setting` regression test.
- `npm test` passes including `security/tenant-isolation.security.api.test.ts`.

### Rollback
`git revert` + restart, then drop the tenant database. The Monhorus database is untouched throughout.

---

## Phase 5 — Operational tooling *(3–4 days)*

**Goal:** make multi-database survivable in operations. Skipping this is how tenants end up unbacked-up.

### Steps

1. **`scripts/backup-monhorus.sh` must enumerate tenant databases by prefix.** It currently runs
   `mongodump --uri="$MONGODB_URI"`, which names exactly one database — **new tenant databases would
   be silently unbacked-up.** Non-negotiable and easy to miss.
2. `scripts/restore-monhorus.sh` — per-tenant restore.
3. `sync-indexes.ts` — loop over tenant connections.
4. The two boot jobs, `startOverdueReconciliationJob()` and `startUnclaimedWorkJob()` (`server.ts`),
   sweep globally and must loop tenants. Easy to forget because no HTTP request touches them.
5. `purge-tenant.ts` → `npm run purge:tenant`: dry-run default, `--apply --tenant ZZTEST`, plus a
   `--yes-i-mean-it` gate when `NODE_ENV=production`. Drops the database **and** deletes that tenant's
   files under `UPLOAD_DIR`, its `Directory` rows and its `Tenant` row. Refuses if the code is `MONHORUS`.
6. Set `MemoryMax` on the connection registry's budget; document the per-tenant RAM cost.

### CHECKPOINT 5
- `sudo scripts/backup-monhorus.sh` produces an archive containing **both** databases.
- A restore of the test tenant alone succeeds and leaves Monhorus untouched.
- `npm run purge:tenant -- --tenant ZZTEST` dry run lists the correct collections and file counts.
- `npm run sync:indexes -- --dry-run` reports both databases.

### Rollback
Scripts are additive; revert the files.

---

## Phase 6 — Production test tenant *(1 day)*

**Goal:** the thing originally asked for.

### Steps

1. Fresh backup, and **pin a copy outside retention**:
   `sudo cp /var/backups/monhorus/db-<ts>.archive.gz /var/backups/monhorus/keep/pre-test-tenant.archive.gz`
   (`RETENTION_DAYS=14`, so without this there is no clean pre-test backup after two weeks).
2. Provision `ZZTEST` through the console — by hand, audited, as a normal operation. Sorts last in
   every list and is unmistakable in a log line.
3. Create its superadmin, a worker and a client.
4. Verify Monhorus dashboard numbers, revenue totals and report numbering are unchanged.

### CHECKPOINT 6
- The Monhorus dashboard, revenue aggregate and audit log show **no** `ZZTEST` data.
- No Monhorus user received a notification from `ZZTEST` activity.
- `df -h` still healthy.
- `npm run purge:tenant -- --tenant ZZTEST` dry run reports the expected records — proving cleanup works
  *before* it is needed.

### Rollback
`npm run purge:tenant -- --tenant ZZTEST --apply --yes-i-mean-it`.

---

## Phase 7 — Mobile rebuild *(1 day, only after a week of stability)*

Pin the Flutter version first. Rebuild both APKs, **verify the signature**:
`apksigner verify --print-certs app-release.apk | grep "SHA-256"` must equal
`01a103a7b36d89c88e131b20feda1d7983a20408b6e6c6150ead401ae1920948`. A missing `key.properties`
does **not** fail the build — it silently signs with a debug key, and Android then refuses the update.
Publish via `scripts/publish-apk-page.sh`.

Ensure nobody runs `apps/mobile*/integration_test/live_api_test.dart` against production during any
of this work.

---

## Verification strategy

**Test-suite discipline.** `fileParallelism: false` means each new *file* costs a full wipe plus a
full `seedRbac()`. Add **cases**, not files. Build the two-tenant cast once per file in `beforeAll`;
log in once per actor per file. The repo already paid this tuition — `planned-work.assignment-scope.api.test.ts`
was rewritten for exactly this reason.

**New suites (two files only):**
- `apps/backend/src/security/tenant-isolation.security.api.test.ts` — modelled on
  `customer-scope.security.api.test.ts`: build the illegal state directly in the collection, then
  prove the API refuses to serve it. Must assert on **ids, not counts**. Must cover: cross-tenant
  detail → 404; cross-tenant write → 404 **and no document created**; a `head_admin` (not just a
  normal admin) is still tenant-bound — the `ALL_PERMISSIONS` short-circuit makes this the most
  likely hole; `Counter` non-skip; `Setting` non-leak; notifications do not fan out cross-tenant;
  `GET /files/:id` for another tenant's `StoredFile` → 404 (it goes through `storage.routes.ts`, not
  a domain service, and is easy to miss). Plus a **negative control**: the platform operator CAN see
  both tenants — without it, a filter that accidentally matches nothing looks green everywhere.
- `apps/backend/src/security/platform-console.security.api.test.ts` — every non-operator tier refused
  every `/platform/*` route; a tenant admin cannot repoint a superadmin's email; the PROTECTED audit
  row is written on a **refused** superadmin creation.

**Invariant test:** no model singleton imported outside `common/db/`. This is the machine-checkable
guarantee that the whole architecture choice was made for.

**Manual end-to-end**, after Phase 4:
```bash
npm run dev                     # backend :4000, web :5173
npm run bootstrap:control -- --apply
npm run bootstrap:platform-operator
# → /admin, log in as ITS, provision ZZTEST, create a superadmin/worker/client
# → log in as each; confirm zero Monhorus data is reachable
```

---

## Residual risks

1. **Disk.** Four other production sites share the host, and each tenant database carries its own
   207-index copy. Current free space is unverified from the dev machine — check it before Phase 4.
   `docs/PRODUCTION_STATUS.md` reported 3.9 GB free on 2026-08-13, but that document is stale on
   several other points, so measure rather than assume.
2. **Backup enumeration (Phase 5 step 1) is the single easiest catastrophic miss.** A tenant that is
   provisioned but not backed up looks perfectly healthy until the day it matters.
3. **`seedRbac` per tenant has no visible failure mode.** If it does not run for a tenant, that
   tenant's roles quietly lose permissions on the next boot. Assert it in the tenant-isolation suite.
4. **Globally unique email** means one person cannot hold accounts in two tenants. Recorded in the
   ADR; revisitable later via a tenant hint at login.
5. **One JWT issuer/audience for all tenants.** Decide now that tenants never get their own signing
   material — retrofitting that later is a much larger change than it looks.
6. **Neighbouring sites.** Any mongod restart or index build is their outage too. This is a
   stakeholder conversation, not just an ops note.
7. **No staging environment exists.** `restore-monhorus.sh --db monhorus_rehearsal` is the closest
   thing; make it the mandatory rehearsal target from Phase 4 onward.
8. **Business decisions that will block Phase 4 if unanswered:** who may delete whose data, what
   happens to a departing tenant's uploads (there is no S3 — `UPLOAD_DIR` is one tree and deletion is
   irreversible), and pricing/data-ownership terms.

## Open questions

Answerable at the phase that needs them; none block Phase 0 or 1.

1. **Impersonation** — "view as this tenant" from the console. Not requested, but likely what makes
   testing against production pleasant, since otherwise you log in and out of separate accounts
   constantly. If wanted, it must be audited and time-boxed. Decide by Phase 3.
2. **Tenant lifecycle** — suspend, rename, and what happens to a tenant's users on suspend. Decide by
   Phase 4.
3. **Cross-tenant platform dashboard** — a console summing across tenants means N queries under
   DB-per-tenant. Decide by Phase 3.
4. **Mail server** — `mail.service.ts` was reworked in `1fca229` and password reset is now deployed
   and returning 200, but whether `SMTP_HOST` is configured on the server is unverifiable from the
   dev machine. Confirm it: with `SMTP_HOST` unset the system **logs the reset link instead of
   sending it** and reports success either way, so the feature looks functional while no mail leaves
   the server.
5. **Billing / plan limits** — assumed **out of scope**.
