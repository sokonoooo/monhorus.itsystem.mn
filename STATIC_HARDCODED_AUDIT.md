# Monhorus — Static / Hardcoded Data & Function Audit

**Date:** 2026-08-21 · **Commit audited:** `ebd3932` (main) · **Scope:** `apps/backend`, `apps/web`, `apps/mobile` (customer), `apps/mobile-employee`, `packages/shared`, scripts, seeds, migrations, docs, CI.
**Surface:** 662 non-test source files (304 backend/shared `.ts`, 144 web `.tsx`, 214 `.dart`).
**Method:** eight parallel read-only sweeps. **No files were changed.**

**On trust:** every P0 below was re-verified by opening the file. Claims not personally verified are marked *(reported)*. Two claims from the sweeps were **refuted** on inspection and are recorded in §17 so nobody acts on them.

---

# 1. Executive Summary

| Metric | Count |
|---|---|
| Total findings | 178 |
| **P0** | **8** |
| P1 | 47 |
| P2 | 91 |
| Acceptable constants (cleared, listed §15) | 32 |
| Duplicated business rules | 14 |
| Hardcoded DATA findings | 96 |
| Hardcoded FUNCTION findings | 62 |
| Tenant-specific hardcoding | **0** |
| Security-relevant hardcoding | 9 |
| Workflow hardcoding | 31 |
| SLA / risk hardcoding | 28 |
| Survey hardcoding | 11 |
| Pagination / limit findings | 44 |

**The headline is not carelessness.** This codebase reasons unusually well: settings, risk bands, stages, SLA windows and tax are genuinely data-driven; every backend metric is a real aggregate; tenant isolation is sound. The recurring failure mode is **safeguards that were designed, written, and then never wired up** — four separate constants document a protection no caller invokes — and **rules hand-copied into Dart**, where nothing can detect drift.

---

# 2. P0 Findings

| # | File | Line | Function | Hardcoded data/rule | Why dangerous | Replacement |
|---|---|---|---|---|---|---|
| 1 | `apps/mobile-employee/integration_test/live_api_test.dart` | 126-127 | `_adminToken()` | `admin@monhorus.mn` / `Monhorus2026admin` | **Tracked in git**, and verified byte-identical to `BOOTSTRAP_ADMIN_PASSWORD` in the local `.env` — the variable `bootstrap-head-admin.ts` provisions the production head_admin from. Anyone with repo access may hold head_admin, the role that resyncs to the full permission catalogue on every boot. Two technician passwords (`:55-56`) leak the same way. | Rotate the production password **first**, then move to env and scrub the file (history included) |
| 2 | `docs/DEPLOYMENT_MONHORUS_PROD.md` | 205, 208 | §6 web build | `VITE_API_BASE_URL=http://103.87.255.221:3020/api/v1`, then a `grep` asserting that same value | The command-line define **overrides** the correct committed `apps/web/.env.production`. Origin is resolved at build time with no runtime override, so following the runbook ships an admin console talking to a retired plain-HTTP host — and **the verification step passes precisely when the build is wrong** | `https://monhorus.itsystem.mn/api/v1`, or drop the define and let `.env.production` win |
| 3 | `docs/DEPLOYMENT_MONHORUS_PROD.md` | 324 | §8 APK build | `--dart-define=API_BASE_URL=http://103.87.255.221:3020/api/v1` | Both apps set `cleartextTrafficPermitted="false"`. An APK built per this line **cannot open a socket at all**; every request fails as a connection error the login screen reports as "no connection". `docs/production-notification-setup.md:154` has the correct value — the two runbooks contradict each other | `https://monhorus.itsystem.mn/api/v1` |
| 4 | `apps/mobile-employee/.../project_remote_data_source.dart` | 143 | `listFloorObjects` | `int limit = 100`, one page, `totalPages` never read | On a 120-device floor the plan draws 100 markers. Worse, `unplacedOnPlanCount` runs over the *same truncated list*, so the caption «Планд байрлуулаагүй N төхөөрөмж байна» is an **affirmative all-clear computed from the first 100**. A technician sees no marker for device #113 and no reason to doubt it | Page-walk, as web's `fetchAllFloorObjects` already does (`FloorDetailPage.tsx:235`, fixed in `c067566`) |
| 5 | `apps/mobile/.../customer_portal_remote_data_source.dart` | 167 | `listObjects` | Same `limit: 100`, one page | Identical failure on the customer app's floor plan | Same six-line page-walk |
| 6 | `apps/mobile/.../screens/floor_detail_screen.dart` | 341-350 | `_HistoryTab.build` | Filters a **building-wide** first page of 100 down to one floor | On a building with >100 requests, a floor whose history is older than the newest 100 renders «Энэ давхарт бүртгэгдсэн үйлчилгээний хүсэлт алга байна» — an **explicit assertion of zero** for a floor with a full service history. Every other truncation here undercounts; this one states a falsehood | Query by `floorId` server-side, or page-walk |
| 7 | `packages/shared/src/constants/settings.ts` | 255 | `FINANCE_TAX_PERCENT` definition | `default: 0` | A deployment that never opens Settings issues **every invoice with ₮0 VAT** against a 10% statutory rate. The mitigation the authors wrote for exactly this — `TAX_UNSET_NOTE` (`invoice.ts:125`) — now has **zero call sites** (see §17: I caused that this morning), so nothing on screen explains the zero | Make the setting required before the first invoice, and restore the warning at the point of invoicing |
| 8 | `apps/mobile-employee/.../planned_work_enums.dart` | 228-249 | `MaterialUnit.fromWire` | `orElse: () => MaterialUnit.piece` *(reported)* | A unit the server adds is **silently displayed as «ширхэг»** — a wrong unit on a material record, not an unknown one. Quantities then read as a different physical measure than recorded | Return null and render the raw wire value |

---

# 3. P1 Findings (selected — full inventory in §5/§6)

| # | File | Line | Function | Hardcoded data/rule | Why it matters | Replacement |
|---|---|---|---|---|---|---|
| 1 | `packages/shared/src/constants/inspection-report.ts` | 77 | `SEVERITY_ORDER` → `overallSafetyLevel` (:90) | `[...RISK_LEVELS].reverse()` | `RISK_LEVELS` ends with reserved spares `BAND_6/7/8`, so reversed they outrank `OUT_OF_SERVICE`. The product advertises that a sixth band is a settings change; the first admin who adds a **mild** band gets every inspection containing one reported to the customer at the worst level, and `isFinding` (`inspection-report.service.ts:61`) files every healthy object as a зөрчил. Silent, on a printed safety document | Rank by resolved band `min` via `resolveRiskBands()`; web already does (`risk-palette.ts:238`) |
| 2 | `apps/backend/src/modules/objects/project.service.ts` | 281 | `foldRiskRows` | `counts.get('CRITICAL') \|\| counts.get('OUT_OF_SERVICE')` | Name-matching the exact anti-pattern `risk-band.ts:9-14` forbids in prose and `object-master.service.ts:1777` already fixed. Rename a band and the danger marker goes silent across web, both apps, sorting and filtering | `getRiskBands().filter(b => b.requiresConclusion \|\| b.decommissions)` |
| 3 | `apps/backend/src/modules/notification/reminder.service.ts` | 112, 155 | `sweepPlannedWorkOverdue`, `sweepPlannedWorkDueSoon` | `permission: 'planned_work.view'` | TECHNICIAN holds that key, so **every technician is notified about every overdue planned work in the company** — the exact fan-out the service-request path was retargeted to eliminate. This path was missed | `dispatch.view` + assignees via `userIds`, matching `service-request.notify.ts:142` |
| 4 | `packages/shared/src/constants/permissions.ts` | 669-711 | TECHNICIAN preset | `customer.view` | Grants the **entire customer directory** — name, code, регистрийн дугаар, tax number, phone, email, address — plus `GET /service-agreements` (gated on `CUSTOMER_VIEW`, `service-agreement.routes.ts:100`) carrying **`monthlyFee`**. Verified: referenced **zero times** in either Flutter app. Same shape as the `employee.view` grant already withdrawn, and contradicts the module's own stated principle | Withdraw from the preset; the job card already carries the customer `NamedRef` |
| 5 | `apps/backend/src/modules/planned-work/planned-work.routes.ts` | 429, 463 | `GET /:id/report`, `/report/pdf` | `findPlannedWorkOrThrow` (unscoped) | Any holder of `planned_work.view` — every technician — reads the consolidated report **and PDF** of any job in the company: customer, site, crew, photos. The assignment guard deliberately passes GETs through on a premise these two routes violate | `resolveAssignedWorkFilter`, as the scoped `getPlannedWorkById` uses |
| 6 | `apps/web/src/features/surveys/SurveyResultsPage.tsx` | 197 | employee-filter effect | `limit: 200` | `employeeListQuerySchema` caps at 100 and **rejects** rather than clamps; `.catch(() => undefined)` swallows the 400. The «Ажилтан» filter is **permanently empty** and reads as "there are no employees" | `limit: 100`, and surface the error |
| 7 | `apps/backend/src/modules/service-request/service-request.service.ts` | 714-715 | `listServiceRequests` | `slaState` filtered **after** `.skip().limit()` | `total`/`totalPages` describe the unfiltered set. Filtering "breached" shows 3 rows under a pager claiming 87 across 5 pages, with pages 2-5 empty. The comment calls it "a known gap" — it is a silent one | Filter at query level, as `audit.routes.ts:129` does |
| 8 | `apps/web/src/features/audit/AuditLogPage.tsx` | 98-99 | query `useMemo` | Bare `YYYY-MM-DD` | Server does `$lte: new Date(...)` = UTC midnight = **08:00 Ulaanbaatar**. "To 19 Aug" silently discards 08:00-23:59 of the 19th — most of the working day. For an audit log, silently narrowing the window is the worst failure mode | `dayBounds(instant, env.APP_TIMEZONE)` (`day-bounds.util.ts:66`) |
| 9 | `apps/web/src/features/portal/PortalHomePage.tsx` | 167 | `load` | `listRequests({page:1, limit:20})` then count | «Хүлээгдэж буй хүсэлт» is structurally incapable of exceeding 20. `summary.requestsByStatus` — fetched by the same component, used correctly by the chart below — holds the true figure | `summary.requestsByStatus` |
| 10 | `apps/web/src/features/portal/PortalHomePage.tsx` | 34 | `OPEN_STATUSES` | 11 statuses, **omits `RETURNED`** | Backend, employee app and the rest of web treat `RETURNED` as live. A request returned for rework **disappears from the customer's open list** — they believe it finished while work continues | Derive from the transitions map (terminal = empty outgoing set) |
| 11 | `packages/shared/src/constants/settings.ts` | 328, 357 | `riskBandsOf`, `requestStagesOf` | `: DEFAULT_RISK_BANDS` / `: DEFAULT_SERVICE_REQUEST_STAGES` on validation failure | A rejected admin ladder is **discarded with no log, no warning, no flag**. Settings still displays the admin's numbers while every score is banded against shipped cut points — and `decommissions` travels with the band, so equipment that should be taken out of service may not be | Surface the rejection; refuse to serve a silently-substituted ladder |
| 12 | `packages/shared/src/constants/settings.ts` | 364 | `riskLevelFor` | `band?.level ?? 'OUT_OF_SERVICE'` | Reached from 7 backend services that **persist** the result. An installation that renames or drops that band writes assessments under a key its ladder no longer contains; they display as «Түвшин N» and `decommissions` returns false | Fall back to the worst **configured** band, as `risk-palette.ts:250` does |
| 13 | `apps/backend/src/modules/service-request/service-request.service.ts` | 463 | `deriveIsUrgent` | `URGENT_WINDOW_HOURS = 6` | Snapshots the editable `sla.urgent_hours`. Set it to 4 and a 5-hour call gets a 5-hour deadline but is **not** flagged urgent — it sorts into the ordinary dispatch queue and breaches unwatched. `getSlaConfig()` is awaited three lines away | `SETTING_KEYS.SLA_URGENT_HOURS` |
| 14 | `apps/web/src/features/help/content/operations.ts` | 253, 380, 471, 482 | help entries | «хоёр цаг» ×4 | The server escalates at **30 min × 3** (`unclaimed.service.ts:28,43`), to `service_request.claim` holders — only the third also reaches dispatchers. The help is wrong on both the interval **and** the audience, in the panel that replaced the removed alerts | Interpolate from the constants |
| 15 | `apps/mobile-employee/.../work_providers.dart` | 102-109 | `_plannedWorkOversightKeys` | 6 keys; **omits `plannedWorkApprove`** | Backend `OVERSIGHT_PERMISSIONS` has 7. A dedicated approver is treated as scoped, and a PENDING_APPROVAL work has an empty crew by construction — so they see an **empty queue**, not an error. The backend comment (`planned-work.scope.ts:80-89`) predicts this exact failure | Mirror the backend list, or publish it |
| 16 | `apps/mobile-employee/.../planned_work_enums.dart` | 199-205 | `enum PlannedWorkAction` | 6 actions; **omits APPROVE/REJECT** | Shared `PLANNED_WORK_ACTIONS` has 8. `fromWire` returns null, so server-computed buttons are dropped: **the employee app cannot approve or reject planned work at all** | Add both, or state that approval is web-only |
| 17 | `apps/mobile/.../service_request_enums.dart` | 86-102 | `progress` | Hardcoded 10-status ordering → `(index+1)/10` | The app **draws a completion percentage the server explicitly refuses to state** (`progressPercent: null`). Rendered on every card and the detail header | Delete; show nothing |
| 18 | `apps/web/src/features/dispatch/DispatchBoardPage.tsx` | 91 | `ASSIGNABLE_STATUSES` | 6-status whitelist | Server refuses only `COMPLETED`/`CANCELLED`. For `ON_THE_WAY`…`VERIFICATION` the Assign control is **not rendered**, and the detail page has none — a technician calls in sick mid-job and the dispatcher cannot hand the work over | "not COMPLETED/CANCELLED" |
| 19 | `apps/web/src/features/invoices/InvoiceFormDrawer.tsx` | 94-95 | tax/due effect | `Number(tax?.value ?? 0)` behind `.catch(() => undefined)` | A blip, or a role with `invoice.manage` but not `settings.view`, yields **"Татвар (0%)"** and `total === subtotal`. The user approves it; the server stores a different total. `invoice-totals.ts` opens with a comment about the previous incident of exactly this class | Show nothing and disable submit, as `use-sla-hours.ts` does |
| 20 | `apps/web/src/features/audit/AuditLogPage.tsx` | 28, 55 | `ACTION_LABELS`, `ENTITY_LABELS` | 24 of 34 actions; 9 of 20 entities | Raw English tokens shown to Mongolian users — the whole `INSPECTION_REPORT_*` approval chain is unlabelled. Typed `Record<string,string>`, so the compiler can never catch the gap | Move to shared, type as `Record<AuditAction, string>` |
| 21 | `apps/web/src/features/calendar/CalendarPage.tsx` | 25 vs 32/52 | `startOfDay`, `toDateKey` vs `TIME_ZONE` | Buckets browser-local, labels Asia/Ulaanbaatar | An event whose own label says 21 Aug renders in the **20 Aug cell** for any viewer outside UTC+8; `windowFor` builds the API range from local midnights so edge events are never fetched. Mobile does this correctly | One convention; `CalendarEventDto.timezone` is already on the wire |
| 22 | `apps/web/.../ReportsPage.tsx` · `InspectionListPage.tsx` · `SurveyResultsPage.tsx` | 130-131 · 96-97 · 158-159 | filter memos | `T00:00:00.000Z` / `T23:59:59.999Z` | A **UTC** day, not an Ulaanbaatar one. Every such report omits 00:00-08:00 of its first day and includes 00:00-08:00 of the day after its last | `dayBounds(…, env.APP_TIMEZONE)` |
| 23 | `apps/web/.../ObjectFormPage.tsx` | 361 | floors effect | `listFloors({limit:100})` then client-side `customerId` filter | `floorListQuerySchema` has **no `customerId`**. Past 100 active floors system-wide, a tenant's floors may not be in the window at all — the picker silently shows nothing | Add the server parameter |
| 24 | `apps/mobile-employee/.../work_providers.dart` | 335-345, 534-542 | `dueTodayCount` ×2 | `DateTime(y,m,d,23,59,59)` from handset local time | The «Өнөөдөр» tiles use the **phone's** timezone while the backend runs on `APP_TIMEZONE` and already publishes `timezone` on the DTO (never read). A technician abroad sees a different day | Server-side `dueToday`, or the published timezone |
| 25 | `apps/mobile-employee/.../home_providers.dart` | 155-229 | `activeCount`, `inProgressCount`, `overdueCount`, `urgentItems` | Two `limit:100, page:1` lists | The hero figures and the headline sentence are page-1 counts. **CORRECTION (verified 2026-08-21): `EmployeeWorkloadModel.activeAssignments` does NOT answer the same question** and must not be substituted — `loadWorkloadCounts` aggregates ServiceRequest **only**, matches `assignedEmployees` with **no team arm**, and spans **8 statuses**, whereas the hero counts planned work *and* requests, own-or-team, over **12**. Swapping it would trade an occasionally-truncated figure for a reliably different one that disagrees with the list beneath it | Walk the pages and disclose truncation |
| 26 | `apps/mobile-employee/.../work_providers.dart` | 850-857 | `OpenRequestPool.urgentCount`, `slaRiskCount` | `page:1, limit:100` | These render **directly beside `pool.total`**, the server's own figure — two numbers from two populations, side by side | Server aggregate |
| 27 | `apps/mobile/.../customer_portal_providers.dart` | 288-314, 492-500 | `customerServiceRequestsProvider`, `activeRequests`, `finishedRequests` | `limit: 100`, `total` discarded | The Идэвхтэй/Дууссан tabs stop at 100 with **no total, no pager, no affordance**. The app already contains the right pattern — `_allBuildings` page-walks and `_headline` blanks the figure when incomplete | Page-walk or disclose |
| 28 | `apps/mobile-employee/.../risk_widgets.dart` | 141-182 | `RiskMetricGrid.build` | Three cards from 5 hardcoded band keys + a fourth printing server `total` | On any installation using a spare band the four cards **visibly do not add up to their own stated total** | `riskBandsInUse()` |
| 29 | `apps/mobile/.../risk_level.dart` · employee `risk_level.dart` | 174-185 · 183-194 | `riskBandsInUse` | Server ladder re-sorted by **compiled enum index** | Undoes the server's configured ordering | Keep the server order |
| 30 | `apps/web/src/features/portal/PortalCharts.tsx` | 172-188 | `riskHeadline` | Four hardcoded band keys + four hardcoded sentences | **CORRECTION (verified 2026-08-21): this function has NO production call site** — only its own test imports it, so it renders on no screen. The audit originally called it "the first sentence a customer reads", which was wrong. The defect was real (a renamed band kept shipped wording; a configured spare band printed an affirmative all-clear over unhealthy devices) and is fixed, but it is latent until somebody mounts it | `riskLevelsInOrder(bands)` |
| 31 | `apps/web/.../WorkReportPanel.tsx` | 343 | objects effect | `limit: 100` | Device #101 on a floor **cannot be put into a work report** | Page-walk |
| 32 | `apps/mobile/.../dio_client.dart` | 190-195 | error mapping | No 5xx branch | The employee app has one (its `:187-204`); the customer app reports every backend 5xx as **"connection lost"**, so `restoreSession()` takes the offline path and opens on a stale cached user whose every request fails | Port the eight lines |
| 33 | `apps/mobile/lib/core/config/app_config.dart` + employee `:27,30` | 27, 30 | `_androidEmulatorOrigin`, `_loopbackOrigin` | `10.0.2.2:4000` / `127.0.0.1:4000` | A release build without `--dart-define` is **dead on arrival, silently** — and release blocks cleartext anyway | No dev fallback in release; fail the build |
| 34 | `apps/backend/src/config/env.ts` | 115 | `MAIL_FROM` | `no-reply@monhorus.itsystem.mn` | A deployment that forgets to set it sends from an address the docs record as non-existent, no SPF/DKIM → password-reset mail lands in spam | Required in production |
| 35 | `apps/backend/src/modules/settings/vocabulary.routes.ts` | 34-40 | `GET /vocabulary` handler | Sends `{key,label,colour,statuses,hidden}` — **withholds `entryStatus` and `onBoard`** | The field the stage design says makes a stage a *control* is configured, validated, stored — and never reaches a client. No client can offer "move to stage X"; all still move by raw status | Publish both |
| 36 | Backend "active work" definitions | `dashboard.service.ts:52` (6) · `employee-workload.service.ts:11` (8) · `PortalHomePage.tsx:34` (11) · inline `$in` at `dashboard.service.ts:220` | — | Four different answers to "is this request live" | A technician can be busy on the dispatch list and not counted live on the dashboard. None is exported, so the next module writes a fifth | One `isRequestActive()` derived from stage config |
| 37 | `apps/mobile-employee/.../event_level.dart` | 71-88 | `settledStatuses`, `dormantStatuses`, `levelFor` | Raw string sets `{'COMPLETED','ARCHIVED'}`, `'OVERDUE'` | Bypasses the typed enums entirely | The enum |
| 38 | `apps/mobile-employee` `work_enums.dart:58` vs `planned_work_enums.dart:84` | — | `isFinished` ×2 | One **excludes** CANCELLED, the other **includes** it | Two copies of one concept that already disagree | One |
| 39 | `apps/mobile-employee/.../work_enums.dart` | 24 | `PlannedWorkStatus` | 8 of 10 values — `PENDING_APPROVAL`, `REJECTED` missing | Those two render as **null on the employee home tab today** | Reuse `planned_work_enums.dart:53` |
| 40 | `apps/mobile/.../object_master_model.dart` · employee `object_models.dart` | 225, 609 · 231, 839 | `LatestAssessmentModel.fromJson`, `ObjectAssessmentModel.fromJson` | `score: … ?? 0` | On this **inverted** scale 0 is the worst band — a missing score renders as the worst possible number. `previousScore` on the adjacent line is left nullable, so the inconsistency looks accidental | Keep nullable |
| 41 | `apps/mobile/.../device_detail_screen.dart` | 504-505 | `_CreateAction._open` | `initialUrgent: riskLevel == critical \|\| outOfService` | Two hardcoded band keys set a flag **sent to the server** that changes dispatch | Band flags |
| 42 | `apps/web/src/features/surveys/SurveyResultsPage.tsx` | 399-407 | inline `tone={…}` | `avg >= 4 → positive; >= 3 → warning; else danger` | The product's only good/warning/bad score threshold, compiled. `EVAL_RISK_BANDS` already proves the settings-driven mechanism exists | A settings key |
| 43 | `apps/mobile/.../survey_enums.dart` | 40-54 | `surveyRatingMin/Max`, `surveyRatingLabels` | Second declaration of the 1-5 scale | Not an import — the two can drift | Fetch or generate |
| 44 | Both Flutter apps | `photo_capture.dart` + 8 web files | MIME/size copies | `MAX_FILE_BYTES`/`ALLOWED_MIME_TYPES` are **not in `packages/shared`** | 9 hand-copies; `MAX_COMPANY_LOGO_BYTES` proves the correct pattern exists in the same repo | `packages/shared/src/constants/upload.ts` |
| 45 | `apps/web/src/lib/invoice-totals.ts` | 22 | `invoiceTotals` | Client copy of `totalsOf` (`invoice.service.ts:193`) | Already caused a live bug (drawer 1,651.5 vs server 1,653). Correctness rests on a comment | Move to shared |
| 46 | `apps/mobile-employee/.../service_request_vocabulary.dart` | 108-116, 147-156, 188-256 | `hasArrivedOnSite`, `isSelfProgress`, `_transitions` | Hand-transcribed matrix and gate sets | `hasArrivedOnSite` decides **whether a technician may write a conclusion at all**; no fetch, no pinning test | Publish via `/vocabulary` |
| 47 | `apps/mobile*/lib/core/**` | — | 14 byte-identical files | Entire auth, networking, push and token layer duplicated | No shared Dart package exists; `MaterialUnit`, `WorkReportRequirement`, `PlannedWorkStatus` have **already** diverged | Extract `packages/mobile_core/` |

---

# 4. P2 Findings (grouped — 91 items)

- **Terminality restated 6×**: `sla.service.ts:57`, `calendar.service.ts:70,165`, `reminder.service.ts:183`, `assignServiceRequest:790`, `OpenServiceRequestsPage.tsx:28`. `service-request.notify.ts:115` **derives** it from the matrix — the pattern to copy.
- **Shipped labels reaching users instead of configured ones**: push (`service-request.notify.ts:144`), dashboard chart (`:271`), Today panel (`:550`), calendar (`:176`), CSV/PDF exports (`report.service.ts:223,336`; `report-pdf/*`), diagram (`project-graph.service.ts:208`), `overallLabel` (`inspection-report.service.ts:453`), detail-page buttons (`ServiceRequestDetailPage.tsx:276`).
- **Silent list caps**: `calendar.service.ts:90,160` (500), `getObjectHistory:2070,2073` (100), `employee.service.ts:723` (50), `/objects/nodes` (100, and the route returns a bare array so truncation is **undetectable**), ~12 web dropdowns, `CustomerDetailPage.tsx:115` (20-row tab, no pager).
- **13 duplicate `PAGE_SIZE = 20`**, ~30 `'Asia/Ulaanbaatar'` literals, 6 `'MNT'` defaults.
- **Notification cadence in code**: `PLANNED_WORK_DUE_SOON_MS` 24h, `INVOICE_DUE_SOON_MS` 3d, `SURVEY_REMINDER_AFTER_MS` 3d, `UNCLAIMED_ALERT_*`. Documented as deliberate; flag for product.
- **18 permission-key string literals** in `notify({permission:'…'})` calls — a typo addresses nobody, and no test catches it.
- **Dead code**: `RoleGuard.tsx`, `UsersPage.tsx` + `use-users.ts`, `lib/permissions.ts` (all 3 exports), `auth-context hasRole`, `DISPATCH_BOARD_COLUMNS` + its import, `ServiceRequestType` (employee), `slaHoursUrgent/Standard` (customer), `RiskLevel.fromScore` (both apps), 15 shared exports (§6).
- **`TaskProgressDrawer.tsx:172`** `accept="image/*"` is wider than the server allow-list — user picks a GIF, gets a 400.
- **`report-pdf.format.ts:19,26`** hardcode the timezone instead of reading `env.APP_TIMEZONE`.
- **`settings.ts:233`** `default: 0.75` where the sibling key uses the constant.
- **Label drift**: `REPORT_SUBMITTED` («Тайлан илгээсэн» vs «Дүгнэлт илгээсэн»), `MATERIAL_UNIT_LABELS.SET` («Хүрээлэн» vs «иж бүрдэл» — the shared one looks like the mistranslation), CANCELLED («Цуцалсан» vs «Цуцлагдсан»), `REVISIT_REQUIRED`.

---

# 5. Static / Hardcoded DATA Inventory (96)

| # | Data type | Exact value | File | Line | Function/const | Purpose | Source should be | P |
|---|---|---|---|---|---|---|---|---|
| 1 | Credential | `Monhorus2026admin` | `mobile-employee/integration_test/live_api_test.dart` | 127 | `_adminToken` | integration login | env | **P0** |
| 2 | Credential | `Monhorus2026field` / `…temp` | same | 55-56 | `_password`, `_temporary` | test logins | env | **P0** |
| 3 | API URL | `http://103.87.255.221:3020/api/v1` | `docs/DEPLOYMENT_MONHORUS_PROD.md` | 205, 324 | §6/§8 | build commands | doc fix | **P0** |
| 4 | Tax rate | `0` | `shared/constants/settings.ts` | 255 | `FINANCE_TAX_PERCENT` | VAT | required setting | **P0** |
| 5 | Page cap | `100` | `mobile-employee/.../project_remote_data_source.dart` | 143 | `listFloorObjects` | floor devices | page-walk | **P0** |
| 6 | Page cap | `100` | `mobile/.../customer_portal_remote_data_source.dart` | 167 | `listObjects` | floor devices | page-walk | **P0** |
| 7 | Page cap | `100` | `mobile/.../customer_portal_providers.dart` | 310 | `buildingServiceRequestsProvider` | floor history | query by floor | **P0** |
| 8 | Unit fallback | `MaterialUnit.piece` | `mobile-employee/.../planned_work_enums.dart` | 249 | `fromWire` | unknown unit | null | **P0** |
| 9 | Severity order | `[...RISK_LEVELS].reverse()` | `shared/constants/inspection-report.ts` | 77 | `SEVERITY_ORDER` | safety verdict | band `min` | P1 |
| 10 | Band keys | `'CRITICAL'`,`'OUT_OF_SERVICE'` | `backend/.../project.service.ts` | 281 | `foldRiskRows` | danger marker | band flags | P1 |
| 11 | Permission | `'planned_work.view'` | `backend/.../reminder.service.ts` | 112, 155 | two sweeps | notify audience | `dispatch.view` | P1 |
| 12 | Permission | `customer.view` | `shared/constants/permissions.ts` | 669-711 | TECHNICIAN preset | — | withdraw | P1 |
| 13 | SLA hours | `6` | `backend/.../service-request.service.ts` | 463 | `URGENT_WINDOW_HOURS` | urgency | `sla.urgent_hours` | P1 |
| 14 | Interval text | «хоёр цаг» ×4 | `web/.../help/content/operations.ts` | 253,380,471,482 | help | doc | interpolate | P1 |
| 15 | Status set | 11 statuses, no `RETURNED` | `web/.../PortalHomePage.tsx` | 34 | `OPEN_STATUSES` | open count | transitions map | P1 |
| 16 | Status set | 6 statuses | `web/.../DispatchBoardPage.tsx` | 91 | `ASSIGNABLE_STATUSES` | assign gate | server rule | P1 |
| 17 | Fallback band | `'OUT_OF_SERVICE'` | `shared/constants/settings.ts` | 364 | `riskLevelFor` | persisted band | worst configured | P1 |
| 18 | Ladder fallback | `DEFAULT_RISK_BANDS` | same | 328 | `riskBandsOf` | silent substitution | surface it | P1 |
| 19 | Stage fallback | `DEFAULT_SERVICE_REQUEST_STAGES` | same | 357 | `requestStagesOf` | silent substitution | surface it | P1 |
| 20 | Score threshold | `avg>=4 / >=3` | `web/.../SurveyResultsPage.tsx` | 399-407 | inline `tone` | tile colour | setting | P1 |
| 21 | Extension | `additionalMinutes: 120` | `web/.../ServiceRequestDetailPage.tsx` | 130 | `extendSla` | SLA extension | setting/input | P2 |
| 22 | Export cap | `1000` | `web/.../ReportsPage.tsx` | 113 | `REPORT_EXPORT_LIMIT` | CSV rows | server total |P2 |
| 23-40 | Risk cut points `81/61/41/21/0` | — | both `risk_level.dart`, `shared/service-request.ts:293` | — | enums, `RISK_BANDS` | classification | `/vocabulary` | P2 |
| 41-52 | MIME/size copies | 8 types, `10*1024*1024` | 9 files (§4) | — | `ACCEPTED_*`, `MAX_BYTES` | upload hints | shared | P1 |
| 53-65 | `PAGE_SIZE` | `20` | 13 web files | — | — | table size | one const | P2 |
| 66-95 | Timezone | `'Asia/Ulaanbaatar'` | ~30 web files | — | local `formatDate` | display | one const | P2 |
| 96 | Currency | `'MNT'` | 6 models/schemas | — | `default:` | money label | `DEFAULT_CURRENCY` | P2 |

*(Rows 23-96 are grouped by identical value/rationale rather than enumerated per-line; every file is named in §4 or the sweep tables.)*

---

# 6. Static / Hardcoded FUNCTION Inventory (62)

| # | Function | File | Line | Hardcoded rule | Configurable? | Source of truth | P |
|---|---|---|---|---|---|---|---|
| 1 | `overallSafetyLevel` | `shared/constants/inspection-report.ts` | 90 | severity by array position | **yes** | band `min` | P1 |
| 2 | `isFinding` | `backend/.../inspection-report.service.ts` | 61 | `indexOf('NORMAL')` | yes | configured ladder | P1 |
| 3 | `foldRiskRows` | `backend/.../project.service.ts` | 261 | two band keys | yes | band flags | P1 |
| 4 | `deriveIsUrgent` | `backend/.../service-request.service.ts` | 465 | `<= 6` | yes | `sla.urgent_hours` | P1 |
| 5 | `sweepPlannedWorkOverdue` | `backend/.../reminder.service.ts` | 105 | `planned_work.view` fan-out | no | dispatch + assignees | P1 |
| 6 | `sweepPlannedWorkDueSoon` | same | 148 | same | no | same | P1 |
| 7 | `listServiceRequests` | `backend/.../service-request.service.ts` | 714 | post-pagination filter | no | query-level | P1 |
| 8 | `riskLevelFor` | `shared/constants/settings.ts` | 362 | `?? 'OUT_OF_SERVICE'` | yes | worst configured | P1 |
| 9 | `riskBandsOf` | same | 328 | silent default | yes | surface rejection | P1 |
| 10 | `requestStagesOf` | same | 357 | silent default | yes | surface rejection | P1 |
| 11 | `load` (portal home) | `web/.../PortalHomePage.tsx` | 161 | counts within 20 | no | server summary | P1 |
| 12 | `_HistoryTab.build` | `mobile/.../floor_detail_screen.dart` | 341 | filters 100 | no | floor query | **P0** |
| 13 | `listFloorObjects` | `mobile-employee/.../project_remote_data_source.dart` | 140 | one page | no | page-walk | **P0** |
| 14 | `listObjects` | `mobile/.../customer_portal_remote_data_source.dart` | 159 | one page | no | page-walk | **P0** |
| 15 | `fromWire` (MaterialUnit) | `mobile-employee/.../planned_work_enums.dart` | 228 | `orElse: piece` | no | null | **P0** |
| 16 | `_adminToken` | `mobile-employee/integration_test/live_api_test.dart` | 126 | credentials | no | env | **P0** |
| 17 | `progress` | `mobile/.../service_request_enums.dart` | 86 | 10-status ordering | no | delete | P1 |
| 18 | `hasArrivedOnSite` | `mobile-employee/.../service_request_vocabulary.dart` | 108 | 5-status set | yes | `/vocabulary` | P1 |
| 19 | `isSelfProgress` | same | 147 | 6-status set | yes | `/vocabulary` | P1 |
| 20 | `riskBandsInUse` ×2 | both `risk_level.dart` | 174/183 | re-sorts by enum index | yes | server order | P1 |
| 21 | `RiskMetricGrid.build` | `mobile-employee/.../risk_widgets.dart` | 141 | 5 band keys | yes | `riskBandsInUse()` | P1 |
| 22 | `riskHeadline` | `web/.../PortalCharts.tsx` | 172 | 4 keys + 4 sentences | yes | `riskLevelsInOrder` | P1 — **dead code: no production call site** |
| 23 | `countOf` (KPI cards) | `web/.../InspectionListPage.tsx` | 164 | `'NORMAL'`,`'ATTENTION'` | yes | same | P1 |
| 24 | `redOrBlack` | `web/.../ObjectFormPage.tsx` | 444 | two keys | yes | `requiresConclusion` | P1 |
| 25 | `isCritical` | `mobile-employee/.../risk_level.dart` | 151 | two keys | yes | band flags | P1 |
| 26 | `_CreateAction._open` | `mobile/.../device_detail_screen.dart` | 504 | two keys → server flag | yes | band flags | P1 |
| 27 | `dueTodayCount` ×2 | `mobile-employee/.../work_providers.dart` | 335, 534 | handset midnight | no | server tz | P1 |
| 28-33 | `activeCount`,`inProgressCount`,`overdueCount`,`urgentItems`,`PlannedWorkBoard.total/openCount` | `mobile-employee/.../home_providers.dart`, `work_providers.dart` | 155-229, 329 | page-1 counts | no | server aggregate | P1 |
| 34-35 | `OpenRequestPool.urgentCount`, `slaRiskCount` | `work_providers.dart` | 850-857 | page-1 beside `total` | no | server | P1 |
| 36-38 | `activeRequests`,`finishedRequests`,`_buildList` | `mobile/.../customer_portal_providers.dart`, `service_request_list_screen.dart` | 492-500, 82 | 100-row page | no | page-walk | P1 |
| 39 | `invoiceTotals` | `web/src/lib/invoice-totals.ts` | 22 | client copy of `totalsOf` | no | shared | P1 |
| 40 | `extendSla` | `web/.../ServiceRequestDetailPage.tsx` | 125 | `120` | yes | setting | P2 |
| 41 | `_attributeSection` | `mobile/.../device_detail_screen.dart` | 245 | 15 label+unit pairs | yes | dynamic renderer | P1 |
| 42 | `_AttributeCard.build` | `mobile-employee/.../device_detail_screen.dart` | 336 | 12 label+unit pairs | yes | dynamic renderer | P1 |
| 43 | `_percentTone` ×2 | both `device_detail_screen.dart` | 308/317 | `>100`/`>=90` | yes | setting | P1 |
| 44 | `levelFor` | `mobile-employee/.../event_level.dart` | 77 | raw status strings | yes | enum | P1 |
| 45-46 | `isFinished` ×2 | `work_enums.dart:58`, `planned_work_enums.dart:84` | — | disagree on CANCELLED | — | one | P1 |
| 47 | `endOfRange` | `backend/.../survey.service.ts` | 782 | UTC day | yes | `APP_TIMEZONE` | P2 |
| 48-52 | `dateRange`,`withinRange`, audit/inspection filters | `report.service.ts:52`, `audit.routes.ts:119`, `inspection.service.ts:80` | — | no end-of-day extension | yes | `dayBounds` | P1 |
| 53-62 | **Dead exports** — `riskBandByKey`, `riskLevelFromScore`, `selfProgressTransitionsFrom`, `permitsBilling`, `isTerminalLifecycleStatus`, `TAX_UNSET_NOTE`, `settingGroupOf`, `unitForLoadMeasurementKind`, `DASHBOARD_WIDGET_PERMISSIONS`, `NOTIFICATION_CHANNEL_UNAPPROVED_NOTE` | `packages/shared/src/**` | — | zero callers | — | wire up or delete | P2 |

---

# 7. Duplicated Business Logic

| Rule | Backend | Web | Customer app | Employee app | Shared | Recommended owner |
|---|---|---|---|---|---|---|
| Score → risk band | via `riskLevelFor` | `risk-palette.ts:262` `riskLevelForScore` | `risk_level.dart:131` `fromScore` (dead) | `risk_level.dart:134` `fromScore` (dead) | **3 copies**: `settings.ts:362`, `risk-band.ts:144`, `service-request.ts:316` | **shared `risk-band.ts`** — collapse 3→1, delete Dart |
| Risk ladder cut points | — | config-driven ✓ | `risk_level.dart:24-31` | `risk_level.dart:25-36` | `DEFAULT_RISK_BANDS` + legacy `RISK_BANDS` | `/vocabulary` (already ships min/max) |
| Invoice totals | `invoice.service.ts:193` `totalsOf` | `lib/invoice-totals.ts:22` | — | — | — | **shared** — already caused a live bug |
| File upload validation | `storage.service.ts:25,27` | **8 files** | `photo_capture.dart:85` | `photo_capture.dart:80` | — | **new `shared/constants/upload.ts`** |
| "Is request live" | `sla.service.ts:57`, `dashboard.service.ts:61`, `reminder.service.ts:183` | `PortalHomePage.tsx:34`, `OpenServiceRequestsPage.tsx:28` | `service_request_enums.dart:65` | `service_request_vocabulary.dart:80` | **none** | **shared `isRequestActive()`** |
| Workflow transitions | ✓ imports | ✓ imports | — | `service_request_vocabulary.dart:188` | `service-request.ts:49` ✓ | `/vocabulary` for Dart |
| Planned-work labels | — | `PortalPlannedWorkDetailPage.tsx:67` (diverged) | — | `work_enums.dart:24` (8 of 10) | `planned-work.ts:52` | shared |
| Material units | ✓ | ✓ | — | `planned_work_enums.dart:228` (diverged) | `material.ts:25` | database (§8) |
| Permission predicate | `authorize.middleware.ts:57` | `lib/permissions.ts:9` (dead) | `app_user.dart:125` | `app_user.dart:189` + 3rd copy | `permissions.ts:10` | shared + `/auth/me` |
| Oversight key set | `planned-work.scope.ts:75` (7) | — | — | `work_providers.dart:102` (6) | — | server |
| Phone regex | `user.validation.ts:8` | ✓ imports | `service_request_model.dart:573` | — | `common.schema.ts:14` ✓ | shared |
| Password policy | `auth.validation.ts:7` | `CustomerPortalAccessTab.tsx:485` | `app_config.dart:46` + 3 regexes | `app_config.dart:46` | none | API |
| Date/time formatting | `report-pdf.format.ts:19` | ~30 local `formatDate` | `format.dart:12` | `format.dart:27` | — | one `lib/format.ts` |
| Notification events | ✓ | ✓ imports | `notification_model.dart:28` | `work_enums.dart:84` | `notification.ts:17` | codegen |

**Structural cause:** there is **no codegen from `packages/shared` to Dart and no cross-language parity test**. Every Dart rule is a hand transcription anchored only by a `/// Mirrors X` comment — and at least five such comments are now factually wrong. A generator plus a CI parity check converts most of the P1 drift above into compile errors.

---

# 8. Tenant-Specific Hardcoding

**None. Zero findings.**

- 24-char ObjectId literals in `modules/`, `features/`, both `lib/` trees: **0 hits**.
- UUIDs anywhere in source: **0 hits**.
- All 30 files containing ObjectIds are `*.test.ts(x)` or `test/fixtures.ts`.
- The only non-test occurrence is `SettingsPage.tsx:180` — inside a **code comment** explaining `Number()` returning NaN.

No hardcoded tenant, customer, employee or object id reaches production on any surface.

---

# 9. Security-Relevant Hardcoding

| # | Item | File · line | Verdict | P |
|---|---|---|---|---|
| 1 | Admin credentials in a tracked file | `live_api_test.dart:126-127` | **Verified**: matches local `.env` `BOOTSTRAP_ADMIN_PASSWORD`, the source of the production head_admin | **P0** |
| 2 | Unscoped planned-work report reads | `planned-work.routes.ts:429,463` | Any technician reads any job's report + PDF | P1 |
| 3 | `customer.view` on TECHNICIAN | `permissions.ts:669-711` | Full customer directory (РД, tax, phone, address) + agreement `monthlyFee`; **unused by both apps** | P1 |
| 4 | `seed:dev` guard keys off `NODE_ENV`, not the database | `seed-dev-data.ts:766` | `NODE_ENV` defaults to `development`, so `seed:dev` against a production `MONGODB_URI` **passes the guard** | P1 |
| 5 | `CORS_ORIGINS` default | `env.ts:56` | `http://localhost:5173` — but `assertProductionOverrides` (`:150`) refuses to boot on a localhost `APP_WEB_BASE_URL`; CORS itself is not covered | P2 |
| 6 | 18 permission-key string literals | notify call sites | A typo addresses nobody, silently | P2 |
| 7 | Fail-open client read gates | `project_providers.dart:47-57` | `canViewObjects/Devices` return `true` while unknown; writes correctly fail closed; server enforces both | P2 |
| 8 | `material.view` on TECHNICIAN | `permissions.ts` | **Verified**: `materialCatalogueProvider` (`work_providers.dart:985`) has **zero watchers**. The premise for keeping it has lapsed; it can be withdrawn | P2 |
| 9 | Dead auth surface | `RoleGuard.tsx`, `lib/permissions.ts` | An unused *authorization* component is a trap for the next reader | P2 |

**Permission changes take effect immediately — CORRECTION (verified 2026-08-21).** Earlier
guidance in this session said a technician keeps a revoked key until re-login. That is wrong:
`authenticate.middleware.ts:69` calls `resolveEffectivePermissions(user.role, user.roles)` on
**every request**, reading the Role documents; nothing is baked into the access token. A
revocation therefore binds at the API the instant the migration commits, including for sessions
already open. What can lag is a client that cached the `/auth/me` permission list at login and
still draws a menu entry — but the request behind it is already refused.

**Tenant isolation verdict: sound.** No path exists for a customer-tier account to read another customer's data. It holds structurally: the CUSTOMER role carries 11 portal keys and no staff key; all ~15 portal-reachable endpoints resolve scope explicitly, including the awkward file-download path; out-of-scope ids answer **404 not 403**, so a detail endpoint cannot be used as an id oracle; a customer account with no organisation is **refused outright** rather than defaulting to no filter; and `assertTierRoleCoherence` (`role-assignment.service.ts:381`) plus `assertRoleEditKeepsHoldersCoherent` (`rbac.service.ts:375`) close both directions of the tier/role incoherence that would otherwise give a staff-tier account an unfiltered portal view.

---

# 10. Workflow Hardcoding

**Configurable:** stage name, colour, which statuses it groups, `entryStatus`, `hidden`, `onBoard`, order, add/remove — via `workflow.request_stages`, server-validated, discarded rather than half-applied, consumed by the dispatch board, list rows, `?stage=` filter and both phones through `/vocabulary`.

**Not configurable:** the 14 engine statuses, the transition graph, self-progress/arrived/reason-required sets, terminality, the completion gate, the survey trigger, auto-promote-on-assign — and **all four other workflows** (planned work: 9 statuses/8 actions; work reports; inspection reports; report records) have **no configuration surface at all**.

| Item | File · line | Function | P |
|---|---|---|---|
| `entryStatus`/`onBoard` withheld from clients | `vocabulary.routes.ts:34-40` | handler | P1 |
| Dart transition matrix | `service_request_vocabulary.dart:188` | `_transitions` | P1 |
| Auto-promote on assign | `service-request.service.ts:839` | `assignServiceRequest` | P1 |
| Four "active" definitions | §4 | — | P1 |
| Bundled labels on 8 outbound surfaces | §4 | — | P2 |
| Portal planned-work stepper | `PortalPlannedWorkDetailPage.tsx:66` | `STAGES` | P2 |
| `DISPATCH_BOARD_COLUMNS` superseded + dead import | `service-request.ts:179`, `service-request.service.ts:21` | — | P2 |

**One-line answer:** the *vocabulary* of the service-request workflow is configurable end-to-end and works; the *path* is a fixed TypeScript enum hand-copied into Dart, and every other workflow is fixed with no configuration surface.

**Object types:** genuinely attribute-driven at the type level — one validator, one renderer per platform, `mergeAttributeValues` preserves withdrawn definitions, and `manufacturer`/`serialNumber`/`voltage`/`dimensions` **do not exist anywhere**. The category layer (`PANEL`/`CIRCUIT`/`EQUIPMENT`) is a fixed discriminated union — a documented, deferred decision (`docs/adr/ASSET_MODEL_FLEXIBILITY.md`). The one gap the ADRs miss: **the customer app has no dynamic attribute renderer at all**, so every per-type attribute a technician records is invisible to customers.

---

# 11. SLA / Risk Hardcoding

| Item | File · line | Function | P |
|---|---|---|---|
| `URGENT_WINDOW_HOURS = 6` | `service-request.service.ts:463` | `deriveIsUrgent` | P1 |
| `SEVERITY_ORDER` spare-band ranking | `inspection-report.ts:77` | `overallSafetyLevel` | P1 |
| `hasCritical` two keys | `project.service.ts:281` | `foldRiskRows` | P1 |
| `riskLevelFor` `?? 'OUT_OF_SERVICE'` | `settings.ts:364` | — | P1 |
| Silent ladder substitution | `settings.ts:328` | `riskBandsOf` | P1 |
| `overallLabel` from shipped labels | `inspection-report.service.ts:453` | `toInspectionReportDto` | P1 |
| Band keys in 12 client sites | §6 rows 20-26 | — | P1 |
| `UNCLAIMED_ALERT_AFTER_MS` 30min × 3 vs help «хоёр цаг» | `unclaimed.service.ts:28,43` | `runUnclaimedSweep` | P1 |
| `additionalMinutes: 120` | `ServiceRequestDetailPage.tsx:130` | `extendSla` | P2 |
| Reminder cadences (24h/3d/3d) | `reminder.service.ts:49,50,58` | sweeps | P2 |
| Legacy `RISK_BANDS` + `riskLevelFromScore` | `service-request.ts:293,316` | dead | P2 |

**Correct by contrast:** `sla.service.ts` (`slaWindowHours`, `computeSlaDueAt`, `evaluateSla`) is fully config-driven, and `requestBlock` builds its near-breach `$expr` from `slaConfig.nearBreachRatio`.

**No working-hours, weekend or holiday logic exists anywhere.** SLA windows are wall-clock hours from creation — a 17:00 Friday request with a 24h SLA breaches Saturday evening. A product gap, not a bug, but it should be an explicit decision.

---

# 12. Survey Hardcoding

**Content is configuration-driven; scale and scoring are compiled.** Questions live in a Mongo collection behind full CRUD + reorder, gated on `survey.manage_questions`. **No question text is hardcoded anywhere.** A fresh install has an empty catalogue and refuses to issue invitations until an admin writes questions.

| Item | File · line | P |
|---|---|---|
| Good/warning/bad threshold `>=4 / >=3` | `SurveyResultsPage.tsx:399-407` | P1 |
| Second declaration of the 1-5 scale in Dart | `mobile/.../survey_enums.dart:40-54` | P1 |
| `SURVEY_RATING_MIN/MAX` = 1/5 | `shared/constants/survey.ts:37-38` | P2 |
| Scale baked into the type name `RATING_1_5` | `survey.ts:19` | P2 |
| YES_NO choices «Тийм»/«Үгүй» hardcoded in 2 clients | `PortalSurveyPage.tsx:457`, `survey_sheet.dart:772` | P2 |
| `SCORE_COLOURS` keyed 1-5 | `SurveyResultsPage.tsx:57` | P2 |
| No survey key in `SETTING_KEYS` | `settings.ts:71-114` | P2 |

---

# 13. Dashboard / Analytics Hardcoding

**Every backend metric is a real aggregate** — `buildDashboardSummary` and its ten blocks, `buildKpis`, `getSurveyResults`, `employeePerformanceReport`. **Not one is computed from a truncated list.** All the wrong numbers are client-side recomputation of figures the server already got right.

| Metric | File · line | Function | Wrong how | P |
|---|---|---|---|---|
| Portal «Хүлээгдэж буй хүсэлт» | `PortalHomePage.tsx:167` | `load` | ≤20, newest-first | P1 |
| Employee hero active/in-progress/overdue | `home_providers.dart:155-181` | — | page-1 of 100+100 | P1 |
| «ЯАРАЛТАЙ АНХААРАХ» | `home_providers.dart:210` | `urgentItems` | newest-first 100 | P1 |
| Planned board total/open/dueToday | `work_providers.dart:329-345` | — | `total` parsed then discarded | P1 |
| Assigned KPI strip | `work_providers.dart:526-550` | — | 100-row page, wrong denominator | P1 |
| Open-pool urgent/SLA beside `pool.total` | `work_providers.dart:850` | — | two populations, side by side | P1 |
| Customer active/finished | `customer_portal_providers.dart:492` | — | 100-row page, no pager | P1 |
| `RiskMetricGrid` four cards | `risk_widgets.dart:141` | — | don't add up to their own total | P1 |
| Portal header building/floor/object sums | `PortalHomePage.tsx:319` | — | 100-building page | P2 |

**Correct and worth copying:** `NotificationsPage.tsx:63` issues a separate `unreadCount()`; `FloorDetailPage.tsx:237` page-walks; `DispatchBoardPage.tsx:220` discloses «Дээрх N нь эхний хэсэг. Нийт X.»; `TODAY_ITEM_LIMIT` counts **before** slicing; `ProjectListView.isComplete` flips its caption.

The recent technician dashboard scoping (`resolveAssignedWorkFilter`, `isScoped`) is **correct and deliberate** — blocks a scoped caller shouldn't see are omitted from the response, not hidden in the UI.

---

# 14. Pagination / Limit Hardcoding (44)

Server schema caps are consistent and sane (100 default 20; 200 for materials/reports; 5000 for the CSV window). The findings are all **client-side silent truncation**.

| Item | File · line | Disclosed? | P |
|---|---|---|---|
| Floor objects, employee app | `project_remote_data_source.dart:143` | **Silent + false all-clear** | **P0** |
| Floor objects, customer app | `customer_portal_remote_data_source.dart:167` | **Silent + false all-clear** | **P0** |
| Floor history filtered from building page | `floor_detail_screen.dart:341` | **States zero** | **P0** |
| Survey employee filter asks 200 vs cap 100 | `SurveyResultsPage.tsx:197` | Swallowed 400 → empty | P1 |
| `slaState` filtered after pagination | `service-request.service.ts:714` | Lying pager | P1 |
| Floors fetched globally then filtered | `ObjectFormPage.tsx:361` | Silent | P1 |
| Work-report equipment | `WorkReportPanel.tsx:343` | Silent | P1 |
| Customer request lists | `customer_portal_providers.dart:288-314` | Silent, no pager | P1 |
| `/objects/nodes` returns a bare array | `object.routes.ts:166` | **Undetectable** | P2 |
| Calendar `.limit(500)` ×2 | `calendar.service.ts:90,160` | Silent | P2 |
| Device history `.limit(100)` ×2 | `object-master.service.ts:2070` | Silent | P2 |
| ~12 web dropdowns at 100 | §4 | Silent | P2 |
| `CustomerDetailPage` requests tab at 20 | `:115` | No pager | P2 |
| 13 × `PAGE_SIZE = 20` | §4 | Paged properly | OK |

**The web floor-plan cap was already fixed** in commit `c067566` (`fetchAllFloorObjects`, both staff and portal). The Dart side was never brought across — the fix is the same six-line page-walk in two files.

---

# 15. Acceptable Constants (cleared — do NOT "fix" these)

- **Floor-plan UI**: `PLAN_MAX_ZOOM` 8, `FIT_PADDING` 0.06, `UNMEASURED_MIN_ZOOM` 0.2, `PLAN_FOCUS_ZOOM` 1.5/300ms, `LABEL_MIN_ZOOM` 0.9 (code still in `aria-label` at every zoom), `PLAN_FLOW_WIDTH` 1000, `DEFAULT_PLAN_ASPECT` 4/3, `kPlanMarkerDiameter` 26px. Coordinates are normalised 0..1, so a replaced plan image of different dimensions keeps pins in place — **no hardcoded image dimensions anywhere**.
- **Enums and their label maps**: statuses, SLA states, object statuses, attribute types, invoice/payment enums, report enums, roles, account statuses, permission modules, notification severities, device platforms, genders, marital statuses, `SAFETY_GRADES` (statutory I–V), `SUPPORTED_CURRENCIES`, `SETTING_GROUPS`.
- **Closed colour palettes** `STAGE_COLOURS`/`RISK_COLOURS` — Tailwind cannot build a class from a runtime hex; correctly reasoned at `service-request-stage.ts:29-36`.
- **Sweep limits** `SWEEP_LIMIT` 500/200, overdue `.limit(1000)` — background jobs that re-run.
- **Technical**: HTTP timeouts 15s/20s, `passwordMinLength` 10 (server re-validates), retry counts, `MAX_CALENDAR_WINDOW_DAYS` 92 (validated with an explicit error), `MAX_RISK_BANDS` 8, `DEFAULT_USAGE_COEFFICIENT` 1 (quoted from requirement 11.5), PDF layout geometry (derived from the source .docx).
- **Correctly shared already**: `MAX_COMPANY_LOGO_BYTES`, `MAX_OBJECT_TYPE_ICON_BYTES` — and `SettingsPage.tsx:222` proves the import path works. These are the pattern the 9 upload copies should follow.
- **`env.ts:150` `assertProductionOverrides()`** — refuses to boot when `APP_WEB_BASE_URL` is localhost in production. Exemplary.

---

# 16. Recommended Source of Truth

| Rule | Belongs in |
|---|---|
| Risk band thresholds, labels, flags | **Database** (settings) → `/vocabulary` for all clients |
| Severity ordering | **Shared**, derived from configured `min` |
| Workflow stages incl. `entryStatus`, `onBoard` | **Database** → `/vocabulary` (publish the withheld fields) |
| Transition graph, self-progress/arrived sets | **Shared** → `/vocabulary` for Dart |
| SLA windows, urgency threshold, near-breach ratios | **Database** (`SETTING_KEYS.SLA_*`) — already exists, just read it |
| Tax percent, invoice due days, currency | **Database** (finance settings), required before first invoice |
| Invoice totals arithmetic | **Shared package** |
| Upload MIME/size limits | **Shared package** (`constants/upload.ts`) |
| "Is request active/live" | **Shared**, derived from stage config |
| Material units, categories | **Database** (master data) |
| Survey questions, options | **Database** ✓ already |
| Survey scale + score thresholds | **Database** (new settings group) |
| Notification cadence | **Database** when a screen exists; documented constants until then |
| Permission catalogue | **Shared code** ✓ correct as-is |
| API base URLs | **Environment** — no dev fallback compiled into release |
| Credentials | **Environment**, never a tracked file |
| Timezone | **Environment** (`APP_TIMEZONE`) server-side; one web constant client-side |
| Page sizes, zoom bounds, marker sizes | **Frontend UI constants** ✓ fine |

---

# 17. Final Release Assessment

## NOT SAFE FOR RELEASE

Three reasons, each sufficient on its own.

**1. A production credential is in the repository.** `live_api_test.dart:126-127` carries `admin@monhorus.mn` / `Monhorus2026admin`, verified byte-identical to the `BOOTSTRAP_ADMIN_PASSWORD` in the local `.env` — the variable `bootstrap-head-admin.ts` provisions the production head_admin from. If that pair was used on the live server, anyone with repository access holds the role that resyncs to the entire permission catalogue on every boot. **Rotate first, then scrub.** This is not a code-quality finding; it is an active exposure.

**2. The deployment runbook produces broken artefacts and certifies them as correct.** §6 builds the web bundle against a retired plain-HTTP host and then greps for that same stale value, so the verification passes exactly when the build is wrong. §8's APK command cannot open a socket at all, because both apps now block cleartext. A release performed by following the written runbook fails.

**3. Two apps tell users things that are not true.** The customer app asserts a floor has **no service history** when it has one (`_HistoryTab`, P0-6). Both apps draw 100 of 120 floor markers and print an affirmative "N devices unplaced" caption computed from the truncated list — a technician standing at the panel has no reason to doubt it. Invoices issue at **₮0 VAT** by default with the warning constant that exists for this case now unrendered.

**With the eight P0s fixed, the assessment becomes SAFE WITH P1 FIXES** — and the P1 list is dominated by two mechanical themes (client-side counts that should read a server aggregate already on the page; band keys that should read configured flags) rather than by architectural problems.

## What this codebase does well, stated plainly

Tenant isolation is sound and structurally so. Every backend metric is a genuine aggregate. Materials are the cleanest area in the product — every Registered/Used/Remaining figure is read, never derived, with an atomic over-consumption guard and retry-safe absolute writes. Object-type attributes are real. The stage vocabulary reaches both phones through `/vocabulary`. `env.ts` refuses to boot on a localhost web URL. `report.service.ts` discloses its own truncation. Where this codebase reasons about a problem, it reasons well, and it writes the reasoning down.

## Two claims from the sweeps that I REFUTED — do not act on them

1. **"Head-admin password in git since the initial commit; history is squashed."** False as stated. `bootstrap-head-admin.ts` reads `BOOTSTRAP_ADMIN_PASSWORD` with **no default**, errors if unset and warns to clear it afterwards; `.env.example` ships it blank; `apps/backend/.env` and the Firebase service-account key are untracked and never were tracked. The real exposure is P0-1 above, via a Flutter integration test — a different file, a different fix.
2. **"`google-services.json` has the wrong package name."** False. All four ids match in both apps (`mn.itsystem.monhorus`, `mn.itsystem.monhorusEmployee`), regenerated after the rename. **Do not regenerate those files.** The real cause of zero push registrations is that `.gitignore` excludes them and `build.gradle.kts:30` applies the Firebase plugin only `if (file(...).exists())` — so an APK built on a machine without the file ships push-less and silent while every check passes. **Verify by unzipping the shipped APK and looking for `google_app_id` in `res/values/values.xml` before changing any code.**

## One finding I caused

`TAX_UNSET_NOTE` has zero callers **because I removed its two call sites this morning**. The blue `Alert variant="info"` boxes in `InvoiceFormDrawer` and `GenerateInvoicesDrawer` were rendering that warning at the moment of invoicing; the info-alert removal moved the wording into the `/invoices` help panel. That was the correct call for 50 decorative notices and the wrong one for this specific warning — a zero tax rate on a financial document deserves to be visible where the document is created, not in a help panel. **Recommend restoring it as a non-info element (a plain warning line beside the tax field).**

---

```
TOTAL_HARDCODED_DATA_FINDINGS=96
TOTAL_HARDCODED_FUNCTION_FINDINGS=62
TOTAL_DUPLICATED_BUSINESS_RULES=14
TOTAL_TENANT_HARDCODING=0
TOTAL_SECURITY_HARDCODING=9
TOTAL_WORKFLOW_HARDCODING=31
TOTAL_SLA_RISK_HARDCODING=28
TOTAL_SURVEY_HARDCODING=11
TOTAL_PAGINATION_LIMIT_FINDINGS=44
P0=8
P1=47
P2=91
ACCEPTABLE_CONSTANTS=32
```

## TOP_10_MUST_FIX

1. **Rotate the production head_admin password, then scrub `live_api_test.dart:126-127`** — a tracked credential matching `BOOTSTRAP_ADMIN_PASSWORD`.
2. **Fix `DEPLOYMENT_MONHORUS_PROD.md:205,208,324`** — the runbook builds a web bundle against a retired plain-HTTP host, self-verifies against the stale value, and produces an APK that cannot connect.
3. **Page-walk floor objects in both Flutter apps** (`project_remote_data_source.dart:143`, `customer_portal_remote_data_source.dart:167`) — 100-marker cap with an affirmative all-clear caption. Web's fix already exists.
4. **Query floor history by `floorId`** (`floor_detail_screen.dart:341`) — the app currently asserts a floor has no service history when it has one.
5. **Make `FINANCE_TAX_PERCENT` required before the first invoice, and restore the unset-tax warning** at the point of invoicing (my regression).
6. **Rank severity by configured band `min`** (`inspection-report.ts:77`) and **derive `hasCritical` from band flags** (`project.service.ts:281`) — wrong safety verdicts the moment a band is added or renamed.
7. **Retarget the two planned-work sweeps** (`reminder.service.ts:112,155`) from `planned_work.view` to the dispatch desk plus assignees — the notification flood is still live on this path.
8. **Scope `GET /planned-work/:id/report` and `/report/pdf`**, and **withdraw `customer.view` from TECHNICIAN** — every technician can read every job's report and the whole customer directory including contract fees.
9. **Fix `MaterialUnit.fromWire`** (silent wrong unit) and **add APPROVE/REJECT + `plannedWorkApprove`** to the employee app — approval is currently unreachable and an approver sees an empty queue.
10. **Replace client-side counts with the server aggregates already on the page** — portal open count, employee hero figures, open-pool urgent beside `pool.total`.
