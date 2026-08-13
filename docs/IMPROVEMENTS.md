# Improvements

Follow-ups from the 2026-08-04 production deployment to `103.87.255.221`, in priority
order. Each entry says what is wrong, why it matters, and what fixing it involves.
Deployment facts live in `DEPLOYMENT_MONHORUS_PROD.md`.

---

## P0 — the server is over capacity

> **Update 2026-08-13: the host was given more RAM — 7.4 GB total, up from 1.6 GB.**
> At the 2026-08-13 deploy it showed 6.1 GB available, **zero** swap in use (down from
> 2.9 GB) and a load average of 0.00. That removes the immediate danger behind items 1
> and 2 but does not close either: a leak that grows without bound reaches 7.4 GB as
> surely as it reached 1.6 GB, it just takes longer, and the `MemoryMax` cap below is
> still the only thing that would stop it taking a neighbour down. Disk is unchanged in
> character — 4.2 GB free of 23 GB.

### 1. The SPIMEX crawler leaks and is OOM-killing other tenants

Not a Monhorus bug, but it is the single biggest threat to Monhorus's uptime and it is
already causing outages.

`spx-web.service` (`/opt/spx-crawler`, uvicorn on `127.0.0.1:8000`) grows to **~1.1 GB
resident within 20 minutes of starting** on a host with 1.6 GB of RAM. `dmesg` shows the
kernel OOM-killer killing it repeatedly — twice on 2026-08-04 alone (11:28, 11:49). At
11:49 the process that hit the wall and *invoked* the OOM-killer was **`next-server`, the
wellcom.mn app**. So the leak is already disrupting a production site.

Restarting it reclaims ~900 MB instantly, which is what unblocked this deployment.

Fix, cheapest first:

1. **Cap it so it can never take the machine down.** In a drop-in for `spx-web.service`:
   ```ini
   [Service]
   MemoryMax=600M
   Restart=always
   ```
   The crawler then dies alone instead of taking a neighbour with it. This is
   containment, not a fix.
2. **Find the leak.** Sustained growth with no plateau usually means unbounded
   accumulation per crawl — response bodies or parsed documents retained in a module-level
   structure.
3. **Add RAM.** 1.6 GB for four sites, PostgreSQL, MongoDB and a crawler is undersized
   regardless.

### 2. Disk is at 88 %

2.7 GB free of 23 GB, after the 1 GB swapfile added during deployment. `mongodump`
archives and uploads both grow here and nothing prunes them. Add log rotation for
`/var/log/nginx/monhorus*.log`, a retention policy for `/var/backups/monhorus`, and
alerting before it reaches 95 %.

### 3. The Android signing keystore exists in exactly one place

`C:\Ajil\monhorus-keys\` on one workstation, with the password in a plaintext file beside
it. That directory **is** the apps' identity on every phone that installs them. If the
machine dies, the apps can never be updated in place again — every user uninstalls and
reinstalls, losing local data.

Copy it somewhere durable and access-controlled (password manager, or an encrypted
archive off-site). Do this before the APKs are handed out, not after.

### 4. No backups are scheduled

The commands are documented and tested but nothing runs them. A timer that dumps the
database and tars `/var/lib/monhorus/uploads` **in the same run**, keeps 14 days, and
writes off-host. Uploads are local-disk only — there is no object store, so that directory
is the entire file corpus and it exists on exactly one disk.

---

## P1 — correctness and security

### 5. ~~HTTPS~~ — done 2026-08-13

The A record was repointed to this host, certbot issued a certificate, and all four
follow-on steps ran together: CORS, the web bundle's compiled-in origin, both APKs'
`--dart-define`, and the removal of the cleartext exception. Credentials no longer cross
the network in clear text and iOS is no longer blocked *by transport security* — though
no iOS build has been attempted, and that needs a signing identity and an account before
it means anything. Details in `DEPLOYMENT_MONHORUS_PROD.md` §7.

What remains from this item:

- **HSTS is not set.** Deliberately: it is a commitment that is painful to walk back if
  anything on this name ever has to serve plain HTTP. Worth adding once the migration has
  settled, starting with a short `max-age`.
- **`:3020` and `:3021` still serve plain HTTP** so that already-installed APKs keep
  working. They are the remaining cleartext surface and should close once no handset
  carries a pre-2026-08-13 build.

### 6. The backend binds `0.0.0.0:4000`, not loopback

`server.ts` calls `app.listen(env.PORT)` with no host argument, so the API listens on all
interfaces. It is unreachable today only because ufw denies it — one firewall edit away
from being exposed with no TLS in front.

Add a `HOST` variable defaulting to `127.0.0.1` in production:

```ts
server = app.listen(env.PORT, env.HOST, () => { … });
```

### 7. Two schema indexes were silently broken

Both found by the new `sync-indexes` script and **already fixed**, recorded here because
the class of bug will recur and neither failed loudly.

- **`EmployeeSalary`** declared `index: true` on `employee` *and* a unique partial index
  on `{employee: 1}`. Both auto-generate the name `employee_1`; the plain one won and
  MongoDB rejected the unique one with `IndexKeySpecsConflict`. The "at most one open
  salary period per employee" guarantee did not exist. Mongoose's *"Duplicate schema index
  on {employee:1}"* warning — visible on every boot and throughout the test output — was
  reporting exactly this. **Treat that warning as an error.**
- **`Invoice`** used `partialFilterExpression: { status: { $ne: 'CANCELLED' } }`.
  MongoDB does not support `$ne` in a partial index, so the unique index on
  `(customer, billingPeriod, billingType)` was never created and nothing enforced
  requirement 12.3's no-duplicate-invoice rule. Now expressed as `$in` over the
  non-cancelled statuses.

Worth a test that asserts `syncIndexes()` succeeds for every model — it would have caught
both at CI time.

### 8. `npm audit` reports 5 vulnerabilities, 1 critical

Unreviewed. Triage against what is actually reachable in production; note that the
server installs with `--omit=dev`, so dev-only advisories do not apply to the deployed
tree.

---

### 16. The credential rate limiter counts successful logins

`auth.routes.ts:24-30` limits `/auth/login` and `/auth/change-password` to 10 requests per
15 min per IP in production — and `express-rate-limit` counts **every** request, not just
rejected ones. Eleven ordinary sign-ins therefore lock a user out of a password that is
correct, which is what happened to the head admin on 2026-08-05: the access log shows
`200`s up to the eleventh request and `429` on everything after.

A brute-force limiter should count failures. The one-word fix is
`skipSuccessfulRequests: true`, which makes the ceiling mean "10 wrong passwords" instead
of "10 sign-ins". The trap is already documented from the other direction in
`test/setup.ts:24-33`, where the suite had to raise the ceiling to a million because
successful logins in fixtures were exhausting it — the same defect, found twice, fixed
neither time.

Note also that a shared office NAT puts all field staff behind one IP, so any per-IP
ceiling is really a per-office ceiling.

**Current state: both limits are disabled in production** (set to `1000000000` in
`/etc/monhorus/backend.env`) because the lockout was blocking real use. The middleware is
still mounted. Re-enable it *together with* `skipSuccessfulRequests`, not before — with the
flag, a ceiling of 10 is defensible; without it, any ceiling low enough to stop an attacker
is low enough to stop a user.

Per-account lockout (`MAX_FAILED_LOGIN_ATTEMPTS=5`, `ACCOUNT_LOCK_MINUTES=15`) is a
different mechanism, counts only failures, resets on success, and is untouched — so brute
force against a *known* account is still bounded at 5 tries per 15 minutes even with the IP
limiter off. What is currently unbounded is spraying one password across many accounts.

---

## P2 — operability

### 9. No CI

No workflow file anywhere. The suite is 969 tests across 45 files and takes ~4½ minutes —
cheap to run on every push. Add typecheck, lint, test, and a `sync-indexes --dry-run`
against a throwaway database.

### 10. Deployment is manual

Every step is hand-run over SSH. Fold the runbook into `scripts/deploy.sh`: build, verify
the bundle's baked-in origin, upload with checksum verification, extract, `npm ci
--omit=dev`, restart, health-check, and roll back on failure.

### 11. Log shipping and monitoring

`logger.ts` emits NDJSON to stdout with no transport; systemd sends it to the journal and
nothing collects it. There is no uptime check on `/health` and no alert if
`monhorus-api` enters a restart loop — which it did during this deployment and was only
noticed because someone was watching.

### 12. Single-instance assumption is undocumented in the code

`overdue-reconciliation` (hourly) and `unclaimed-work` (5-minutely) are process-local
`setInterval` timers, so a second replica runs both twice. Nothing in the code says so.
Either add a lock or state the constraint at the call site.

### 13. Close open question 16.4 in `DEPLOYMENT_UBUNTU.md`

That entry says `apps/mobile/android/` and `scripts/` are untracked. Both are tracked now
— 19 files under `apps/mobile/android/`, plus `scripts/run-mobile.sh` — so a fresh clone
does build the customer Android app. The open question is stale and should be deleted
before someone acts on it.

### 14. `migrate-reports.ts` has no npm script

Its own header documents `npm run migrate:reports`, which does not exist; every other
script in that directory has one. Either add it or delete the reference.

### 15. Web bundle is a single 1.02 MB chunk

Vite warns on every build. Route-level `React.lazy` on the 25 feature modules would cut
first paint substantially, which matters more here than usual — clients are field staff on
mobile networks.

---

## Fixed during this deployment

Recorded so the reasoning is not lost.

- **`env.ts` rejected empty optional values.** `z.string().min(10).optional()` accepts an
  absent key but not an empty one, so `BOOTSTRAP_ADMIN_PASSWORD=` — which
  `bootstrap-head-admin.ts` itself tells operators to clear, and which `.env.example`
  ships for all three `BOOTSTRAP_` keys — crash-looped the backend. Copying the tracked
  template verbatim produced a service that could not start. Now wrapped in
  `optionalEnv()`, which maps empty to absent; also applied to `RATE_LIMIT_*`, where
  `z.coerce.number()` turned `""` into `0` and failed `.positive()`.
- **Open question 16.1 resolved.** `sync-indexes.ts` created 205 indexes across 37 models
  on a database that had none.
- **The two broken indexes above.**
