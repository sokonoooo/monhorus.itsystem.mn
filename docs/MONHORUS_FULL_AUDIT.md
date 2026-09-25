# Monhorus — Full Project Audit

**Date:** 2026-09-04 · **Commit:** `f4e304c` (`main`) · **Method:** six parallel read-only lanes — security/authorization/tenancy, business logic and calculations, database and data integrity, web application, both Flutter apps, and tests/configuration/operations. Each lane traced production call paths rather than definitions; every P0 below was re-opened and confirmed in the source before it was written down.

**No source file was modified by this audit.**

---

## Read this before the findings

**There is a prior audit at `docs/PROJECT_AUDIT_REPORT.md` (1,718 lines).** Roughly half of what a thorough sweep of this codebase produces is already logged there — the dead `ServiceRequest.device` delete-guard (Z3, line 1358), the employee-termination gap (line 535), the `deleteBlockersOf` omissions (H-11). Where a finding here duplicates one there, it is marked **[also PAR]**. The value of this document is the residue.

**There is also `STATIC_HARDCODED_AUDIT.md`, whose remediation banner overstates.** It claims all P0/P1/P2 findings are fixed. Three were never in any remediation lane and remain open, verified today:

| Claimed fixed | Actual state |
|---|---|
| `seed:dev` production guard (§9 item 4) | **Open.** `seed-dev-data.ts:766` still keys off `NODE_ENV`, which defaults to `development` |
| `CORS_ORIGINS` production refusal (§9 item 5) | **Open.** `assertProductionOverrides` still covers only `APP_WEB_BASE_URL` |
| `slaState` post-pagination filtering | **Open.** `service-request.service.ts:722-723` still filters already-fetched rows |

It also states *"not one backend metric is computed from a truncated list."* That is false — see P1-14 and P1-15 below.

The recurring failure mode this codebase names about itself — *"safeguards that were designed, written, and then never wired up"* — now applies to that document's own record of itself. Treat its remaining claims as unverified.

---

# 1. Executive Summary

Monhorus is a well-reasoned codebase with unusually good instincts: 1,444 backend tests with **zero `vi.mock()`** (every one a real integration test), six genuine concurrency races under test, exemplary backup/restore scripts, a documented and correct atomic guard on material draws, sound tenant isolation, and load arithmetic that matches its specification exactly. Where this codebase reasons about a problem it reasons well, and it writes the reasoning down.

The findings cluster into five themes, and none of them is carelessness:

1. **A convention adopted two-thirds of the way.** `dayBounds(…, APP_TIMEZONE)` exists, is documented, and is used by dashboard, reports, calendar and the PDF formatter. The two modules that never adopted it are the two where a day boundary *is* money and a deadline: invoice overdue, and `plannedEndDate`. `invoice.service.ts` is now the only non-test backend file still calling `setUTCHours`.
2. **Guards that test presence rather than content.** `input.X ?? stored` cannot clear a field. `input.assignedEmployeeIds !== undefined` blocks an edit that changed nothing else. Conditional updates whose `modifiedCount` nobody reads.
3. **Failure collapsed into emptiness.** `.catch(() => setX([]))` renders a transport error as an affirmative "none". This produces the single worst class of defect in the product: a customer reading a clean bill of health off a failed request.
4. **One rule enforced on one of several doors.** Auto-decommission on one of four score-writing paths; band-conditional requirements on the manual assessment path only; the assignment scope on three of four report-read families.
5. **Checks that cannot fail.** `npm run lint` runs zero tasks and exits 0 with no linter installed. `/health` touches no dependency. The index drift detector does not exist while the permission one does.

**Counts.** P0: 20 · P1: 101 · P2: ~120 · False positives and legitimate constants explicitly cleared: ~95.

**Release assessment: NOT SAFE — see §9.**

---

# 2. All Findings by Severity

## P0 — wrong output someone acts on, data loss, or a blocked safe deploy

| # | Location | Problem | Impact | Fix |
|---|---|---|---|---|
| **P0-1** | `object-master.service.ts:1291-1367` | Every §4.2 technical field merges as `input.X ?? stored ?? null`. The form sends explicit `null` for a cleared box; `null ?? stored === stored`. ✓ verified | A technician clears a mis-entered **500 kW**, sees «Объект шинэчлэгдлээ.», and 500 kW is still there — still feeding floor load, panel reserve and `loadVariance`. The same handler does it correctly 200 lines earlier for `description`/`notes` | Presence test: `if ('ratedPowerKw' in input.equipment)`. No client change |
| **P0-2** | same file `:1300-1356` | Reference merges use a truthiness test, so the explicit «Хэлхээнд холбохгүй» option sends `null` and changes nothing ✓ | The circuit→equipment edge is what the load walk traverses, so the equipment's power stays in a panel the user believes they disconnected | as above |
| **P0-3** | `auth_provider.dart:220` + `push_messaging.dart:97` (**both apps**) | `start()` returns early on `_started`, which is cleared only by `stop()`, reached only via `logout()`. `handleSessionExpired()` never calls it ✓ | Session expiry, an admin passcode reset, or a password change elsewhere → re-login → **`POST /notifications/devices` is never sent again** for the life of the install. Nothing logged server-side. **Strongest explanation yet for the zero-registered-devices symptom** | Call `PushMessaging.stop()` from `handleSessionExpired` and the `changePassword` success branch |
| **P0-4** | `customer_portal_providers.dart:451,491,500` | Three providers depend only on the Dio client, are not `autoDispose`, and never watch `currentUserProvider` | After logout + login as a **different customer** in the same process, B sees A's unread badge, A's survey prompts naming A's request numbers, and A's full notification list with A's building names. **Cross-tenant disclosure on a shared handset.** Two sibling providers watch the user *specifically to avoid this*, with a comment saying so | Watch `currentUserProvider`, or invalidate on the auth transition |
| **P0-5** | `conclusion_editor_screen.dart:66-89,160-164` | The three visit-level fields reach the notifier **only** inside `_save()`; every equipment card emits on each keystroke | Navigate away and back: the cards still hold their text, «Ерөнхий үнэлгээ / дүгнэлт / зөвлөмж» are empty. The half-preserved screen reads as a rendering glitch, not data loss — and these are the exact three fields submission is blocked on | Add `onChanged` calling the existing setters |
| **P0-6** | `invoice.service.ts:386-422` vs `:521-617` | Preview returns one candidate **per agreement**; the generator does `findOne` — one agreement **per customer**, no sort. The unique partial index then blocks the second permanently ✓ | Customer with two ACTIVE agreements (₮2.4M + ₮0.6M): operator sees ₮3.0M across two rows, ticks the customer, gets one ₮0.6M invoice and *"1 нэхэмжлэл үүслээ"* with **no skipped entry**. ₮2.4M is never billed and never can be for that period | Key the run on agreement id end to end; index `(serviceAgreement, billingPeriod)`; guard overlapping activations |
| **P0-7** | `invoice.service.ts:81,91,282` | Overdue is framed on the **UTC** day (`setUTCHours`) while everything else uses `dayBounds(…, APP_TIMEZONE)`. Only non-test backend file still doing this ✓ | Every day 00:00–08:00 local: dashboard says ₮2.2M overdue, `/invoices` summary says **₮0**, the badge reads «Илгээсэн», the `?status=OVERDUE` filter returns nothing, and the customer's overdue push is eight hours late | `dayBounds(dueDate, APP_TIMEZONE).end` |
| **P0-8** | `report.service.ts:979-987` | `PLANNED_WORK_COMPLETION_RATE` counts only `status === 'COMPLETED'`, but approving a report **archives** the work | 20 works, 12 completed *and* approved, 3 awaiting approval: KPI prints **15%**; truth is **83%**. The better the office closes paperwork, the lower the number. Contradicts its own published formula | Count `COMPLETED ∪ ARCHIVED`; exclude DRAFT/CANCELLED from the denominator |
| **P0-9** | `report-record.service.ts:366-380` | Rule 17.9 auto-decommission is enforced at `object-master.service.ts:1913` only. `applyReportToEquipment` writes the same `score`/`riskLevel` head without touching `status` | A panel scored 5 → `OUT_OF_SERVICE` via a planned-work report stays `ACTIVE`: its 10 kW still counts toward floor load, its reserve still reads as headroom, new circuits can still be wired to it. **The same score through `POST /assessments` decommissions it** | Move the band-flag side effects into the shared write path |
| **P0-10** | `object-master.service.ts:1912` + four risk readers | Auto-retired equipment is excluded from load but included by `rollup.service.ts:46`, `dashboard.service.ts:422`, `inspection.service.ts:364`, `project.service.ts:361` | It becomes `rollup.worstObject` and pins the floor/building/project at that band **permanently** — undeletable (immutable assessment rows) and its `{customer, code}` is occupied forever, so a replacement can never reuse `DB-2A`. `floorLoadSummary` shows the contradiction in one response | Give the risk readers the same status predicate as `countsTowardLoad` |
| **P0-11** | `object-type.service.ts:355` | Deleting an ObjectType checks only `ObjectRecord.objectType`; a `canCreateCall` type need never be instantiated | `extendSla` re-reads it, `equipmentSlaHoursFor` returns null, the window silently rebases to the global. The comment three lines above that call names this exact failure | Block deletion while any request references it |
| **P0-12** | `report-record.service.ts:281` | `syncItems` hard-deletes withdrawn `ReportItem`s, destroying the idempotency key | Re-adding the same object mints a new `_id`, so the `(sourceReportItem, newScore)` guard misses and writes a second, identical, permanently undeletable assessment row | Soft-withdraw, and add the unique constraint |
| **P0-13** | `PortalHomePage.tsx:218-220` | `.catch(() => setBuildings([]))` moves `buildings` from `null` to `[]`, flipping every tile's `loading` to false ✓ | A customer with a genuinely critical floor reads «Анхаарах тоноглол 0 · Хэвийн 0 · Үнэлгээ хийгээгүй 0» off a transport error — a clean bill of health produced by a failure. **The only place in the app where a failure produces an affirmative all-clear** | A third state: loading / failed / empty |
| **P0-14** | `TaskProgressDrawer.tsx:75-85,134,150` | The reset effect is keyed `[task]`, and the parent hands back a **new object** after every photo save ✓ | Pressing «Зураг нэмэх» overwrites `note`, `conclusion`, `score`, `recommendation` and `completedQuantity` from the stored copy — behind a green success toast | Key on `task.id` |
| **P0-15** | `ReportsPage.tsx:124,213-218,305` + `report.service.ts:110` | The screen request never sends `format`, so `truncatedAt` is always null and the banner is unreachable; the CSV route sends a raw body, discarding it | A 1,200-row export downloads 1,000 rows with a footer row describing 1,200 — a financial/SLA document disagreeing with itself, filed as complete. A green test mocks the flag and certifies dead UI | Set a response header on the CSV route and surface it |
| **P0-16** | `config/database.ts:23` | `autoIndex: !env.isProduction`. Tests run with indexes auto-built; production relies on a **manual** `sync:indexes`. There is a startup drift detector for permissions and **none for indexes**, and no test anywhere asserts an `E11000` | The unique index on `invoiceNumber` and the partial unique on `(customer, billingPeriod, billingType)` are the only thing between two overlapping generation runs and double-billing. If absent in production, every test still passes and the first signal is a duplicate invoice in a customer's inbox | Diff `model.diffIndexes()` at boot and refuse (or log `error`) on a missing unique index; add one real duplicate-key test |
| **P0-17** | `app.ts:52-58` | `/health` touches no dependency and returns «Систем хэвийн ажиллаж байна» whenever the process is alive. Zero test coverage | It is the first post-deploy check in the runbook. Mongo down, no replica-set primary, disk full for uploads — all green, deploy signed off, every real request 500s | Ping Mongo and check `readyState`; return 503 otherwise |
| **P0-18** | `docs/DEPLOYMENT_MONHORUS_PROD.md:479-493` | §6 extracts the tarball **over the live tree in place**. §11, titled "Rollback", disables the service and removes the nginx config | That is a decommission procedure. Once the tar lands the previous build is gone; recovery means rebuilding the prior commit and re-shipping, under outage | Release directories plus a `current` symlink; retitle §11 |
| **P0-19** | `package.json:16`, `turbo.json` | `npm run lint` runs **0 tasks and exits 0**. No ESLint config, no eslint/prettier dependency in any of four `package.json` files, no workspace `lint` script ✓ | The same self-certifying-green class that was just fixed in the deploy greps. Anyone wiring CI, or running the documented pre-ship check, gets a pass from a linter that was never installed | Install and configure it, or delete the task — a check that cannot fail is worse than a missing one |
| **P0-20** | `inspection-report.controller.ts:25-27` + `inspection-report.service.ts:63-69` | The nested inspection-report sub-router loads through a raw `findById` with no predicate; `requirePlannedWorkAssignmentScope` passes GETs through unconditionally ✓ | **Any technician reads any job's inspection report and its PDF** — customer, site, crew, embedded photographs. A fourth report-read family missed when the other three were scoped, and `planned-work.routes.ts:89-92` asserts it *is* covered. A test at `assignment-scope.api.test.ts:496` pins the hole as intended | Route the three GETs through `findReadableWorkOrThrow`; invert that test |

## P1 — wrong under a reachable condition (101 total; the load-bearing ones)

**Security**

- **P1-1** `self-progress.policy.ts:83-104`, `work-report.service.ts:322-341` — service-request writes lift assignment scope on a **read** permission union (`hasWorkReadOversight`, which includes `invoice.view`/`dispatch.view`). Planned-work writes correctly use the write set. Latent under shipped presets; live the moment an administrator builds the read-only-board role the code invites. **Fix:** a write-shaped predicate.
- **P1-2** `seed-dev-data.ts:766` — the guard keys off `NODE_ENV` (default `development`), not the target database. A production `MONGODB_URI` with no `NODE_ENV` passes; `alignSystemRoles` then overwrites every role's permissions. **[open, contra STATIC banner]**

**Workflow and SLA**

- **P1-3** `service-request.auto-status.ts:51-57` — `WAITING` allows neither `REPORT_SUBMITTED` nor `COMPLETED`, and `hasArrivedOnSite` reads history, so a technician who paused for parts can submit a report that strands: request stuck at WAITING, `completedAt` null, SLA escalating forever, **no survey, no customer notification**, equipment scores already applied. Only a `logger.warn`.
- **P1-4** `work-report.service.ts:635-668` — `submitWorkReport` has no report-status guard (every sibling has one). An APPROVED report reverts to SUBMITTED; the customer's endpoint starts 404-ing; a second approval re-runs `publishApprovedResult`, applying equipment scores twice.
- **P1-5** `planned-work.service.ts:990-999` — the guard tests `!== undefined`; the web edit branch always sends `assignedTeamId: null`. **Every DRAFT/REJECTED edit returns 400**, keyed to a field the form has no slot for. The portal's reject-and-resubmit loop is unreachable. No test covers it.
- **P1-6** same guard, mirror case — `PATCH {"assignedEmployeeIds": []}` empties an approved work's crew; `assertEmployeesExist([])` returns silently. The work then 403s every transition and goes overdue untouchable.
- **P1-7** `service-request.service.ts:1048-1054` — `extendSla` re-derives the window from *current* config. Type retuned 24h→6h, +120 min granted at 20:00Z → deadline moves to **16 hours earlier and two hours in the past**, instantly BREACHED, audit row reading "SLA extended".
- **P1-8** `planned-work.overdue.service.ts:58` + `PlannedWorkFormPage.tsx:275` — `plannedEndDate` stored at UTC midnight, so every work is OVERDUE at 08:00 local on its own due date, with a working day left. Persists `overdueAt`, writes an audit event, fires the notification.

**Reporting and figures**

- **P1-9** `reminder.service.ts:198-209,295-300` — `sweepSla` and `sweepInvoices` query all matching rows, `.limit(500)`, **no sort and no exclusion of already-notified rows**. Past 500 the same head is examined every pass and the tail is never notified, permanently. The other three sweeps are self-draining; the "background jobs re-run" rationale does not extend to these two.
- **P1-10** three incompatible definitions of "SLA зөрчил": `report.service.ts:952-971` and `:334-337` use `completedAt == null && slaDueAt < now` with no status predicate, so **every cancellation counts as a permanent breach**. 100 requests → truth 8, KPI card 18, dashboard 3.
- **P1-11** `report.service.ts:997` — `RECEIVABLE_TOTAL` is range-scoped while «Авлага» is all-time everywhere else. ₮10M shown against ₮30M outstanding.
- **P1-12** `report.service.ts:412-451` — the CUSTOMER report ranges two of its four columns; a March report shows March's requests beside **all-time** invoiced and receivable, under a date header.
- **P1-13** `report.service.ts:353-355` — the SLA footer prints a whole-set total beside a single page's breach count. Page 1 «Нийт 137 · Зөрчсөн 25», page 6 «… Зөрчсөн 0», KPI card 61.
- **P1-14** `report.service.ts:257-271` — `RISK_ASSESSMENT` applies the customer filter **after** pagination. 4,000 rows, 120 for the customer → one row on screen, footer «Нийт 4000», 160 pages offered.
- **P1-15** `dashboard.service.ts:620-623` — four Today-panel counters computed by `.filter().length` over a 40-row truncated fetch, rendered beside `completedCount`, a real `countDocuments`.
- **P1-16** `report.service.ts:141` — the planned-work footer uses `$avg` of percentages; the dashboard's own comment names the unweighted mean as the wrong answer. 1/1 and 50/500 → weighted 10.2%, footer 55%.
- **P1-17** `report-pdf.format.ts:107` — `Math.round` defeats the deliberate 99.9% clamp; a 9999/10000 job prints «Үлдсэн 1 · Хувь 100%».
- **P1-18** `inspection-report.pdf.ts:200-246` — frozen prose beside live derived figures. One signed page can read «Ерөнхий түвшин: Ноцтой» in the table and "Анхаарах шаардлагатай" in the prose above it.

**Materials, surveys, risk**

- **P1-19** `planned-work.material-usage.service.ts:168-191` — `applyDelta` is atomic; the composition around it is not. Two concurrent corrections on the same (task, material): consumed lands at 70 while the ledger says 50, **permanently unrepairable**. A test explicitly reasons this case away as impossible — true sequentially, false concurrently.
- **P1-20** `planned-work.service.ts:1629-1673` — `setPlannedMaterials` overwrites the field `applyDelta` moves, from a stale snapshot; the same 30 m can be drawn twice. `releaseTaskMaterialUsage` ignores `{ok:false}` and deletes the ledger row anyway.
- **P1-21** `survey.schema.ts:89` — deactivating the overall-score question silently freezes every employee average. 40 responses of 5 then 60 of 1 → dashboard reads **5.00 over 100 responses**; truth 2.60.
- **P1-22** `rollup.service.ts:56` — `$cond` treats a score of **0** as false, so the worst condition the system records reports as "never assessed" and propagates `null` up the tree — while `project.service.ts` reports `hasCritical: true` for the same floor.
- **P1-23** `constants/planned-work.ts:120-149` — band-conditional requirements are enforced on the manual assessment path only. A task scored 5 with `conclusion: null` completes and is approved; the identical payload through `recordAssessment` is a 400.
- **P1-24** `load.service.ts:204-237` — the floor's measured total mixes a partial measured sum against a complete calculated sum and marks the result `complete: true`. Two panels, one measured 20% over → screen reads «зөрүү −18 кВт», sign inverted, presented as complete.
- **P1-25** `report-record.service.ts:367-382` — `latestAssessment` is set unconditionally, so approving a backdated report makes an older verdict current — and that head is what the dashboard and reports count as critical.

**Web (49 P1s — the load-bearing ones; the lane report carries the full table)**

*Controls that cannot succeed*

- **P1-26** `CustomerFormPage.tsx:81-85`, `ProjectFormPage.tsx:62`, `AgreementDrawer.tsx:64-70` — all three fill «Хариуцагч» from `dispatchService.employeeCandidates()`, and the whole dispatch router sits behind `DISPATCH_VIEW`. **The shipped SALES role holds neither that nor `employee.view`**, so it gets a permanently empty dropdown on the three forms it exists to use. Deterministic, silent, and a product decision to resolve.
- **P1-27** `ServiceRequestDetailPage.tsx:291-307` — buttons come from the transition matrix alone, but `COMPLETED` is refused unless the report is APPROVED, and approval already auto-advances. **«Дууссан» fails in every ordinary path.** Planned work solves this with a server-computed action list.
- **P1-28** `ObjectFormPage.tsx:527,538` — initial assessment is unwinnable for any score 41–80: the client keys requirements on band *name*, the server on band *flags*, and `grep -c "revisitRequired\|repairRequired"` in that file is **0** — no control exists that could satisfy it. Root cause: `/vocabulary` withholds the flags.
- **P1-29** `AgreementDrawer.tsx:129` — the console never calls `update` or `changeStatus`, so every agreement is permanently DRAFT and can never be billed, while the generation preview shows the customer as having nothing due.
- **P1-30** `PlannedWorkFormPage.tsx:232-238` — every DRAFT edit fails, keyed to a field the form has no slot for.

*Silent wrong output*

- **P1-31** `InspectionListPage.tsx:395-415` vs `:86-116` — the source-type and status controls write to the URL and the query memo **never reads them**. The select moves, the table reloads, the results are identical: an unfiltered list read as filtered.
- **P1-32** `PortalHomePage.tsx:457` — navigates to `/portal/floors/:id`, a route that **exists nowhere** (one grep hit: this line). Every click on the flagship silhouette lands on NotFoundPage.
- **P1-33** `AssignDrawer.tsx:69-71,113-120` — `selectedEmployees` is never seeded from the request while the backend replaces the crew wholesale. The button reads «Дахин хуваарилах», and **adding a second technician silently removes the first**.
- **P1-34** `PlannedWorkFormPage.tsx:151,429-457` (also `TaskFormDrawer`, `CalendarPage`) — crew ids are seeded from the record but options come from an ACTIVE-only, 100-capped roster, so an assigned-but-unlisted person **has no checkbox to untick** and is silently re-submitted.
- **P1-35** `InspectionReportPage.tsx:276-293` and `PlannedWorkReportPage.tsx:113-128` — `submitReport` reads nothing from the form and then reloads from storage. Typing the narrative and pressing «Хянуулахаар илгээх» **discards it and locks the record**; only a return reopens it.

*Failure rendered as absence* — the widest family, ~15 instances

- **P1-36** `api-client.ts:119-123` — blob errors yield `ApiError.message === ''`; `PlannedWorkReportPage.tsx:401` guards on truthiness so a failed PDF export **renders nothing at all**, which its own docblock calls the worst outcome. `ReportsPage.tsx:217` shows a blank red toast.
- **P1-37 … P1-45** — audit-log filters (`AuditLogPage.tsx:71`), org pickers that block creation (`useOrgOptions.ts:41,68`), the role checklist (`EmployeeSystemAccessPanel.tsx:78,545`), a controlled `<select>` rendering «Сонгохгүй» for a value it holds (`FormControls.tsx:113`), the portal summary spinning forever (`PortalHomePage.tsx:234`), the survey card vanishing (`:255`), the unsubmittable portal request form (`PortalRequestCreatePage.tsx:157`), the planned-work banner (`PortalPlannedWorkListPage.tsx:100`), the work-report floor picker (`WorkReportPanel.tsx:335`), a 403 shown as "there are no employees" (`AssessmentDrawer.tsx:133`), and a 500 telling the user a floor plan does not exist (`FloorPlanPin.tsx:54`).

*Structural*

- **P1-46** `main.tsx:15` — the single ErrorBoundary sits **outside** `BrowserRouter` with no `resetKey`, the prop it was built for. One thrown render replaces the whole shell permanently, and the recovery button reloads the same broken URL.
- **P1-47** `NotificationsPage.tsx:128` — the only customer-reachable one of ~40 hardcoded `/dashboard` crumbs; customers hold `notification.view`, reach the page, and clicking «Нүүр» gives them `ForbiddenState`.
- **P1-48** `FloorDetailPage.tsx:328-360` — no cancel flag and no sequence guard, and `hasLoadedRef` is never reset on `floorId` change, so floor B's URL renders over floor A's name, objects and kW totals with nothing loading on screen.
- **P1-49** `ObjectTypeAttributesEditor.tsx:145,212,295` — unconfirmed delete; `keyFrozen` computed by value, so **re-adding a key rebinds it to the old stored data** and a re-added `fuse` as NUMBER makes every object holding `"FUSED"` fail validation — a value that renders on no web screen.

**Mobile**

- **P1-36** No `autoDispose` anywhere in either app — every file-bytes family is a permanent unevicted cache, and every detail read is permanently stale until a manual refresh.
- **P1-37** Notification list is one page of 25 while the badge is a true server count; «Бүгдийг уншсан» then clears 40 the user saw 25 of.
- **P1-38** `create_request_sheet.dart:122` — drag-dismissible, no `PopScope`, loses uploaded photos and the whole form to one gesture. The employee app's equivalent sheets set `isDismissible: false` with a comment explaining exactly why.
- **P1-39** Employee-app cache bleed on the project catalogue and, notably, `conclusionEditorProvider` retaining technician A's **unsaved draft** for technician B.
- **P1-40** Release APK built without `--dart-define` silently targets `127.0.0.1`, which release cleartext rules then block; `build.gradle.kts:101-108` also falls back to the **debug** signing key.

**Tests, config, ops**

- **P1-41** Invoice and service-request numbering use read-latest→parse→+1 while `nextSequenceValue()` exists and is used by four other modules — and the project allocator has a ten-simultaneous-creates test that these two lack.
- **P1-42** Backend invoice arithmetic has **no rounding-boundary test**; the web has one, and the two implementations are kept in step by a comment recording the incident.
- **P1-43** Authorization tested as "admin can", not "the wrong role cannot", in six modules — `audit.routes.ts` has **one guard and zero negative tests**, and the audit trail is what records refused escalations.
- **P1-44** `resetDomainCollections()` never calls `invalidateSettingsCache()`; seven files remember to do it themselves. Order-dependent passes within a file.
- **P1-45** No fake timers anywhere; a known one-hour-a-day flake was patched at one call site while the shared helper that causes it still returns `Date.now() + 3_600_000`.
- **P1-46** `mongodump` without `--oplog` on a live replica set — the archive is not a point-in-time snapshot, so a restore can carry an audit row for an invoice that does not exist.
- **P1-47** §6 restarts the service **before** migrations, then conditions them on human recollection — and the index half has no drift signal at all.
- **P1-48** §10 authenticates with a real admin password over `http://103.87.255.221:3020` — the plain-HTTP origin §6 greps the bundle to exclude, twelve lines earlier.
- **P1-49** No CI of any kind. 2,979 tests gated on a human remembering, with `npm run lint` green regardless.
- **P1-50** Cross-language contract parity is **currently exact** (155 mirrored values, 25 permission keys, six enum families diffed clean) with **zero mechanism** keeping it so. `PlannedWorkLifecycleStatus.fromWire` falls back to `draft`, so a drifted `CANCELLED` renders to a technician as a draft job.

*(The remaining P1s are listed in the lane reports and follow the same five themes.)*

## P2 — fragile, unclear, or hygiene (~90)

Grouped rather than enumerated; each carries file:line in the lane reports.

- **Dead code:** the entire `features/diagram/` module (~1,900 lines, no route, no client for a live backend module), `components/ui/Select.tsx`, ten dead service methods, five dead exports, three props no caller passes (including `BuildingSilhouette.selectedFloorId`, so the floor highlight is permanently off while the Dart twin uses it).
- **Contractual fields stored, validated, rendered and read by nothing:** per-agreement `slaUrgentHours`/`slaStandardHours`/`frequency`/`calendarRule` — printed on the customer page beside the three terms that *are* enforced.
- **Accessibility:** `FormControls.tsx` renders error ids that nothing references (`aria-describedby`/`aria-invalid` never set) across 34 importing files; dialogs never move or trap focus.
- **Validation mismatches:** the settings error-path prefix never matches, so every scoped stage/band error shows only the top banner; eight components discard `fieldErrors` entirely; `RescheduleDrawer` pre-fills a value the server rejects as unchanged.
- **Numbering, currency and precision:** lexicographic sequence sort breaks past 9999/month; invoice totals can exceed `MAX_SAFE_INTEGER`; a preview shows the agreement currency while the invoice is stamped with the global setting.
- **Config:** `UPLOAD_DIR`/`LOG_LEVEL` honoured but absent from `.env.example`; `LOG_LEVEL` bypasses the validated env contract; Node pinned only by a floor; `turbo` floating seven minors past its declared intent.
- **Twelve schemas still carry `__v`** while the four concurrency-critical models disable it — latent, since no destructive array op currently runs on them, and there is no `VersionError` handler anywhere.

---

# 3. Security Issues

**Tenant isolation (customer ↔ customer): sound, and re-tested.** All 11 CUSTOMER permission keys were traced to their routes and every handler opened. Every customer-reachable path resolves scope explicitly; out-of-scope ids answer **404 not 403** so a detail endpoint cannot be used as an oracle; a customer account with no organisation is refused outright rather than defaulting to no filter; and both directions of tier/role incoherence are refused at assignment *and* at role-edit time. No cross-tenant read could be constructed. `src/security/customer-scope.security.api.test.ts` proves it, several times over.

**The assignment boundary (staff ↔ staff) does not hold** — P0-20 above.

**The one live disclosure is on a phone, not the server** — P0-4: cross-tenant notification and survey data surviving a logout in the customer app's provider cache.

Other security findings: P1-1 (read permission lifting a write scope), P1-2 (`seed:dev` guard), plus P2-grade items — no `MulterError` branch so upload-size failures 500; one route pair missing a params schema, so a malformed id 500s via `BSONError`; no orphan-file reaper and no reference counting anywhere; task-photo downloads scoped to the tenant but not to the assignment; rate limiting only on `/auth`; `CORS_ORIGINS` defaulting to localhost with no production refusal (fails closed, so hygiene rather than exposure).

**Explicitly cleared after tracing** (details in §6 of the security lane): CORS allowing Origin-less requests (Bearer-only, no CSRF surface), `fileFilter` trusting client MIME (`nosniff` plus a separate parsing path for SVG), path traversal (CSPRNG keys, `base + sep` prefix check), NoSQL operator injection (`validate()` replaces the request objects and no `.passthrough()` exists anywhere), ReDoS (every user-derived regex escaped), mass assignment (one spread, behind a five-field schema), the `head_admin` bypass (role read from the database every request, never from the token), token revocation (`iat` vs `passwordChangedAt` plus session revocation), and login/reset timing oracles (both deliberately equalised).

---

# 4. Hardcoded Data & Business Logic

Largely resolved by the previous remediation — see `STATIC_HARDCODED_AUDIT.md`. What survives:

- **The Ulaanbaatar-day convention is two-thirds applied** (P0-7, P1-8). Both fixes already have their tool written.
- **`/vocabulary` withholds the band behaviour flags** (`requiresConclusion`, `requiresRecommendation`, `decommissions`), so no client can ask "is this band dangerous". The customer app now infers it from cut points — a heuristic that drives `initialUrgent`, **which is sent to the server** (P1-27 is the web half of the same gap).
- **Per-agreement SLA terms are decorative** (§2 P2) — an operator who agrees a 4-hour window, types it in and sees it on screen gets a different deadline enforced.
- **Three incompatible definitions of "SLA зөрчил"** and three of "current work" (P1-10, P0-8).

---

# 5. Pagination & Data Integrity Issues

- **Filtering after pagination:** `slaState` (still open, contra the banner), `RISK_ASSESSMENT`'s customer filter (P1-14), `inspection.service.ts:239` counting rows it then drops.
- **Counters computed from truncated fetches:** the Today panel (P1-15), the SLA report footer (P1-13).
- **Sweeps that can never reach past their cap:** P1-9.
- **Truncation flags that cannot reach a reader:** P0-15.
- **Rollups stale on create, delete, link, unlink and floor move** — `recalculateFrom` has exactly two callers.
- **Concurrency:** P1-19/P1-20 (material array, three writers, one atomic guard), P1-41 (numbering), plus discarded `modifiedCount` on conditional updates in `planned-work.transition.service.ts:440` and `planned-work.report.service.ts:612` — the latter leaving an APPROVED report on a CANCELLED work, unrecoverable because nothing deletes a report and `plannedWork` is uniquely indexed.
- **Schema/index integrity:** P0-16. Three unique indexes are named in model comments as the *sole* enforcement of a rule, and on a production first boot they do not exist until `sync-indexes` runs.
- **Genuinely clean:** enums, `ref:` strings and `timestamps` all diff correctly against `packages/shared` — the schema lane found no P0 and said so rather than inflating a P1.

---

# 6. Frontend / Backend / Mobile Inconsistencies

| Rule | Backend | Web | Mobile |
|---|---|---|---|
| Band requirements | flags (`requiresConclusion`…) | **name-based** (P1-27) | inferred from cut points |
| Day boundary | `dayBounds` — except invoices | `business-day.ts` ✓ | server `timezone` ✓ (employee) |
| "SLA зөрчил" | three definitions | renders the server's | — |
| Notification audience | `dispatch.view` + assignees | help says `service_request.view` (wrong) | — |
| `service_request.claim` holders | ADMIN, SYSTEM_ADMIN, TECHNICIAN | help names Dispatcher (wrong) | — |
| Dispatch board columns | configurable stages | help says 12 fixed (retired constant) | — |
| Risk band count | 2–8, editable | help says "five fixed levels" | — |

**The help panel is publishing four rules the code no longer implements** — and two of them (audience, claim holders) are wrong in the direction that changes what an operator believes about who was told. This is the third time this class has appeared.

**Contract parity is currently exact** and held by transcription alone (P1-50).

---

# 7. Test Coverage Gaps

Strong where it counts: zero mocks, six real concurrency races, `src/security/` with 31 refusal assertions, `day-bounds.util.test.ts` timezone-correct by construction, and test infrastructure (`supertest-shared-server.ts`) fixing a genuinely subtle port-churn bug with the evidence written into the comment.

The gaps are specific and consequential:

1. **No test proves any unique index enforces anything** (P0-16) — the duplicate-invoice test passes through an application pre-check.
2. **No backend rounding-boundary test for money** (P1-42) — the exact regression the web comment records could recur server-side undetected.
3. **Authorization negative tests are absent in six modules** (P1-43), including the audit log entirely.
4. **No cross-language parity test** (P1-50) — 180 values, zero mechanism.
5. **No fake timers** (P1-45) — a one-hour-a-day flake class.
6. **No test asserts a failed-fetch branch in the web**, which is why the swallowed-`.catch` family (P0-13, P1-31…35) is invisible to the suite: a "renders the list" test passes either way.
7. **PDF tests verify structure, never content** — a bug mapping the wrong object's score into a row produces a structurally perfect, fully passing, customer-signed document.

---

# 8. Top 10 Must-Fix

1. **P0-20** — scope the inspection-report reads; any technician can pull any job's report and PDF today. Invert the test that pins it.
2. **P0-3** — `PushMessaging.stop()` on session expiry. Best available explanation for zero registered devices, and two lines.
3. **P0-4** — customer-app provider cache serving the previous tenant's data after a re-login.
4. **P0-1 / P0-2** — presence tests in the object merge; a cleared 500 kW that silently persists into every load figure.
5. **P0-6** — one invoice per customer where the preview promised one per agreement; unbilled money that cannot be recovered for that period.
6. **P0-13** — a third state on the portal tiles; the only place a failure renders as an all-clear.
7. **P0-7 / P1-8** — finish the Ulaanbaatar-day migration in `invoice.service.ts` and `plannedEndDate`.
8. **P0-16 / P0-17** — an index-drift check at boot and a `/health` that can fail; both are deploy-safety infrastructure.
9. **P0-9 / P0-10** — one door for band side effects, and one status predicate for the risk readers.
10. **P0-5 / P0-14** — stop discarding typed technician input on navigation and on photo attach.

---

# 9. Final Release Assessment

## NOT SAFE

Four independent reasons, each sufficient:

**1. Money is wrong in two directions.** A customer with two agreements is silently underbilled with a success message (P0-6), and invoice overdue status disagrees between three surfaces for eight hours of every day (P0-7). Neither is detectable from inside the product.

**2. Data belonging to one customer is shown to another.** Not on the server — tenant isolation is sound and was re-tested — but in the customer app's provider cache after a logout on a shared handset (P0-4), and in the inspection-report reads on the server for staff (P0-20).

**3. Figures that drive safety and load decisions are wrong.** A cleared technical field silently keeps its old value and continues feeding load roll-ups (P0-1/P0-2); auto-decommissioned equipment still counts toward risk while excluded from load (P0-10); a failed portal fetch reports "0 equipment need attention" (P0-13).

**4. The deploy has no rollback, no working health check, no index-drift detection, and a lint step that cannot fail** (P0-16 … P0-19). A bad release cannot be reverted, and the first check the runbook prescribes is green when the database is down.

**Path to SAFE WITH CONDITIONS:** fix the Top 10, run the permission convergence, and rotate the head_admin password still outstanding from the previous audit. The remaining P1s are real but none is release-blocking on its own.

**One thing this assessment is not.** The volume of findings should not be read as a poor codebase. Nearly every defect here sits beside a comment, a test or a sibling implementation that gets the same problem right — the material guard, the claim race, the day-bounds utility, the security suites, the backup scripts. The failure mode is not ignorance; it is a good rule applied to three of four doors.

---

## False Positives & Legitimate Constants

Recorded so nobody "fixes" them. Each was traced, not grepped.

**Security:** CORS Origin-less allowance (Bearer-only, no CSRF surface); client-supplied MIME (`nosniff`, and SVG has its own parsing path); path traversal (CSPRNG keys, `base + sep` check); NoSQL injection (no `.passthrough()` anywhere); mass assignment (one spread behind a closed schema); `head_admin` bypass (tier read from the DB every request); `/vocabulary` unguarded (presentation vocabulary only); `portal.profile.view` guarding nothing (inert, not a hole).

**Business logic:** billing a full month for a contract that ran one day (overlap not containment, deliberate); `evaluateSla` checking at-risk before near-breach (at-risk is the higher threshold, and validation refuses the inverted config); a live request due exactly now BREACHED while one *completed* at the deadline is WITHIN_SLA (asymmetric on purpose); no SLA pause/resume to be wrong (there is none); `applyDelta` itself genuinely atomic; survey skip semantics correct in both directions and `averageOf` returning **null, not 0**; survey issuance exactly-once; all five §11.5 load formulas matching spec with no invented power factor; `MONTHLY_REVENUE` correctly single-sourced; `.populate()` on `countDocuments()` inert dead code, not a wrong count.

**Data:** denormalised material quantities with a documented single authority; 404-not-403 answers; prune-only role seeding; background sweeps needing no transaction (proven by test).

**Web:** the two remaining `variant="info"` matches are prose in comments; `/audit/facets` is covered by a router-level guard; label maps are `Record<Enum, string>` under `strict` + `noUncheckedIndexedAccess`, so a new backend enum member is a **compile error** — that whole class is structurally closed; `unwrap()` treating `null` as data; `DataTable`'s loading→error→empty precedence; no optimistic updates to roll back.

**Mobile:** iOS push off by design (matches `PUSH_ENABLED_PLATFORMS`); package ids verified correct and formally refuted as a cause; compiled label fallbacks behind `/vocabulary` (a fallback is not a duplicate); the Dart transition matrix deliberately narrower than the shared one, documented; the single-use `Route` pattern already fixed at all 31 push sites; `_hydrateOnce` guarded so a rebuild cannot fight the keyboard.

**Ops:** backups on the same disk (known, documented, one-line change); `fileParallelism: false` load-bearing and documented; SMTP and Firebase optional by design with the production refusal tested; `assertProductionOverrides` narrow but correctly reasoned; two deployment documents complementary by design.

---

*Audited read-only at `f4e304c`. Every P0 re-verified against source before inclusion. Where a lane's claim did not survive that check, it was dropped rather than reported.*
