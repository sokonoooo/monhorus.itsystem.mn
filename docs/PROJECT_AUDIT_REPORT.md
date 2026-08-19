# Monhorus — Full Project Audit Report

**Audit date:** 2026-08-13
**Audit type:** Full end-to-end project audit
**Baseline:** `main` @ `3cc9a70`, clean working tree
**Method:** 13 parallel deep-trace audits across every layer, with every Critical and High finding independently re-verified against source by the lead auditor before inclusion. No source file was modified. No database was contacted.

---

## 1. Executive Summary

### Overall system status

Monhorus is a **substantially better-engineered system than its own documentation claims**, with a small number of genuinely serious defects concentrated in predictable places.

The architectural core is strong and was verified, not assumed:

- **Tenant isolation is real and well-built.** A single resolver (`common/security/customer-scope.ts`) derives the tenant from the session, discards any client-supplied `customerId`, applies the predicate *inside the query* rather than as a post-fetch check, and answers **404 rather than 403** so detail endpoints are not existence oracles. It is backed by security tests that seed two real tenants, plant a secret string, and assert it never appears in the other tenant's response.
- **The RBAC layer is exceptional.** Role writes funnel through a single chokepoint with a build-failing invariant test that rejects any second write path. Self-escalation is refused first, before any rule that could be argued around. Tier/role coherence is enforced in *both* directions and on *both* the assignment and role-edit paths.
- **Validation is near-total.** Every one of ~180 routes validates its inputs with a shared zod schema. There is no mass assignment anywhere, no `.passthrough()`, no sort injection.
- **The test suite is real.** 1,973 tests pass in 2m10s (the docs claim 1,135 in ~5 min — understated by 74%, overstated on time by 2.3×). Nothing is skipped.

### Main strengths

1. `packages/shared` as a single source of truth for permissions, statuses and zod schemas, imported by both backend and web — drift between those two is a compile error.
2. The file-download authorization chain: an exhaustive `Record<OwnerType, PermissionKey[]>` (so a new attachment kind cannot default to readable) plus per-file tenant resolution. There is no static file serving anywhere.
3. Server-generated storage keys, a hand-written SVG sanitiser with a serve-time `sandbox` CSP, and a password-reset lifecycle that is textbook-correct (256-bit CSPRNG, hash-at-rest, claim-before-write, uniform failure, timing equalisation).
4. Codebase comments carry genuine institutional memory — several non-obvious MongoDB index traps are documented at the point where they were hit.

### Main risks

1. **There is no backup.** Not "an incomplete backup" — no script, no timer, no cron, anywhere in the repository. Every uploaded photo, floor plan and HR document exists on exactly one disk that is 83–88% full, behind a **single-node** replica set that provides transactions but no redundancy. The restore procedure is one sentence with an ellipsis in it and has never been rehearsed.
2. **Two silent data-destruction paths** in routine operations: editing an employee on the web wipes their education, work history and certificates; saving a conclusion from the employee phone wipes materials, follow-up flags and the revisit date entered on the web.
3. **A recurring root cause: an endpoint's permission key is treated as if it were also a scope.** Five report/PDF endpoints and the entire customer-master and invoicing modules load by bare `findById` with no `AuthContext` in the function signature at all.
4. **A recurring second cause: DTOs are not narrowed per audience.** The server sends staff-internal data to customers and relies on client JSX to hide it — which the web portal does and the customer mobile app does not.
5. **No CI.** `.github/` does not exist. 2,322 tests run only when a human types the command, and the 349 Flutter tests are outside the npm workspace so they run nowhere automatically.

### Production readiness

**PARTIALLY READY.** The application code is closer to production-ready than the surrounding operations are. A system is already serving real users at `https://monhorus.itsystem.mn`, and the code quality supports that. What does not support it is the absence of backups, CI, monitoring and any automated deployment — plus five confirmed data-integrity defects that will corrupt real records during ordinary use.

Critically, **the last 6 commits are in git but not on the server** (`docs/PRODUCTION_STATUS.md:42-43`, evidenced by `POST /auth/forgot-password` returning 404 in production). Several findings below are therefore *pending-deployment* rather than live — each is marked.

---

## 2. Applications Audited

| Application | Path | Stack | Audited |
|---|---|---|---|
| Backend / API | `apps/backend` | Express 4 + Mongoose 8 + TypeScript + zod, 25 modules, ~180 routes | Full |
| Web / Admin | `apps/web` | React 18 + Vite 6 + react-router 6 + axios + Tailwind, 62 routes | Full |
| Customer Portal | `apps/web/src/features/portal` | Same SPA, distinct route tree + `CustomerOnly` tier guard | Full |
| Employee Mobile | `apps/mobile-employee` | Flutter + Riverpod + Dio, 153 Dart files | Full |
| Customer Mobile | `apps/mobile` | Flutter + Riverpod + Dio, 80 Dart files | Full |
| Shared | `packages/shared` | zod schemas, permission catalogue, status constants | Full |
| Database | MongoDB via Mongoose | 37 models, single-node replica set `rs0` | Full |
| CI/CD / Deployment | — | **None.** Bare-metal systemd + nginx, manual `git pull` | Full |

**Correction to the audit brief:** there is **no Prisma** in this repository and no migration framework. `find . -name "*.prisma"` returns nothing; there is no `@prisma/client` dependency. The ODM is Mongoose 8.9.2, and "migrations" are 10 standalone `tsx` scripts invoked by hand.

---

## 3. Findings Summary

| Severity | Count |
|---|---:|
| Critical | 5 |
| High | 44 |
| Medium | 51 |
| Low | 33 |
| **Total** | **133** |

All 133 are **CONFIRMED** against source unless explicitly marked POTENTIAL. Potential risks are listed separately in §11.

---

## 4. Critical Findings

---

### C-1 · No automated backup, no rehearsed restore, single copy of all files

- **Severity:** Critical
- **Application:** Deployment / Operations
- **Feature:** Backup & recovery
- **Path:** repository-wide (absence); `docs/DEPLOYMENT_MONHORUS_PROD.md:382-389`, `docs/IMPROVEMENTS.md:67-71`, `docs/PRODUCTION_STATUS.md:97-99`
- **Component/API:** n/a

**Evidence.** A full repository sweep excluding `node_modules` found **zero** `.timer`, `.service`, `crontab`, `cron`, `logrotate`, `rsync` or `mongodump` files. `scripts/` contains exactly one file, `run-mobile.sh` (a local Flutter launcher). 100% of the backup material is copy-paste bash inside markdown:

```bash
# docs/DEPLOYMENT_MONHORUS_PROD.md:382-386
sudo bash -c 'set -a; . /etc/monhorus/backend.env; set +a
mongodump --uri="$MONGODB_URI" --archive=/var/backups/monhorus/db-$(date +%F).archive --gzip'
sudo tar czf /var/backups/monhorus/uploads-$(date +%F).tar.gz -C /var/lib/monhorus uploads
```

followed verbatim at `:389` by: *"**Nothing is scheduled yet** — see `IMPROVEMENTS.md`."*

**Problem.** Three factors compound:

1. `docs/DEPLOYMENT_UBUNTU.md:390-391` — *"The storage module is local-disk only. There is no object store, no S3, no fallback. What is on that disk is the whole of the file corpus."*
2. Production is a **single-node** replica set (`rs0`). That provides transaction support, not redundancy. There is no secondary.
3. The disk is at **83–88%** with 2.7–3.9 GB free (`PRODUCTION_STATUS.md:21`, `IMPROVEMENTS.md:49-53`), and `mongodump` archives would be written to that same disk with no retention policy or log rotation.

**Impact.** A disk-full event or host loss is currently an **unrecoverable total-data-loss event** — every service request, report, invoice, floor plan, inspection photo and HR document. This ranks above every other finding in this report; everything else is recoverable.

**Reproduction/verification.** `find . -name "*.timer" -o -name "*.cron*" -o -iname "*backup*" | grep -v node_modules` → no results. `ls scripts/` → `run-mobile.sh`.

**Recommended fix.** (a) A systemd timer running the already-written command pair, 14-day retention, **off-host** destination. (b) logrotate for `/var/log/nginx/monhorus*.log` and retention for `/var/backups/monhorus`. (c) **One rehearsed restore onto a scratch host, with the result written down** — note `mongorestore --drop` is destructive on first attempt and `sync-indexes` must be re-run afterwards, since `autoIndex` is off in production. (d) Disk alerting at 90%.

**Existing tests.** None (operational).
**Missing tests.** A restore rehearsal is the test. Nothing in software can substitute.

---

### C-2 · Editing an employee silently erases education, work history and certificates

- **Severity:** Critical
- **Application:** Web / Admin
- **Feature:** Employee management
- **Path:** `apps/web/src/features/employees/EmployeeFormPage.tsx:280-282`, `:310-312`; `apps/backend/src/modules/employee/employee.service.ts:278-305`
- **Component/API:** `buildPayload()` → `PATCH /api/v1/employees/:employeeId`

**Evidence.** `buildPayload()` unconditionally terminates with:

```ts
// apps/web/src/features/employees/EmployeeFormPage.tsx:280-282
      education: [],
      workHistory: [],
      certificates: [],
    };
```

and is used for **both** create and update:

```ts
// :310-312
      const saved = isEdit && employeeId
        ? await employeeService.update(employeeId, parsed.data)
        : await employeeService.create(parsed.data);
```

The backend applies them whenever present:

```ts
// apps/backend/src/modules/employee/employee.service.ts:278-282
  if (input.education !== undefined) {
    target.education = input.education.map((entry) => ({ ... }));
  }
```

The form has no UI for these three lists. They survive `safeParse` because `employeeBaseShape` declares each with `.default([])` (`packages/shared/src/schemas/employee.schema.ts:151-153`) — so even omitting them from the payload would inject `[]`.

**Problem.** Every save of the employee edit form destroys three stored collections.

**Impact.** Editing an employee's phone number wipes their entire education record, employment history and professional certificates. The web app never *displays* these fields, so an administrator cannot see the loss — but the employee mobile app reads them (`apps/mobile-employee/lib/features/employee/profile/domain/entities/employee_profile.dart`). Certificates are used by the `employee.print_certificate` flow. This is unrecoverable without a backup, which does not exist (C-1).

**Reproduction/verification.** Seed an employee with an education entry, open `/employees/:id/edit`, change any field, save, re-read the record.

**Recommended fix.** Omit `education`/`workHistory`/`certificates` from the update payload entirely, and change the backend's `updateEmployeeSchema` so those keys cannot be defaulted into an update (they need `.optional()` without `.default([])` on the update path, or a separate update shape).

**Existing tests.** `EmployeeFormPage.test.tsx` mocks `employeeService`, so the destructive payload is never observed.
**Missing tests.** A round-trip test asserting an employee's `education.length` is unchanged after a `PATCH` that does not mention education.

---

### C-3 · Saving a conclusion from the employee phone destroys five fields entered on the web

- **Severity:** Critical
- **Application:** Employee Mobile → Backend
- **Feature:** Service-request conclusion (Дүгнэлт)
- **Path:** `apps/mobile-employee/lib/features/employee/work/data/models/work_report_model.dart:330-344`; `apps/mobile-employee/lib/features/employee/work/presentation/providers/conclusion_providers.dart:548`; `apps/backend/src/modules/service-request/work-report.service.ts:379-395`
- **Component/API:** `PUT /api/v1/service-requests/:requestId/report`

**Evidence.** The mobile payload:

```dart
// work_report_model.dart:330-344
Map<String, dynamic> toJson() {
  return <String, dynamic>{
    'score': score, 'conclusion': conclusion, 'recommendation': recommendation,
    'actionTaken': actionTaken,
    'repairRequired': false,      // hardcoded
    'revisitRequired': false,     // hardcoded
    'objectIds': objectIds, 'objectAssessments': ...,
    'beforePhotoIds': beforePhotoIds, 'afterPhotoIds': afterPhotoIds,
  };                              // no `materials`, no `revisitDate`
}
```

`conclusion_providers.dart:548` additionally hardcodes `actionTaken: null`. The endpoint is a **full replace**, and zod defaults every absent field:

```ts
// apps/backend/src/modules/service-request/work-report.service.ts:379-395
  report.actionTaken = input.actionTaken ?? null;
  report.repairRequired = input.repairRequired;      // zod default false
  report.revisitRequired = input.revisitRequired;    // zod default false
  report.revisitDate = input.revisitDate ? new Date(input.revisitDate) : null;
  report.set('materials', input.materials.map(...));  // zod default []
```

The web editor writes all five (`apps/web/src/features/service-requests/WorkReportPanel.tsx:556-584`, with a dedicated `MaterialEditor` at `:750`). `WorkReportModel.fromJson` (`work_report_model.dart:234-267`) does not even parse `materials`, `repairRequired`, `revisitRequired` or `revisitDate`, so the app cannot round-trip them.

**Problem.** Absent is treated as "clear", and the mobile client is structurally incapable of sending four of the fields.

**Impact.** A dispatcher records materials used and flags "засвар шаардлагатай" on the web. The technician opens the same conclusion on the phone and taps save. The material list is emptied (requirement 19.2 data), both follow-up flags reset to `false`, the revisit date is cleared, and `actionTaken` is nulled — which is also the per-object `observation` fallback at `work-report.service.ts:593`, so the loss propagates into published report items. Silent, one-directional, no warning on either client.

**Reproduction/verification.** Save a report on the web with materials and `repairRequired: true`; `PUT` the mobile payload for the same request id; re-read `GET /:id/report` → `materials: []`, `repairRequired: false`.

**Recommended fix.** Either make `PUT /:id/report` patch-semantic (only apply keys actually present in the raw body — note zod defaults make `!== undefined` insufficient, so this needs the pre-parse body), or parse the four fields into `WorkReportModel`, carry them through editor state untouched, and echo them in `toJson()`.

**Existing tests.** `conclusion_editor_test.dart` (1,024 lines) covers the editor UI, not the payload shape against the server contract.
**Missing tests.** A payload-shape test asserting the mobile `toJson()` covers every field `saveWorkReportSchema` will default.

---

### C-4 · Expired service agreements are never marked expired and keep generating invoices

- **Severity:** Critical
- **Application:** Backend
- **Feature:** Service agreements → monthly invoicing
- **Path:** `apps/backend/src/modules/invoice/invoice.service.ts:344`; `apps/backend/src/modules/service-agreement/service-agreement.model.ts:107-108`; `apps/backend/src/jobs/`
- **Component/API:** `previewMonthlyInvoices()` / monthly invoice generation

**Evidence.** `grep -rn "'EXPIRED'" apps/backend/src --include='*.ts' | grep -v test` returns **nothing**. The status is declared in the schema and **never written by any code path**.

The model declares the index for the sweep that would write it:

```js
// apps/backend/src/modules/service-agreement/service-agreement.model.ts:107-108
// Expiry sweep and the active-agreement dashboard counter.
serviceAgreementSchema.index({ status: 1, endDate: 1 });
```

`apps/backend/src/jobs/` contains exactly two files — `overdue-reconciliation.job.ts` and `unclaimed-work.job.ts`. **There is no expiry sweep.** And generation filters on status alone:

```ts
// apps/backend/src/modules/invoice/invoice.service.ts:344
  const agreements = await ServiceAgreement.find({ status: 'ACTIVE' })
```

No `endDate` predicate anywhere on the path.

**Problem.** An agreement whose term ended remains `ACTIVE` forever, and monthly invoice generation treats it as billable indefinitely.

**Impact.** **Wrong invoices sent to real customers**, every month, for contracts that ended. This is the most directly costly defect in the audit. Compounded by the absence of a state machine on agreements (`POST /:id/status` refuses only "already in this state", so `CANCELLED → ACTIVE` is also reachable — see M-31).

**Reproduction/verification.** Create an agreement with `endDate` in the past and `status: 'ACTIVE'`; call `GET /api/v1/invoices/generation-preview` → it appears as a billable candidate.

**Recommended fix.** (a) Add an `endDate: { $gte: periodStart }` predicate to the generation query — a one-line containment. (b) Add an expiry sweep job that writes `EXPIRED`, using the index that already exists for it. (c) Add a transition table for `SERVICE_AGREEMENT_STATUSES`.

**Existing tests.** None covering agreement expiry or invoice-generation candidate selection by date.
**Missing tests.** A test asserting an agreement past `endDate` is not a generation candidate.

---

### C-5 · Every organisation dropdown on the employee form issues a request the backend rejects with 400

- **Severity:** Critical
- **Application:** Web / Admin
- **Feature:** Employee create/edit; org filters
- **Path:** `apps/web/src/features/employees/useOrgSelectors.ts:23,47,70,94`; `apps/web/src/features/org/useOrgOptions.ts:12,30,59`; `packages/shared/src/schemas/common.schema.ts:41-44`; `apps/backend/src/middlewares/validate.middleware.ts:44-52`
- **Component/API:** `GET /api/v1/org/companies|departments|positions?limit=200`

**Evidence.**

```ts
// apps/web/src/features/employees/useOrgSelectors.ts:23
const OPTION_LIMIT = 200;
```

against

```ts
// packages/shared/src/schemas/common.schema.ts:41-44
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
```

`orgListQuerySchema` extends it without overriding `limit` (`apps/backend/src/modules/org/org.validation.ts:25`), and all four org routes validate with it. The middleware **rejects rather than clamps**:

```ts
// apps/backend/src/middlewares/validate.middleware.ts:44-52
      if (error instanceof ZodError) {
        next(AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, undefined, zodIssuesToFieldIssues(error)));
```

**Problem.** `limit=200` exceeds `.max(100)`, so every one of these requests is a hard 400.

**Impact.**
- `EmployeeFormPage` (create **and** edit): Company / Department / Position selects are permanently empty with the banner "Компанийн жагсаалт ачаалж чадсангүй." **Employees cannot be filed under any organisational unit.**
- `DepartmentsPage.tsx:145` and `PositionsPage.tsx:182,184`: the company and department filters are silently empty, because `useOrgOptions.ts:36,64` uses `.catch(() => undefined)` — no error at all, just a dropdown containing only "Бүх байгууллага".

**Reproduction/verification.** Open `/employees/new` against a real backend; observe `GET /api/v1/org/companies?limit=200` → `400 VALIDATION_ERROR`.

**Recommended fix.** Change `OPTION_LIMIT` to 100 in both files, or page-walk. Longer term, decide whether `validate` should clamp `limit` rather than reject — rejection converts a benign over-ask into a total feature failure, and this is the second time it has bitten (see H-31).

**Existing tests.** `EmployeeFormPage.test.tsx:17` mocks `orgService` and **asserts `limit: 200`** — the test encodes the bug.
**Missing tests.** A contract test asserting every client-side `limit` is ≤ the server schema's `.max()`.

---

## 5. High Findings

Full structure retained; grouped by theme for readability.

### 5.1 Authorization & data exposure

---

#### H-1 · Five report/PDF endpoints ignore tenant and assignment scope — any technician reads any customer's report

- **Severity:** High · **Application:** Backend · **Feature:** Planned-work & inspection reports
- **Path:** `apps/backend/src/modules/planned-work/planned-work.routes.ts:399-402, 433-437`; `apps/backend/src/modules/inspection-report/inspection-report.routes.ts:36-55`; loaders at `planned-work.service.ts:557-563` and `inspection-report.service.ts:67-73`; guard at `planned-work.scope.ts:427-430`

**Evidence.** Both loaders take **no `AuthContext` at all**:

```ts
// apps/backend/src/modules/inspection-report/inspection-report.service.ts:67-73
export async function findPlannedWorkOrThrow(plannedWorkId: string): Promise<Doc<IPlannedWork>> {
  const work = await PlannedWork.findById(plannedWorkId);
  if (!work) throw AppError.notFound(…);
  return work;
}
```

Verified identical shape at `planned-work.service.ts:557-563` (`findRaw`, re-exported as `findPlannedWorkOrThrow`). The mounted guard deliberately waves reads through:

```ts
// apps/backend/src/modules/planned-work/planned-work.scope.ts:427-430
if (READ_METHODS.has(req.method)) { next(); return; }
```

on the stated premise (`:414-420`) that *"the loader beneath it has already decided."* For `getPlannedWorkById` that is true — it applies tenant **and** assignment filters inside the `findOne` (`planned-work.service.ts:591-604`). For these five it is false.

**Problem.** `GET /planned-work/:id/report`, `/report/pdf`, `/inspection-report`, `/inspection-report/pdf` and `/inspection-report/readiness` are gated on `planned_work.view` alone.

**Impact.** Every technician — plus FINANCE and SALES, who hold the key — can fetch the full consolidated report body and download the rendered **PDF including evidence photographs** for *any* planned work in the company, for *any* customer, in *any* status including DRAFT. The payload carries `customerName`, `projectName`, `buildingName` (`planned-work.report.service.ts:284-286`) plus every sub-task note, score and material. Meanwhile `GET /planned-work/:id` answers that same caller **404**. One layer down, `DOWNLOAD_PERMISSIONS_BY_OWNER.PLANNED_WORK_TASK = [PLANNED_WORK_VIEW]` (`storage.routes.ts:66`) carries no assignment scope either, so every task before/after photo in the company is downloadable.

**Reproduction.** As a technician assigned to nothing: `GET /api/v1/planned-work/<other-job-id>` → 404; `GET /api/v1/planned-work/<same-id>/report` → 200 with the full report.

**Fix.** Thread `AuthContext` into the five loaders and reuse `getPlannedWorkById`'s filters. One line per route.

**Existing tests.** `planned-work.assignment-scope.api.test.ts:497-517` **asserts the current behaviour as intended** — *"refuses the nested inspection-report writes to a stranger but not the read."* It must be updated deliberately.
**Missing tests.** Cross-tenant 404 on each of the five endpoints.

---

#### H-2 · Every technician can export the entire customer book with tax IDs, and every service contract with its monthly fee

- **Severity:** High · **Application:** Backend · **Feature:** Customer master data, service agreements
- **Path:** `apps/backend/src/modules/objects/object.service.ts:54-76, 216-218, 300`; `apps/backend/src/modules/service-agreement/service-agreement.routes.ts:98-125`; `packages/shared/src/constants/permissions.ts:639`

**Evidence.** Both services take **no auth context**:

```ts
// apps/backend/src/modules/objects/object.service.ts:216-218
export async function listCustomers(query: CustomerListQuery): Promise<PaginatedData<CustomerDto>>
// :300
export async function getCustomerById(customerId: string): Promise<CustomerDto>
```

The DTO (`:54-76`) returns `registrationNumber` (РД), `taxNumber` (ТТД), `phone`, `email`, `address`, `contactPerson`, `notes`. `P.CUSTOMER_VIEW` is in the seeded TECHNICIAN default (`permissions.ts:639`). `GET /service-agreements` is the same shape, and its DTO exposes `monthlyFee`, `currency`, `slaUrgentHours`, `slaStandardHours` (`service-agreement.routes.ts:52-86`).

**Problem — stated precisely.** The *grant* is deliberate: the comment beside it explains the job card must name the organisation and place. The defect is that a key granted for **hierarchy readability** returns the **full commercial and PII record**, and the list is entirely unscoped.

**Impact.** `GET /api/v1/objects/customers?limit=100` from any field technician's phone token returns the company's whole customer book with tax IDs and contacts; `GET /api/v1/service-agreements` returns every contract's monthly fee. This is the customer-side twin of the leak that `converge-technician-permissions.ts` was written to close on the employee side. Not portal-reachable (CUSTOMER holds no staff keys). Compounds H-1.

**Fix.** Split a narrow `CustomerRefDto` (id, code, name) for the technician-facing read and gate the full DTO on `customer.manage`; thread scope into `listCustomers`.

**Existing tests.** `employee-privacy.security.api.test.ts` covers the employee-side equivalent; the customer side is uncovered.
**Missing tests.** A technician-token test asserting `registrationNumber`/`taxNumber` are absent from `GET /objects/customers`.

---

#### H-3 · Customers receive unapproved report content, including the internal reviewer's rejection text — and the guard that would stop it is dead code

- **Severity:** High · **Application:** Backend / Customer Portal · **Feature:** Planned-work report
- **Path:** `apps/backend/src/modules/planned-work/planned-work.service.ts:543-545`; `planned-work.report.service.ts:165-191, 656`; `apps/web/src/features/portal/PortalPlannedWorkDetailPage.tsx:439`

**Evidence.** `loadDetail` attaches the report unconditionally for every caller, and the DTO returns the content with a **flag, not a filter**:

```ts
// apps/backend/src/modules/planned-work/planned-work.report.service.ts:186-187
    // A customer sees an approved report and nothing else.
    visibleToCustomer: report.status === 'APPROVED',
```

alongside `conclusion`, `recommendation`, `returnReason`, and the id+name+timestamp stamps for created/submitted/approved/returned. The only enforcement is JSX at `PortalPlannedWorkDetailPage.tsx:439`.

The server-side guard exists and has **zero callers** — verified by grep across backend and web:

```ts
// apps/backend/src/modules/planned-work/planned-work.report.service.ts:656
export function assertReportVisibleToCustomer(report: Doc<IPlannedWorkReport>): void {
```

**Impact.** A customer reading their own `GET /planned-work/:id` in devtools or curl sees the draft conclusion before anyone signed it off, the **internal return reason** (a manager's written criticism of a technician's write-up), and the user ids and full names of every staff member who authored, submitted, returned and approved it.

**The contrast proves this is an omission, not a policy.** The sibling service-request path refuses server-side and hand-builds its DTO field by field: `work-report.service.ts:328-347` → 404 unless `APPROVED`.

**Fix.** Call the existing guard, or emit `report: null` for a customer-scoped caller unless `APPROVED`.

**Existing tests.** None asserting a customer cannot read a DRAFT report body.
**Missing tests.** Exactly that.

---

#### H-4 · The customer mobile app renders the internal staff names and status reasons the web portal deliberately withholds

- **Severity:** High · **Application:** Customer Mobile · **Feature:** Service-request detail
- **Path:** `apps/backend/src/modules/service-request/service-request.service.ts:177-217`; `apps/web/src/features/portal/PortalRequestDetailPage.tsx:42-46`; `apps/mobile/lib/features/customer_portal/presentation/screens/service_request_detail_screen.dart:238-239, 253-269`

**Evidence.** `toDetailDto` takes only the request — no scope, no role — so **one DTO serves staff and customers alike**, carrying `statusHistory` (with `reason` and `changedByName`), `slaExtensionReason`, `revisitReason`, `createdByName`, `teamLeaderEmployeeId`, and `assignedEmployees` with `employeeCode`, names and photos.

The web portal knows and declines to render it, in a comment that names the problem exactly:

> `PortalRequestDetailPage.tsx:42-46` — *"the request detail endpoint still SENDS the assignment and the status history — the server does not narrow that payload — so this screen is a presentation choice, not a boundary."*

**The customer mobile app renders it anyway.**

**Impact.** A customer reads the internal reviewer's return-for-fix text, cancellation reasons, SLA-extension justifications, and the name and employee code of every staff member who touched the request. The mitigation the web team wrote down is absent on the one client that needed it.

**Fix.** Add `toCustomerDetailDto`, composed field by field — the technique `getCustomerWorkReport` already establishes in the same module.

**Existing tests.** None. **Missing tests.** A customer-token assertion that `statusHistory` and `assignedEmployees` are absent.

---

#### H-5 / H-6 · No self-approval check on inspection reports or consolidated reports

- **Severity:** High · **Application:** Backend · **Feature:** Report approval
- **Path:** `apps/backend/src/modules/inspection-report/inspection-report.service.ts:709-727`; `apps/backend/src/modules/report-record/consolidation.service.ts:288-307`; sibling at `planned-work.report.service.ts:115-121`

**Evidence.** `approveReport` is the whole handler — `assertTransition` (status only), then stamp. `report.createdBy` / `submittedBy` are never compared to `actor.userId`:

```ts
// inspection-report.service.ts:715-723
  const report = await loadReportOrThrow(work);
  assertTransition(report, 'APPROVED');
  const before = auditSnapshot(report);
  report.status = 'APPROVED';
  report.approvedBy = new Types.ObjectId(actor.userId);
```

The sibling workflow blocks exactly this:

```ts
// apps/backend/src/modules/planned-work/planned-work.report.service.ts:115-121
  if (report.createdBy && String(report.createdBy) === actor.userId) {
    blockers.push('Тайланг зохиогч өөрөө батлах боломжгүй.');
  }
  if (report.submittedBy && String(report.submittedBy) === actor.userId) {
    blockers.push('Тайланг илгээсэн хүн өөрөө батлах боломжгүй.');
  }
```

**Impact.** Every seeded **ADMIN** (`permissions.ts:503`) and **MANAGEMENT** (`:526`) holds both `PLANNED_WORK_SUBMIT_REPORT` and `PLANNED_WORK_APPROVE_REPORT`, so one person can author, submit and approve the same **statutory inspection**. The PDF then prints "Тайлан гүйцэтгэсэн" and "Хянасан" with the same name. For consolidated reports, seeded ADMIN holds all three of `object_master.assess`, `report.approve`, `report.publish`, and approval calls `applyReportSafely`, pushing scores onto equipment and rollups.

**Fix.** Lift `approvalBlockersOf`'s check into both approve paths.

**Existing tests.** `inspection-report.api.test.ts` covers transitions, not authorship separation.
**Missing tests.** Author-approves-own-report → 403, for both workflows.

---

#### H-7 · `employee.view` downloads every HR document; DISPATCH holds it

- **Severity:** High · **Application:** Backend · **Feature:** Employee documents
- **Path:** `apps/backend/src/modules/storage/storage.routes.ts:64, 707, 725, 799`; `packages/shared/src/constants/permissions.ts:537-545`

**Evidence.** Download of `EMPLOYEE`-owned files maps to `EMPLOYEE_VIEW` alone (`storage.routes.ts:64`) and the document *list* is gated the same (`:707`), while upload and delete require `EMPLOYEE_MANAGE_DOCUMENTS` (`:725`, `:799`). The `DISPATCH` role block (`permissions.ts:537-545`) holds `EMPLOYEE_VIEW` and **not** `EMPLOYEE_MANAGE_DOCUMENTS`. FINANCE likewise.

**Impact.** A dispatcher — whose job is assigning work — can `GET /employees/:id/documents` and download every colleague's employment contract, diploma and national-ID scan, while being unable to add or remove one. The read permission is strictly weaker than the write permission for the same objects, and there is **no self/tenant dimension at all**.

**Fix.** Map `EMPLOYEE` downloads to `EMPLOYEE_MANAGE_DOCUMENTS` (keeping the narrow `isOwnProfilePhoto` exception at `:262-270`), or introduce `employee.view_documents`.

**Existing tests.** `employee-privacy.security.api.test.ts:319-367` pins salary separation; documents are uncovered.

---

#### H-8 · National ID is in the employee directory list on `employee.view`, while the certificate endpoint gates the same field behind a second key

- **Severity:** High · **Application:** Backend · **Feature:** Employee directory
- **Path:** `apps/backend/src/modules/employee/employee.mapper.ts:58, 290`; `apps/backend/src/modules/employee/employee.controller.ts:288-290`

**Evidence.** `registrationNumber: employee.registrationNumber` appears in both the list DTO (`:58`) and detail DTO (`:290`), reachable with `employee.view` alone. The certificate endpoint gates the identical field on a second key:

```ts
// employee.controller.ts:288-290
      registrationNumber: auth.permissions.has(PERMISSIONS.EMPLOYEE_VIEW_AUDIT)
        ? employee.registrationNumber
        : null,
```

**Impact.** The Mongolian регистрийн дугаар is a national identifier. Two endpoints in the same module disagree about whether it needs a second permission, and the weaker one is the **bulk list**. Every `employee.view` holder — DISPATCH, FINANCE, MANAGEMENT, ADMIN, plus any technician on an installation predating `converge-technician-permissions` — can bulk-export every colleague's national ID. Withdrawing `employee.view_audit` does not stop it. (`GET /employees/me` is unaffected — `toEmployeeSelfDto` omits the field.)

---

### 5.2 Data integrity

---

#### H-9 · Deactivating a customer has no effect at any layer; two `select('_id isActive')` calls never read the field they fetched

- **Severity:** High · **Application:** Backend · **Feature:** Customer / org lifecycle
- **Path:** `apps/backend/src/modules/objects/project.service.ts:628-633`; `apps/backend/src/modules/employee/employee.service.ts:77-83`; `apps/backend/src/modules/user/user.service.ts:88`; `apps/backend/src/common/security/customer-scope.ts:31-50`

**Evidence.** The intent is written into the projection and then dropped:

```ts
// apps/backend/src/modules/objects/project.service.ts:628-631
  const customer = await Customer.findById(ownerCustomerId).select('_id isActive');
  if (!customer) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', …);
  }                                      // isActive fetched, never referenced
```

Identical at `employee.service.ts:77-83` for `Company`. Account provisioning checks existence only (`user.service.ts:88` — `Customer.exists({...})`), and `resolveCustomerScope` never loads the Customer document at all.

**Impact.** A project can be created for a deactivated customer; an employee can be filed under a deactivated company; a login-capable portal account can be provisioned against a deactivated organisation, and existing ones keep signing in. **"Deactivated" means only "hidden from the picker."**

**Root cause worth naming:** there is **no `pre(/^find/)` default scope on any model**. Every soft-delete filter in this system is hand-written per call site, so omission is silent and invisible in review. `org.service.ts:81-83` (`activeFilter()`) is the pattern that works; it is applied in one module.

---

#### H-10 · Terminating an employee revokes nothing and unassigns nothing

- **Severity:** High · **Application:** Backend · **Feature:** Employee lifecycle
- **Path:** `apps/backend/src/modules/employee/employee.service.ts:464-560`; contrast `employee-access.service.ts:88`

**Evidence.** `changeEmployeeStatus`'s `TERMINATED` branch (`:510-529`) validates and sets `terminationDate`/`terminationReason`, then `:531` sets `status`, saves, writes a status-history row and an audit row. That is all. It does **not** revoke the linked `systemUser`'s sessions, suspend the `User`, or unassign the employee from open work. The capability exists and is used elsewhere — `employee-access.service.ts:88` does `Session.updateMany(...)` when access is explicitly revoked.

**Impact.** A terminated employee **keeps a live refresh session and keeps working mobile-app access** until someone separately remembers to revoke it. They also remain selectable for new work: `planned-work.crew.ts:27`, `project.service.ts:636`, `object-master.service.ts:1596` and `notification/recipient.util.ts:18-21` all resolve employees without a status filter (the parallel `User` path at `notification.service.ts:82` *does* filter `status: 'active'`).

---

#### H-11 · Deleting an object orphans `ReportItem.object`, a required field

- **Severity:** High · **Application:** Backend / Database · **Feature:** Referential integrity
- **Path:** `apps/backend/src/modules/object-master/object-master.service.ts:479-514, 1268`; `apps/backend/src/modules/report-record/report-record.model.ts:207`

**Evidence.** `deleteBlockersOf` counts five things: assessments, panel/circuit children, start/end-point references and service requests. It does **not** count `ReportItem.object` (declared `required: true`), `WorkReport.objects`, `PlannedWorkTask.relatedObjects`, or `Diagram.nodes[].object`.

The assessment guard does not save it: assessments are written only when a report is **approved** (`report-record.service.ts` `applyReportToEquipment`), so an object named in a DRAFT or SUBMITTED report has assessment count 0, passes all five blockers, and is hard-deleted at `:1268`.

**Impact.** `ReportItem` rows whose **required** `object` field points at a document that no longer exists. The report renders a scored finding against a nonexistent asset and `populate('object')` yields `null` on a non-nullable path. Compounding: for an object that *did* have assessments, the debris can never be cleaned either, because `ObjectAssessment`'s delete hooks throw `IMMUTABLE` (`object-master.models.ts:439-452`).

Same class at the hierarchy level: `project.service.ts:404-437` does not count `Report.project`, `Report.building`, `ReportItem.floor` or `PlannedWorkTask.floor`.

---

#### H-12 · `PATCH /objects-master/:id` keeps the old floor's pin when the object moves floors

- **Severity:** High · **Application:** Backend · **Feature:** Object placement
- **Path:** `apps/backend/src/modules/object-master/object-master.service.ts:1074-1090`; contrast `:1334-1342`

**Evidence.** The pin is cleared **only when `floorId` is set to `null`**:

```ts
// :1074-1079
  if (input.floorId !== undefined) {
    object.floor = input.floorId ? await assertFloorUsable(input.floorId, object.customer) : null;
    // Taking the object off the floor takes its pin with it: …
    if (!object.floor) object.planPosition = null;
  }
```

The sibling endpoint does the right thing and explains why:

```ts
// :1334-1342
    object.floor = floor._id;
    // The pin belonged to the floor it came from, so a move leaves the object unplaced on
    // the new plan rather than at the same fraction of a different drawing.
    object.planPosition = null;
```

**Impact.** The same logical operation produces two different outcomes depending on the endpoint. Via `PATCH`, the object arrives on floor B pinned at a meaningless coordinate, indistinguishable from a deliberate placement. Not currently triggered by any shipped client (the web edit route always resends the object's existing floor), so this is an **API-contract defect awaiting its first caller**.

---

#### H-13 · Replacing a floor plan with a different aspect ratio silently displaces every marker

- **Severity:** High · **Application:** Backend / all clients · **Feature:** Floor plans
- **Path:** `apps/backend/src/modules/objects/floor-plan.service.ts:117-131`; `apps/backend/src/modules/objects/project.routes.ts:423-450`

**Evidence.** The decision is documented:

> *"Object placements are deliberately KEPT across a replacement… stored normalised to 0..1 of the plan rather than in pixels, and a replacement plan is almost always the same floor redrawn or rescanned, so the pins still land where they belong… a pin that ends up slightly off after a genuinely different drawing is dragged, which costs one click."*

**Problem.** The reasoning holds for a re-scan at a different resolution. It **fails for a different aspect ratio**, and "slightly off" understates it: because both axes are independently normalised, replacing a 4:3 plan with a 16:9 one displaces every marker by up to 25% of the drawing's width — a panel pinned to the correct room lands in a different room. `PUT /floors/:floorId/plan` accepts the replacement with no dimension comparison, no warning and no review prompt.

**Impact.** A survey's worth of placement work silently invalidated by one upload. The audit row records file names but nothing about the coordinate consequence.

**Fix.** Store the image's width/height on the `FloorPlan` document; on replacement, compare aspect ratios and warn that N placed markers need review.

---

### 5.3 Pagination, filtering and silent record loss

---

#### H-14 · Four list endpoints filter *after* pagination while reporting the unfiltered total

- **Severity:** High · **Application:** Backend · **Feature:** List endpoints
- **Path:** `planned-work.service.ts:715-741` (`reportStatus`); `service-request.service.ts:521-541` (`slaState`); `object.service.ts:242-297` (`hasActiveAgreement`); `project.service.ts:954-980` (`hasPlanImage`)

**Evidence** (worst case — the only one with no acknowledging comment):

```ts
// apps/backend/src/modules/planned-work/planned-work.service.ts:719-733
  const [rows, total] = await Promise.all([
    PlannedWork.find(filter).populate([...]).sort(sort).skip(skip).limit(query.limit),
    PlannedWork.countDocuments(filter),                       // :721 — unfiltered
  ]);
  …
  if (query.reportStatus) {
    items = items.filter((item) => item.reportStatus === query.reportStatus);   // :731-733
  }
```

**Impact.** `?reportStatus=SUBMITTED` on a 500-row set at 20/page returns `total: 500, totalPages: 25` and typically 0–3 items per page. A user paging through concludes the submitted reports do not exist. The rows are unreachable on *every* page.

**Fix.** Push each predicate into the query. `invoice.service.ts:239-252` is the correct reference implementation already in this codebase — it pushes a *derived* status into the query so the page count stays honest.

---

#### H-15 · Dispatch's "available employees" filter runs after `.limit()`, hiding assignable technicians permanently

- **Severity:** High · **Application:** Backend · **Feature:** Dispatch
- **Path:** `apps/backend/src/modules/employee/employee-workload.service.ts:113-143`; route `dispatch.routes.ts:59-77`

**Evidence.**

```ts
  const employees = await Employee.find(filter)
    .populate({ path: 'team', select: 'name' })
    .sort({ lastName: 1, firstName: 1 })
    .limit(query.limit);                                    // :116
  …
  return query.availableOnly
    ? candidates.filter((candidate) => candidate.isAvailable)   // :141-143
    : candidates;
```

Response is a **bare array** with no total and no `skip`.

**Impact.** A dispatcher asking for available employees gets the first 100 **by surname**, then whichever of those happen to be free. With 150 active employees, an available technician whose surname sorts after the 100th is invisible to dispatch — permanently, with no page 2 and no signal. This is the one place the pattern hides a *person* from a work-assignment screen.

---

#### H-16 · Both CSV exports truncate silently; the truncation flag is computed and then discarded

- **Severity:** High · **Application:** Backend · **Feature:** Export
- **Path:** `apps/backend/src/modules/report/report.service.ts:107-112, 1044-1060`; `apps/backend/src/modules/report/inspection.service.ts:411-418`

**Evidence.** The flag is computed with an explicit promise in its own comment:

```ts
// report.service.ts:107-112
// … The CSV export is the exception: it renders one window and offers no way to ask for
// the next, so a capped export still says so rather than passing itself off as the whole report.
truncatedAt: query.format === 'csv' && total > query.limit ? query.limit : null,
```

`reportToCsv` (`:1044-1060`) emits header + data rows + totals row only. `truncatedAt` is never rendered, and the route discards the envelope. Default limit 1000, max 5000.

**Compounding:** the totals row is aggregated over the **whole filtered set** while the data rows are the first 1000 — so a truncated export ships a footer that does not reconcile with its own rows, with nothing explaining why. `GET /inspections?format=csv` is the same shape at 5000 (`inspection.service.ts:411-418`), dropping a correct `total` it already has.

---

#### H-17 · `GET /calendar` caps at 500 per source, then filters by status after the cap, with no total

- **Severity:** High · **Application:** Backend / Web · **Feature:** Calendar
- **Path:** `apps/backend/src/modules/calendar/calendar.service.ts:83-90, 153-160, 214-256`

**Evidence.** `.limit(500)` on both `PlannedWork` and `ServiceRequest`; the response is `{ from, to, timezone, events }` with **no total, no `hasMore`, no truncation flag**; and `:244-246` filters by status after both caps.

**Impact.** A month view for a busy organisation renders a quietly incomplete calendar. `?status=COMPLETED` compounds it: the 500 rows are selected by `plannedStartDate` ascending, so completed work later in the window is cut before the filter sees it. The long doc comment at `:195-212` discusses the 500 cap purely as a data-leak surface and never as a truncation surface.

---

#### H-18 · The web object form fetches the *global* first 100 floors and then filters by customer in memory

- **Severity:** High · **Application:** Web / Admin · **Feature:** Object registration
- **Path:** `apps/web/src/features/projects/objects/ObjectFormPage.tsx:338-344`

**Evidence.**

```ts
    projectService
      .listFloors({ isActive: true, limit: 100 })
      .then((page) => {
        setFloors(page.items.filter((entry) => entry.customerId === customerId));
      })
      .catch(() => undefined);
```

`customerId` is never sent to the server. 100 is the hard cap.

**Impact.** Any customer whose floors sort past global position 100 gets an **empty floor dropdown with no error** — and the `.catch(() => undefined)` makes a network failure look identical. Textbook client-side filter over a truncated page.

---

#### H-19 · Two inspection filters are wired to the URL and never sent to the API

- **Severity:** High · **Application:** Web / Admin · **Feature:** Inspections list
- **Path:** `apps/web/src/features/inspections/InspectionListPage.tsx:87-105, 375-376, 394-395`

**Evidence.** The query builder sends `page, limit, search, customerId, projectId, type, riskLevel, dateFrom, dateTo` — and **no `sourceType`, no `status`**. Both controls are rendered and both write to `searchParams`. `InspectionListQuery` declares both (`packages/shared/src/types/inspection.types.ts:94-95`) and the backend accepts both (`packages/shared/src/schemas/report.schema.ts:41-42`).

**Impact.** Selecting "Үүсгэсэн бичлэг" or "Төлөв" changes the URL, resets the page, refetches — and returns the identical unfiltered set. A silent no-op that looks like a working filter.

---

#### H-20 · Mobile lists cap at one page of 100 and then filter client-side

- **Severity:** High · **Application:** Both mobile apps · **Feature:** Lists, floor plans
- **Path:** employee `work_remote_data_source.dart:285-305` + `work_providers.dart:606-611`; customer `customer_portal_providers.dart:215-275`; both `project_remote_data_source.dart:140-159`

**Evidence.** `PaginatedData.hasMore` exists at `core/network/paginated_data.dart:49` and has **no call sites in either app**. Every list is page 1 only.

The sharpest case: the employee app fetches one page of 100 `GET /service-requests` with `includeUnclaimed: true` — so the page contains the reader's requests **plus the whole open pool**, and for an oversight caller the whole organisation's — then applies the "is this mine" filter in Dart. Sorted `createdAt desc`, once the org has more than 100 newer requests, a technician's own request silently vanishes from "Хүсэлт".

Second: a floor with >100 devices loses plan markers, **and mis-states the reason** — `floor_plan_markers.dart:37-40` prints "Планд байрлуулаагүй N төхөөрөмж" computed over the truncated list, so it offers a *wrong* explanation for a thin-looking plan, which is worse than none.

---

#### H-21 · Plan search on the web reports "not found" for any object past #2,000

- **Severity:** High · **Application:** Web / Admin · **Feature:** Floor plan
- **Path:** `apps/web/src/features/projects/FloorPlanPanel.tsx:482-505`; `FloorDetailPage.tsx:193, 202, 236-249`

**Evidence.** Search filters `allObjects` in JS; `allObjects` comes from a page-walk with `OBJECT_PAGE_LIMIT = 100` and `MAX_OBJECT_PAGES = 20` — a hard 2,000-object ceiling with no UI notice.

**Impact.** Search silently returns "Илэрц олдсонгүй." for any object past #2,000 — it reports **absence, not truncation**, the worst failure mode for a "where is this panel" query. Layer filtering and the `unplacedCount` figure are computed over the same truncated set. No server-side plan search exists, though `objectListQuerySchema` supports `search`, `category`, `status` and `riskLevel`.

---

### 5.4 Client / platform correctness

---

#### H-22 · The customer mobile app reports every backend 5xx as "your connection is down"

- **Severity:** High · **Application:** Customer Mobile · **Feature:** Networking
- **Path:** `apps/mobile/lib/core/network/dio_client.dart:190-195`; fix present at `apps/mobile-employee/lib/core/network/dio_client.dart:191-203`

**Evidence.** `diff` of the two files shows the customer app is missing this block, which exists verbatim in the employee app:

```dart
// PRESENT in apps/mobile-employee, ABSENT in apps/mobile
// A 5xx is an answer from the server, not a failure to reach it. …
final Response<dynamic>? response = error.response;
if (response != null) {
  throw _toServerException(response.statusCode ?? 0, response.data);
}
```

**Impact.** `validateStatus: (status) => status < 500` makes Dio throw on 5xx; the catch then produces `NetworkException`. The user is told their connection is down while the API is demonstrably replying, and every retry retries against a broken server. It cascades: `auth_repository_impl.dart:86-101` keys its offline fallback on `NetworkFailure`, so a 500 from `/auth/me` on cold start **opens the app on a stale cached session** whose every subsequent request fails. The employee app was corrected to key on `AuthFailure`; the fix was never backported.

---

#### H-23 · The customer app's iOS bundle identifier is still the Flutter template default

- **Severity:** High · **Application:** Customer Mobile · **Feature:** Release
- **Path:** `apps/mobile/ios/Runner.xcodeproj/project.pbxproj:494, 511, 529, 545, 676, 698`

**Evidence.** `PRODUCT_BUNDLE_IDENTIFIER = com.example.monhorusMobile` at all six sites. The employee app was corrected to `mn.monhorus.monhorusEmployee`; this one was not.

**Impact.** App Store Connect rejects `com.example.*`. Changing it after any TestFlight or App Store release creates a *different app* rather than an update. Hard release blocker.

---

#### H-24 · The employee app mislabels unapproved planned work as approved, and cannot approve it

- **Severity:** High · **Application:** Employee Mobile · **Feature:** Planned work
- **Path:** `apps/mobile-employee/lib/features/employee/work/domain/entities/planned_work_enums.dart:28-44, 60-69, 193-199`; second copy at `…/home/domain/entities/work_enums.dart:24-32`

**Evidence.** The Dart enum declares **7** lifecycle states; the shared constant declares **9**. `PENDING_APPROVAL` and `REJECTED` are missing — and the parser does not degrade, it **coerces**:

```dart
  static PlannedWorkLifecycleStatus fromWire(String? value) {
    return PlannedWorkLifecycleStatus.values.firstWhere(
      (PlannedWorkLifecycleStatus status) => status.wireValue == value,
      orElse: () => PlannedWorkLifecycleStatus.draft,     // :43
    );
  }
```

with `orElse: () => PlannedWorkEffectiveStatus.planned` on the effective-status enum. The shared file is emphatic that this state is now universal: *"EVERY work passes through here now, whoever raised it"* (`packages/shared/src/constants/planned-work.ts:20-21`).

**Impact.** A `PENDING_APPROVAL` work — nobody approved it, no crew agreed — renders as **"Төлөвлөгдсөн"** and `isOpen` counts it into the technician's outstanding queue. It asserts a *wrong fact* rather than showing an unknown. Compounded by `PlannedWorkAction` omitting `APPROVE` and `REJECT` (`:193-199`): a team lead on the phone sees pending work labelled as approved **and has no way to approve or reject it**. The file is internally inconsistent — `PlannedWorkAction.fromWire` correctly returns null.

**Note:** the *service-request* vocabulary was checked exhaustively in the same file family and **matches the shared constant exactly** — all 14 statuses, all 14 transition rows, self-progress set, reason-required set, types and SLA states. The planned-work one has drifted. There is **no automated parity test** in either mobile app.

---

#### H-25 · Editing any freshly created planned work returns 400 from the web UI

- **Severity:** High · **Application:** Web / Admin · **Feature:** Planned work
- **Path:** `apps/web/src/features/planned-work/PlannedWorkFormPage.tsx:231-240`; `apps/backend/src/modules/planned-work/planned-work.service.ts:916-925, 803, 1059-1063`

**Evidence.** The form unconditionally puts `assignedEmployeeIds` **and** `assignedTeamId: null` in the PATCH body; `.nullish()` preserves an explicit `null`. The backend refuses on `!== undefined`, not truthiness:

```ts
if (PRE_APPROVAL_STATUSES.includes(work.status) &&
    (input.assignedEmployeeIds !== undefined || input.assignedTeamId !== undefined)) throw …
```

`PRE_APPROVAL_STATUSES = ['DRAFT','PENDING_APPROVAL','REJECTED']` and **every** planned work is created `DRAFT`.

**Impact.** Editing a freshly created work is impossible, and the portal's documented "correct a rejected request and resubmit" loop is unreachable. Past pre-approval the guard stops firing, so the same payload **silently unassigns the crew** — and every team member loses read and write access.

---

#### H-26 · Cross-tab token refresh trips the server's reuse detector and revokes every session

- **Severity:** High · **Application:** Web / Admin · **Feature:** Authentication
- **Path:** `apps/web/src/lib/api-client.ts:62-105`; `apps/backend/src/modules/auth/auth.service.ts:196-210`; `apps/web/src/components/layout/AppShell.tsx:42`

**Evidence.** The refresh dedupe is a **module-level variable** — correct within one tab, useless across tabs. There is no `storage` listener, no `BroadcastChannel`, no `navigator.locks` anywhere in `apps/web/src`. The backend rotates refresh tokens and treats replay as a breach, revoking **all** sessions for the user.

**Impact.** Access TTL is 15 min, all tabs share one token in `localStorage`, and `AppShell.tsx:42` polls `/notifications/unread-count` **every 60 s in every open tab** — so two open tabs are near-guaranteed to 401 within the same second. Both read token `R`, both POST `/auth/refresh`, the second is treated as reuse, and both tabs are hard-logged-out. Random forced logout for anyone working with two tabs open, which is the normal admin workflow.

---

### 5.5 Database & performance

---

#### H-27 · `ObjectNode.ancestors` is unindexed and queried three times per hierarchy list row

- **Severity:** High · **Path:** `apps/backend/src/modules/objects/object.models.ts:177, 189-193` vs `project.service.ts:230-243`

**Evidence.** Verified directly: `objectNodeSchema` declares `{parent,kind,name}`, `{customer,kind,name}` and `{customer,code}` unique. **`ancestors` has no index.** `countsUnder` issues three `ancestors`-keyed queries and is called once per row of every project and building list, plus again inside `deleteBlockersFor`.

**Impact.** Full collection scan of `objectnodes` × 3 × page size, on the most-visited screens in the product.

---

#### H-28 · `AuditLog` has no plain `{createdAt:-1}` index and will eventually hard-fail

- **Severity:** High · **Path:** `apps/backend/src/modules/audit/audit-log.model.ts:100-102` vs `audit.routes.ts:107-135`

**Evidence.** Verified: all three declared indexes **lead** with a discriminator (`entityType`, `user`, `action`). The default audit view filters on none of them and sorts `{createdAt: -1}`.

**Impact.** COLLSCAN plus an in-memory sort on the **fastest-growing collection in the system** (39 action types, a row for every create/update/status change/login/assignment/approval), with no TTL. MongoDB aborts a non-indexed sort past 32 MB, so this endpoint will **hard-fail with `Sort exceeded memory limit`** rather than merely being slow. Two aggravators on the same route: `distinct('entityType')`/`distinct('action')` at `:160-161` are unindexed full scans, and the search is an unanchored regex.

---

#### H-29 · ~12 database queries per row on `/projects`, `/buildings` and `/floors`

- **Severity:** High · **Path:** `apps/backend/src/modules/objects/project.service.ts:446-477, 230-243, 404-442`

**Evidence.** Verified directly: `toProjectDto` is async and per row awaits `countsUnder` (4 queries), `rollupOf` (1) and `deleteBlockersFor` (7, including a **second** `countsUnder`).

**Impact.** ~1,200 round trips for one `GET /projects?limit=100`. `toBuildingDto` is identical; `toFloorDto` is ~8/row at a default page size of 50 (~400 queries for the default floor page). `GET /projects/:id/buildings` hardcodes `limit: 100` and always pays the full cost.

**Fix.** `deleteBlockers` answers "may I delete this" — a *detail-view* concern that does not belong on a list row. Removing it from the three list mappers cuts ~60% immediately.

---

#### H-30 · Production indexes are built only by a remembered manual step

- **Severity:** High · **Path:** `apps/backend/src/config/database.ts:23`; `server.ts:47-57`; `scripts/sync-indexes.ts:1-11`; `docs/DEPLOYMENT_MONHORUS_PROD.md:220-224`

**Evidence.** `autoIndex: !env.isProduction` (verified). Boot runs `seedRbac()` and nothing else. The script's own header records what this already cost:

> *"No such migration existed, so a first boot with NODE_ENV=production created no indexes at all — including the unique ones correctness depends on… Nothing fails loudly; the collections simply scan, and a duplicate that a unique index would have refused is accepted instead."*

The runbook makes it a **shell comment** executed from memory *after* the service has restarted and begun serving traffic.

**Impact if skipped:** `User.email` unique gone (duplicate accounts, login resolves by whichever document Mongo returns first); `Report {customer,sourceType,sourceId}` gone (the report store's idempotency guarantee — re-completion writes duplicate reports); `Invoice {customer,billingPeriod,billingType}` gone (**duplicate invoices to real customers**); `EmployeeSalary` open-period uniqueness gone; **TTL indexes gone**, so expired sessions and reset tokens are never purged onto a disk already 83% full. The compounding failure: duplicates accumulate, and the *next* `sync-indexes` run then fails to build the constraint because live data violates it — surfacing weeks after the cause, as a log line.

---

#### H-31 · The transaction code path has zero test coverage

- **Severity:** High · **Path:** `apps/backend/src/test/global-setup.ts:19`; `common/utils/transaction.util.ts:36-66`

**Evidence.** Verified: tests use `MongoMemoryServer.create()` — a **standalone**. `MongoMemoryReplSet` appears nowhere in the repository. So `detectSupport()` returns `'unsupported'` in every test and **every test executes the `operation(null)` fallback**. `mongoose.startSession()`, `withTransaction`, commit and — most importantly — **rollback** are never exercised. The codebase says so itself: `project.api.test.ts:864` — *"the test database is a standalone mongod where transactions silently do nothing."*

**Impact.** Production (a real replica set) runs the one path that is never tested. The abort/rollback semantics of planned-work completion and report approval — the two most state-heavy operations in the system — have never executed anywhere. A rollback bug would first appear in production, during a partial failure.

**Fix.** `MongoMemoryReplSet.create({ replSet: { count: 1 } })` — a one-line change that flips coverage onto the real path.

---

### 5.6 Security & production configuration

---

#### H-32 · Password-reset links are written to the server log, and `APP_WEB_BASE_URL` defaults to localhost

- **Severity:** High · **Application:** Backend · **Feature:** Password reset
- **Path:** `apps/backend/src/config/env.ts:91, 107, 145`; `apps/backend/src/modules/mail/mail.service.ts:60-68`; `apps/backend/src/config/logger.ts:33-48`; `apps/backend/src/modules/auth/auth.service.ts:332-334`

**Evidence (verified end to end).**

```ts
// apps/backend/src/config/env.ts:91
  APP_WEB_BASE_URL: z.string().url().default('http://localhost:5173'),
```

```ts
// apps/backend/src/modules/mail/mail.service.ts:60-68
const logTransport: MailTransport = {
  kind: 'log',
  async send(message) {
    logger.info({ to: message.to, subject: message.subject, body: message.text },
      'Mail not configured; message written to the log instead of sent');
  },
};
```

`message.text` contains the live single-use reset link. The redaction list at `logger.ts:33-48` covers `password`, `refreshToken`, `accessToken`, `req.headers.authorization`, `req.headers.cookie` — **`body` is not in it** — and the production log level is `info`.

**Impact — two distinct failures.**
1. With `APP_WEB_BASE_URL` unset (its current production state, `PRODUCTION_STATUS.md:53-61`), every reset link points at the recipient's own machine. It fails **completely silently**: the send succeeds, the log is clean, the API returns its fixed message, and only the recipient sees a dead link.
2. With `SMTP_HOST` unset (also the current state, `:164`), every `POST /auth/forgot-password` writes a **live account-takeover credential** into journald at `info` — on a host `DEPLOYMENT_MONHORUS_PROD.md:38-41` records as carrying four other tenants. Valid for 60 minutes.

The module comment argues the fallback "never runs in a deployment that has SMTP_HOST set" — the reasoning has the condition backwards; the risk case is a deployment **without** it.

**Status:** pending deployment (the reset feature is in git, not on the server).

**Fix.** Add `'body'`/`'*.body'` to the redact paths; refuse `logTransport` under `env.isProduction`; add a `.superRefine` requiring `APP_WEB_BASE_URL` and `SMTP_HOST` when `NODE_ENV === 'production'` — the schema already exits(1) on bad input, so the machinery exists.

---

#### H-33 · Production source maps are built, shipped, world-readable and cached for a year

- **Severity:** High · **Path:** `apps/web/vite.config.ts:35`; `docs/DEPLOYMENT_MONHORUS_PROD.md:211-213, 221`; `docs/DEPLOYMENT_UBUNTU.md:723-728`

**Evidence.** Verified: `sourcemap: true` (an explicit opt-in — Vite's default is `false`), and `apps/web/dist/assets/index-CCSjDcTu.js.map` is **5,191,772 bytes** on disk, containing `sourcesContent`. The ship tarball excludes only `node_modules`, `.git`, `*.pdf` and the mobile apps; the deploy then runs `chmod -R a+rX` and nginx serves `/assets/` with `expires 1y; immutable`.

**Impact.** The complete TypeScript source of the admin console, comments included, is downloadable at `https://monhorus.itsystem.mn/assets/index-*.js.map`.

**Fix.** `sourcemap: 'hidden'` plus an nginx `location ~ \.map$ { deny all; }`, or exclude `*.map` from the tarball.

---

#### H-34 · There is no CI, and the mobile suites run nowhere

- **Severity:** High · **Path:** absence of `.github/`; root `package.json:8-12`; `turbo.json`

**Evidence (verified).** `ls .github` → no such directory. No workflow file anywhere. `packages/shared` has **no `test` script**, so turbo reports 3 successful tasks and silently covers zero shared tests — 60 source files and 2,731 lines of zod schemas plus the entire permission matrix. Neither mobile app is in `workspaces`, so `npm test` never touches the **349 Flutter tests**.

**Impact.** 2,322 tests run only when a human types the command, on a codebase where the highest-risk coupling — hand-mirrored Dart copies of shared constants — has already drifted (H-24) and would have been caught by a parity check in CI. The measured cost of running everything is **2m10s**.

---

#### H-35 · `npm ci --omit=dev` makes every documented migration command un-runnable, and `NODE_ENV` is a boot precondition

- **Severity:** High · **Path:** `apps/backend/package.json:10-18, 52-53`; `apps/backend/src/config/logger.ts:54-60`; `docs/DEPLOYMENT_MONHORUS_PROD.md:220`; `docs/DEPLOYMENT_UBUNTU.md:116, 436-437`

**Evidence.** Every migration/bootstrap npm script routes through `tsx`, a **devDependency**, while the production host installs with `npm ci --omit=dev`. The two runbooks give directly opposed instructions — `DEPLOYMENT_UBUNTU.md:116` says *"Do not prune dev dependencies"*, `DEPLOYMENT_MONHORUS_PROD.md:160-162` says on this host they are pruned.

Separately, `pino-pretty` is also a devDependency and is selected whenever `NODE_ENV !== production|test`. `env.ts:27` defaults `NODE_ENV` to `development`. **If the systemd `EnvironmentFile` fails to load, the backend crashes at boot inside the logger**, before any of its own diagnostics can report it.

**Impact.** An operator following `DEPLOYMENT_UBUNTU.md` §8 gets `npm ERR! Missing script`-class failures on every migration, and a single env-loading slip turns into an unexplained boot crash.

---

#### H-36 · The routine deploy procedure silently reverts the TLS migration

- **Severity:** High · **Path:** `docs/DEPLOYMENT_MONHORUS_PROD.md:204-209, 324` vs `:260-266`

**Evidence.** §6 "Deploying an update" — the section used on **every** release — still builds the web bundle with `VITE_API_BASE_URL=http://103.87.255.221:3020/api/v1`, and its built-in verification step asserts that stale value, so it **passes**. §7 of the same document (dated 2026-08-13) records the correct value as `https://monhorus.itsystem.mn/api/v1`. §8 has the same defect for the APK build — and since both apps now set `cleartextTrafficPermitted="false"`, following §8 produces an APK that cannot open a socket at all.

**Impact.** The documented release procedure undoes the TLS migration and self-certifies as correct.

---

#### H-37 · `/health` cannot detect an unhealthy service, and a Mongo outage never triggers a restart

- **Severity:** High · **Path:** `apps/backend/src/app.ts:52-58`; `apps/backend/src/config/database.ts:14`; `apps/backend/src/server.ts:47-48, 81-84`

**Evidence.** `/health` returns 200 with `uptime` and `timezone` — no database check. The runtime `disconnected` handler is a `logger.warn` and nothing else. No handler converts a lost connection into a non-zero exit, so `Restart=always` never fires.

**Impact.** During a Mongo outage `/health` returns `200 ok` while every API request hangs 10 s (mongoose buffer timeout) and then 500s, **indefinitely**, with no restart and no alert. Conversely, at *startup* there is one connect attempt and `process.exit(1)` — which with `Restart=always`/`RestartSec=5` becomes a permanent 15-second restart loop writing a fatal line each time, onto a disk with no log rotation configured anywhere in the repo. Both failure modes are documented as having already occurred.

---

#### H-38 · The authentication module has zero behavioural test coverage

- **Severity:** High · **Path:** `apps/backend/src/modules/auth/**` vs the test tree

**Evidence (measured).** Zero test references to `/auth/refresh`. Zero to `/auth/logout`. Zero hits for `PASSWORD_CHANGE_REQUIRED`, `TOKEN_EXPIRED` or `TOKEN_INVALID`. No test drives a single failed login, so account lockout (`auth.service.ts:111-144`) is unexercised. `setup.ts:31` raises the rate limit to 1,000,000 for the whole suite, so the limiter is worked *around* rather than tested. Login itself is used as a fixture in 45 files and asserts only `status === 200`.

**Impact.** The untested list includes **refresh-token rotation and reuse detection** (`auth.service.ts:198-211` — revokes every session on replay, the highest-value auth control in the system), the `enforcePasswordChange` gate mounted on ~25 routers, and `passwordChangedAt` access-token invalidation — the only thing stopping a stolen access token outliving a password reset. Password reset is the sole well-tested auth flow.

---

#### H-39 · Login is enumerable via the lockout response, defeating the timing equalisation built to prevent it

- **Severity:** High · **Path:** `apps/backend/src/modules/auth/auth.service.ts:99-144`

**Evidence.** The unknown-address branch burns an equivalent bcrypt cycle and returns `INVALID_CREDENTIALS`. But it has **no counter**, while a real account increments `failedLoginAttempts` and returns `ACCOUNT_LOCKED` on the fifth attempt.

**Impact.** An attacker confirms whether any address is registered in 5 requests, undoing the property that `burnPasswordCycle` and the uniform reset messaging exist to provide. Lockout also lets an attacker deny service to any known user at will. A second, smaller leak sits above it: `lockedUntil` is checked *before* `comparePassword`, so an already-locked account returns without burning a cycle.

---

#### H-40 · Login rate limiting is disabled in production, and one shared bucket covers four credential endpoints

- **Severity:** High · **Path:** `apps/backend/src/modules/auth/auth.routes.ts:26-32, 51, 73, 80, 93`; `docs/DEPLOYMENT_MONHORUS_PROD.md:99-101`

**Evidence (verified).** `skipSuccessfulRequests` is **absent** from both limiters. The production default is 10 per 15 min per IP, counting *successful* logins — which is why production sets `RATE_LIMIT_CREDENTIAL_MAX=1000000000`, effectively disabling it.

`credentialLimiter` is a **single middleware instance** mounted on `/login`, `/forgot-password`, `/reset-password` **and** `/change-password`, so all four share one counter.

**Impact.** Two directions. With the limiter enabled at 10, an office behind one NAT address gets 10 combined logins + resets + password changes per 15 minutes for the entire staff. With it disabled (current state), `POST /auth/forgot-password` with a random address is an **unauthenticated 250 ms-of-CPU request with no ceiling** — `burnPasswordCycle` runs a full bcrypt at cost 12, on a host shared with four other production sites. All three documents discussing this decision reason only about `/login` and never note the other three endpoints. The in-memory store also means the ceiling multiplies by instance count under any future scaling.

**Fix.** Add `skipSuccessfulRequests: true`, re-enable at a sane value, and give `/forgot-password` its own stricter bucket.

---

#### H-41 · The zone (ROOM) level exists only in the backend; no client can create or select one

- **Severity:** High · **Application:** All clients · **Feature:** Zones
- **Path:** `apps/web/src/services/object.service.ts:110, 114` (uncalled); `apps/web/src/features/service-requests/useLocationChain.ts:19-22`; `apps/mobile/lib/.../create_request_sheet.dart:55-59`

**Evidence.** A zone is an `ObjectNode` with `kind: 'ROOM'`, with full tenant-scoped CRUD and delete-blocking on the backend. **No client reaches any of it.** `createNode`/`updateNode` exist in the web service layer and are never called; there is no `deleteNode` wrapper and no route. The service-request form slices the hierarchy `PROJECT → FLOOR` inclusive and omits `roomId`, pinned by tests. The customer app's zone picker was deliberately removed, with a regression test. `grep -rn "objects/nodes" apps/mobile/lib apps/mobile-employee/lib` → **0 hits**.

**Impact.** `ServiceRequest.room` is always `null` in practice, while all three clients render a "Өрөө/бүс" row that can never be populated. A tested, scoped, delete-blocked CRUD surface is dead weight — and `ServiceRequest.device` is downstream of it (`ROOM → PANEL → CIRCUIT → DEVICE`), so the fault-equipment link is unreachable too.

---

### 5.7 Supply chain, tooling and client resilience

---

#### H-42 · Production dependencies carry 1 critical and 3 high advisories, all from one chain that a single bump clears

- **Severity:** High · **Application:** Backend · **Feature:** Dependencies
- **Path:** `apps/backend/package.json:26` (`bcrypt: ^5.1.1`)

**Evidence (measured, not inferred).**

```
$ npm audit --omit=dev
6 vulnerabilities (2 moderate, 3 high, 1 critical)

$ npm ls tar --omit=dev
monhorus@0.1.0
└─┬ @monhorus/backend@0.1.0 -> ./apps/backend
  └─┬ bcrypt@5.1.1
    └─┬ @mapbox/node-pre-gyp@1.0.11
      └── tar@6.2.1
```

`tar@6.2.1` carries twelve advisories including **critical** arbitrary file creation/overwrite via hardlink path traversal, plus symlink poisoning, parser-differential file smuggling and several uncatchable DoS paths. These are **production** dependencies (`--omit=dev`), reaching the deployed server through `npm ci --omit=dev`.

The same chain also drags in five deprecated packages (`rimraf@3`, `glob@7`, `inflight`, `npmlog@5`, `gauge@3`).

**Problem.** `bcrypt@5` uses `@mapbox/node-pre-gyp` for native-binary installation. **`bcrypt@6` dropped `node-pre-gyp` entirely**, so one major bump removes the whole chain.

**Impact.** `tar` is not on a request path here — it is install-time tooling — so exploitation requires an attacker-controlled archive during install rather than at runtime. But it is a critical advisory shipping to production with a one-line fix, and it is the kind of finding that blocks a security review.

Separately: `nodemailer@6.9.16` carries a **high** advisory (SMTP command injection via CRLF) — relevant given the mail feature is about to be deployed — and `react-router-dom` a moderate open-redirect→XSS. `crypto-js@4.2.0` ("development discontinued") and `jpeg-exif@1.1.4` arrive via `pdfmake → @foliojs-fork/pdfkit` with no clean fix available.

**Reproduction/verification.** `npm audit --omit=dev` at the repo root.

**Recommended fix.** Bump `bcrypt` to `^6`, re-run `npm audit --omit=dev`, and verify the cost-12 hashing behaviour is unchanged (the hash format is stable across the major). Bump `nodemailer` before deploying the mail feature.

**Existing tests.** `password.util.ts` behaviour is exercised indirectly by every auth test, so a bcrypt bump is well covered.
**Missing tests.** `npm audit --omit=dev` as a CI gate.

---

#### H-43 · `npm run lint` is a complete no-op — there is no ESLint in this repository

- **Severity:** High · **Application:** Tooling · **Feature:** Static analysis
- **Path:** `package.json:19`; `turbo.json`

**Evidence (verified three ways).**

```
$ grep -l "eslint" package.json apps/*/package.json packages/*/package.json
NONE
$ ls .eslintrc* eslint.config.* apps/*/.eslintrc* apps/*/eslint.config.*
NONE
$ grep -n '"lint"' package.json apps/*/package.json packages/*/package.json
package.json:19:    "lint": "turbo run lint",
```

**No package.json in the repository references eslint, no package defines a `lint` script, and no ESLint config file exists anywhere.** The root script delegates to a turbo task that no workspace implements, so it exits successfully having done nothing.

**Impact.** The command that a developer or a future CI pipeline would reasonably trust to catch unused variables, floating promises, missing `await`, exhaustive-deps violations and unsafe casts **passes unconditionally**. Six `// eslint-disable-next-line` directives are consequently inert — `use-table-columns.ts:119,184`, `use-authorised-file-urls.ts:56`, `express.d.ts:47`, `pdf.renderer.ts:17` — which means someone believed linting was running.

This is directly implicated in findings already in this report: the unhandled promise rejection at `ObjectFormPage.tsx:300-318` (M-47), the missing race guards at P-4, and the dead exports catalogued in §19 are all standard lint output.

**Note:** Dart is fine — both apps have `analysis_options.yaml` with `flutter_lints ^5.0.0`.

**Recommended fix.** Add ESLint with `@typescript-eslint` and `eslint-plugin-react-hooks` to `apps/backend` and `apps/web`, and gate it in CI. Expect a substantial first-run backlog.

---

#### H-44 · A model-parsing `TypeError` escapes the mobile transport layer and becomes an undiagnosable generic error

- **Severity:** High · **Application:** Both mobile apps · **Feature:** Networking / resilience
- **Path:** `apps/mobile-employee/lib/core/network/dio_client.dart:183`; `apps/mobile-employee/lib/features/employee/project/data/repositories/project_repository_impl.dart:45-50`

**Evidence.** `decoder(responseBody['data'])` is called inside a `try` whose only handler is `on DioException`. A `_TypeError` raised by a model cast is **not** a `DioException`, so it passes straight through the transport layer and is caught by the repository's catch-all, which flattens it to:

```dart
ServerFailure('Гэнэтийн алдаа гарлаа.', code: 'UNKNOWN')
```

**Problem.** The highest-risk parse sites are hard casts with no fallback: `create_user_request.dart:77` (`json['items'] as List`, while every sibling field uses `?? n`), `user_model.dart:26-28` in **both** apps (three hard casts on the login and `/auth/me` path), `auth_session_model.dart:40-41` in both, and `dio_client.dart:264-266` in the 401-refresh path. Roughly 30 `json! as Map<String, dynamic>` casts in the data sources throw on a `204` or a `data: null` response.

**Impact.** One missing or renamed backend field turns an entire screen into a generic "Гэнэтийн алдаа гарлаа." with **no log, no field name, and no way to distinguish it from a real server fault**. This is the failure mode that makes H-24-class drift expensive to diagnose, and it sits on the login path in both apps.

**Recommended fix.** Catch `TypeError`/`FormatException` around `decoder(...)` and surface a distinct `ParseFailure` naming the offending field; replace the hard casts on the auth path with guarded reads.

---

## 6. Medium Findings

| # | App | Feature | Path | Problem | Impact |
|---|---|---|---|---|---|
| M-1 | Backend | Planned work | `planned-work.transition.service.ts:173` vs `:184-185` | Permission+status check runs *before* the tenancy assert; `assertTransitionAllowed` names the foreign work's status in the error | Cross-tenant existence + status oracle; 400 vs 404 distinguishes records a customer must not know about. Two-line reorder |
| M-2 | Backend | Storage | `storage.service.ts:27-36, 54-65` | File type validated by client-declared MIME only; no magic bytes | Arbitrary bytes stored and re-served labelled `image/png`. Mitigated by `nosniff`, no HTML/SVG in the allow-list, and `attachment` for non-images |
| M-3 | Backend | Storage | `auth.routes.ts:26` is the only limiter | No rate limit on any upload endpoint; any portal user can POST 10 MiB in a loop | ~400 requests fills a disk at 83%, taking Mongo and the API down |
| M-4 | Backend | Storage | `storage.routes.ts:726`, `project.routes.ts:426`, `planned-work.routes.ts:329`; `:634` | Three routes run `upload.single` *before* `validate` and don't clean up on rejection; company logos are never claimed | Permanent orphan files, no GC job, no TTL on `StoredFile`. Every logo re-upload orphans 2 MB |
| M-5 | Backend | Errors | `error-handler.middleware.ts:20-84` | `MulterError` and `BSONError` are not normalised | An 11 MB upload is a 500, not 400; `GET /employees/zzz/documents` is a 500 (missing params schema at `storage.routes.ts:705`) |
| M-6 | Backend | PDF | `report-pdf/pdf.renderer.ts:45-58`; `report-images.ts:150-157` | Generation is synchronous on the single event loop; unbounded task count × unthrottled parallel sharp decodes | A large report stalls **every** request including `/health`; plausible OOM |
| M-7 | Backend | PDF | `pdf-template.ts:111-119` | Font assets resolve to `../../../src/assets`; `tsc` does not copy `.ttf` into `dist/` | PDF export breaks silently on any move to a `dist`-only artifact |
| M-8 | Backend | Export | `report.routes.ts:113-133` | `GET /inspections?format=csv` gated on `object_master.view` only; the sibling route separates `report.export` | A technician exports 5,000 rows of conclusions; policy inconsistency |
| M-9 | Backend | Transactions | `employee-access.service.ts:251-273`; `service-request.service.ts:367-418`; `storage.routes.ts:744-773` | Three multi-collection writes unwrapped on a session-capable deployment | Account created without its employee link and **un-retryable** (the email guard then refuses); attachments permanently undownloadable; orphaned file rows |
| M-10 | Backend | Transactions | `report-record.service.ts:196-235` | `syncItems` upserts in a loop then prunes, no session | A crash mid-loop leaves a report mixing old and new findings |
| M-11 | Backend | Sorting | 13 list services | Only `report-query.service.ts:123` has an `_id` tiebreaker | Rows can appear on two pages or neither during ordinary paging. One line each |
| M-12 | Backend | Lists | `object.routes.ts:166`, `service-agreement.routes.ts:118`, `dispatch.routes.ts:94`, `object-master.service.ts:1811` | Bare arrays with a limit but no `skip` and no total | Client cannot distinguish complete from truncated. `/objects/nodes` loses floors from the create-request form past #100 |
| M-13 | Backend | Lists | `project-graph.service.ts:123-133`, `diagram.service.ts:197`, `org.service.ts:602-617`, `invoice.service.ts:344`, `load.service.ts:179` + 6 more | Truly unbounded collections returned | `/projects/:id/graph` serialises every object in a project. `/org/teams` validates `page`/`limit` and then ignores both |
| M-14 | Backend | Response shape | 13 endpoints | Bare array vs `PaginatedData` envelope | This shape choice is *what makes* the truncation in M-12 silent |
| M-15 | Backend | Reports | `inspection-report.service.ts:729-748` vs `:794-810` | `returnReport` does not clear `approvedBy/Name/At`; `reopenReport` does | `APPROVED → RETURNED → edit → SUBMITTED` leaves the approver's signature on content they never saw, at the same version, printed into the statutory PDF signature block |
| M-16 | Backend | Assessments | `object-master.service.ts:1675-1680` | Assessments are written `status: 'APPROVED'` with no review step | A unilateral field score moves object/floor/building rollups. Held by TECHNICIAN |
| M-17 | Backend | SLA | `service-request.service.ts:803-835` | `extendSla` has no status guard at all | SLA breach history is retroactively editable; `LATE` flips to `WITHIN_SLA`. UI-only guard at `ServiceRequestDetailPage.tsx:143` |
| M-18 | Backend | Conclusions | `work-report.service.ts:229-231` | Three conclusion routes authorise with `includeUnclaimed: true` | Conclusions writable on unclaimed requests, contradicting the module's own stated write policy |
| M-19 | Backend | RBAC | `permissions.ts:52, 262` | `service_request.cancel` and `portal.profile.view` are enforced by nothing | An admin revoking `service_request.cancel` believes they removed an authority; cancelling actually rides on `change_status` |
| M-20 | Backend | RBAC | `rbac.service.ts:83` | `Role.updateMany({}, {$pull: …})` runs on **every** boot against **every** role including custom | A backend rollback to an older build strips newer permissions from custom roles; rolling forward does not restore them, and the convergence script never touches custom roles |
| M-21 | Backend | RBAC | `converge-technician-permissions.ts:89-92` vs `permissions.ts:642-686` | `TECHNICIAN_APP_PERMISSIONS` is stale — 2 keys where the default now carries 7 | On any upgraded database technicians silently lack `self_progress`; the app simply draws no progress buttons. No 403, no message |
| M-22 | Backend | Users | `user.service.ts:100-103, 185, 423` | `POST /users` and `/reset-passcode` echo the plaintext passcode | Lands in HAR exports and proxy logs for a credential about to be live. The parallel employee path hashes and returns no credential |
| M-23 | Backend | Users | `role-assignment.service.ts:674-682, 502-507` | The permission ceiling runs only for accounts that already exist | A narrow `admin` can create an account stronger than itself and receives its passcode. Bounded by `canManageRole`, so lateral not vertical |
| M-24 | Backend | Employees | `employee.schema.ts:225-228`; `employee.service.ts:229-236` | `status` is writable through `PATCH /employees/:id` under `employee.update` | Bypasses the completeness and termination-date rules the dedicated `/status` route enforces. The web edit form ships the dropdown |
| M-25 | Backend | Customers | `object.schema.ts:31-33`; `object.service.ts:157-166` | `code` is editable on update; the UI is the only guard | Breaks every printed invoice and contract reference. Org and project codes are correctly unwritable |
| M-26 | Backend | Employees | `employee.service.ts:148-155` | Manager cycles: only self-reference is blocked, no ancestor walk | `A→B→A` accepted; any future org-chart or approval-chain feature loops |
| M-27 | Backend | Object master | `object-master.routes.ts:373-375` vs `:153-155, :242-244` | `/objects-master/:id/history` requires `object_master.view`; both siblings accept the portal key | The customer app calls it unconditionally → the equipment timeline **403s on mobile** and does not exist on web. One-word route fix |
| M-28 | Backend | Diagram | `diagram.routes.ts:132-153`; `diagram.service.ts:343-362` | `PATCH /diagrams/:id/active-step` persists shared state under the **read** permission, unaudited | Any technician/sales/finance user can permanently change what the whole installation's dashboard shows. Currently uncalled by any client |
| M-29 | Backend | Diagram | `diagram.service.ts:262-318` | Full-document replace, no version, no `If-Match` | Two editors silently destroy each other's work; the audit log stores counts only, so loss is unrecoverable by design |
| M-30 | Backend | Diagram | `diagram.service.ts:216-221` | "The dashboard's diagram" is whichever was saved most recently | Creating a second diagram silently re-points the dashboard installation-wide |
| M-31 | Backend | Agreements | `service-agreement.routes.ts:280` | No transition table; refuses only "already in this state" | `CANCELLED → ACTIVE` is reachable. `agreementNumber` is also client-supplied, and `nextAgreementNumber` is a read-then-write max scan rather than the atomic counter used elsewhere |
| M-32 | Backend | Concurrency | `versionKey:false` on all transition-bearing models | No optimistic concurrency anywhere; all transitions are read-check-`save()` | Two concurrent calls can both pass `canTransition` and both write. Mitigated: claim is genuinely atomic, report writes dedupe by `sourceId` |
| M-33 | Backend | Planned work | `planned-work.service.ts:688` vs `:705` | The status filter rebuilds `filter.plannedEndDate`, discarding the caller's `from` | "PLANNED work in June" silently becomes "PLANNED work ending from now on" |
| M-34 | Backend | Reports | `report.service.ts:868-873` | `buildReport` takes no scope argument | `AUDIT_LOG` exports `user`, `role`, `reason` and **`ip`** across every tenant; `CUSTOMER` exports every customer's receivables. Safe only because no customer role holds `report.view`; SALES does |
| M-35 | Database | Uniqueness | `employee.model.ts:156-163, 228-237` vs `org.models.ts:57-58, 86, 115` | `Employee.employeeCode/email/icCardNumber/attendanceNumber` are **globally** unique while sibling org codes are per-Company | Two legal entities cannot both issue code `E-001`, though both can use department code `ELEC`. `Company` is nullable on Employee |
| M-36 | Database | Tenancy | `report-record.model.ts:88, 206` | `Report.customer` and `ReportItem.customer` are nullable | Fails closed, so no leak — but a null-customer row is invisible to every tenant-scoped query and nothing detects it |
| M-37 | Database | Indexes | 6 declarations vs 0 `$text` queries (verified) | Six text indexes maintained; every search is an unanchored `/x/i` regex | Pure write amplification **and** a full collection scan on every search. Worst case regexes two 8,000-char fields |
| M-38 | Database | Indexes | `service-request.model.ts:125-129`; `object-master.models.ts:207-208`; `object-master.service.ts:409` | `ServiceRequest.floor/room/panel/circuit/device`, `circuit.start/endPointObject`, and `latestAssessment.riskLevel` are queried and unindexed | Every floor DTO and object-detail load scans `servicerequests` and `objects`. Meanwhile `Object.status` *is* indexed and never filtered |
| M-39 | Database | Migrations | `scripts/rename-task-conclusion-to-note.ts:42, 73` vs `planned-work.models.ts:359-363` | The script renames `conclusion`→`note`, but `conclusion` was later re-introduced with a different meaning | Still listed as runnable in the production runbook; would overwrite a real Дүгнэлт as a Тайлбар. Should be deleted |
| M-40 | Database | Migrations | `sync-indexes.ts:56` vs `converge-system-role-permissions.ts:141` | Two opposite CLI conventions in one directory; the **only destructive** script is the one that defaults to applying | Muscle memory from `--apply` drops indexes with no preview |
| M-41 | Database | Seeds | `config/env.ts:27, 80` | `SEED_DEV_PASSWORD` has a hardcoded default and the guard keys on `NODE_ENV`, which **fails open** to `development` | A staging box with `NODE_ENV` unset seeds a fleet of working accounts on a password public in this repository |
| M-42 | Web | Auth | `api-client.ts:97-117` | A 401 on the *replayed* request never clears the session | The user sits in a rendered shell where every request fails, with no redirect to login |
| M-43 | Web | Errors | `api-client.ts:91, 119-122` | For `responseType: 'blob'`, `error.response.data` is a `Blob`, so `payload.message` is `undefined` | Failed CSV/PDF downloads render a **blank** error toast/banner |
| M-44 | Web | Lists | `object.service.ts:63-69` + 8 call sites | `customers()` hardcodes `limit: 100` and discards `page.total`; no caller passes a search | Past customer #100: cannot create a service request, planned work, project or object for them. The correct pattern already exists at `TaskFormDrawer.tsx:187-192` |
| M-45 | Web | Forms | `AgreementDrawer.tsx:109, 241`; `InvoiceFormDrawer.tsx:33-36` | `Number('' \|\| '0')` → a blank "required" field becomes a legitimate `0` | Zero-fee contracts and zero-price invoice lines created silently — and that fee drives monthly generation |
| M-46 | Web | Forms | `GenerateInvoicesDrawer.tsx`, `InvoiceFormDrawer.tsx:258`, `WorkReportPanel.tsx` | Field errors are computed but not rendered on the control | Clearing a material quantity blocks the save with **nothing on screen saying why** |
| M-47 | Web | States | 10 call sites using `.catch(() => undefined)` / `setX([])` | Secondary/option fetch failures are indistinguishable from "empty" | Audit facets, calendar employees, object types, assignees and floor equipment all read as "none exist" on failure. `ObjectFormPage.tsx:300-318` has *no* catch and clears the user's selection |
| M-48 | Both mobile | Config | `app_config.dart:27-39`; `android/app/build.gradle.kts:55-63`; both apps' debug manifests | A release build with no `--dart-define` ships pointing at `10.0.2.2:4000`; a release build with no `key.properties` is silently **debug-signed**; the debug NSC override is inert because `usesCleartextTraffic` is ignored when a network-security-config is present | Two silent release footguns and a broken local debug loop, each one guard away from being loud |
| M-49 | Backend | Finance | `invoice.service.ts:276-279` (`setUTCHours(0,0,0,0)`) vs `dashboard.service.ts:367` (`dayBounds(now, env.APP_TIMEZONE).start`) | The invoice module computes the overdue day boundary in **UTC**; the dashboard computes it in **Asia/Ulaanbaatar** (UTC+8) | For eight hours of every day the receivables list and the dashboard finance tile disagree about which invoices are overdue. Two code paths for one number, which the dashboard's own neighbouring comment says "must never disagree" |
| M-50 | Employee Mobile | Tests | `apps/mobile-employee/integration_test/live_api_test.dart:20-22, 117-120, 150-160` | A **head-admin password is committed in plaintext**; the file opens a second Dio against a hardcoded `http://127.0.0.1:4000/api/v1` and calls `POST /users/:id/reset-passcode` against a real account | Excluded from `flutter test` (which scans only `test/`), so it is not a live risk — but the credential is in git history and must be rotated. Also broken on Android by construction and split-brains under `--dart-define` |
| M-51 | Web | Dead code | `apps/web/src/features/diagram/**` (7 files, **2,332 lines**); `DashboardDiagramPanel.tsx:58` | The feature's only root is `DashboardDiagramPanel`, and `grep -rn 'DashboardDiagramPanel' apps/web/src docs` returns **only its own definition** — nothing routes to it | The entire web diagram feature is unreachable, which means the backend `modules/diagram/` module and the `DIAGRAM_VIEW`/`DIAGRAM_MANAGE` permissions have no consumer at all. It also keeps `@xyflow/react` in the entry chunk for one remaining live file (`FloorPlanCanvas.tsx`) |

---

## 7. Low Findings

| # | App | Path | Problem |
|---|---|---|---|
| L-1 | Backend | `utils/jwt.util.ts:53-56` | `jwt.verify` does not pin `algorithms`. Not exploitable in jsonwebtoken 9 (verified in `node_modules`); hardening note only |
| L-2 | Backend | `planned-work.service.ts:960-966, 1433-1439` | `reschedulePlannedWork` / `setPlannedMaterials` use bare `findRaw`, skipping the scope convention. Masked today by oversight keys |
| L-3 | Backend | `planned-work.routes.ts:200` | Transition returns 404-before-403, an existence oracle for callers lacking the action |
| L-4 | Backend | `report.routes.ts:76-84` | One 403 is hand-built inline, bypassing the central handler's structured logging |
| L-5 | Backend | `report.service.ts:105` | `totalPages` uses `total === 0 ? 0 : …` while 18 other endpoints use `Math.max(1, …)` |
| L-6 | Backend | `report.service.ts:1045`, `inspection.service.ts:442` | No CSV formula-injection neutralisation (`=`,`+`,`-`,`@` prefixes). Quoting is correct RFC 4180 |
| L-7 | Backend | `notification.model.ts` | No TTL and no purge job; one row per recipient per event, forever |
| L-8 | Backend | `planned-work.overdue.service.ts:137` | The overdue sweep is `.limit(1000)` per hourly tick, so a backlog drains at 1000/hour |
| L-9 | Backend | `project.service.ts:72-73, 786, 956` | Staff creator names reach customers via `CREATOR_POPULATE`; `ObjectDetailDto` exposes `notes` |
| L-10 | Backend | `material.routes.ts:44` | `service.listMaterialItems(req.query as never)` defeats boundary type-checking |
| L-11 | Backend | `service-agreement.routes.ts:104` | `status: z.string().optional()` rather than an enum — an unmatched value silently returns `[]` |
| L-12 | Backend | `object-master.service.ts:526-543` | Three child lookups omit the customer predicate. Not exploitable (parent is scoped); defence in depth |
| L-13 | Backend | `object-master.service.ts:926-1032` | `quick-place` never checks `type.showOnPlan`; the rule lives only in the web picker → a permanently invisible pinned object |
| L-14 | Backend | `floor-plan.service.ts:89-108` vs `:259-288` | On an archived floor the plan can be deleted but not re-uploaded |
| L-15 | Backend | `floor-plan.service.ts:33` | PDF is accepted as a plan format but never rasterised; all four clients degrade gracefully but placement is impossible |
| L-16 | Backend | `floor-plan.service.ts:133-221` | No image processing at all — no resize, no dimension cap, no thumbnail. `sharp` is used only by the PDF renderer. Risk is displaced onto clients and cellular data |
| L-17 | Backend | `diagram.service.ts:196-199`; `diagram.model.ts:134-135`; `project-graph.service.ts:133` | `GET /diagrams` is unbounded and uncalled; `DiagramNode.object` is an unvalidated dead reference; the project graph is unbounded and uncalled |
| L-18 | Backend | `error-handler.middleware.ts:44-48, 103-110` | Mongoose `ValidationError` messages name schema paths and enum members; `err.keyValue` (often an email) is logged unredacted |
| L-19 | Backend | `server.ts:33-45` | Shutdown omits `closeIdleConnections()`, so the 10 s force-exit is the *normal* path; `shutdown()` is not re-entrant and corrupts the exit code |
| L-20 | Backend | `authenticate.middleware.ts:41-43, 120` | `enforcePasswordChange` re-queries `status` that `authenticate` loaded one line earlier and discarded — a redundant round trip per request |
| L-21 | Backend | `sync-indexes.ts:100-108` | `created` accumulates total live indexes, so the run log cannot confirm a new index was built. This is why the docs disagree (205 vs 207) |
| L-22 | Backend | `scripts/migrate-reports.ts:41-42` | Documents an npm alias (`migrate:reports`) that does not exist |
| L-23 | Backend | `report.service.ts:212-216, 801-806` | `.populate()` chained onto `countDocuments()` — a no-op |
| L-24 | Database | `object.models.ts:173` | `ObjectNode.code` lacks `uppercase: true`, so its per-tenant unique index is case-sensitive. Every other code field normalises |
| L-25 | Database | `user.model.ts:60-68` | `User.email` is globally unique while `User.customer` is the tenant — forced by the auth design, but a real onboarding constraint |
| L-26 | Database | 8 schemas | `versionKey` inconsistently omitted, so optimistic-concurrency behaviour differs across collections for no stated reason |
| L-27 | Database | `audit-log.model.ts:62-66`; `DEPLOYMENT_UBUNTU.md:243` | The model instructs revoking update/delete at the DB-user level before production; the runbook grants plain `readWrite` on the whole database |
| L-28 | Web | `token-storage.ts:7-15` | Tokens in `localStorage` (acknowledged, "revisit before launch"). The named mitigation — a strict CSP — is absent; the SPA has no CSP at all. Table/sidebar prefs and the risk-band cache are not cleared on logout |
| L-29 | Web | `App.tsx:493` vs `navigation.ts:257` | `/access` accepts `RBAC_VIEW` **or** `USER_VIEW`, but the page loads roles unconditionally and the Users tab needs an admin *tier* the frontend never mirrors → a permanently 403ing tab |
| L-30 | Web | `App.tsx` (absent), `vite.config.ts` | Zero code splitting: 61 static imports → one 1.31 MB chunk, with `leaflet` and `@xyflow/react` on the login page. Users are field staff on mobile networks |
| L-31 | Mobile | `apps/mobile/lib/main.dart:63-68`; `login_screen.dart:163-165`; icon maps | The customer binary ships a full user-administration client gated on a client-side **role** check (backend correctly refuses); no forgot-password UI though the backend has one; `BREAKER` uses a filled glyph in the customer app and outlined everywhere else; an unknown icon key renders a blank `<svg>` on web while both phones fall back to OTHER |
| L-32 | Web / shared | `packages/shared/src/**`; `apps/web/src/services/material.service.ts:19`; `components/ui/States.tsx:64`; `routes/RoleGuard.tsx:18`; `docs/archive/**` | ~100 exports in `packages/shared` have zero references (11 dead functions, 17 unused zod schemas, ~45 request-DTO types superseded by `z.infer`); the `/materials` backend module plus its complete web client are reachable from **no screen**, so material names are free text and two spellings never reconcile; 15 dead `.ts`/`.tsx` files sit in `docs/archive/` and ship to production in the deploy tarball. **Do not prune the shared constants blind** — seven of the "dead" tables are the canonical record the Dart mirrors are transcribed from, and should become parity-test inputs instead |
| L-33 | Customer Mobile | `apps/mobile/test/customer_portal/customer_portal_models_test.dart:287` | The test asserts `NotificationEvent.values.length == 17` while the shared constant defines 18 — the assertion **locks in** the missing `SERVICE_REQUEST_UNCLAIMED` event rather than catching it | A dispatcher's "nobody has claimed this" alert renders as a blank row in both apps, and the test guarantees it stays that way |

---

## 8. End-to-End Flow Map

### Authentication

```
User → Client → POST /auth/login → credentialLimiter → zod → auth.service.loginUser
     → User.findOne(+password) → bcrypt(12) → Session{tokenHash: sha256} → {access 15m, refresh 30d}
     → client secure storage → every request: authenticate → User.findById → permissions from DB
```

**Works:** JWT with separate access/refresh secrets, `iss`/`aud`, and a `type` claim asserted in both verifiers, so a refresh token cannot be presented as an access token. Refresh tokens stored **only** as SHA-256 digests, rotated on every use, with replay revoking *every* session and writing a `TokenReuseDetected` audit row. `authenticate` re-reads the user each request and rejects tokens minted before `passwordChangedAt` — this is what makes a 15-minute access token safely revocable. **`permissions`, `customerId` and `employeeId` are never in the token**; they are resolved server-side per request, so there is no stale-authority window and no forgeable claim.

**Broken:** account enumeration via the lockout response (H-39); rate limiting disabled in production and shared across four endpoints (H-40); no test coverage of refresh, rotation, reuse detection, logout or lockout (H-38); cross-tab refresh collisions trigger mass revocation (H-26); a 5xx on the customer app is reported as "no network" and opens a stale session (H-22).

**Authorization happens at:** `authenticate` (identity + status + password-change epoch) → `enforcePasswordChange` → `requirePermission`/`requireAnyPermission` → `resolveCustomerScope` inside the query.

---

### Password change / `must_change_password`

**Verified complete.** All 24 business routers mount `enforcePasswordChange` immediately after `authenticate` — I checked every router registered in `routes/index.ts:39-66` against its mount site. The complete reachable surface while the flag is set is `/auth/{login,refresh,logout,forgot-password,reset-password,me,change-password}` and `/health`: exactly what is needed to resolve the state. All three clients also enforce it at the root, redundantly, which is the right arrangement.

**Residual risk:** mounted 25 times by hand with no app-level fallback and **no completeness test** — contrast `role-assignment.invariant.test.ts`, which fails the build for the equivalent RBAC mistake.

---

### User / Role / Permission

```
Admin → UI → POST/PATCH /users → authorize('admin','head_admin') → user.manage
     → assertCanManageRole → role-assignment chokepoint (the ONLY write to user.roles)
     → self-refusal → tier authority → protected → rbac.manage → ceiling → coherence → last-admin
```

**Works — the strongest area in the codebase.** Self-escalation is refused **first**, before any rule that could be argued around on the way to it (the code records the original exploit). Permission ceiling: an actor cannot grant keys beyond its own set plus the target tier's defaults. Tier/role coherence is enforced in both directions and on both the assignment and the role-*edit* path — closing the "edit the role underneath the accounts that hold it" route. `head_admin` mutations require a separate `rbac.manage_protected`, with an audit row on refusal as well as grant. A build-failing invariant test rejects any second write path to `user.roles`.

**Broken:** provisioning is uncapped, so a narrow admin can create an account stronger than itself and receives its passcode (M-23); two permissions are enforced by nothing (M-19); shipped permission defaults never reach an existing database, and the compensating script is stale (M-21).

---

### Service Request

```
Customer (portal / customer mobile) → POST /service-requests → owner forced from session
  → location chain re-verified node by node → status forced NEW, SLA computed server-side
  → Dispatch (dispatch.assign) OR technician claim (atomic findOneAndUpdate, loser 409)
  → Employee mobile: status transitions bounded by self-progress policy + assignment scope
  → Conclusion (service_request.update) → submit → approve → APPROVED
  → Customer: GET /:id/report/customer → 404 unless APPROVED, hand-built DTO
```

**Works:** the state machine is genuinely server-enforced (`canTransition` against the shared table, with authority checked before legality). Body `customerId` mismatch is a 403, not a silent rewrite. Attachments are verified to be files this account uploaded and not yet claimed, closing both the byte leak and the metadata leak. The customer conclusion route is the **correct pattern in this codebase** — separate route, 404 unless APPROVED, DTO composed field by field.

**Broken:** the detail DTO is not narrowed per audience, and the customer mobile app renders what the web portal deliberately hides (H-4); a mobile conclusion save destroys web-entered fields (C-3); SLA history is retroactively editable (M-17); conclusions are writable on unclaimed requests (M-18); the web console offers transitions a technician cannot perform and hides reassignment the backend allows (M-19 family).

---

### Planned Work

```
Create (staff or portal) → forced DRAFT, empty crew, own tenant
  → PLAN (submit) → PENDING_APPROVAL → APPROVE (crew chosen here; empty crew refused) → PLANNED
  → START → PAUSE/RESUME → COMPLETE → report created DRAFT → submit → approve → ARCHIVED
```

**Works:** the transition matrix lives in one shared file with `from[]`, `to`, `requiresReason`, `permission` and an optional `customerPermission`. **No create or update schema carries a `status` field**, so status is unreachable except through the transition endpoint. The web builds its buttons *exclusively* from the server-computed `availableActions` list — the correct architecture, and the direct contrast to the service-request screens. Both background jobs are idempotent by construction and safe under horizontal scaling despite no leader election.

**Broken:** editing a DRAFT work always 400s and past approval the same payload unassigns the crew (H-25); the employee app coerces `PENDING_APPROVAL`/`REJECTED` into approved-looking states and cannot approve or reject (H-24); reports and PDFs are readable cross-tenant (H-1); customers receive draft report bodies (H-3); the status filter discards the caller's date bound (M-33).

---

### Inspection → Report → Approval

There are **four independent report workflows**, and only one has a self-approval rule:

| Workflow | Author key | Approve key | Self-approval blocked? |
|---|---|---|---|
| `PlannedWorkReport` | `planned_work.submit_report` | `planned_work.approve_report` | **Yes** (`planned-work.report.service.ts:115-121`) |
| `InspectionReport` | same | same | **No** (H-5) |
| Consolidated `Report` | `object_master.assess` | `report.approve` | **No** (H-6) |
| `WorkReport` (SR) | `service_request.update` | `service_request.approve_report` | **No — granted to the author deliberately**, documented at `permissions.ts:654-657`; currently latent because no client draws the button, so **the mitigation is UI-only** |

**What the customer sees:** on the service-request path, **only APPROVED**, enforced server-side, correctly. On the planned-work path, **drafts too**, filtered in JSX (H-3). Same question, two answers.

---

### Organisation structure

Flat by construction — `Company → Department | Position | Team`, no self-referencing parent, so org cycles are impossible. **There is no delete endpoint anywhere** in org or employee; lifecycle is `isActive`/`status` throughout, which is a deliberate and sound choice.

**Broken:** deactivation has no enforcement (H-9); termination has no side effects (H-10); manager reporting lines can cycle (M-26); `status` is writable through the generic PATCH, bypassing the dedicated route's rules (M-24).

---

### Import / Export

**There is no import functionality anywhere in the system.** Verified: zero hits for `'/import`, `bulkCreate`, `importCsv`, `parseCsv`; no `csv-parse`, `papaparse`, `xlsx` or `exceljs` dependency; no import UI in any client. Every entity is created one at a time through its own validated POST. The entire sub-question — duplicate detection, partial-import transaction safety, row limits — has no code to audit. **This is a product gap worth surfacing: the system has nine CSV exports and no way back in.**

Export: two CSV endpoints and two PDF endpoints, all bounded, none dumping a whole collection. Defects at H-16 (silent truncation), M-8 (missing `report.export` gate), M-34 (no tenant scope on report exports) and L-6 (no formula-injection neutralisation).

---

### File upload / download

```
POST /files/<kind> → authenticate → permission → multer (10 MiB, MIME allow-list)
  → storageKey = randomBytes(24).hex → parked on uploader → claimed by the create call
GET /files/:fileId → authenticate → per-owner-type permission table → tenant resolution → stream
```

**This is the strongest single subsystem in the codebase** and I could not find a way to fetch a file by guessing an id. The permission table is a `Record<StoredFileOwnerType, PermissionKey[]>`, so adding an owner type without a mapping is a **compile error** — a new attachment kind can never default to readable. Tenant resolution walks the file back through its owning entity; `EMPLOYEE` and `PLANNED_WORK_TASK` hit an explicit `default: throw`. Refusals are reported as not-found. Path traversal is closed twice over (server-generated opaque keys *plus* a `base + path.sep` containment check). There is **no `express.static` anywhere in the backend**.

**Broken:** `employee.view` covers HR document downloads (H-7); MIME is client-declared (M-2); no upload rate limit (M-3); three orphan paths with no GC (M-4); `PLANNED_WORK_TASK` downloads carry no assignment scope (H-1).

---

## 9. Data Flow & Data Integrity

### Representative trace — Service Request

| Layer | Artefact | Verified |
|---|---|---|
| Frontend model | `CreateServiceRequestInput` from `packages/shared` | Web portal and admin use the **identical** schema; the Dart model transcribes it, including the phone regex and `description` min-5 |
| API request | `POST /api/v1/service-requests` | Field names match on all three clients |
| DTO / validation | `createServiceRequestSchema` (`.strict()`-adjacent; zod strips unknown keys) | No mass assignment possible |
| Controller | `service-request.routes.ts:64-87` | `requireAnyPermission(SERVICE_REQUEST_CREATE, PORTAL_…_CREATE)` |
| Service | `createServiceRequest` | Owner from session; body `customerId` mismatch → 403; every location node re-verified for kind, owner and parentage; attachments verified as caller-uploaded and unclaimed |
| ORM / DB | `ServiceRequest.create` + `StoredFile.updateMany` | **Not atomic** (M-9) |
| Response DTO | `toDetailDto` | **One DTO for staff and customers** (H-4) |
| Frontend state | portal hides fields in JSX; customer mobile renders them | **Divergence is the defect** |

### Integrity issues found

| Class | Findings |
|---|---|
| **Data loss** | C-2 (employee sub-records), C-3 (conclusion fields), H-25 (crew unassigned on edit) |
| **Data leakage** | H-1, H-2, H-3, H-4, H-7, H-8, M-34 |
| **Incorrect mappings** | Z3: `ServiceRequest.device` is *written* as an `ObjectNode` and *read* as an `ObjectRecord` (`service-request.model.ts:129` vs `object-master.service.ts:511`) — the delete-blocker can never fire and the two hierarchies are disconnected |
| **Incorrect relationships** | H-11 (orphaned `ReportItem.object`, a required field), plus `Report.project/building`, `ReportItem.floor`, `PlannedWorkTask.floor` |
| **Duplicate data** | H-30 — without the manual index step, duplicate invoices, duplicate reports and duplicate user emails are all accepted |
| **Stale data** | H-13 (marker coordinates after an aspect-ratio change), H-12 (pin retained across a floor move) |
| **Race conditions** | M-32 (no optimistic concurrency), M-29 (diagram last-write-wins), H-26 (refresh collision). *Correctly handled:* request claim, unclaimed sweep, overdue sweep, code counters, reset-token claim |
| **Incorrect pagination** | H-14, H-15, H-16, H-17, H-18, H-20, H-21, M-11, M-12 |
| **Tenant isolation** | **Boundary itself is sound.** Gaps are at the edges: check *ordering* (M-1), DTO *composition* (H-3, H-4), and four modules with no scope resolver at all (H-2 and the invoicing/agreement/report set) |

**Sensitive fields exposed to clients:** national ID in the employee list (H-8); tax IDs and contacts in the customer list (H-2); monthly fees in the agreement list (H-2); internal `returnReason` and staff identities to customers (H-3, H-4); `ip` addresses in the audit CSV export (M-34).

**Verified NOT exposed:** `User.password` is `select: false` **and** deleted in a `toJSON` transform, and every read path serialises through a single allowlist DTO. Session and reset-token hashes never leave the server. Salary is double-gated — the query is *skipped entirely* without the key, and the DTO key is **omitted rather than nulled**. No SMTP or JWT secret is reachable through the settings module.

---

## 10. Cross-Application Consistency

| Feature | Web / Admin | Customer Portal | Employee Mobile | Customer Mobile | Backend |
|---|---|---|---|---|---|
| Token storage | `localStorage` | `localStorage` | Keychain / EncryptedSharedPrefs | Keychain / EncryptedSharedPrefs | — |
| 401 → refresh → replay | ✅ (no cross-tab lock — H-26) | ✅ same | ✅ single-flight | ✅ single-flight | ✅ rotation + reuse detection |
| 5xx handling | ✅ typed `ApiError` (blank on blobs — M-43) | ✅ same | ✅ `ServerException` | ❌ **"no network"** (H-22) | — |
| Session expiry UX | ❌ no notice (L-28) | ❌ no notice | ✅ | ⚠️ stale-session fallback (H-22) | — |
| SR status vocabulary | ✅ imports shared | ✅ imports shared | ✅ **hand copy, exact match** | ✅ match | ✅ canonical |
| PW status vocabulary | ✅ imports shared | ✅ imports shared | ❌ **2 of 9 missing, coerced** (H-24) | n/a (no PW screens) | ✅ canonical |
| PW approve/reject | ✅ | ✅ | ❌ **absent** (H-24) | n/a | ✅ |
| Permission source | `/auth/me`, never cached | same | `/auth/me` | `/auth/me` | DB per request |
| Empty permission set | n/a | n/a | ⚠️ **two features disagree** — Project tab treats it as "unknown", Work tab as "refused" and tells the user to contact an admin | n/a | — |
| Pagination | server-side; several `limit:100` truncations | ✅ server-side, correct `limit:1` + `total` idiom | ❌ page 1 only, `hasMore` never called | ❌ page 1 only (buildings fixed) | mixed (H-14…H-17) |
| Floor-plan coordinates | 0..1, centred, `1/zoom` | same | same | same | `.min(0).max(1).strict()` |
| Floor-plan objects | page-walk to 2,000 | page-walk to 2,000 | **100, one page** | **100, one page** | `limit` max 100 |
| Zoom range | fit … 8× | static | 1 … 5× | 1 … 5× | — |
| Label threshold | zoom ≥ 0.9 | always | zoom ≥ 2.0 | zoom ≥ 2.0 | — |
| Coordinate sanity guard | ❌ absent | ✅ `isDrawable` | ✅ parse-time | ✅ parse-time | ✅ zod |
| Place / move objects | ✅ | ❌ | ❌ | ❌ | `object_master.manage` |
| Pin a fault on a request | ✅ | ❌ | ❌ **no create-request screen** | ✅ | accepted |
| **See** that fault pin back | ✅ | ❌ | ✅ | ❌ **cannot display what it placed** | — |
| Zones | ❌ | ❌ | ❌ | ❌ | ✅ full CRUD, unreachable (H-41) |
| Equipment history | ❌ not implemented | ❌ | ✅ | ❌ **403s** (M-27) | `object_master.view` only |
| Planned work | ✅ | ✅ | ✅ | ❌ **granted, unimplemented** | ✅ |
| Forgot password | ✅ | ✅ | ❌ "contact an administrator" | ❌ same | ✅ exists |
| Conclusion fields written | all 9 | n/a | **5 of 9** (C-3) | n/a | full replace |
| Timezone | `Asia/Ulaanbaatar` via server | same | ✅ Calendar tab correct | — | `APP_TIMEZONE` |

### Important inconsistencies

1. **Same DTO, two audiences, two behaviours** (H-3, H-4). The server declines to narrow; the web portal compensates in JSX and the customer mobile app does not. The divergence runs in the *unsafe* direction.
2. **Hand-mirrored Dart constants have already drifted** (H-24), while the TypeScript side cannot drift because it imports. No parity test exists in either mobile app. This is the system's most fragile coupling, and `docs/PRODUCTION_STATUS.md:123-126` names it as such.
3. **~13 core Dart files are maintained as byte-identical parallel copies** across the two mobile apps. H-22 is the direct cost: a fix landed in one copy and not the other. They belong in a shared package under `packages/`.
4. **The employee app's Home tab treats an empty permission set as authoritative** and prints "Хүлээгдэж буй ажил алга байна" over four zeroes when nothing was even attempted — asserting a fact on the strength of having asked nothing. The Project tab has the correct `permissionsKnown` distinction; the Work tab tells a technician who *does* hold the key to go ask an administrator for it.
5. **The customer app can place a fault pin it can never display back** — the one party who did the marking is the only one who cannot verify it.
6. **The `Asia/Ulaanbaatar` boundary is handled correctly in the Calendar tab and wrong on Home** — `home_remote_data_source.dart:106` sends a bare `YYYY-MM-DD`, which the backend parses as a UTC instant (08:00 local), so `createdAt <= to` excludes requests raised this morning. The Calendar data source sends real UTC instants and documents why.

---

## 11. Security Audit

### Confirmed vulnerabilities

| # | Vulnerability | Severity |
|---|---|---|
| H-1 | Cross-tenant read of any planned-work report + PDF with photos, by any `planned_work.view` holder | High |
| H-2 | Full customer book with tax IDs, and every contract's monthly fee, readable by any technician | High |
| H-3 | Customers receive unapproved report bodies + internal reviewer criticism + staff identities | High |
| H-4 | Customer mobile renders staff names, employee codes and internal status reasons | High |
| H-5/H-6 | One person can author, submit and approve the same statutory inspection | High |
| H-7 | `employee.view` downloads all HR documents; DISPATCH holds it | High |
| H-8 | National ID in the bulk employee list under a weaker key than the certificate endpoint uses | High |
| H-32 | Live password-reset links written to journald on a five-tenant host | High |
| H-33 | Complete admin-console TypeScript source published at `/assets/*.js.map` | High |
| H-39 | Account enumeration via the lockout response | High |
| H-40 | Credential rate limiting disabled in production; unauthenticated 250 ms-CPU endpoint with no ceiling | High |
| H-42 | 1 critical + 3 high advisories in **production** dependencies via `bcrypt → node-pre-gyp → tar`; `nodemailer` CRLF injection | High |
| M-1 | Cross-tenant existence + status oracle via transition check ordering | Medium |
| M-22 | Plaintext passcode echoed in two API responses | Medium |
| M-50 | Head-admin password committed in plaintext in `live_api_test.dart` — must be rotated | Medium |
| M-28 | Shared dashboard state writable under a read permission, unaudited | Medium |
| M-34 | Report CSV exports carry no tenant scope; `AUDIT_LOG` includes IPs across all tenants | Medium |

### Potential risks

- **POTENTIAL:** Four modules — customer master data, invoicing, service agreements and §15.2 reports — resolve **no tenant scope at all**. Nothing is currently exploitable *by a customer*, because the `CUSTOMER` role holds portal keys only and the coherence rule blocks widening it. But the boundary rests on one control instead of two, in a codebase whose own scope helper documents this exact pattern as the bug it was written to remove. (H-2 is the already-live half of this.)
- **POTENTIAL:** `Diagram` has no tenant field and `Diagram.find()` is unscoped. Not portal-reachable today (`DIAGRAM_VIEW` is staff-only); becomes a cross-tenant leak the moment anyone draws a specific customer's substation or the key is widened.
- **POTENTIAL:** Report/PDF endpoints do no tenant assertion. A customer role granted `planned_work.view` — a plausible admin mistake — turns them into a cross-tenant PDF dump.
- **POTENTIAL:** `assertTierRoleCoherence` guards the RBAC assignment path but does not retroactively validate accounts written before it existed. Recommend a one-off audit query.
- **POTENTIAL:** `audit-log.model.ts:62-66` instructs revoking update/delete privileges at the DB-user level before production; `DEPLOYMENT_UBUNTU.md:243` grants plain `readWrite` on the whole database. The application-layer immutability hooks are excellent but are not a substitute.
- **POTENTIAL:** HSTS is **set unintentionally** — `app.ts:23` is bare `helmet()`, and helmet 8.3.0 defaults `strictTransportSecurity` to `max-age=31536000; includeSubDomains`. Two documents record its absence as a deliberate decision. The one-year subdomain-wide commitment has already been made, unknowingly, on API responses only — the SPA's own HTML carries none.

### Security controls verified as working

- **Tenant isolation** — single resolver, predicate inside the query, 404-not-403, refuses rather than defaults for an unlinked customer account, and proven by a security test that constructs the forbidden state by direct DB write.
- **Portal/staff separation** — three independent barriers: a model-level validator, an RBAC chokepoint refusing the pairing in *both* directions and capping against the **static** contract, and disjoint permission namespaces.
- **RBAC chokepoint** — one write path, enforced by a build-failing invariant test; self-refusal checked first; ceiling; protected-mutation classification; last-administrator protection; audit on refusal.
- **File download authorization** — exhaustive owner-type table (compile-error-safe), per-file tenant resolution, opaque server-generated keys, double traversal containment, no static serving.
- **Password reset lifecycle** — 256-bit CSPRNG, SHA-256 at rest, prior grants revoked, claim-before-write so a race has one winner, expiry compared in code rather than trusted to the TTL index, uniform failure code, bcrypt burn on the unknown-address path, HTML-escaped name in the mail body.
- **Input validation** — zod on every route; `validate` *replaces* rather than merges, so downstream casts are assertions over sanitised data; no `.passthrough()`, `z.any()` or mass assignment anywhere in ~180 routes; no sort injection (every `sortBy` is a `z.enum`).
- **Error handling** — no stack traces, unknown errors collapse to a fixed 500, debug echo gated on `!isProduction`, duplicate-key returns the field name not the value.
- **Log redaction** — `authorization`, `cookie`, and all password/token field names at root and one nesting level (the gap is `body`, H-32).
- **SVG sanitisation** — a 22 KB allowlist parser rejecting `DOCTYPE`/`ENTITY` (billion-laughs), decoding entities *before* value checks, plus a serve-time `default-src 'none'; sandbox` CSP pinned by a test.
- **Immutability** — `AuditLog`, `ObjectAssessment` and `EmployeeStatusHistory` block every Mongoose mutation path.

---

## 12. Database Audit

**Schema.** 37 Mongoose models across 28 files, in two naming conventions (`*.model.ts` and `*.models.ts`) — a trap `sync-indexes.ts:18-23` documents explicitly because a singular-only glob silently skips five modules. Full inventory produced during the audit; key tenant-owned collections are `ObjectNode`, `Object`, `PlannedWork`, `ServiceRequest`, `ServiceAgreement`, `Invoice` and `User`, all carrying an indexed `customer` field.

**Relations.** No ObjectId reference is validated by the database — Mongoose `ref` is a `populate()` hint only. Referential integrity rests entirely on hand-written delete-blocker functions, which are correct for Role, ObjectType, Invoice, PlannedWorkTask, EmployeeDocument and org master data (which has no delete endpoint by design), and **incomplete for `Object` and `ObjectNode`** (H-11). Four polymorphic references (`Report.sourceId`, `AuditLog.entityId`, `Notification.entityId`, `StoredFile.ownerId`) have no `ref` and no validation. Naming hazard: the model registered as `'Object'` is exported as `ObjectRecord` while a *different* collection is `ObjectNode`.

**Constraints.** Multi-tenant uniqueness is **mostly right and deliberately so** — `{customer, code}` unique on both `ObjectNode` and `Object`, `{customer, sourceType, sourceId}` on `Report`, `{customer, billingPeriod, billingType}` on `Invoice`, each with a comment explaining the tenancy reasoning. Global uniques (`Customer.code`, `ObjectType.code`, `MaterialItem.code`, document numbers) are correct by design and documented. The two real gaps are M-35 (Employee identity keys global while sibling org codes are per-Company) and L-24 (`ObjectNode.code` case-sensitive).

Three non-obvious index traps have already been hit and fixed, with the reasoning preserved in comments — `partialFilterExpression` rejecting `$ne`, an auto-named index colliding with a unique partial index of the same name, and partial-on-`$type:'string'` rather than `sparse` because sparse still collides on explicit nulls. **These comments are institutional memory and should not be refactored away.**

**Indexes.** Verified missing: `ObjectNode.ancestors` (H-27), plain `AuditLog {createdAt:-1}` (H-28), `Object.latestAssessment.riskLevel`, `ServiceRequest.floor/room/panel/circuit/device`, `Object.circuit.start/endPointObject`, `Report {createdAt:-1}` (M-38). Verified wasteful: six text indexes, zero `$text` queries (M-37).

**Transactions.** One helper, probing topology via `hello` rather than trial (well-designed, with a documented rationale). Used at exactly **two** call sites. Production *is* a replica set, so they work — but the branch has zero test coverage (H-31), a topology downgrade degrades silently behind a single `logger.warn` (and both committed env files are standalone), and the two riskiest multi-collection writes are unwrapped (M-9, M-10).

**Queries.** N+1 at H-29; unbounded collections at M-13; fetch-all-then-filter at H-14/H-15/L-16.

**Tenant scoping.** Seven collections are scopable and correctly indexed. `Report`/`ReportItem` carry a **nullable** `customer` (M-36 — fails closed, but unreliable as a boundary). `PlannedWorkTask`, `ObjectAssessment`, `AuditLog` and `Diagram` have no tenant field at all.

**Migrations.** No framework — 10 standalone `tsx` scripts. **The safety discipline is above average:** every script has a dry-run, the three most destructive default to dry-run and require `--apply`, and one requires a second `--revoke-extra` flag for revocation. Three have dedicated tests. The problem is not the scripts; it is that **nothing runs them** (H-30), the destructive one has the inverted default (M-40), and one is stale and hazardous (M-39).

**Backup/recovery.** See C-1. Nothing executable exists.

---

## 13. API Audit

**Authentication.** Every router except `/auth` mounts `authenticate` + `enforcePasswordChange` — verified across all 24. `/health` is deliberately public.

**Authorization.** 73 permission keys; **71 are enforced** on at least one route or service check. Two are dead (M-19). Six routes carry no `requirePermission` at the router — each verified as intentional, with the decision made correctly one layer down (`/auth/me`, `/auth/change-password`, `/auth/logout`, `/employees/me`, `GET /files/:fileId`, `POST /planned-work/:id/transition`).

**Validation.** Near-total. The only genuine gaps are two employee-document routes missing a `params` schema (M-5) and three cosmetic weaknesses (L-10, L-11, and a hand-built query literal).

**DTOs.** Explicit mappers throughout; no raw Mongoose document reaches a client. The systemic issue is that DTOs are not **narrowed by audience** (H-3, H-4, H-2, H-8).

**Pagination.** 21 endpoints return a proper `PaginatedData` envelope. 13 return bare arrays with no total (M-14), which is the mechanism that makes truncation silent. Four filter after pagination while reporting the unfiltered total (H-14). Server caps are consistent at 100 (200 for materials, 5000 for report exports).

**Filtering.** Server-side where implemented; the defects are client-side filtering over truncated sets (H-18, H-20, H-21) and two filters that are never sent (H-19).

**Error handling.** Central handler guarantees `{success, data, message, code, issues?}` on every failure path, logs 5xx at `error` and 4xx at `warn`, and leaks no stack trace. Gaps: `MulterError`/`BSONError` unnormalised (M-5), one hand-built 403 (L-4), one `totalPages` semantic difference (L-5).

**Data exposure.** See §11.

**Performance.** H-29 (N+1), M-6 (blocking PDF), M-13 (unbounded), H-27/H-28/M-38 (missing indexes), plus full-collection scans on the dashboard (`dashboard.service.ts:293` loads every non-archived planned work and counts it in a JS loop) and an aggregation with no `$limit` whose `$lookup` runs per group before `slice(0, TOP_N)`.

**Rate limiting.** Two limiters, on `/auth` only. See H-40.

---

## 14. Mobile Audit

### Employee Mobile (`apps/mobile-employee`)

**Genuinely disciplined.** All 50 endpoints it calls exist with matching method, path and payload — zero 404-by-construction. Tokens in `flutter_secure_storage` with `encryptedSharedPreferences` and `first_unlock`; **no `shared_preferences` dependency exists in the project**. No `LogInterceptor`, no `print`/`debugPrint` anywhere in `lib/` — tokens never reach a log sink. Single-flight refresh with a `Completer`, replay exactly once, `/auth/login` and `/auth/refresh` excluded from both the Bearer header and the retry path. Permissions come from `/auth/me`; nothing gates on a role string. Uploads get a dedicated 60 s send timeout and a **rebuildable `FormData`** so the 401 replay does not resend a consumed stream — the kind of thing that is normally wrong. ~9,600 lines of hermetic tests across 17 files, plus a live-API integration suite.

**Defects:** H-24 (enum drift + no approve/reject), C-3 (conclusion data loss), H-20 (client-side filter over a truncated page), the Home tab's empty-permission and zero-length-UTC-window bugs, M-48 (release footguns), and no offline write buffering — a technician in a lift shaft who fills in a conclusion loses it.

### Customer Mobile (`apps/mobile`)

**Tenant scoping is exemplary and I audited it specifically: there is no client-side filtering of other tenants' data anywhere.** `customerScopeProvider` is a plain `Provider` — no setter, no family parameter, no picker — and the repository interface has no overload that omits the scope. Every client-side `.where()` was enumerated and is a within-tenant view filter. `user_management` is **not** a privilege-escalation path: it is unreachable from any customer screen, `UserRole.fromWire` defaults to `customer` (least privilege) on an unknown value, and the backend refuses all four routes anyway. `create_request_sheet_test.dart` and `customer_portal_models_test.dart` include **source-scanning tests** asserting no code path other than `customerScopeProvider` constructs a scope — an unusually good way to keep that guarantee from eroding.

**Defects:** H-23 (iOS bundle id — release blocker), H-22 (5xx → "no network" + stale session), H-20 (100-item pages filtered client-side), planned work granted but entirely unimplemented, the fault pin it can place but cannot display, silent notification mark-read failures, no `integration_test/`, and L-31 (admin UI shipped in a customer binary).

**Shared to both:** floor-plan coordinate handling is **identical and correct** across web and both apps — normalised 0..1, origin top-left, marker centred, counter-scaled `1/zoom`, with the letterbox trap explicitly avoided by sizing the widget box from the decoded image's intrinsic aspect ratio. No coordinate discrepancy exists. Android cleartext is correctly denied in release; iOS ATS is scoped to local networking only.

---

## 15. Web / Portal Audit

### Admin Web

**Every route is guarded** — I enumerated all 62 against the backend route map. `ProtectedRoute → AppShell → PermissionGuard` on every admin route; only `/change-password`, `/` and `*` are auth-only, correctly. Almost every form re-parses the **same shared zod schema** the backend uses, and maps `issue.path.join('.')` onto rendered `error=` props. `DataTable` bakes in loading/empty/error. **Every paginated screen resets to page 1 on filter change** — I checked all 18 and none fails. `total` always comes from the API, never `items.length`. One base URL, env-driven, with a tracked `.env.production`; **no frontend call targets a non-existent endpoint**.

`FloorDetailPage.tsx` is the **reference implementation** for honest client-side filtering — it page-walks the complete set and documents why — flawed only by a silent 2,000 ceiling.

**Defects:** C-5 (org dropdowns 400), C-2 (employee data loss), H-26 (cross-tab logout), H-18/H-19 (truncated-then-filtered, dead filters), M-42…M-47, L-28…L-30. Dead code: `routes/RoleGuard.tsx`, `hasRole`/`isAdmin`, and `features/users/*` (unrouted).

### Customer Portal

**Tenant isolation holds on every portal-reachable data endpoint traced** — I verified six chains end to end through route → guard → service → mongoose query. Server-side paging is real throughout; search is passed to the server, not applied to a fetched page; **there is no `limit=1000` anywhere**; status-count banners use the correct `limit: 1` + read `total` idiom. Planned work correctly **shares one form component** with the staff screen via a `variant` prop rather than a hand-copied form, and the two behaviours that differ are enforced server-side regardless.

**Defects:** H-3 (draft report bodies), M-1 (transition oracle), and three low-severity counting/truncation issues — the home page's open-request count is derived from a 20-row page while the same file uses the correct `limit: 1` idiom two functions below, and two page-walkers stop silently at 20 pages.

---

## 16. Testing Audit

**Measured, not claimed:**

| Suite | Files | Tests | Result | Duration |
|---|---|---|---|---|
| Backend | 52 | 1,169 | ✅ pass | 90.7 s |
| Web | 65 | 804 | ✅ pass | 29.3 s |
| `packages/shared` | 0 | **0** | no test script | — |
| Customer mobile | 6 | 131 | ✅ pass | 34 s |
| Employee mobile | 17 | 218 | ✅ pass | 63 s |
| **Root `npm test`** | 117 | **1,973** | ✅ pass | **2m10s** |

Repo-wide total **2,322**. Zero failures, zero `.skip`/`.only`/`.todo`. **The documentation is wrong in both directions** — `PRODUCTION_STATUS.md:101,128` claims 1,135 tests in ~5 min; the count is understated by 74% and the duration overstated 2.3×.

**Existing coverage — the strongest areas are the ones that matter most.** Tenant isolation is thoroughly tested at unit *and* API level, with two real tenants, a planted secret string asserted absent from the other tenant's response, the 404-not-403 convention pinned, and an unlinked-customer account proven refused rather than unfiltered. Role escalation is covered by three suites that assert *consequences* (`/auth/me` re-checks, "nothing half-written", audit payloads) rather than status codes, plus a source-scanning invariant test that fails the build on any second role write. File-download authorization is pinned cross-tenant with real bytes on disk. Business flows (planned work, service requests, inspection→report→approval) are covered by 10 files.

**Missing coverage, ranked by risk:**

1. **Refresh-token rotation and reuse detection** — zero references to `/auth/refresh`. Silent regression is a session-hijack window.
2. **`enforcePasswordChange`** — mounted on ~25 routers, zero assertions.
3. **`passwordChangedAt` token invalidation** — the only thing stopping a stolen access token outliving a password reset; appears in 17 test files, every occurrence a fixture write.
4. **Tenant scope for `/calendar` and `/dashboard`** — the existing security fixture already grants `DASHBOARD_VIEW` and then never calls it.
5. Account lockout; CSV export tenant scoping; unauthenticated `GET /files/:fileId`; `PATCH /employees/:employeeId`; the whole `/api/v1/audit` module (no test file at all).
6. **Sorting** — 0 tests, 9 implementations. **Max-limit rejection** — 0 tests, 14 caps (and C-5 is exactly this bug reaching production).
7. **`packages/shared`** — 60 files, 2,731 lines of schemas plus the permission matrix, no test script; turbo skips it silently.
8. **A Dart↔TypeScript constant parity test** — would have caught H-24.

**Weak tests — quoted:**

- `org.api.test.ts:77-81` — the page-2 test never asserts `status` or `items.length`. **If page 2 returned `[]` or 500'd, `[].some(...)` is `false` and the test passes.**
- `report.api.test.ts:317,321` — `total >= rows.length` and `rows.length <= 2` are both true for `{total: 0, rows: []}`, the exact failure a pagination test exists to catch.
- `report.api.test.ts:366-380` — a test named *"flags truncation only for the export"* never requests `format=csv`, so the branch it names is never executed.
- `object-master.api.test.ts:299-307` — asserts 200 on delete and never re-fetches.
- `rbac.seed.test.ts:42` / `DataTable.test.tsx:286` — `expect(app).toBeDefined()`, `expect(user).toBeDefined()`.
- Six web list pages share a pagination test that mocks `page: 2` **unconditionally**, so the `route: '?page=2'` is inert — deleting the URL→query wiring leaves them green.
- `ObjectTypesPage.test.tsx:279-287` reads its own source as a string and greps for `dangerouslySetInnerHTML` — an ESLint rule in the wrong place, defeated by string concatenation.

206 of 1,169 backend `it()` blocks (17.8%) assert only a status code; many legitimately (403 checks), the bad ones being those asserting a positive outcome. On the web, only 3 of 65 files use `vi.mock` — the rest spy on the **service singleton**, so the suite proves nothing about URL/param serialisation or error mapping, and **there is no `*.service.test.ts` anywhere**. That seam is precisely why C-5 shipped.

**Isolation** is well designed and documented (`pool: 'forks'`, `isolate: true`, `fileParallelism: false`, with a comment explaining that a fresh module registry is what keeps the rate limiter and caches from leaking; a pooled HTTP server avoids ~12,000 ephemeral ports). Two real defects: `NotificationsPage.test.tsx:17` and `AppShell.test.tsx:13,32` **make real network calls** to `localhost:4000` (failures are swallowed, so they pass today), and there is no network tripwire. Test uploads leak: **43,407 files / 170 MB** in `apps/backend/var/test-uploads`, ~462 per run, never cleaned, invisible because gitignored.

`integration_test/live_api_test.dart` commits a **head-admin password in plaintext** and calls `POST /users/:id/reset-passcode` against a real account. It is excluded from `flutter test`, but it is in the repository.

---

## 17. Production Readiness

| Requirement | Status | Evidence / Notes |
|---|---|---|
| Authentication | **COMPLETE** | `auth.service.ts`, `authenticate.middleware.ts` — rotation, reuse detection, revocation epoch, no authority in the token. Untested (H-38) |
| Authorization | **COMPLETE** | 71/73 keys enforced; chokepoint + invariant test. Gaps are scope, not authz (H-1, H-2) |
| Tenant isolation | **PARTIAL** | Boundary sound and security-tested. Four modules resolve no scope; five report endpoints bypass it (H-1, H-2) |
| Password reset | **PARTIAL** | Code complete and well-built; `APP_WEB_BASE_URL` unset in production, links go to `localhost` (H-32). **Not deployed** — returns 404 on the server |
| Email | **MISSING** | `SMTP_HOST` unconfigured; transport degrades to writing the reset link into the log (H-32). Sender address `no-reply@monhorus.itsystem.mn` does not exist; no SPF/DKIM |
| Environment configuration | **PARTIAL** | `env.ts` validates and exits(1) on bad input — genuinely good. But four settings default to dev values with **no production guard** (`APP_WEB_BASE_URL`, `SMTP_HOST`, `CORS_ORIGINS`, `UPLOAD_DIR` — the last documented as *"the one variable whose default will destroy data"*) |
| Database migrations | **PARTIAL** | 10 idempotent scripts with dry-runs and good discipline; nothing runs them; the destructive one defaults to applying; one is stale and hazardous (H-30, M-39, M-40) |
| Database backup | **MISSING** | No script, no timer, no cron anywhere in the repository. Restore is one sentence with an ellipsis, never rehearsed (C-1) |
| Android signing key backup | **PARTIAL** | Signing correctly wired; **no keystore committed** (verified — only `key.properties.example`); fingerprint and verification step documented. But the key exists on **one Windows machine** (`C:\Ajil\monhorus-keys\`) with no backup, and a missing `key.properties` silently debug-signs the release |
| CI/CD | **MISSING** | No `.github/`, no pipeline, no deploy script. `packages/shared` and both mobile apps run nowhere (H-34) |
| Static analysis (lint) | **MISSING** | `npm run lint` passes unconditionally — **no ESLint dependency, config or per-package script exists anywhere** (H-43). Dart is correctly linted in both apps |
| Dependency hygiene | **PARTIAL** | Lockfile verified in sync (709 entries, `npm ls --package-lock-only --all` exit 0; the `nodemailer` fix in `39648f4` is complete). But `npm audit --omit=dev` reports 1 critical + 3 high, all clearable by one `bcrypt` bump (H-42) |
| Rate limiting | **PARTIAL** | Implemented on `/auth` only; **disabled in production**; `skipSuccessfulRequests` absent; one bucket shared across four endpoints (H-40) |
| Monitoring/logging | **PARTIAL** | Structured pino NDJSON with good redaction (gap: `body`). **No metrics, no alerting, no log shipping, no log rotation**; `/health` cannot detect an unhealthy service (H-37) |
| Production URLs | **PARTIAL** | `apps/web/.env.production` is tracked and correct (`https://monhorus.itsystem.mn/api/v1`) with an excellent rationale. But the deploy runbook §6/§8 still build with the retired `http://103.87.255.221:3020` and self-verify against it (H-36) |
| Security configuration | **PARTIAL** | helmet + CORS allowlist + `trust proxy` + `x-powered-by` off, all correct. HSTS set unintentionally; **no CSP on the SPA**; source maps published (H-33); backend binds `0.0.0.0` with `ufw` as the only barrier |

### The seven known production tasks — current state verified against code

| # | Task | Status | Verified evidence |
|---|---|---|---|
| 1 | Android signing key backup | **PARTIAL / MISSING** | Signing config correct, nothing sensitive in git. The key itself is on one machine with no backup — **the single highest risk-to-effort item in the report** |
| 2 | `APP_WEB_BASE_URL` | **MISSING** | `env.ts:91` defaults to `http://localhost:5173`, consumed directly by `resetLinkFor()`. Unset in production |
| 3 | Production deployment | **PARTIAL** | The site is live and serving. No pipeline, no deploy script, no container; the last 6 commits are in git only, and the routine procedure reverts TLS (H-36) |
| 4 | Email / password reset | **PARTIAL** | Code complete and well-built; unconfigured, undeployed, and currently a token-disclosure channel when enabled (H-32) |
| 5 | Automatic database backup | **MISSING** | Nothing executable exists anywhere (C-1) |
| 6 | CI | **MISSING** | `.github/` does not exist. The measured cost of running everything is 2m10s (H-34) |
| 7 | Login rate limiting with `skipSuccessfulRequests` | **MISSING** | Verified absent from `auth.routes.ts:26-41`. Production sets the ceiling to 10⁹, so the control is off (H-40) |

---

## 18. What's Working Correctly

Verified by reading the code, not inferred:

1. **Tenant isolation architecture** — one resolver, predicate in the query, 404-not-403, fails closed for an unlinked account, proven by a security test that constructs the forbidden state by direct DB write.
2. **RBAC chokepoint and role assignment** — single write path enforced by a build-failing invariant test; self-escalation refused first; permission ceiling; both-direction tier/role coherence on both the assignment and role-edit paths; audit on refusal as well as grant.
3. **Portal/staff separation** — three independent barriers; a customer cannot acquire a staff key by any path I could find.
4. **File download authorization** — compile-error-safe owner-type table, per-file tenant resolution, opaque keys, double traversal containment, no static serving.
5. **Password-reset token lifecycle** — every property correct: entropy, hash-at-rest, supersession, claim-before-write race safety, expiry-in-code, uniform failures, timing equalisation, HTML escaping.
6. **Input validation** — zod on every route, replace-not-merge semantics, no mass assignment anywhere in ~180 routes, no sort injection.
7. **Error handling** — envelope guaranteed, no stack leak, production debug gated.
8. **SVG sanitiser and serve-time CSP** — genuinely thorough, including billion-laughs and entity-decoding-before-validation.
9. **Concurrency primitives that exist** — request claim (`findOneAndUpdate` with the open condition *and* scope in the filter), the unclaimed and overdue sweeps (stake-then-act), and `Counter` (`$inc`) are all correctly atomic.
10. **Immutability enforcement** on `AuditLog`, `ObjectAssessment` and `EmployeeStatusHistory`.
11. **Floor-plan coordinate handling** — identical and correct across web and both mobile apps; the letterbox trap explicitly avoided; pin input round-trips with the same clamp on all clients.
12. **`packages/shared` as the source of truth** — backend↔web drift is a compile error, and the service-request vocabulary's hand-written Dart mirror matches exactly.
13. **Notification module** — recipients resolved by permission not role, per-user read authorization that no permission can override, bounded queries, delivery failures swallowed so a notification cannot 500 a successful business write.
14. **Background jobs** — both idempotent by construction and safe under horizontal scaling despite no leader election.
15. **Environment validation** — refuses to boot on a missing or malformed secret, with an empty-string preprocessor added after a real restart-loop incident.
16. **The test suite** — 1,973 tests passing in 2m10s, with the security-critical areas genuinely well covered.
17. **Documentation as institutional memory** — several MongoDB index traps, the plan-position normalisation decision, and the `.env.production` tracking rationale are documented at the point where they were learned. This is unusual and valuable.
18. **TypeScript discipline** — verified repo-wide: **not a single** `: any`, `as any`, `any[]`, `Promise<any>`, `catch (e: any)`, `@ts-ignore` or `@ts-expect-error`. The ~95 `as unknown as` casts at route boundaries are legitimate, because `validate` *replaces* `req.query`/`body`/`params` with zod-parsed output, so each cast asserts a shape zod just produced.
19. **Zero deferral markers** — no `TODO`, `FIXME`, `HACK`, `XXX` or `@deprecated` anywhere in tracked source (the only grep hit is a base64 substring in a lockfile integrity hash). Known gaps are written as prose next to the code instead, which is why this audit could find them.
20. **Repository hygiene** — no `.DS_Store` tracked anywhere, no `dist/`, `build/`, `coverage/`, `.turbo/` or `var/` tracked, no logs or editor files, and the 96 MB `.docx` that would have made the remote unpushable is correctly ignored. The 40 tracked PNGs are required platform launcher icons and the 2.1 MB of TTFs are needed for Cyrillic PDF generation.

---

## 19. Recommended Fix Order

### Tier 1 — Critical security & data integrity

| # | Change | Why | Files | Dependencies | Tests required |
|---|---|---|---|---|---|
| 1 | Schedule the already-written backup commands; rehearse a restore | Only unrecoverable risk in the report | new systemd timer + docs | Off-host destination; disk headroom | A written restore rehearsal |
| 2 | Stop sending `education`/`workHistory`/`certificates` on employee update | Silent destruction on every edit | `EmployeeFormPage.tsx:280-282`; `employee.schema.ts:151-153` | none | Round-trip: sub-records unchanged after an unrelated PATCH |
| 3 | Make `PUT /:id/report` patch-semantic, or send all 9 fields from mobile | Silent destruction of web-entered data | `work-report.service.ts:379-395`; `work_report_model.dart:330-344` | Decide patch-vs-replace first | Payload-shape test vs the zod defaults |
| 4 | Add `endDate` to invoice generation; add an expiry sweep | Wrong invoices to real customers | `invoice.service.ts:344`; new job | Uses the existing `{status,endDate}` index | Expired agreement is not a candidate |
| 5 | `OPTION_LIMIT` 200 → 100 | Employee org assignment is broken | `useOrgSelectors.ts:23`, `useOrgOptions.ts:12` | none | Assert every client limit ≤ server `.max()` |
| 6 | Thread `AuthContext` into the five report/PDF loaders | Largest disclosure surface | `planned-work.routes.ts:399,433`; `inspection-report.routes.ts:36,43,50` | **Existing test at `assignment-scope.api.test.ts:497-517` asserts today's behaviour** | Cross-tenant 404 on all five |
| 7 | Narrow the two customer-facing DTOs server-side | Internal review data and staff identities reaching customers | `planned-work.service.ts:543-545`; `service-request.service.ts:177-217` | `assertReportVisibleToCustomer` already exists, uncalled | Customer token sees no draft body, no `statusHistory` |
| 8 | Split a narrow customer DTO for technician reads; scope `listCustomers` | Whole customer book with tax IDs | `object.service.ts:54-76, 216-218` | Check no screen needs the full DTO | Technician token sees no `taxNumber` |
| 9 | Lift the self-approval check into the inspection and consolidation approve paths | One person signs a statutory inspection alone | `inspection-report.service.ts:709`; `consolidation.service.ts:288` | Reuses `approvalBlockersOf` | Author-approves-own → 403 |
| 10 | Redact `body`; refuse `logTransport` in production; require `APP_WEB_BASE_URL`/`SMTP_HOST` in production | Reset tokens in the journal; dead reset links | `logger.ts:33-48`; `mail.service.ts:60-68`; `env.ts` | **Before the mail feature is deployed** | Boot fails without the vars when `NODE_ENV=production` |

### Tier 2 — Production blockers

11. **Bump `bcrypt` to `^6`** — clears 1 critical + 3 high production advisories in one line, and `nodemailer` before the mail feature ships (H-42). 12. `sourcemap: 'hidden'` + deny `*.map` in nginx (H-33). 13. Fix `DEPLOYMENT_MONHORUS_PROD.md` §6/§8 build commands (H-36) — one edit, prevents every future release reverting TLS. 14. Back up the Android keystore to a password manager or encrypted archive (task #1). 15. Add `skipSuccessfulRequests: true`, re-enable the limiter, give `/forgot-password` its own bucket (H-40). 16. Fix the iOS bundle identifier before any TestFlight build (H-23). 17. Make `/health` check `mongoose.connection.readyState` — the precondition for any monitoring (H-37). 18. Add CI running `npm test`, both `flutter test` suites, `npm audit --omit=dev` and `sync-indexes --dry-run` (H-34, H-42). 19. **Introduce ESLint** — `npm run lint` currently passes unconditionally because no ESLint exists (H-43). 20. Move `sync-indexes` into `ExecStartPre` rather than human memory; invert its default to require `--apply` (H-30, M-40). 21. Delete `rename-task-conclusion-to-note.ts` (M-39). 22. Reconcile the two runbooks on `--omit=dev`; document `NODE_ENV` as a boot precondition (H-35). 23. **Rotate the head-admin password committed in `live_api_test.dart`** (M-50).

### Tier 3 — Critical business flows

21. Stop `PlannedWorkFormPage` sending assignment fields on edit (H-25) — the portal correction loop is unreachable today. 22. Add the two missing Dart enum values; switch both `orElse` coercions to null-degrade; add `APPROVE`/`REJECT` (H-24). 23. Run `migrate:system-role-permissions --apply` everywhere and refresh `TECHNICIAN_APP_PERMISSIONS` (M-21). 24. Reorder the transition tenancy assert above the status check (M-1). 25. Add `ReportItem`/`WorkReport`/`PlannedWorkTask`/`Diagram` to the object and node delete blockers (H-11). 26. Enforce `isActive` where it is already fetched; revoke sessions and unassign on termination (H-9, H-10). 27. Map `EMPLOYEE` file downloads to `EMPLOYEE_MANAGE_DOCUMENTS`; gate `registrationNumber` consistently (H-7, H-8).

### Tier 4 — High-priority bugs

28. The four filter-after-pagination endpoints, using `invoice.service.ts:239-252` as the model (H-14). 29. `availableOnly` into the query (H-15). 30. Render `truncatedAt`; give the inspections export a total (H-16). 31. Send `sourceType`/`status` on the inspections list (H-19). 32. Pass `customerId` to `listFloors` (H-18). 33. Append `_id` to every list sort (M-11). 34. Clear `planPosition` on any floor change (H-12). 35. Cross-tab refresh lock (H-26). 36. Backport the 5xx fix and the `AuthFailure` restore to `apps/mobile` — **and extract the ~13 duplicated core Dart files into a shared package**, which is the real fix (H-22).

### Tier 5 — Performance

37. Drop `deleteBlockers` from the three list mappers (H-29). 38. Add `{ancestors:1, kind:1}` and `{createdAt:-1}` on `AuditLog` (H-27, H-28). 39. Either adopt `$text` or drop the six text indexes (M-37). 40. Add pagination to mobile lists; surface truncation everywhere using the `TaskFormDrawer.tsx:187-192` pattern (H-20, H-21, M-44). 41. Move PDF rendering off the request thread and cap parallel sharp decodes (M-6).

### Tier 6 — UX / Tier 7 — Technical debt

42. Session-expiry notice; blob error messages; field errors on the controls; stop swallowing option-fetch failures (L-28, M-43, M-46, M-47). 43. Store plan dimensions and warn on aspect-ratio change (H-13). 44. Decide zones: build the client surface or remove the backend CRUD (H-41). 45. Give the diagram a tenant field or document it as installation-global; add concurrency control (M-28…M-30). 46. Clean up dead code (`RoleGuard`, `features/users/*`, `getFloorLoad`, `hasMore`, two dead permissions), the 1.2 MB of PDFs and 390 KB HTML tracked at repo root, and `docs/archive/step-1/**` (shipped to production on every deploy). 47. Add a network tripwire to the web test setup and clean `var/test-uploads`. 48. Reconcile the documentation drift catalogued in §17 — the ADR describes Argon2id and an invitation flow that do not exist (the system uses bcrypt and has neither), and `DEPLOYMENT_UBUNTU.md` is 69 commits stale with ~18-line citation drift throughout.

---

## 20. Final Assessment

| Dimension | Verdict | Basis |
|---|---|---|
| **Production readiness** | **PARTIALLY READY** | A live system with genuinely good application code, missing the operational floor beneath it: no backup, no CI, no monitoring, no automated deploy — plus five confirmed data-integrity defects that corrupt real records during ordinary use |
| **Security** | **NEEDS WORK** | No authentication or authorization *bypass* was found, and the core controls are unusually well built. But 11 confirmed High disclosure issues share one root cause — a permission key treated as a scope, and DTOs not narrowed by audience |
| **Data integrity** | **CRITICAL ISSUES** | Two silent destruction paths in routine operations, wrong invoices to real customers, orphaned required references, and no backup to recover from any of it |
| **Test coverage** | **NEEDS WORK** | 1,973 passing tests with excellent tenant-isolation and RBAC coverage — but the entire auth module, sorting, max-limit rejection and `packages/shared` are untested, and none of it runs in CI |
| **Cross-app consistency** | **NEEDS WORK** | Coordinates, permissions and the service-request vocabulary agree exactly across four clients. Planned-work statuses have drifted, ~13 core Dart files are duplicated and have already diverged, and pagination differs fundamentally between web and mobile |

---

## 21. Top 10 Actions

1. **Schedule backups and rehearse one restore.** Everything else in this report is recoverable; this is not. The commands are already written — they need a timer, an off-host destination, a retention policy, and one rehearsal with the result written down. *(C-1)*
2. **Stop the two silent data-destruction paths.** Employee edit wiping education/work history/certificates, and the mobile conclusion save wiping materials and follow-up flags. Both are small changes; both are corrupting records right now. *(C-2, C-3)*
3. **Add the `endDate` predicate to invoice generation and write the expiry sweep.** Expired contracts are being invoiced every month. *(C-4)*
4. **Change `OPTION_LIMIT` from 200 to 100.** A one-character fix that restores employee organisation assignment, which is broken outright today. *(C-5)*
5. **Thread `AuthContext` into the five report/PDF loaders.** One line per route; closes the largest disclosure surface, where any technician can download any customer's inspection report with photographs. *(H-1)*
6. **Back up the Android signing keystore.** It exists on one machine. If that machine dies, every user must uninstall and reinstall, losing on-device data. Lowest effort, highest ratio in the report. *(Task #1)*
7. **Before deploying the mail feature:** redact `body` in the logger, refuse the log transport in production, and make `APP_WEB_BASE_URL` and `SMTP_HOST` required when `NODE_ENV=production`. Otherwise the first deploy turns password reset into a token-disclosure channel that also sends dead links. *(H-32)*
8. **Add CI, and give it something to run.** The whole suite takes 2m10s — cheaper than the drift it would have caught. Include `packages/shared`, both Flutter suites, `npm audit --omit=dev`, and a Dart↔TypeScript constant parity check, which would have caught the planned-work enum drift. Note that `npm run lint` is currently a no-op because **no ESLint exists in the repository**, so a CI lint step needs ESLint introduced first. *(H-34, H-43, H-24)*
9. **Bump `bcrypt` to `^6`.** One line removes the entire `node-pre-gyp → tar` chain carrying a critical and three high advisories from production dependencies, plus five deprecated transitive packages. Bump `nodemailer` in the same change, before the mail feature ships. *(H-42)*
10. **Fix the deploy runbook's build commands, disable production source maps, and move `sync-indexes` into `ExecStartPre`.** §6 currently reverts the TLS migration on every release and self-verifies as correct; `/assets/*.js.map` publishes the admin console's full source; and skipping the index step silently voids duplicate-invoice prevention, report idempotency and unique emails — damage that surfaces weeks later, when the index can no longer be built. *(H-36, H-33, H-30)*

---

*Report produced by static analysis and code reading only. No source file was modified, no commit was made, and no database was contacted. Every Critical and High finding was independently re-verified against source before inclusion; where a subagent's claim did not survive that check, it was corrected or narrowed rather than reported as found (notably the `seedRbac` "prune-only" claim, which is accurate for existing non-SYSTEM_ADMIN system roles — the real finding is the rollback hazard in M-20).*
