# Monhorus — full project audit

**Commit audited:** `6896bec` (main, immediately after the round-7 merge)
**Date:** 2026-09-07
**Nothing in this audit changed any code.** This file is the only thing written.

---

## 1. Method, and how much to trust this document

Seven read-only lanes ran in parallel over 842 source files across five packages:
security/authorization · calculations · data layer · cross-surface parity · web · both Flutter
apps · ops and test integrity.

Three rules were imposed on every lane, because the failure mode in previous rounds was not
missed findings but **confident false ones**:

1. **Open the file. Never report from a grep hit.** Every finding carries `path:line`.
2. **The three older audit documents are stale and were declared off-limits as sources.**
   `MONHORUS_FULL_AUDIT.md`, `STATIC_HARDCODED_AUDIT.md` and `docs/PROJECT_AUDIT_REPORT.md`
   describe problems fixed across seven remediation rounds. Only code at HEAD counted.
3. **Try to refute your own best finding before submitting it.** Every lane owed a
   "checked and NOT a problem" list. Those lists are in §6 and are as valuable as the findings.

**Twelve findings marked ✅ below I re-verified personally**, by opening the deciding lines or by
running the arithmetic. Unmarked findings are lane-reported with a stated verification method.
Items the lanes could not settle are marked *(unverified)* and say what evidence is missing.

**Measured test state — all green.** Backend 1587 · web 1057 · shared 78 · customer app 194 ·
employee app 300 = **3216 tests, 0 failed, 0 skipped**. `flutter analyze` clean in both apps.

---

> ## P0 REMEDIATION — 2026-09-08, commit `9764ce6`
>
> **All five P0s are fixed and merged to local `main`** (not pushed). Verified after the
> merge: backend **1591**, web **1069**, shared **78**, `tsc --noEmit` clean on both apps.
> Each fix landed with a regression test confirmed failing first.
>
> **One prescription in this document was wrong, and is corrected in place below.** P0-4 told
> the implementer to reuse `mongorestore --dryRun`. Measured against mongorestore 100.14.0 and
> a real MongoDB 8.2.3 replica set, `--dryRun` never reads the archive body — an archive with
> half its bytes removed still exits 0. Following this document would have shipped a check
> that always passes, which is the exact pattern §6 flags elsewhere. `gzip -t` is used instead.
>
> **P0-2 needed a design change this document did not anticipate.** The form could not be made
> to ask the right question, because `/vocabulary` withheld the band behaviour flags. They are
> now published; enforcement did not move.
>
> **Two P0 fixes are inert until an operator acts** — see P0-3.

## 2. Verdict

**Not ready for an unattended production release.** Not because the codebase is weak — the
refutation lists show it is unusually disciplined — but because of five specific defects, of
which **two destroy user data or access and three make a control that appears to work not work.**

The most serious cluster is not in application logic. It is that **the backup control can
silently reduce itself to zero archives, and never verifies the database half of what it
writes.** Everything else here is recoverable. That one is not.

Second: **there is no CI.** 3216 tests exist and nothing runs them on a change. `npm test`
doesn't even reach the two Flutter suites — 494 of those tests — because the root `workspaces`
array omits the mobile apps.

---

## 3. P0 — fix before the next release

### P0-1 ✅ ~~The role-assignment drawer silently strips every role an account already held~~ — FIXED `8477853`
`apps/web/src/features/access/AccessPage.tsx:369-372` and `:194`

The drawer opens with `setAssignSelection([])` and POSTs that array. The endpoint is an explicit
replacement (`apps/backend/src/modules/rbac/rbac.routes.ts:172`, `kind: 'EXPLICIT'`), and
`UserDto` carries no `roleIds` — so the drawer **cannot** seed itself from current roles even in
principle.

An admin opens it for a user holding FINANCE + DISPATCH, sees both unchecked, ticks MANAGEMENT,
saves: the account loses FINANCE and DISPATCH. Saving with nothing ticked reduces the account to
zero roles. The correct pattern is already in this codebase —
`EmployeeSystemAccessPanel.tsx:539` does `setSelected([...current])`. The existing test covers
only whether the menu item is disabled.

### P0-2 ✅ ~~Creating an object with a score of 41–80 always loses the assessment~~ — FIXED `b1c9bf5`
`apps/web/src/features/projects/objects/ObjectFormPage.tsx:527` vs
`apps/backend/src/modules/object-master/object-master.service.ts:1863-1890`

The web form gates its findings on `initialRiskLevel === 'CRITICAL' || 'OUT_OF_SERVICE'` — the
exact form the backend **discarded**, with a comment saying why: *"written as
`riskLevel === 'CRITICAL' || …` this rule silently meant 'the two bands that happened to be
called that', so renaming one moved the safety gate with the word."*

The backend requires `revisitRequired || repairRequired` for any band with
`requiresRecommendation && !requiresConclusion` — which in the shipped defaults is exactly
SCHEDULE_REPAIR (41–60) and ATTENTION (61–80). `grep -c "revisitRequired\|repairRequired"` on the
form returns **0**: it has no control for either field and never sends them.

So on a conclusion-generating type, any score of 41–80 writes the object, then fails the
assessment call on a field the page cannot render, leaving the user at the "object written,
assessment not" panel with no way to finish. Unconditional. `AssessmentDrawer.tsx` and the
employee app's `assessment_sheet.dart` both carry the checkboxes — only this entry point is broken.

### P0-3 ✅ ~~The backup can silently reduce itself to zero archives~~ — FIXED `15f64ff`
`scripts/backup-monhorus.sh:141-150` + `scripts/monhorus-backup.service`

Three verified gaps compose:
- **No `OnFailure=`** in the unit — no mail, no webhook, no dead-man switch. The only design is
  that someone notices `systemctl status`.
- **The prune runs BEFORE the dump, with no "keep N newest" floor** — `find -mtime +14 | rm -f`.
  The comment claims a failure "still leaves RETENTION_DAYS-1 days of history"; that holds only
  while the last *success* is inside the window.
- **`Persistent=true`** re-fires and re-fails nightly.

An unnoticed 15-day failure streak ends with an empty `/var/backups/monhorus` and a timer that
still looks armed.

### P0-4 ✅ ~~The database archive is never integrity-checked; the uploads archive is~~ — FIXED `15f64ff`
`scripts/backup-monhorus.sh:256` vs `:270`

The DB half gets `[ -s "$DB_ARCHIVE.partial" ]` — a non-zero byte count. The uploads half gets
`tar -tzf`, with a comment stating it "catches a truncated write, which is the failure a full
disk actually produces." The script's own header says the disk runs 83–88% full. A truncated
`db-*.archive.gz` is renamed to its final name and counted as a good backup. ~~The verifier already
exists in `restore-monhorus.sh:159-161` (`mongorestore --dryRun`).~~

**CORRECTION — that prescription was wrong.** `mongorestore --dryRun` short-circuits before
the demultiplexer runs and never reads the archive body: measured against mongorestore
100.14.0 and a real MongoDB 8.2.3 replica set, `plain.trunc50` (half the bytes removed) exits
0 with "0 document(s) restored successfully". `mongorestore --nsInclude=<no-match>` does read
the whole stream, and was also rejected — it needs a server, a credential and a network, so it
can fail spuriously and discard a good backup, and its errors are confusable with connection
failures, reintroducing the classification problem. **`gzip -t` is what shipped:**
`mongodump --archive --gzip` writes one gzip stream, so it walks the file to the CRC32/length
trailer, needs nothing running, and reads both archive shapes.

> **OPERATOR ACTION REQUIRED for P0-3.** The notification path is inert until
> `ALERT_WEBHOOK_URL` and `HEARTBEAT_URL` are set in `/etc/monhorus/backup.env` and the two new
> files (`monhorus-backup-notify.sh`, `monhorus-backup-failure.service`) are installed. Unset
> counts as *undelivered*, not as nothing-to-do: the notifier exits non-zero and leaves a
> marker the next successful run prints. `HEARTBEAT_URL` is the only thing that catches a run
> that never happened — `OnFailure=` cannot fire for a disabled timer.

### P0-5 ~~Audit-log date filters return nothing for a single-day range~~ — FIXED `3e7a040`
`apps/web/src/features/audit/AuditLogPage.tsx:65-66` → `audit.routes.ts:119-123`

Bare `yyyy-mm-dd` reaches `new Date(...)` = UTC midnight = 08:00 Ulaanbaatar. `to` chops 16 hours
off the last day; **Эхлэх = Дуусах = the same day collapses `$gte` and `$lte` to one instant**, so
a day full of activity renders «Шүүлтүүрт тохирох бүртгэл алга». `lib/business-day.ts` exists for
this and is used by the reports and inspections screens; the audit page never adopted it.

---

## 4. P1 — real defects with a plausible trigger

### Security and access

**P1-1 ✅ SALES can read the entire audit trail, including IP addresses.** `GET /reports/AUDIT_LOG`
is gated on `report.view` (`report.routes.ts:61-63`) while the real audit router requires
`audit.view` (`audit.routes.ts:93-97`). The report emits actor, role, reason and IP
(`report.service.ts:882-895`). SALES holds `report.view`, not `audit.view`.
*Correction to the lane's claim:* SALES does **not** hold `report.export`, so it can read but not
CSV it.

**P1-2 ✅ Work-report photo ids are written with no ownership check.**
`work-report.service.ts:523-524` — `report.set('beforePhotos', ids.map(...))` with no
`ownerType`/`ownerId` filter, and `PHOTO_SELECT` resolves them for display. A technician can put
any 24-hex id in the list and read back filename, MIME type, size, uploader and creation time of
any stored file — another tenant's floor plan, an HR document. The **equipment ids on the very
same save are tenant-checked** (`:559-572`), and the sibling attachment path has
`assertAttachmentsBelongToActor` (`service-request.service.ts:379-401`). An omission, not the
module's posture.

**P1-3 The `/reports` catalogue resolves no customer scope at all.** `report.routes.ts:47-99` —
neither `/kpi` nor `/:reportKey` calls `resolveCustomerScope`, unlike two routes 50 lines below.
`customerId` is a raw client filter; omit it and the filter is `{}` across all tenants, `limit`
up to 5000. Not a live customer-tier break (the portal is separately gated), but it is the only
customer-owned read surface with no second line of defence. `technicalReport` additionally
applies **no status filter**, so DRAFT/SUBMITTED/RETURNED conclusions are returned.

**P1-4 `seedRbac` is prune-only, so withdrawn TECHNICIAN grants survive in existing databases.**
`rbac.service.ts:58-63,107-124`. `employee.view`, `customer.view` and `report.view` were removed
from the TECHNICIAN default but remain catalogue keys, so a role document seeded earlier still
carries them. *(unverified — needs a per-environment check of the live role documents.)* If they
persist, every technician reads the staff directory, the customer directory with tax numbers, and
every contract's `monthlyFee`. Remedy exists:
`npm run migrate:system-role-permissions -- --apply --revoke-extra`.

### Data integrity

**P1-5 ✅ `setPlannedMaterials` can lose a technician's recorded material usage.**
`planned-work.service.ts:1633` (snapshot) → `:1665-1676` (full-array `$set` via `work.save()`).
`applyDelta` (`planned-work.material-usage.service.ts:88-115`) goes to real lengths to be atomic —
a conditional single-document `$inc`. `setPlannedMaterials` rebuilds the whole array from a stale
in-memory snapshot, and `plannedWorkSchema` is `versionKey: false`, so there is no guard.

Planner opens the drawer (100 planned, 0 consumed) → technician records 40 → planner saves →
the row is written back as `consumed 0, remaining 100`. The pool is handed out twice and 140 can
be drawn from 100. **The file's comment "WHAT IS ALREADY CONSUMED SURVIVES THIS WRITE" is true
sequentially and false concurrently** — and an earlier round's conclusion that this function is
now correct was based on the sequential reading.

**P1-6 ✅ Paged lists sort on tied keys with no tiebreaker, so rows duplicate and drop across
pages.** ~20 endpoints, including every report builder, which pages up to 5000 rows —
`employee.service.ts:616`, `planned-work.service.ts:781` (default sort `plannedStartDate`, which
is day-granular), `report.service.ts:155,469,633,796,920` and others. The codebase knows the fix
and applied it in exactly two places: `report-query.service.ts:123` and `inspection.service.ts:236`
both append `_id`. That asymmetry is what makes this a bug rather than a design choice.

**P1-7 Deleting an object can leave a dangling required reference.**
`object-master.service.ts:657` (`deleteBlockersOf`) never counts `ReportItem`. Its intended cover
is `ObjectAssessment`, but `report-record.service.ts:351` skips items with no score — and a
scoreless observation is a first-class input (`score` is `.nullish()`). Write an observation-only
finding, approve it, delete the object: every blocker reads zero and the delete succeeds.
`ReportItem.object` is `required: true` and now points at nothing; the report renders a nameless
finding forever. Same gap for `WorkReport.items[].object`, `PlannedWorkTask.relatedObjects` and
`Diagram.object`.

**P1-8 Invoice numbering is read-max-and-increment, and a collision is reported as the wrong
thing.** `invoice.model.ts:224-238`. The atomic `counter.model.ts` exists and is used by
`nextWorkNumber` and `nextReportNumber`; this one is not. The monthly run's catch assumes any
`11000` is the period-uniqueness index and tells the operator «нэхэмжлэл аль хэдийн үүссэн» — so
a genuine invoice-number collision silently skips that agreement's invoice for a false reason.
Secondary: the `.sort({invoiceNumber:-1})` string sort breaks past 9999 in a month.

### Wrong numbers

**P1-9 ✅ The dashboard's 6-month trend truncates its oldest month by up to 3 days.**
`month-window.util.ts:57-62` — `setUTCMonth(getUTCMonth() - 1)` on a **last-day** instant. In
August, `monthEnd('2026-03')` is 31 March, so it asks for 31 February, which JS normalises forward
to **3 March**. I ran the real functions: on a UTC host the oldest bar loses 3 days in August and
1 day in five other months, while still being labelled «2026-03».

**P1-10 ✅ `monthEnd` resolves the zone offset through the *process's* timezone, not the named
zone** — and its docblock claims the exact opposite ("works in the DEPLOYMENT timezone rather than
the server's"). `new Date(probe.toLocaleString(...))` parses in the host zone, so what it computes
is (Ulaanbaatar − host), not (Ulaanbaatar − UTC). Measured:

| process TZ | `monthEnd('2026-04','Asia/Ulaanbaatar')` | correct? |
|---|---|---|
| UTC | `2026-04-30T16:00Z` | ✓ |
| Asia/Ulaanbaatar | `2026-05-01T00:00Z` | **8 h late** |
| America/New_York | `2026-04-30T12:00Z` | **4 h early** |

**Neither runbook pins the host timezone and no systemd unit sets `TZ`**, so which behaviour you
get is an undocumented install-time choice. Affects `dashboard.service.ts` and
`portal-summary.service.ts` — the two screens the utility exists to keep in agreement.
`day-bounds.util.ts` does this correctly via `formatToParts`; this file is the one that does not.

**These two interact: each masks the other.** On a UTC+8 host P1-10 makes `monthEnd` return
day-of-month 1, so P1-9's rollover never fires. Fixing either alone makes the dashboard worse.

**P1-11 Every printed planned-work report rounds ≥99.5% up to «100%».**
`report-pdf.format.ts:105-107` uses `Math.round`, defeating `progressPercentOf`'s deliberate
`Math.min(99.9, ...)` clamp. A sub-task at 995/1000 renders `995/1000 (100%)` — the same cell
says 5 units outstanding and 100% done, on a document a customer signs. Both web renderers print
`99.5%`, so the PDF contradicts the console it was generated from.

**P1-12 «Боломжтой ажилтан» uses a hand-written 6-status list that contradicts the same file's
openness definition.** `dashboard.service.ts:58-66` vs `:190`. `REPORT_SUBMITTED`,
`VERIFICATION`, `RETURNED` and `REVISIT_REQUIRED` are absent from `ACTIVE_REQUEST_STATUSES` but
open under `{ $nin: SETTLED_REQUEST_STATUSES }`, and `assignedEmployees` is cleared only on
UNASSIGNED. Two technicians carrying live returned/verification jobs show as available, and the
workload chart shows them at 0 — while the same payload counts both requests as open.

### Cross-surface

**P1-13 ✅ Round 7's session-keying fix is incomplete — `work_providers.dart` was never touched.**
Five user-scoped providers, none `autoDispose`: `serviceRequestDetailProvider:777`,
`plannedWorkDetailProvider:1151`, `plannedWorkReportBundleProvider:1286`,
`inspectionReportProvider:1381`, `workFileBytesProvider:1392`.

Technician A opens an unclaimed pool request and signs out; B signs in on the same handset and is
served A's cached snapshot with no HTTP request, then decides whether to claim on a stale record.
`workFileBytesProvider` retains evidence photographs in RAM across sign-out — and its two siblings
*were* keyed in round 7, with the rationale written into one of them: *"somebody else's personal
data left in memory on a shared handset."* Same route, same handset, missed.

**P1-14 The customer app has the same leak class on ten family providers**, and its own comment at
`customer_portal_providers.dart:160-161` overstates coverage — true of the six that call
`_requireScope`, false of the ten that don't. Narrower than the employee case (ids don't overlap
between organisations) except for **two accounts of the same organisation**. Unambiguous:
`fileBytesProvider:552` is an unbounded cache of floor plans and photos surviving sign-out.

**P1-15 The customer create-request sheet is swipe-dismissible while holding a required photo.**
`create_request_sheet.dart:122-124` — no `isDismissible: false`, no `enableDrag: false`, and
**there is no `PopScope` anywhere in either app**. Photos upload eagerly, so a stray scrim tap
discards the whole form *and* orphans every uploaded file server-side. The employee app does the
opposite on both equivalents with the reasoning written down (`assessment_sheet.dart:53-55`).

**P1-16 Object-history rows render unlabelled on a customer's phone.** The Dart enum
(`object_master_enums.dart:112-118`) mirrors a retired wire vocabulary; the backend now sends
`OBJECT_ASSESSMENT`/`SERVICE_REQUEST`/`CONSOLIDATED`, which all resolve to `null` — so **every
equipment assessment row**, the most common kind, shows no label and a placeholder icon.

**P1-17 Three web controls are gated on a permission their route does not use.** «Тоноглол
нэмэх» on `object.manage` where the route needs `object_master.manage` (SALES sees it and lands on
Хандах эрхгүй); the conclusion **approve** button on `change_status` where the route accepts
`approve_report` too, so a technician cannot approve the conclusion they just wrote — the exact
outcome that permission was created to enable; and the status block likewise excludes
`self_progress`.

**P1-18 Employee photos can never load.** `EmployeeDetailPage.tsx:159-164` and
`EmployeeListPage.tsx:83-88` use raw `<img src>` against a Bearer-only endpoint. Every other photo
surface goes through `lib/file-url.ts`, which exists for this reason.

**P1-19 Two of seven filters on Үзлэг ба дүгнэлт are inert.** `InspectionListPage.tsx:86-116`
never reads `sourceType` or `status`, though both dropdowns write them to the URL. A reviewer
filtering to «Ноорог» is shown every conclusion in the system and believes it is the filtered set.

**P1-20 `/users` needs an RBAC key *and* a legacy role tier; no client checks both.**
`user.routes.ts:31` adds `authorize('admin','head_admin')` on top of `requirePermission(USER_VIEW)`.
Web gates on the key alone; the customer app gates on the tier alone. Either mismatch produces a
visible screen that 403s.

### Operations

**P1-21 `NODE_ENV` is optional, defaults to `development`, and gates seven production controls** —
the reset-token log guard, internal error disclosure to clients, the login brute-force ceiling,
log level and transport, `autoIndex`, and the `seed:dev` refusal. `assertProductionOverrides`
itself returns early when `NODE_ENV !== 'production'`, so the one guard that would catch a
misconfigured deploy is the first thing the misconfiguration disables.

**P1-22 The brute-force defence has zero test coverage and is neutered suite-wide.**
`src/test/setup.ts:31-32` sets `RATE_LIMIT_CREDENTIAL_MAX ??= '1000000'` with a comment saying "a
test that wants to assert the policy sets it back down" — **no test does.** Deleting
`credentialLimiter` from the login route would pass all 1587 backend tests. Account lockout and
token-reuse detection are likewise never exercised.

**P1-23 Audit-log immutability is documented as required at the DB layer and the runbook does the
opposite.** `audit-log.model.ts:62-65` says to revoke update/delete at the database-user level;
`DEPLOYMENT_UBUNTU.md:243` grants `readWrite`. The mongoose hooks are the only protection and are
bypassed by any direct driver call or `bulkWrite`.

**P1-24 The two deployment runbooks contradict each other on index creation, and the older one is
actively wrong.** `DEPLOYMENT_UBUNTU.md:256-263` states *"no such migration exists in this
repository"* — but `src/scripts/sync-indexes.ts:101` calls `syncIndexes()` and `package.json`
exposes `sync:indexes`. Its "Deploying an update" section omits the index step entirely, while
`index-drift.ts:220-234` **refuses to boot** on a missing unique index. An operator following it
gets a hard outage on any release that adds one.

**P1-25 No release-rollback procedure exists.** The "Rollback" section is a tenant *uninstall*.
`sync-indexes` also drops indexes absent from the schema, so rolling code back and re-running it
destroys the newer release's indexes, while not running it leaves drift that may refuse the boot.

**P1-26 A transient transaction probe failure is cached as "unsupported" forever.**
`transaction.util.ts:44-48` — `detectSupport()`'s catch returns `'unsupported'`, assigned to a
module-level variable reset only by a test seam. A failover-time blip makes every multi-document
write in that process non-atomic until restart, after one `logger.warn`.

**P1-27 Restore hazards.** `--db` can be silently ignored when the URI has no database path —
exactly the form the oplog credential recommends — turning a rehearsal into a production restore
with `--drop` (`restore-monhorus.sh:270`). The `--nsExclude admin.*/config.*` net is conditioned
on oplog presence rather than on "is this a full-instance archive", and the detector reports any
failure as "none in this archive". `--confirm` is a bare flag with no TTY check.

**P1-28 `nodemailer` carries a HIGH advisory as a direct runtime dependency.** `npm audit`: 10
vulnerabilities (1 critical, 4 high, 5 moderate). The critical `tar` is install-time only, but
reaches through `bcrypt`, a runtime auth dependency.

---

## 5. P2 — latent, hygiene, dead code

Grouped; each was verified but none has a live trigger today.

- **Unknown-value fallbacks that understate state (both Flutter apps).** `InspectionReportStatus`
  and `WorkReportStatus` → `draft` (the one member meaning *not locked*); `PlannedWorkTaskStatus`
  → `pending`; `AccountStatus` → `active`, which makes `mustChangePassword` read false and skips
  the forced-change screen the app promises cannot be navigated around. In every case a sibling
  parser in the same file correctly returns null — `MaterialUnit`'s docblock spells out the
  reasoning after a real bug printed 40 metres of cable as 40 ширхэг. Latent: every shared
  constant set matches the Dart enums exactly today.
- **Three compiled risk-band assumptions in the customer app**, all reachable after the server has
  answered: `solidForeground` keys chip text colour off band identity rather than the resolved
  colour; `AccentTone.named` knows only eight colour words; and "severe" is decided client-side
  against a hardcoded midpoint of 50, because `/vocabulary` does not publish the backend's real
  per-band flags.
- **Dead code.** The entire `apps/web/src/features/diagram/` tree — ~2,400 lines plus a full
  backend module and nine routes — is unreachable; nothing imports its only entry point, yet
  `diagram.view`/`diagram.manage` are granted to six roles. Also `hooks/use-sla-hours.ts`,
  `components/ui/Select.tsx`, six unused service methods, `service_request.cancel` (enforced by no
  route), `portal.profile.view`, and push `forget()` — documented as reserved for sign-out on a
  shared handset and never called, so the gap it was written to fill is unfilled.
- **Truncation not disclosed.** The customer picker caps at 100 and discards `total`, so past 100
  customers the 101st cannot be selected when creating a project, object, planned work or invoice.
  `/objects/nodes` returns a bare array with no `total`, so no client *can* detect the 100-row cut.
  The inspection CSV export truncates at 5000 rows with nothing in the file saying so. The portal
  home presents a 100-row page as the whole estate.
- **Two "due today" predicates in one dashboard payload** (`dashboard.service.ts:236` vs `:687`) —
  one excludes already-past-due, the other includes it.
- **Invoice summary tiles ignore every filter but customer.** `paidTotal` and `draftCount` are
  flows and should follow the period filter; the cards sit above the filter bar with nothing
  saying they describe a different set.
- **Server row-level errors on the two structured settings can never reach the row** — the path
  prefix the page strips doesn't match the path the shared schema produces, so a 70-character band
  name comes back as one generic banner over five groups.
- **Unsaved-changes guards exist on two of eight forms.** Absent from `ObjectFormPage` (1,400
  lines, cancel is a bare `navigate(-1)`) and from `SettingsPage`, which holds a whole re-cut risk
  ladder in local state.
- **Sparse indexes that are no-ops** because the field has `default: null` —
  `service-request.model.ts:232` and `object-master.models.ts:626`. The codebase states the rule
  in `employee.model.ts:224-226` and uses `partialFilterExpression` in the index directly above one
  of them.
- **Every delete-blocker guard is check-then-act** with no transaction, though `withTransaction`
  exists and the deployment is a replica set. **Three of five document-number generators are
  non-atomic** and the comment claiming "the caller retries" is false — no caller does.
- **Orphaned blobs** on two delete paths; **floor deletion never checks planned-work tasks or
  report items** (`project.service.ts:462-467` sends FLOOR to a `{ _id: null }` branch that always
  counts 0).
- **Two tests that cannot fail** — `report.api.test.ts:451-465` and `:448`, both with their sole
  assertion inside an `if (total > 0)`. **Eight Flutter widget tests assert only `findsNothing`**
  with no positive anchor, so they pass if the screen renders nothing. These are the only such
  tests in 3216.
- **Background jobs log success at `debug`**, below production's `info`, so there is no positive
  evidence a sweep ran. **Credentials are passed on the command line** to mongo tools, visible in
  `ps` on a host shared with four tenants. **`UPLOAD_DIR` is missing from `.env.example`** though
  the runbook calls it "the single most destructive thing to get wrong".
- **Both apps report `platform: 'android'` regardless of device**, and both ship an iOS target. The
  shared constant exists so enabling iOS is "a dispatch change, not a migration" — but because no
  row records which is which, it *will* be a migration.
- **20 pages × 100 items renders into eager `ListView(children:)`** in both Flutter apps — no
  infinite scroll anywhere, so every row widget is built before the list is.

---

## 6. Checked and NOT a problem

Recorded so nobody spends a round re-discovering these. Each was investigated and refuted.

**Refuting earlier claims, again:**
- **No secrets are committed.** The Firebase service-account key is untracked, gitignored, and
  `git ls-files` / `git log --all` are both empty for it. Confirmed independently by two lanes.
  This claim has now been refuted three times across audits; it should stop being raised.
- **Round 7's `--oplog` change does not strand existing archives.** `--oplogReplay` is added only
  inside `if archive_has_oplog`; the else branch restores with the pre-change argument set.

**Verified sound (spot-checks by area):**
- **Authentication.** Tokens re-validated against the DB every request with a `passwordChangedAt`
  cut-off; refresh rotation with reuse-detection that kills all sessions; password change and
  admin reset both bump the cut-off *and* revoke sessions; login and forgot-password both burn a
  bcrypt cycle on the unknown-email path; reset tokens are 32 CSPRNG bytes, hashed at rest,
  single-use, with one indistinguishable failure code.
- **No NoSQL injection surface.** `validate.middleware.ts` *replaces* `req.body/query/params` with
  the zod output, so operator objects cannot survive. All 25 `new RegExp` sites escape input. No
  `$where`, `$function` or `mapReduce`.
- **No path traversal in storage.** Keys are 24 CSPRNG bytes generated server-side; the caller's
  filename never touches the filesystem; SVGs are parsed and re-serialised before a byte is
  written and served under `default-src 'none'; sandbox`.
- **The customer portal is correctly scoped on every path**, putting the scope filter *inside* the
  query rather than checking after load, and answering 404 rather than 403.
- **Every `resolveAssignedWorkFilter` call site handles `null` correctly** — all of them checked;
  none uses a spread.
- **The staff-tier + portal-role cross-tenant reader is closed on both paths**, including when a
  *role's* permission set is edited.
- **Enum drift is structurally prevented at the model layer** — all ~70 Mongoose `enum:`
  declarations derive from shared constants; not one hand-written array.
- **No wholesale-overwrite updates.** Not a single `Object.assign` or blanket `$set: {...body}` in
  any service.
- **`$ne: [$field, null]` in aggregation — confirmed against a real MongoDB, not folklore.** A
  lane spun up `mongodb-memory-server` and proved `{$ne:['$missing', null]}` returns **true**,
  which is why round 7's `$ifNull` fix was correct. The remaining `$ne` guards are safe only
  because the schema writes the field by default — latent, not live.
- **Invoice arithmetic, planned-work progress weighting, risk-band tiling, report footers and
  report date ranges** all held up under direct reading. "Critical" is derived from band
  *behaviour* flags, not band names, at every roll-up site.
- **Mongoose 7's hook-default change has NOT disarmed the audit-log immutability guards** —
  checked in the installed source.
- **The technician claim flow and the material-usage pool guard are genuinely atomic.**
- **Web:** no bare permission-key literals anywhere; risk bands are not compiled into the web app;
  no client-side money that can disagree with the server; single-flight token refresh with a retry
  guard; zero duplicate DOM ids today (enumerated programmatically across every import edge).
- **Mobile:** the push `_started` guard cannot permanently block re-registration (it re-issues the
  token — that bug is genuinely fixed); secure storage is correct; nothing sensitive is logged; no
  unknown risk level renders as a safe band in either app.
- **Ops:** graceful shutdown, the `/health` readiness probe, error responses that never leak, and
  mail's production refusal are all correct and, where it matters, tested. No skipped, `.only`,
  `.todo`, snapshot or tautological tests anywhere. No lockfile drift.
- **Label pairs that look like drift and are correctly different:**
  `ServiceRequestStatus.CANCELLED` «Цуцалсан» vs `PlannedWorkStatus.CANCELLED` «Цуцлагдсан»;
  `PlannedWorkStatus.DRAFT` «Төсөл» vs `PlannedWorkReportStatus.DRAFT` «Ноорог»; the three
  `SUBMITTED` labels. **Do not reconcile these** — they are different enums for different modules.

---

## 7. Corrections to things previously believed

1. **`setPlannedMaterials` is not safe.** An earlier round concluded it now has correct semantics
   and should not be re-entered. That is true sequentially and false concurrently — see P1-5.
2. **Round 7's session-keying fix was reported complete. It was not** — `work_providers.dart` was
   never touched (P1-13), and the customer app was never covered at all (P1-14).
3. **SALES cannot CSV the audit log**, only read it — the lane over-claimed `report.export`.
4. **`PlannedWorkLifecycleStatus.fromWire`'s `draft` fallback is dead code**, not a live bug — the
   field is never read by any screen. Caught and withdrawn by the lane that raised it.
5. **`PlannedWorkTask`'s object array is named `relatedObjects`**, not `objects`.

---

## 8. Suggested order

> **Items 1–3 are done** (P0-3/P0-4, P0-1, P0-2). The list below is kept as written; what
> remains starts at item 4.
>
> **New follow-ups this remediation surfaced:**
> - `archive_has_oplog` reports an unreachable server identically to "no oplog in this
>   archive", so a connection failure silently downgrades a point-in-time restore to a smear.
>   Now confirmed by measurement rather than reading.
> - The orphan panel in `ObjectFormPage` should be able to retry a refused assessment. It is
>   the only thing covering a refusal the form could not have predicted — a race against a
>   settings change between the two calls — and it already holds the `objectId` it needs.
> - `auditQuerySchema` still has no date coercion. P0-5 was fixed client-side because
>   `GET /audit` has exactly one caller; a second client must use `businessDayStart`/`End`
>   too, or the fix moves server-side then — but not both.

Ordered by "what breaks if this is left alone", not by effort.

1. **P0-3 and P0-4** — the backup. Everything else is recoverable; a lost database is not.
2. **P0-1** — role stripping. It destroys access, and an admin locking themselves out is plausible.
3. **P0-2** — the 41–80 assessment. A safety-relevant reading is silently lost.
4. **P1-5** — material usage. Silent data loss, and the current comment argues it cannot happen.
5. **P1-13 / P1-14** — finish the session-keying. The pattern and the argument already exist.
6. **P1-1, P1-2** — the two access gaps that cross a boundary.
7. **P1-9 + P1-10 together** — they mask each other; fixing one alone makes the dashboard worse.
8. **CI**, before anything else grows. 3216 tests and nothing runs them.

**One question this audit could not settle from source:** whether live installations carry role
documents that still hold the withdrawn TECHNICIAN grants (P1-4). That is a data question. Run the
migration in `--dry-run` per environment before assuming either way.
