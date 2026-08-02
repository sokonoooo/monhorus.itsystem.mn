# Web Admin Phase 1 - Architecture and Implementation

Status: partially delivered. See "Known gaps" for what is not finished.
Last updated: 2026-07-28

---

## 1. Frontend architecture discovered

| Concern | Finding |
|---|---|
| Framework | React 18.3 with Vite 6, TypeScript strict |
| Routing | react-router-dom 6, declarative `<Routes>` |
| State | React context plus local `useState`. No Redux, Zustand or TanStack Query |
| Data fetching | Hand-rolled hooks over a shared axios instance |
| Styling | Tailwind CSS 3.4 with PostCSS. No component library |
| Forms | None. Controlled inputs written by hand |
| Tests | None existed for TypeScript |

Nothing was replaced. New work follows the same patterns: an axios service module per domain, a fetch hook per list, controlled inputs, Tailwind utility classes.

## 2. Backend architecture discovered

| Concern | Finding |
|---|---|
| Runtime | Node 20, Express 4.21, TypeScript with NodeNext resolution |
| Database | MongoDB via Mongoose 8 |
| Layering | `routes -> controller -> service -> model` |
| Validation | Zod 3.25 through a `validate({ body, query, params })` middleware |
| Errors | `AppError` plus a terminal error handler emitting `{ success, data, message, code, issues }` |
| Auth | JWT access token (15 min) plus rotating refresh tokens in a `Session` collection |
| Logging | pino with credential redaction |

## 3. Database architecture

Before this phase: `User`, `Session`, `AuditLog`.

Added in this phase:

| Collection | Purpose |
|---|---|
| `Permission` | Materialised copy of the shared permission catalogue |
| `Role` | Dynamic role with an embedded array of permission keys |
| `Company`, `Department`, `Position`, `Team` | Internal organisation master data |
| `Employee` | Employee master record with embedded education, work history and certificates |
| `EmployeeSalary` | Effective-dated salary history, separate collection |
| `EmployeeStatusHistory` | Append-only status trail |
| `EmployeeDocument` | HR metadata for an uploaded document |
| `StoredFile` | Binary metadata with an opaque storage key |
| `Customer` | Customer organisation |
| `ObjectNode` | Polymorphic hierarchy: Project, Building, Floor, Room, Panel, Circuit, Device |
| `ServiceRequest` | Service request with embedded status history |

There is no migration framework in the repository. Mongoose builds indexes on boot when `autoIndex` is enabled outside production. Index creation must be scripted before a production deployment.

### Notable index decisions

- Optional-unique fields (`registrationNumber`, `email`, `icCardNumber`, `attendanceNumber`) use `partialFilterExpression: { $type: 'string' }` rather than `sparse`, because sparse indexes still collide on explicit nulls.
- `EmployeeSalary` has a unique partial index on `{ employee }` where `effectiveTo: null`, so the database itself guarantees at most one open salary period per employee.
- `ObjectNode` codes are unique per customer, not globally.

## 4. Authentication flow

Unchanged from the previous phase and not replaced.

1. `POST /auth/login` verifies with bcrypt (cost 12), issues a 15-minute access JWT and a rotating refresh token stored as a SHA-256 digest.
2. `authenticate` verifies the Bearer token, re-reads the user, rejects suspended accounts and rejects any token issued before `passwordChangedAt`.
3. `enforcePasswordChange` blocks a `must_change_password` account from every route except `/auth/me` and `/auth/change-password`.
4. Refresh rotates; replaying a rotated token revokes every session for that user.

**Change made in this phase:** `authenticate` now also resolves the caller's effective permission set onto `req.auth.permissions`. Permissions are deliberately **not** placed in the JWT, so revoking a permission takes effect on the next request rather than after the token expires.

## 5. Current route map (before this phase)

```
/login
/change-password
/users            (admin user list)
```

## 6. Proposed and implemented route map

| Route | State | Guard |
|---|---|---|
| `/login` | Existing | Public |
| `/change-password` | Existing | Authenticated |
| `/dashboard` | Implemented | `dashboard.view` |
| `/employees` | Implemented | `employee.view` |
| `/employees/new` | Implemented | `employee.create` |
| `/employees/:id` | Implemented | `employee.view` |
| `/employees/:id/edit` | Implemented | `employee.update` |
| `/objects` | Implemented | `object.view` |
| `/service-requests` | Implemented | `service_request.view` |
| `/service-requests/new` | Implemented | `service_request.create` |
| `/service-requests/:requestId` | Implemented | `service_request.view` |
| `/dispatch` | Implemented | `dispatch.view` |
| `/customers`, `/planned-work`, `/calendar`, `/inspections`, `/devices`, `/floor-plans`, `/materials`, `/reports`, `/invoices`, `/notifications`, `/access`, `/audit`, `/settings` | Placeholder page | Per navigation config |

## 7. Permission matrix

28 permissions in `packages/shared/src/constants/permissions.ts`. Default grants per seeded system role:

| Role | Permissions | Salary access |
|---|---|---|
| SYSTEM_ADMIN (Системийн админ) | 28 (all) | Yes |
| ADMIN (Админ) | 24 | No |
| MANAGEMENT (Менежер) | 18 | No |
| DISPATCH (Dispatcher) | 12 | No |
| FINANCE (Санхүү) | 9 | Yes |
| SALES (Борлуулалт/харилцагч) | 8 | No |

`head_admin` in the legacy coarse role enum is an unconditional superuser. Without this the bootstrap account could never reach the RBAC screen to grant itself anything.

Salary permissions are granted to FINANCE and SYSTEM_ADMIN only. Requirements section 3.1 assigns all monetary responsibility to the Санхүү duty, so MANAGEMENT does not receive them by default. A holder of `rbac.manage` can change this at runtime.

## 8. Existing API inventory (reused, unchanged)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me            (extended: now returns roleIds and permissions)
POST   /api/v1/auth/change-password
GET    /api/v1/users
POST   /api/v1/users
GET    /api/v1/users/:userId
POST   /api/v1/users/:userId/reset-passcode
PATCH  /api/v1/users/:userId/status
```

## 9. APIs added in this phase

```
GET    /api/v1/rbac/permissions
GET    /api/v1/rbac/roles
POST   /api/v1/rbac/roles
PATCH  /api/v1/rbac/roles/:roleId
DELETE /api/v1/rbac/roles/:roleId
POST   /api/v1/rbac/users/:userId/roles

GET    /api/v1/org/companies
GET    /api/v1/org/departments?companyId=
GET    /api/v1/org/positions?companyId=&departmentId=
GET    /api/v1/org/teams?companyId=&departmentId=

GET    /api/v1/employees
POST   /api/v1/employees
GET    /api/v1/employees/:employeeId
PATCH  /api/v1/employees/:employeeId
POST   /api/v1/employees/:employeeId/status
GET    /api/v1/employees/:employeeId/salary
POST   /api/v1/employees/:employeeId/salary
GET    /api/v1/employees/:employeeId/certificate
GET    /api/v1/employees/:employeeId/documents
POST   /api/v1/employees/:employeeId/documents
DELETE /api/v1/employees/:employeeId/documents/:documentId

GET    /api/v1/objects/customers
GET    /api/v1/objects/nodes?parentId=|customerId=&kind=
GET    /api/v1/objects/nodes/:nodeId/breadcrumb

GET    /api/v1/service-requests
POST   /api/v1/service-requests
GET    /api/v1/service-requests/:requestId
POST   /api/v1/service-requests/:requestId/assign
POST   /api/v1/service-requests/:requestId/status
POST   /api/v1/service-requests/:requestId/extend-sla

GET    /api/v1/dispatch/board
GET    /api/v1/dashboard/summary
GET    /api/v1/files/:fileId
```

## 10. Shared schema and enum inventory

Constants: `permissions.ts` (28 keys, 6 system roles), `employee.ts` (statuses, types, genders, marital statuses, education levels, safety grades, qualification levels, document types, salary calculation types, currencies), `service-request.ts` (14 statuses, transition map, request types, 6 SLA states, SLA hours, 5 risk bands).

Zod schemas: `common.schema.ts`, `employee.schema.ts`, `service-request.schema.ts`, `rbac.schema.ts`.

`packages/shared` now depends on `zod` so the same schema object is imported by the Express validator and the React form. There is exactly one definition of every field rule.

## 11. Employee data model

Identity, employment, operational, meal, and profile field groups exactly as enumerated in the Phase 1 brief. Education, work history and certificates are embedded arrays. Documents, salary and status history are separate collections.

## 12. Employee and User relationship

Separate entities, linked by the optional `Employee.systemUser` reference with a unique partial index, so one user maps to at most one employee. An employee may exist with no login. Passwords are never stored on the employee record; account creation reuses the existing auth flow.

## 13. Employee, Team, Skill and Dispatch relationship

`Employee.team` references `Team`. Skills, `qualificationLevel`, `safetyGrade` and `permittedJobTypes` live on the employee record. Dispatch reads employee data through the employee module; there is no duplicate employee dataset. `assignServiceRequest` rejects any employee whose status is not `ACTIVE`.

## 14. Employee salary-security model

Four layers:

1. Salary lives in a separate collection, so an employee query cannot return it incidentally.
2. `getEmployeeById` skips the salary query entirely without `employee.view_salary`, and **omits the key** from the response rather than nulling it.
3. Both salary endpoints are guarded by `requirePermission`.
4. Audit rows for a salary change record only the effective dates, never the amounts, because `audit.view` holders do not necessarily hold `employee.view_salary`.

Verified by automated test and by live HTTP probe.

## 15. Service-request data model

Location is a denormalised chain of `ObjectNode` references. `validateLocationChain` verifies each node exists, is of the declared kind, belongs to the stated customer, and sits beneath its declared parent, which prevents a stale id from a changed parent selection reaching the database.

## 16. Object hierarchy model

One polymorphic `ObjectNode` collection discriminated by `kind`, with `parent`, a materialised `ancestors` array for single-query breadcrumbs, and a denormalised `customer` on every node. Children are loaded one level at a time; an unscoped query returns an empty list by design.

## 17. SLA ownership and calculation flow

The backend is the sole authority. `sla.service.ts` computes the deadline at creation (6 hours urgent, 24 standard, per requirements 8.1 and rule 17.10) and derives the state on read. The frontend renders a countdown from the backend deadline and never computes state.

`SLA_NEAR_BREACH_RATIO` (0.75) and `SLA_AT_RISK_RATIO` (0.9) are configuration defaults. Requirements 8.4 names the states but sets no thresholds; these are documented as defaults, not invented business rules.

## 18. Audit architecture

`AuditLog` is append-only; all seven mutation paths are blocked at the Mongoose layer. Audit writes never fail a business operation; failures are logged at error level.

Implemented events: employee created, updated, company/department/position/team/manager changed (each as its own row), status changed, salary changed, document uploaded, document removed, role created/updated/deleted, roles assigned, request created, assigned, status changed, SLA extended, plus the pre-existing authentication events.

## 19. File-upload architecture

multer writes to a configurable directory (`UPLOAD_DIR`) using a server-generated opaque filename. The caller's filename is stored only as display metadata. Downloads go through `GET /api/v1/files/:fileId`, which authenticates, checks the permission implied by the owning entity type, and streams with `Cache-Control: private, no-store`. `resolveStoredFilePath` refuses any path escaping the upload directory. No server path is ever exposed.

Limits: 10 MB per file, 10 files per request, allow-list of image, PDF, Word and Excel MIME types.

## 20. Frontend component structure

```
components/
  PermissionGuard.tsx
  layout/AppShell.tsx
  ui/{Alert,Badge,Button,ConfirmDialog,DataTable,DomainBadges,Drawer,Input,
      Modal,PageHeader,Select,Spinner,States,ToastProvider}.tsx
config/navigation.ts
contexts/auth-context.tsx
features/
  auth/{LoginPage,ChangePasswordPage}.tsx
  dashboard/DashboardPage.tsx
  dispatch/DispatchBoardPage.tsx
  employees/{EmployeeListPage,EmployeeFormPage,EmployeeDetailPage,EmployeeSalaryTab,
             EmployeeDocumentsPanel,FormControls,useEmployeeList,useOrgSelectors}
  objects/ObjectsPage.tsx
  service-requests/{ServiceRequestListPage,ServiceRequestCreatePage,
                    ServiceRequestDetailPage,useLocationChain}
  {PlannedModulePage,NotFoundPage}.tsx
lib/{api-client,permissions,token-storage,passcode}.ts
services/{auth,user,employee,org,object,service-request}.service.ts
test/{setup.ts,render.tsx}
```

`DataTable` embeds its own loading, error and empty presentation, so no list screen
can ship a blank panel while fetching or failing. `States.tsx` holds the shared
Skeleton, EmptyState, ErrorState, ForbiddenState and PlannedModuleState panels.

## 21. Backend module structure

```
modules/
  audit/     auth/      dashboard/
  employee/  {model, salary, status-history, document, mapper, service, controller, routes}
  objects/   org/       rbac/     service-request/   storage/   user/
```

## 22. Implementation sequence followed

Shared contracts, RBAC foundation, organisation models, employee module, storage, object hierarchy, service requests, dispatch, dashboard, web shell, employee UI, tests, verification.

## 23. Requirement versus wireframe conflicts

| # | Conflict | Resolution |
|---|---|---|
| 1 | Phase 1 brief lists request statuses `EN_ROUTE`, `ARRIVED`, `PENDING_APPROVAL`. Requirements 14.1 defines the same states as `ON_THE_WAY`, `ON_SITE`, `VERIFICATION` | Followed the requirements document. Rejected the brief's alternative names. Mongolian labels come from 14.1 verbatim |
| 2 | Admin prototype has a `Гэрээ` (contract) sidebar item | Rejected. Test case TC-002 states no separate contract module exists; service conditions live inside the customer detail tab (requirements 6.1) |
| 3 | Admin prototype's customer form offers `Байгууллага / Хувь хүн` | Rejected the individual option. Rule 17.2 states a V1 customer is always an organisation |
| 4 | Prototype embeds sample data and prototype-only JavaScript | Used only for layout, spacing, table, tab, filter and badge patterns. No sample values carried over |
| 5 | Brief implies six top-level roles; repository has four | Resolved by user decision to add dynamic RBAC. The four coarse roles are retained for the mobile client; the six admin duties are seeded as dynamic roles |

## 24. Assumptions confirmed by repository evidence

- The response envelope `{ success, data, message }` and error shape were taken from the existing middleware, not invented.
- Phone and registration-number formats match the patterns already used by the `User` model.
- Mongolian labels, `Asia/Ulaanbaatar` and MNT follow requirements 16.1 and existing constants.
- The audit action vocabulary extends the existing enum rather than replacing it.

## 25. Blocked items requiring clarification

1. **Employee registration screenshot is absent.** Reference file 5 is not in the repository; a search of all image formats found only the requirements PDF. The three-tab form was built from the field list in the brief, using the admin prototype for layout. The exact visual layout cannot be matched to a screenshot that was never supplied.
2. ~~**Service-agreement model.**~~ Resolved. The collection exists (requirements 6.2) and the dashboard counts active agreements for real; the hardcoded zero is gone (section 31.1).
3. **Building and floor aggregate risk score.** Requirements 19.2 lists this as an open decision (worst score, average, or weighted average) to be settled by the customer and the technical team. No aggregation was implemented.
4. **Plan editor format and coordinate system.** Requirements 19.2 open decision: image, PDF or SVG, plus scale, coordinate system and version migration. Owner: UX and development. Note the scope: the plan IMAGE is built (section 29.4); what stays blocked is placing objects at coordinates on it, line routing and any drawing tool.
5. **Overdue invoice action.** Requirements 19.2 open decision: remind only, flag as risky, or suspend service. Owner: management and finance. This no longer blocks the module: Нэхэмжлэл ба төлбөр is built and OVERDUE is derived and reported, but the system takes **no automatic action** and every screen says so (section 30.2).
6. **Capacity standard tables** for cable, breaker, RCD and wet-environment selection. Owner: technical engineer. Blocks parts of Үзлэг and Төхөөрөмж.
7. **Notification delivery channel.** Requirements 14.3 tabulates every event and its recipients, but never states the channel, and 19.2 leaves it open. The in-app centre is built; email, SMS and push are not, and the screen states the limit rather than implying a delivery that never happens (section 30.4).
8. **Customer confirmation legality.** Requirements 19.2 open decision: in-app confirmation versus digital signature or a stamped PDF. This does not block internal report approval, which is decided and implemented (section 28); it blocks only the customer-facing confirmation step.

The three planned-work questions previously listed here, on overdue ownership, report
approval authority and paused-resume semantics, were answered by the product owner and are
recorded as confirmed decisions in section 28. They are no longer blocked.

## 26. Missing backend integrations for the frontend

Every screen delivered so far is wired to a real endpoint. No development fixtures were
introduced, and no page holds hardcoded domain data. The gaps below are features whose
**backend does not exist yet**, so the corresponding UI is either absent or explicitly
labelled as planned rather than faked.

### Closed in the backend completion pass

| Need | Endpoint added | Consumed by |
|---|---|---|
| Assign employees or a team from the board | `GET /dispatch/employee-candidates`, `GET /dispatch/team-candidates` | `AssignDrawer` on the dispatch board. Candidates carry live workload counts and only ACTIVE employees are returned |
| Employee workload | Aggregated from `ServiceRequest` in `employee-workload.service.ts` | Employee detail page. Two grouped aggregations, not one query per employee |
| Request location breadcrumb | `locationPath` now resolved from the materialised ancestor chain | Present in `GET /service-requests/:id`; the detail page still renders flat rows, so this is available but not yet displayed as a trail |
| Service-request attachments | `POST /files/service-request-attachments` | Endpoint and ownership transfer are implemented and the detail payload returns attachments; the create form does not yet expose an upload control |
| Customer create and edit | `POST`/`PATCH /objects/customers` | Endpoints and audit are implemented; the `/customers` screen is not built |
| Object node create and edit | `POST`/`PATCH /objects/nodes` | Endpoints implemented with full hierarchy validation; the browser remains view-only |

Attachment uploads are parked against the uploader until a request claims them, because
the create form needs file ids before the request exists. Ownership transfers to the
request on creation so the download permission check resolves against the real owner.

### Still outstanding

| Frontend need | Required backend | Current state |
|---|---|---|
| Service-agreement count on the dashboard | Service-agreement collection (requirements 6.2) | Returns zero, not guessed. Out of Phase 1 scope |
| Planned-work progress on the dashboard | Planned-work module (requirements 7) | Module now implemented; the dashboard tile is not yet wired to it |
| Notifications | Notification module (requirements 14.3) | Built, in-app only. See section 30.4 |
| Customer management screens | Endpoints now exist | Built |

## 27. Known gaps

- Employee education, work history and certificate arrays are accepted by the API but have no repeater UI; the form sends empty arrays and the Анкет tab explains this.
- The employee certificate prints through a clean browser document rather than a server-rendered PDF. No PDF library exists in the repository.
- `slaState` filtering happens after pagination, so a filtered page can return fewer rows than the page size. Correcting this needs an aggregation pipeline.
- Drag and drop is deliberately not implemented on the dispatch board. Moving a card is not authorisation to change a status, and the detail page already provides a keyboard-accessible, backend-validated transition control.
- Employee document deletion uses `window.confirm`; the reusable `ConfirmDialog` is used for the service-request flows that require a reason.
- Employee workload counters aggregate service requests only. Planned-work assignments are not yet counted toward workload, on the dashboard chart or on the employee page.
- The dashboard trend covers service requests only; planned work is summarised as a completion percentage rather than plotted over time.
- Planned-work sub-tasks reference a floor but not yet an Object; `PlannedWorkTask.relatedObjects` exists and feeds object history, but no UI writes it.
- Turborepo `test` task added, but `apps/mobile` is outside the workspace and is verified separately with `flutter test`.

## 28. Төлөвлөгөөт ажил: confirmed business decisions

These decisions were supplied by the product owner and are now implemented. They replace
the three items that section 25 previously listed as blocked.

### 28.1 One project owns many planned works

Requirements state only that a planned work must belong to one project. Nothing states
that a project may have one active planned work at a time, so no such constraint exists:

- `PlannedWork.project` is a plain indexed reference, not a unique or partial-unique index.
- Creation never inspects whether the project already has an active work.
- A project may run any number of planned works concurrently, in different buildings,
  periods, work types, employees or teams.

Covered by `planned-work.api.test.ts`, "allows a project to own several concurrent
planned works".

### 28.2 Progress is quantity-weighted, never task-count based

Each `PlannedWorkTask` carries `totalQuantity` and `completedQuantity`. Everything else is
derived by the backend and published on the DTO:

| Figure | Derivation |
|---|---|
| `remainingQuantity` | `totalQuantity - completedQuantity`, clamped at zero |
| task `progressPercent` | `completedQuantity / totalQuantity * 100` |
| work `progressPercent` | `sum(completedQuantity) / sum(totalQuantity) * 100` over included tasks |
| floor `progressPercent` | the same aggregation restricted to that floor |

Validation: `totalQuantity` must be greater than zero; `completedQuantity` must lie between
zero and `totalQuantity`; reducing `totalQuantity` below a recorded `completedQuantity`
clamps the completed figure rather than leaving an impossible pair.

`progressPercentOf` reports 100 only when the quantity is genuinely complete, and caps at
99.9 otherwise, so a nearly finished task cannot read as finished.

A **skipped** task is excluded from both numerator and denominator, so skipping does not
depress the percentage of work that was really done.

### 28.3 Task status is derived, never selected

No route accepts a task status. `deriveTaskStatus` is the only producer:

- `completedQuantity` zero and not started: `PENDING`
- `completedQuantity` zero but reported as started: `IN_PROGRESS`
- partial quantity: `IN_PROGRESS`
- full quantity with complete evidence: `DONE`
- full quantity with missing evidence: `IN_PROGRESS`
- explicitly skipped: `SKIPPED`

Required completion evidence for a 100 percent task is a before photo, an after photo, a
conclusion and a recommendation. `missingEvidence` is published on the task DTO so the UI
explains what is outstanding instead of hiding a disabled control. Deleting a photo
re-derives the status and can pull a task back out of `DONE`, which is intended.

### 28.4 OVERDUE is a system-controlled effective status

Persisted lifecycle statuses: `DRAFT`, `PLANNED`, `STARTED`, `PAUSED`, `COMPLETED`,
`ARCHIVED`, `CANCELLED`. `OVERDUE` is **never** persisted as a lifecycle state.

The backend returns `effectiveStatus` on every DTO:

- `OVERDUE` when `plannedEndDate` is earlier than server time and the lifecycle status is
  `PLANNED`, `STARTED` or `PAUSED`;
- the lifecycle status otherwise.

`DRAFT` is excluded because it was never formally planned. `COMPLETED`, `ARCHIVED` and
`CANCELLED` are excluded because the work is no longer outstanding. A paused work can
become overdue.

Stored fields: `overdueAt` and `overdueNotificationSentAt`, both nullable.

Reconciliation is two-layered:

1. `apps/backend/src/jobs/overdue-reconciliation.job.ts` runs hourly and once at boot;
2. a fallback pass in `markOverdueIfNeeded` runs on the reads and mutations that touch a
   work, so a stamp is never missing because the job has not fired.

The stamp is claimed with a conditional update on `overdueAt: null`, so the breach audit
event is written exactly once per breach:

```
action:   PLANNED_WORK_BECAME_OVERDUE
actor:    SYSTEM (userLabel "SYSTEM", user null)
oldValue: { effectiveStatus: <previous lifecycle status> }
newValue: { effectiveStatus: "OVERDUE", plannedEndDate, overdueAt }
```

List filtering, and therefore any dashboard count built on it, uses effective status. The
`OVERDUE` filter is expressed as a query over lifecycle status plus deadline so the
reported total stays truthful rather than being filtered after paging. Selecting a
lifecycle status excludes records that currently read as overdue, so the two figures add
up. The web client renders `effectiveStatus` and never derives it.

Reversal is possible only through an authorised reschedule. A different date sent through
the ordinary `PATCH` is rejected outright: `updatePlannedWorkSchema` is `.strict()` and has
no `plannedEndDate` field. `POST /planned-work/:id/reschedule` requires
`planned_work.reschedule`, a reason of at least five characters, backend validation that no
sub-task is stranded outside the new window, and writes a `PLANNED_WORK_RESCHEDULED` audit
record carrying both dates and whether the overdue state was cleared.

Late completion is preserved in reporting history: `completedLate`, `delayMinutes`, and
`originalPlannedEndDate`, which is captured at creation and survives every reschedule. The
full change history lives in `scheduleHistory`.

### 28.5 Report approval authority

A dedicated permission, `planned_work.approve_report`, granted by default to `MANAGEMENT`,
`ADMIN` and `SYSTEM_ADMIN`. Approval is never inferred from a reporting line, because an
assigned employee does not always have a manager who is valid for the work, and no named
approver is stored on the record.

Per-record rules, enforced in `approvalBlockersOf`:

- the report must be `SUBMITTED`;
- the approver must hold `planned_work.approve_report`;
- the approver must not be the report author;
- the approver must not be the submitter.

Emergency override uses the existing RBAC architecture rather than a new mechanism:
`head_admin` is already an unconditional superuser, so that identity alone may approve a
report it authored or submitted. The override sets `approvalWasOverride` on the record and
is audited with the reason `head_admin emergency override`.

Customer confirmation is separate from internal approval, is not required for it, and a
customer may only ever see an approved report (`visibleToCustomer`).

The report is its own workflow, not extra lifecycle statuses:

```
DRAFT -> SUBMITTED -> APPROVED
SUBMITTED -> RETURNED -> SUBMITTED
```

Submission requirements, all reported through `submissionBlockers`:

- every included task at 100 percent with complete evidence;
- every task conclusion and recommendation present;
- actual material usage recorded against each planned material;
- consolidated conclusion and recommendation present;
- the report preview generates successfully.

Return requires a reason of at least five characters, stores `returnedBy` and `returnedAt`,
and writes an audit record. A returned report leaves the planned work `COMPLETED`; it never
returns to `STARTED`.

Lifecycle relationship: completion creates the report in `DRAFT`; the author submits it;
approval archives the work. Archiving is unreachable except through
`archiveAfterReportApproval`, and approval plus archiving run in one transaction, so the
work is never archived without an approved report and an approved report never leaves the
work unarchived.

Audit vocabulary added: `PLANNED_WORK_BECAME_OVERDUE`, `PLANNED_WORK_RESCHEDULED`,
`PLANNED_WORK_ARCHIVED`, `REPORT_CREATED`, `REPORT_UPDATED`, `REPORT_SUBMITTED`,
`REPORT_RETURNED`, `REPORT_APPROVED`. Each is a distinct governance event that must be
filterable on its own, which is why they are named rather than folded into the generic
`Submitted` and `Approved` actions.

Stored approval fields: `createdBy`, `createdByName`, `submittedBy`, `submittedByName`,
`submittedAt`, `approvedBy`, `approvedByName`, `approvedAt`, `approvalWasOverride`,
`returnedBy`, `returnedByName`, `returnedAt`, `returnReason`.

### 28.6 Paused semantics

Pausing changes neither `plannedStartDate` nor `plannedEndDate`. The original deadline
stays in force, so:

- a paused work can become overdue;
- resuming does not extend the deadline;
- there is no hidden automatic extension anywhere in the code path.

Pause requires a reason, and records `pausedBy`, `pausedAt` and an audit event.
`currentPauseStartedAt`, `totalPausedMinutes` and a full `pauseHistory` with actor,
timestamp and reason are tracked. Resume records `resumedBy` and `resumedAt`, closes the
open pause episode, adds the elapsed minutes to `totalPausedMinutes`, and audits the
transition. The resume target is `STARTED` when `actualStartDate` exists and `PLANNED`
when it does not.

Extending the schedule after a pause is an explicit reschedule with its own permission,
reason, validation and audit record.

### 28.7 Lifecycle transition matrix

| From | Permitted actions |
|---|---|
| `DRAFT` | `PLAN`, `CANCEL` |
| `PLANNED` | `START`, `PAUSE`, `CANCEL`; may read as `OVERDUE` |
| `STARTED` | `PAUSE`, `COMPLETE` when all completion rules pass, `CANCEL`; may read as `OVERDUE` |
| `PAUSED` | `RESUME` to `PLANNED` or `STARTED`, `CANCEL`; may read as `OVERDUE` |
| `COMPLETED` | report workflow only; `ARCHIVED` only after approval; never returns to `STARTED` |
| `ARCHIVED` | terminal, read-only |
| `CANCELLED` | terminal; reason, actor and timestamp mandatory |

`PAUSE` and `CANCEL` require a reason. `CANCEL` requires `planned_work.cancel`; the other
actions require `planned_work.change_status`. `ARCHIVE` is absent from the action list
because archiving is a consequence of approval, and `OVERDUE` is absent because it is not a
lifecycle state.

### 28.8 Implementation rules honoured

- `workNumber` uses an atomic counter document (`Counter`, `nextSequenceValue`), so
  concurrent creations cannot be handed the same number. This is stronger than counting
  existing rows and relying on a unique-index collision plus retry, which is what the
  service-request numbering still does.
- All date comparisons use server time; timestamps are stored in UTC and displayed in
  `Asia/Ulaanbaatar`.
- Every lifecycle transition goes through `planned-work.transition.service.ts`. No other
  module writes `status`.
- Frontend buttons are generated from `work.availableActions`, computed by the backend from
  the matrix plus the caller's permissions. The client holds no copy of the matrix.
- A generic `PATCH` cannot write status: `updatePlannedWorkSchema` is `.strict()` and omits
  both `status` and `plannedEndDate`.
- Completion and approval run inside `withTransaction`.

**Transaction caveat, recorded deliberately.** Multi-document transactions require a
replica set. A single-node `mongod` started for local development does not provide one, and
the driver rejects the operation. `apps/backend/src/common/utils/transaction.util.ts`
probes support once and, when transactions are unavailable, runs the same callback without
a session and logs a warning. What is lost on such a server is atomicity, not the
correctness of the individual writes. **Use a replica set in production.**

### 28.9 Calendar

`GET /calendar` projects planned work and service requests over a mandatory, bounded window
(92 days maximum). There is no calendar-only entity: every event carries `source`,
`sourceId` and `detailPath` back to its owning record.

- Planned work supplies its backend-derived `effectiveStatus` and quantity-weighted
  progress. Cancelled work is excluded because it is not a schedule commitment.
- A service request occupies the span from creation to its SLA deadline. Requests with no
  deadline are excluded rather than pinned to an arbitrary date. `progressPercent` is null
  because a request has no quantity to measure.
- Each source is included only when the caller holds the permission that governs it, so a
  user without planned-work access sees their requests rather than a 403. A caller who can
  read neither source gets 403.
- Views: month, week, day and agenda. The month grid fetches whole weeks, so leading and
  trailing days are populated. The response carries the server timezone, which the UI
  displays; the client performs no status arithmetic.

## 29. Project hierarchy and Object master data

Confirmed by the product owner and implemented. Three decisions were taken explicitly and
are recorded here because none of them is derivable from the requirements alone.

### 29.1 Decisions taken

| Question | Decision | Consequence |
|---|---|---|
| Can one Object be linked to more than one Floor? | **One Floor per Object** | `Object.floor` is a single reference. Re-linking moves the object and is audited on both sides. No join collection. |
| Build the section 4.1 type registry now, or use fixed types? | **Build the registry** | `ObjectType` is an administrator-managed catalogue with all eight section 4.1 fields. |
| What happens to floor equipment that is not fed by any panel circuit? | **Report separately, exclude from the floor total** | Section 11.5 defines the floor total as the sum of panel loads; that formula is left untouched and the unattached figure is reported on its own. |

### 29.2 Catalogue versus placement

Corrected by the product owner after the first cut. The catalogue and the placement are
different things, and only the catalogue is a module of its own.

```
Project module                            Catalogue
  ObjectNode                                ObjectType   section 4.1 registry
    PROJECT                                              the product list
    BUILDING
    FLOOR                                 An object instance is a placement:
  FloorPlan                               it is created on a floor, carries the
  Object       PANEL | CIRCUIT | EQUIPMENT   measurements taken there, and
  ObjectAssessment   append-only history     references a catalogue type.
```

An object instance is created, measured and assessed **on the floor**. It has no existence
apart from the floor it sits on, so it is not a sidebar module and its screens live under
the floor path:

```
/floors/:floorId                          floor detail
/floors/:floorId/objects/new              create an object on this floor
/floors/:floorId/objects/:objectId        object detail, with a back link to the floor
/floors/:floorId/objects/:objectId/edit
/object-types                             Тоноглолын каталог, the product list
```

The old `/objects-master` list screen is archived under `docs/archive/object-master-list/`.
The backend is unchanged: `POST /objects-master` already took a `floorId` and
`GET /objects-master?floorId=` already existed, so only the UI moved.

The customer is no longer chosen on the object form. It is read off the floor in the route,
which removes the only way the two could disagree.

Linking an existing object to a floor is kept as the secondary `Байгаа объект холбох`
action: relocating a panel to another floor is a real need and the backend already supports
and audits it. Creating is the primary action.

`ObjectNode` keeps the single polymorphic collection so the breadcrumb and the dependent
selectors stay written once, and gains a kind-specific `attributes` sub-document carrying
the section 4.2 fields. `ROOM`, `PANEL`, `CIRCUIT` and `DEVICE` remain in the kind enum for
historical rows but are no longer created: panels, circuits and equipment are master data.

### 29.3 Two levels of typing

Structural CATEGORY versus catalogue TYPE, and they do different jobs:

- **Category** (`PANEL` / `CIRCUIT` / `EQUIPMENT`) is fixed and decides which section 4.2
  fields exist at all, and which section 11.5 formula applies.
- **Type** is a row in the section 4.1 registry, for example MCB or Гэрэл. It carries
  `generatesConclusion`, which decides whether an object may be assessed, plus `showOnPlan`
  and `icon`, which are stored for the still-unapproved plan editor and read by nothing.

`ObjectType.category` is not a section 4.1 field. It was added because without it a cable
type could be attached to a panel and the per-category validation would have nothing to key
on. Category and code are both immutable after creation: changing either would silently
invalidate every object already using the type.

Validation is a Zod discriminated union with `.strict()` on every branch, so a panel payload
carrying an `equipment` block is rejected rather than having the stray field quietly
stripped and stored as an incomplete object.

### 29.4 Floor plan image: built. Plan editor: not built.

Requirements 11.1 and rule 17.3 require every floor to have a plan and require plan changes
to be audited. That is decidable and is implemented: upload, immediate preview, replace,
metadata edit and removal, each writing its own audit record.

There is deliberately **no** version number, no `supersededBy`, no version switch, no
migration, no coordinate placement, no X/Y positioning, no drawing tool and no cable routing
editor. Requirements 19.2 leaves the plan editor format, scale and coordinate system
unapproved, and section 11.2 carries the customer's own note that the placement rules are
not settled. A web test asserts the version fields are absent from the payload.

Replacement removes the previous image outright. With no version to hold it, a superseded
file would be an unreachable orphan; the audit record names both the old and the new file
so the change stays traceable.

### 29.5 Load calculation, section 11.5 only

| Figure | Formula |
|---|---|
| equipment | `Σ (нэрлэсэн чадал × тоо ширхэг × ашиглалтын коэффициент)`, default coefficient 1.0 |
| circuit ratio | `хэлхээний ачаалал ÷ зөвшөөрөгдөх чадал × 100` |
| panel ratio | `самбарын ачаалал ÷ хүчин чадал × 100` |
| floor total | sum of the panel loads on that floor |
| reserve | `хүчин чадал − тооцоолсон ачаалал` |

Rule 17.17 excludes a decommissioned object. Rule 17.18 reports an incomplete calculation as
`Бүрэн бус` carrying the reason, never as a zero. Rule 17.16 keeps calculated and measured
load separate and derives only the variance.

**Not implemented, and why.** Section 11.6 dangerous-connection checks compare against cable,
breaker, RCD and wet-environment standard tables that section 19.2 leaves unapproved, so no
ampacity table, breaker-sizing rule or phase-balance threshold is invented. Section 11.5 also
asks for reserve in kVA; converting kW to kVA needs a power factor that section 4.2 never
records on a panel, so the response carries `kvaNote` explaining the omission instead of a
fabricated number.

No single aggregate risk score is produced for a building or a floor: section 19.2 leaves the
aggregation method (worst, average or weighted) unapproved. Counts per level and an
unassessed count are reported instead.

### 29.6 Assessment history is append-only

`ObjectAssessment` blocks all eight mutation paths at the model layer, exactly as the audit
log and the material ledger do. Section 10.1 requires the previous and new score, the
assessor, the date, the photos and the conclusion to be kept, and rule 17.15 forbids deleting
log or status history.

Band-conditional requirements are applied in the service rather than the schema, because the
band thresholds are configurable per section 16.1 and only the backend knows the current
values:

- red or black: conclusion, recommendation and action taken are all mandatory
- yellow or orange: recommendation is mandatory, plus a repair or a revisit
- a flagged revisit needs a date and an owner (section 9.3)

Rule 17.9 is enforced automatically: an object scored into the black band is moved to
`DECOMMISSIONED` rather than left in active use.

### 29.7 Object history sources

| Row kind | Source |
|---|---|
| Assessment | `ObjectAssessment`, the append-only spine |
| Measurement | the measured reading on those same assessments; section 9.1 records a measurement as part of the work, not as its own entity |
| Inspection / Repair | service requests naming the object, split by `requestType` |
| Planned work | `PlannedWorkTask.relatedObjects` |
| Audit | the immutable audit log |

### 29.8 Deletion versus archiving

Deletion is refused whenever a dependent record exists and the reasons are published on the
DTO as `deleteBlockers`, so the UI explains a missing button instead of hiding it silently.
An assessed object can therefore never be deleted, only archived. The same applies up the
hierarchy: a project with buildings, a building with floors, a floor with linked objects or a
plan image.

### 29.9 Navigation change

The sidebar was restructured after this module landed:

- **Төсөл ба объект** (the read-only hierarchy browser) is removed. Project, Building and
  Floor now have their own CRUD screens, which supersede it. The component is archived under
  `docs/archive/objects-browser/`.
- **План зураг** is removed as a sidebar module. The plan image lives on the floor detail
  screen, which is where it is actually used, and the plan editor is unapproved.
- **Dispatch board** is now a tab of the service-request module at
  `/service-requests/dispatch`, not a separate sidebar entry. It is a way of working the
  request queue rather than a separate domain. `/dispatch` redirects.
- **Объектын бүртгэл** is removed as a sidebar module. An object instance is a placement on
  a floor, not free-standing master data, so it is created and read inside Төсөл. See 29.2.
- **Тоноглолын төрөл** is relabelled **Тоноглолын каталог** so the sidebar states plainly
  that it is the product list rather than a list of installed equipment.
- **Calendar** and **Мэдэгдэл** are header icons rather than sidebar entries. Both are
  consulted from every module rather than being places you work in. Both remain
  permission-gated exactly as a sidebar entry would be.

The notification icon still points at the planned-module placeholder: section 14.3 defines
who receives what but never states the delivery channel, and that question is unanswered.

### 29.10 Floor detail screen order

Fixed by the product owner and asserted by a test that compares document positions:

1. General information and the plan image
2. Objects on the floor

The load calculation is no longer a separate block at the bottom of the page. Object counts
(Самбар / Хэлхээ / Тоноглол), the section 11.5 load figures (Давхрын нийт ачаалал / Хэмжсэн
нийт / Зөрүү), the risk band counts, the unassessed count, the unattached-equipment note and
the kVA note all sit inside the single `Ерөнхий мэдээлэл` card, because they describe the
same floor and were read as one thing. Nothing was removed; it moved.

Creating an object and linking an existing one are both disabled until a plan image exists.

### 29.11 Үнэлгээ display

A single object's үнэлгээ is shown as a percent, not as a band name:

```
before   Хэвийн (92)              after   * 92%
         Ноцтой эрсдэлтэй (38)            * 38%
```

Section 10.1 makes the score a 0-100 figure, so the percent is the score itself and no
conversion is applied. The band still drives the colour and remains the accessible name and
the tooltip, so the meaning survives for a screen reader and on hover. This applies wherever
a single object is scored: the floor object table, the object detail header, the child
circuit and equipment tables, and the assessment history rows.

Where a band is named rather than an object scored, the band label stays: the risk-count
breakdown on the floor card.

### 29.12 Үнэлгээ across the hierarchy

`ProjectDto`, `BuildingDto` and `FloorDto` now carry a `riskSummary`:

```ts
interface RiskSummaryDto {
  counts: readonly RiskLevelCountDto[];   // non-zero bands only
  unassessedCount: number;
  hasCritical: boolean;                   // section 10.2 warning marker
  lastAssessedAt: string | null;          // the prototype's "Сүүлийн үзлэг"
}
```

Rendered as a `Үнэлгээ` column on the project list, on the buildings table inside a project
and on the floors table inside a building, with `Сүүлийн үзлэг` alongside it on floors.

**Still no aggregate score.** Section 19.2 leaves the building and floor aggregation method
unapproved, so this is counts and a warning marker, never one rolled-up number. A test
asserts no percentage is emitted by the summary cell.

**All five bands, not the prototype's three.** The prototype's buildings and floors tables
carry `Green / Yellow / Red` columns. Section 10 defines five bands, and collapsing five into
three would require a mapping nobody approved, so every non-zero band is shown with its own
band colour and the band name as its accessible label. Recorded here as a deliberate
deviation from the prototype.

**Batched, not N+1.** `riskSummariesFor` in `apps/backend/src/modules/objects/project.service.ts`
resolves a whole page in two queries: one mapping floors to their owning project or building
through the materialised `ancestors` array, one `$group` over objects by floor and
`latestAssessment.riskLevel` with a `$max` on `assessedAt`.

### 29.13 Back navigation

`PageHeader` gained an optional `backTo`, so every detail page with a parent offers one
explicit way back rather than relying on breadcrumbs alone:

| Page | Back to |
|---|---|
| Project detail | Төслийн жагсаалт |
| Building detail | its project |
| Floor detail | its building |
| Object detail and form | its floor |

## 30. The four remaining modules

Үзлэг ба дүгнэлт, Нэхэмжлэл ба төлбөр, Тайлан and Мэдэгдэл are built. Every sidebar entry
now resolves to a real screen; `PlannedModulePage` is no longer reachable from navigation.

Three decisions were taken explicitly for this work and are recorded because none of them
follows from the requirements alone.

| Question | Decision |
|---|---|
| What is `Үзлэг ба дүгнэлт`? | The prototype's **Нэгдсэн төхөөрөмжийн тайлан**: a consolidated read over the existing assessments. Not a second store, and not a new approval workflow. |
| What may an invoice contain? | The agreement's monthly fee plus tax, generated; anything else is a line finance enters by hand. Nothing is auto-charged from a rule nobody approved. |
| How is rule 17.20 export satisfied? | CSV with a UTF-8 BOM for Excel, and the browser print dialog for PDF. No server-side PDF or xlsx dependency. |

### 30.1 Үзлэг ба дүгнэлт: a report, not a workflow

`/inspections` reads the append-only `ObjectAssessment` history across every project,
building and floor, matching the prototype screen of the same name: report number, device,
location trail, score, conclusion, recommendation, owner and state, with the prototype's
filter bar and band counters above it.

There is deliberately **no** draft-submit-approve chain here. An assessment is immutable
once written (requirements 10.1, rule 17.15), so every row is a settled fact rather than a
draft awaiting sign-off. Section 9.4 defines report approval, and that chain already exists
where it belongs: on the planned-work report.

The service-request status flow is untouched. Rules 17.6 and 17.7 tie completion to a
conclusion, and today a service request can still reach COMPLETED without one; adding that
gate would change existing behaviour and is a separate decision.

Counters are per band and per **object**, not per assessment row: a device assessed five
times is one device. No aggregate score is produced anywhere (section 19.2).

### 30.2 Нэхэмжлэл ба төлбөр

```
Invoice   DRAFT -> SENT -> PAID
                \-> CANCELLED  (reason mandatory, from DRAFT or SENT)
```

- **Amount source.** Requirements 12.2 sources the monthly fee from the customer's service
  agreement, which already exists with `monthlyFee`. Section 12.1 also says "төсөл бүрд нэг
  үнэ оруулна", but no project price field exists and 12.2 is the authoritative source
  table, so the agreement wins. **Recorded conflict**; no second price was invented.
- **Tax.** Requirements 12.2 sources tax from the finance settings and states no rate, so a
  `finance.tax_percent` setting was added defaulting to **0**. An untaxed invoice is
  produced until finance sets the real figure, and the screens say so. A rate applied at
  creation is stored on the invoice, so a later settings change cannot rewrite history.
- **No stored OVERDUE.** Section 12.3 defines OVERDUE against the due date. Storing it
  would need a scheduler to flip rows at midnight and would disagree with the clock in
  between, so it is derived on read, exactly as planned work derives its overdue state. The
  list filter expresses it as the condition that defines it, so pagination stays honest.
- **No automatic overdue action.** Section 19.2 leaves the action unapproved. The invoice is
  reported as overdue with a day count and nothing else happens.
- **No partial payment, no Payment collection.** Section 12.1 excludes both from V1 and 12.3
  requires the payment to equal the invoice total, so a settled invoice carries exactly one
  embedded payment. A mismatched amount is rejected rather than stored as a balance.
- **Duplicate rule.** Section 12.3 forbids a second invoice on the same customer, period and
  billing type. The unique index is **partial** on `status != CANCELLED`, so cancelling a
  wrong invoice frees the slot; without that, one mistake would block the period forever,
  which contradicts the same clause requiring a replacement to carry the cancelled
  invoice's reference.
- **Duplicate payment reference** warns rather than refuses (12.3 says анхааруулна): the
  same bank reference can legitimately settle a re-issued invoice. The warning is written to
  the status history and the audit record.
- **Permissions.** Preparing, issuing, taking payment and cancelling are four separate keys,
  so a clerk can draft an invoice without being able to issue it.

### 30.3 Тайлан

All nine section 15.2 reports and all seven section 15.3 KPIs, each an aggregation over data
another module already produced. Columns travel with the rows, so one screen and one CSV
writer serve the whole catalogue and adding a report needs no frontend change.

- A KPI whose denominator is zero reports **null**, rendered as a dash. A rate over an empty
  set is undefined, not zero.
- Each KPI carries its formula and its section 15.3 purpose, so a number can be read back to
  its inputs rather than trusted.
- A capped row set reports `truncatedAt` and the screen warns, so an export can never be
  mistaken for a complete one.
- **Export** is gated on `report.export`, separately from `report.view`: section 14.2
  restricts who may take a file out of the system. CSV carries a UTF-8 BOM, which is what
  makes Excel open Cyrillic on a double click instead of mangling it.

### 30.4 Мэдэгдэл: in-app only

Every event in the section 14.3 table is transcribed into `NOTIFICATION_EVENTS`. What 14.3
never states is the delivery channel, and 19.2 leaves it open, so nothing is sent by email,
SMS or push and the screen states that limit.

Recipients are resolved by **permission**, because 14.3 names recipients by duty ("админ",
"менежер") and a permission is the only definition of a duty the system actually enforces.
Roles stay editable and the mapping follows them. One row is written per recipient, since
read state is personal, and the actor is never notified about their own action.

Writes are wired into the service-request create, assign and status-change paths, the
assessment path (bands below green, plus repair and revisit), and invoice issue. The writer
swallows its own failures exactly as the audit writer does: a notification must never turn a
successful operation into a 500.

The recipient resolution is cached for 15 seconds and `Role.permissions` is indexed, because
this lookup sits on the write path of every notified domain event. A role edit drops the
cache immediately, so a permission change takes effect at once. Nothing here is an
authorisation decision: access is still checked per request, and a stale entry can only
misdirect a notification for a few seconds.

### 30.5 Test-harness change

Suites previously took a database each, dropped on teardown. That bought no isolation the
per-test collection reset did not already provide, and `dropDatabase` on WiredTiger scales
badly: seventeen suites ran in about 220 seconds, twenty passed 1100 and unrelated suites
began timing out. Suites now share one database and empty collections instead, which is
cheap and constant.

## 31. Dashboard rebuild

Requirements 15.1 lists the dashboard indicators. The page now draws the distributions
instead of tabulating them, and leads with outstanding work rather than a log of finished
work. Three defects were fixed on the way.

### 31.1 Defects found and fixed

| Defect | Effect | Fix |
|---|---|---|
| The risk block queried `ObjectNode` with `kind: 'DEVICE'` and a `riskScore` field | The object master module superseded that shape, so the block reported **nothing** no matter how many assessments existed | Counts now come from `ObjectRecord.latestAssessment.riskLevel`. A test asserts it against seeded assessments so the regression cannot return |
| `activeServiceAgreements` was hardcoded to `0` | The agreement module shipped and the counter stayed stuck at zero | Counted from `ServiceAgreement` with status ACTIVE |
| Day boundaries used `setHours` | That is the **server's** local day. Deployed in UTC, "today" was wrong for eight hours out of every twenty-four | `dayBounds` resolves the day in `APP_TIMEZONE` through `Intl`, so daylight saving is the platform's problem rather than an offset constant. Eight unit tests, including a zone that does observe it |

`plannedWorkAverageProgress` was also declared on the DTO and never populated. It is now a
real block with total, in-progress, overdue and completed counts.

The route file previously held all the query logic, against the module convention. It moved
into `dashboard.service.ts`; the route is now the twelve lines it should always have been.

### 31.2 Today, not the audit tail

The bottom of the dashboard used to be the ten most recent audit rows. That answers "what
has already been recorded", which nobody acts on. It is replaced by **Өнөөдрийн ажил**:

- service requests that are due today, already past due, or urgent and still open;
- planned work that has started or is due, including work that is running late;
- ordered overdue first, then urgent, then by deadline, which is the order the day should
  be worked;
- counters for due, overdue, urgent, unassigned and completed today.

An overdue job from last week is today's problem, so it appears here rather than being
filtered out by a strict "created today" window. Completed work is **counted but not
listed**: it needs no action.

Every row links to its own record, so the panel is a worklist rather than a display.

### 31.3 Charts without a chart library

Hand-rolled SVG in `components/charts/Charts.tsx`: donut, horizontal bar, grouped bar,
multi-series line, and a progress bar. No new dependency. The repository already builds its
fetch hooks, form state and tables by hand, the bundle is over the size warning already, and
a chart library would still need wrapping to get the Cyrillic labels and the section 10
palette right.

| Chart | Shows | Requirement |
|---|---|---|
| Line | 14-day created versus completed requests | 15.1 |
| Donut | Risk bands across all objects | 15.1 |
| Donut | Requests by status | 15.1 |
| Bar | Open requests by work type | 15.1 |
| Grouped bar | Employee workload: active versus completed today | 15.1 |
| Progress | Planned-work completion | 15.1 |
| Donut | Invoice status, with overdue carved out of sent | 15.1 |

Three deliberate choices:

- **Accessibility.** A shape conveys nothing to a screen reader, so every chart is
  `role="img"` with the figures in its accessible name, and each also renders a legend or
  axis. No number is available only as geometry.
- **Zero baseline** on the line chart. Starting the axis at the data minimum makes a
  two-unit change look like a collapse.
- **Zero-count slices are dropped** server-side. A legend listing eleven statuses with ten
  zeroes hides the one that matters.

Risk bands keep the colours section 10 assigns them, and the donut still shows counts per
band with no aggregate score, because section 19.2 leaves the aggregation method unapproved.

Overdue invoices are carved out of the sent bucket rather than read as their own row, since
OVERDUE is derived from the due date and is not a stored status (section 30.2).

## 32. Asset diagram

A node and edge diagram of the electrical estate, on the dashboard, plus a generated view
of each project's objects on the customer page.

### 32.1 What this is not

It is **not** the section 11 floor-plan editor. That places objects at coordinates on a
scanned plan, requires every placed object to carry a master record (11.1, 11.3) and derives
colour from the latest assessment (11.3, 11.4); section 19.2 still leaves its format and
coordinate system unapproved, and it stays unbuilt.

This is a free-standing schematic on its own canvas. Every property is authored, which is
why node status carries its own vocabulary (`OK`, `WARNING`, `FAULT`, `OFFLINE`,
`MAINTENANCE`) rather than the section 10 risk bands: a risk band is derived from an
assessment and must never be hand-set, so the two must not be confusable.

### 32.2 Timeline, and why it is not versioning

The requirement asks to persist timeline data and to let a user change the timeline and
update the diagram state, while forbidding versioning and historical version storage. Those
are only compatible under one reading, which is the one implemented:

> A timeline is a list of **authored operating states**. Each step stores per-node and
> per-edge overrides (status, metrics, accent colour; edge colour, animation, dash, label).
> Selecting a step applies those overrides to the current diagram.

The structure lives in one document. A step stores no geometry and no structure, so it is
not a snapshot; removing one discards it and loses no history. Saving overwrites in place.

Three things enforce it, each with a test:

- the document has no `versions`, `history` or `supersededBy` field, asserted after
  repeated saves;
- the audit row records the **shape** of a change (name, node count, edge count), never the
  canvas, because writing the node array into every audit entry would rebuild a version
  store by the back door;
- applying a step never writes back into the authored elements.

If the intent was instead to time-travel through recorded assessment and load history, only
the source of the step data changes; the canvas, the API and the storage stay as they are.

### 32.3 React Flow

`@xyflow/react` 12, MIT. The requirement list — drag, connect, resize, pan, zoom, mini-map,
grid snapping, four-side handles, edge animation — is that library's feature set, and
hand-rolling pointer-level dragging, connection routing and a mini-map would be slower and
less robust. It is the web app's first UI dependency and costs about 85KB gzipped; the
bundle went from 175KB to 260KB gzipped.

Three things are still hand-written because the library's defaults fight the requirements:

- **Four-side handles.** One handle per side in `ConnectionMode.Loose`, so each acts as both
  source and target. Two overlapping handles per side would make the smaller unclickable.
- **Edge animation.** React Flow's `animated` flag hardcodes its own dash pattern, which
  would override the chosen dash style, so motion is a local CSS class that composes with
  whatever `stroke-dasharray` the edge carries. It respects `prefers-reduced-motion`.
- **Arrowheads.** Direction decides which ends carry a marker and the arrow type decides its
  shape, so `markerStart` and `markerEnd` are derived rather than set by hand.

### 32.4 Persistence

| Endpoint | Why it exists |
|---|---|
| `GET /diagrams/dashboard` | The dashboard asks for "the" canvas; returns null when none has been drawn, so the page offers to start one rather than erroring |
| `PUT /diagrams/:id` | Whole-document replace: the canvas is edited as one thing |
| `PATCH /diagrams/:id/viewport` | Pan and zoom fire on every wheel tick; rewriting the node array to remember a scroll position would be absurd, and it is not an audited event |
| `PATCH /diagrams/:id/active-step` | Gated on `diagram.view`, not manage: choosing which operating state to look at is reading |

Saving is explicit. The canvas changes on every drag, so autosaving would write hundreds of
times a minute; the viewport is the exception because it has its own cheap endpoint and
losing a scroll position costs nothing.

Element ids are minted on the client: an edge has to name its endpoints the instant it is
drawn, so waiting for the server would mean a round trip mid-drag. The API validates
referential integrity of the whole document, rejecting a dangling edge or a timeline step
that names a deleted element rather than cleaning it up silently, because either renders as
an invisible element instead of an error.

### 32.5 Customer page

The section 6.1 tabs now all resolve to real screens.

| Tab | What it shows |
|---|---|
| Төсөл ба объект | The selected project's objects, **generated from the records** |
| Төлөвлөгөөт ажил | The customer's planned works with quantity-weighted progress |
| Нэхэмжлэл ба төлбөр | The customer's invoices, with receivable, overdue and paid totals |
| ~~Мэдэгдэл ба Audit log~~ | Removed on the product owner's instruction |

The project visual is **derived, not authored**: `GET /projects/:id/graph` builds it from the
hierarchy and the electrical relations on every request, so it cannot drift from the data
and there is nothing to save, keep in sync or version. It is read-only for the same reason —
editing it would mean editing a picture of the data rather than the data. It reuses the
diagram's node and edge renderers, so both canvases look identical.

Containment (building → floor → object) is drawn dashed and faint; a real electrical feed
(panel → circuit → equipment, section 11.4) is drawn solid, so the two relations are not
mistaken for each other. Where a pair is linked both ways the feed wins.

Object status comes from the record: the latest assessment band maps onto the badge, a
decommissioned object reads as offline whatever its last score was, and an unassessed object
says `Үнэлгээгүй` rather than being given a score it does not have.

## 33. Dashboard customisation, and the diagram's scope corrected

### 33.1 What was wrong

"Customise my dashboard diagrams and boards" was read as a request for a node-and-edge
schematic editor. It meant the dashboard's own widgets should be configurable. The
schematic was removed from the dashboard (section 33.3 covers what became of it).

The customer page's Төсөл ба объект tab was also built as a node graph and read badly: a
hierarchy tree answers "what is connected to what", but the question being asked was "where
is the risk".

### 33.2 Widget layout

The dashboard is one page shared by every role, and what matters on it differs by job: a
dispatcher wants today's queue, finance wants receivables. Each user now chooses which of
the eleven widgets appear, in what order, and whether each takes half or full width.

- `GET/PUT/DELETE /dashboard/layout`, keyed by user, not by role: two dispatchers reading
  the same board still care about different things.
- Needs no permission beyond `dashboard.view`. **A layout is a display preference, never an
  access decision**: the summary payload already omits blocks the caller may not see, so a
  layout can only reorder and hide what they were already entitled to. A widget whose data
  is absent renders nothing rather than an empty frame.
- A row exists only once somebody customises. The default is a constant, so changing the
  shipped order needs no migration.
- **Reconciled on every read.** A widget the product has since removed is dropped; one added
  since the layout was saved is appended in its default state. Without that, the people who
  customised earliest would silently never see a new widget. Two tests cover both directions.
- Reordering uses up and down buttons rather than drag and drop: eleven rows on a settings
  panel, and a keyboard user gets the same control for none of the cost.

### 33.3 The schematic editor

Removed from the dashboard and from the customer page, so nothing imports the canvas any
more and React Flow is tree-shaken out: the bundle went back from 260KB to **196KB gzipped**.

The module is left in place rather than deleted — `apps/web/src/features/diagram/` and the
`/diagrams` API, both still tested — because the instruction was to take it off the
dashboard, not to drop the feature. If it is not wanted anywhere, it and the `@xyflow/react`
dependency can go in one commit.

### 33.4 Барилгын visualization

The customer's Төсөл ба объект tab now shows a bar per building: height is the number of
objects, and the bar is segmented by risk band with unassessed objects in blue. A project
selector sits above it, with building, floor, object and unassessed counts.

It is **stacked rather than one colour per building** on purpose. Colouring a whole building
by a single band would be an aggregate judgement, and section 19.2 leaves the building-level
aggregation method (worst, average or weighted) unapproved. Counts state what is there
without deciding that question. Section 10.2's warning marker is carried separately, as a
marker on any building holding a red or black object.

A building with no objects still draws at the minimum height: dropping it would read as the
building not existing. Each bar and each key entry links to the building.

## 34. Монхорус шаардлага: the fifteen-item list

Source: `Монхорус шаардлага.pdf` at the repository root, four pages, fifteen numbered items.
This document **overrides the older requirements where it is explicit**, and where it is
silent the consolidated requirements PDF still governs.

A second source arrived with it: `Үзлэгийн тайлан (2).docx`, a real completed inspection
report. It is the authority on the **shape** of the consolidated report, in the same way the
prototype HTML is the authority on UI. Where the requirement text is terse, this document is
what it is describing.

### 34.1 Items and where they landed

| # | Item | Where |
|---|---|---|
| 1 | One datum per table cell, user-configurable columns | `useTableColumns` + `ColumnPicker`, every table in the app |
| 2 | Sidebar icons instead of green/grey | `NavGlyph`, 16 hand-drawn glyphs; `implemented` flag removed |
| 3 | Remove unnecessary helper text | Page descriptions stripped; see 34.3 for what was kept |
| 4 | Consistent back button | `PageHeader backTo` |
| 5 (p1) | Create forms missing fields; GPS from a map | Project/building/floor forms; `MapPicker` (Leaflet + OSM) |
| 1 (p2) | Dashboard widget customisation | Section 33 |
| 2 (p2) | Employee system access lifecycle | 34.4 |
| 3 (p3) | Assessment percent shown in colour | Section 29, `ScorePercent` / `ScoreBar` |
| 5 (p3) | Sub-task documents visible to the admin | `TaskDetailDrawer`, thumbnail to enlarged preview |
| 6 | Sub-task Тайлбар and үнэлгээ, no Дүгнэлт | 34.2 |
| 7-11 | Consolidated inspection report | 34.5 |
| 12-13 | Service request completion gate and admin review | Section 9.2 work report, `assertReportAllows` |

### 34.2 Sub-task: Тайлбар, not Дүгнэлт

Item 6 separates two words the first build had conflated. A sub-task now carries a
**Тайлбар** describing the condition found, plus a **үнэлгээ** of 0-100 from which the risk
band is derived. **Дүгнэлт exists only at consolidated-report level.**

The band is always derived from the score through `riskLevelFor` with the thresholds from
Тохиргоо, and re-derived whenever the score changes. A caller supplying `riskLevel` gets a
400: the schema is `.strict()`. This keeps a re-banding in settings from leaving stale bands
behind.

**Confirmed by the product owner:** the score is **required** when completing a sub-task, but
sub-tasks already DONE without one are **grandfathered** — they stay DONE and their planned
work can still complete. The alternative, enforcing it retroactively, would have pulled every
existing completed sub-task back out of DONE and stalled work in flight. The report lists
such sub-tasks as үнэлгээгүй rather than refusing to generate.

**Migration.** Renaming `conclusion` to `note` leaves documents written before the change
holding a key the application no longer reads, which would silently drop those sub-tasks out
of DONE. `npm run migrate:task-note --workspace @monhorus/backend` performs the `$rename`.
It supports `--dry-run`, is safe to repeat, and reports rather than overwrites any document
that holds both keys.

### 34.3 Helper text: what was removed and what was not

Removed: page `description` props that restated the page title, and the hint under Холбогдсон
объект on the floor page.

**Kept deliberately**, because each states a rule or a consequence rather than describing the
obvious: the "устгах боломжгүй" notes on the audit log and material transactions, the
load-calculation and unapproved-scoring notes on the floor page, the assessment-history
immutability note, and the empty-state rule on the planned-work report. Detail-page
descriptions that carry record data (code, customer name) are data, not prose, and stayed.

### 34.4 Employee system access

Item 2 on page 2 asks for the full lifecycle from the employee record. Five operations, all
behind `employee.manage_system_access`: create or link a login, change the assigned roles,
suspend, restore, and revoke.

**Confirmed by the product owner:** "хүчингүй болгох" means the login stops working —
suspend the account, cut live sessions, and unlink it from the employee. The user document
and the whole audit trail are kept.

Every operation writes an audit row with old and new values plus the caller's reason.
`SELF_ACTION_FORBIDDEN` is enforced server-side on all five, including the case where the
caller names their own user id in link-existing mode. `assertCanManageRole` still applies, so
a plain admin cannot act on an admin or head_admin account.

**Open, not blocking.** Nothing records the status an account held before it was suspended,
so restoring an account that was `must_change_password` returns it to `active` and the pending
forced password change is dropped. Contained: restore refuses any status other than
`suspended`. Preserving it needs a new field on `User`.

### 34.5 The consolidated inspection report

Items 7 to 11. One report per planned work, generated once every non-skipped sub-task is done.

**What "баримт бичиг" means.** Confirmed by the product owner: a sub-task's document is the
record it already produces — before and after photos, the risk score, the Тайлбар describing
the condition, and the Зөвлөмж. There is **no separate checklist entity and no generated
document file**. Item 8's "шалгах хуудас болон үүсгэсэн баримт бичгүүд" is that record, not a
further artefact. This is why no checklist module was built.

**Илэрсэн зөрчил is derived, never entered.** Any sub-task scoring below Хэвийн is a finding,
carrying its own Тайлбар as the condition and its Зөвлөмж as the advice. Deriving it keeps
the finding list in step with the band thresholds in Тохиргоо, and avoids a third text field
that the performer would have to remember to fill and could contradict the other two.

**Overall safety level: worst wins.** Confirmed by the product owner, against averaging. One
unusable panel makes the inspection unusable, and an average would let a single dangerous
finding vanish behind good results elsewhere. Section 19.2 left the aggregation method open;
this is the recorded decision, and it applies **only here** — building and floor rows still
show counts and a warning marker, never a rolled-up number.

`overallSafetyLevel()` returns null when nothing was scored, and the UI shows Үнэлгээгүй.
An inspection with no evaluations has no verdict and must never render as safe.

**Nothing derived is stored.** The groups, the findings and the overall level are computed at
read time from the sub-tasks. Only the narrative, the replacement lists, the status, the
version and the who/when fields are persisted, so a report cannot go stale against the work
it describes.

**The admin's text is never overwritten.** The system composes the first draft of the issue
summary, conclusion and recommendation and sets `isAutoDraft`. The moment an administrator
edits any of them it clears, and regeneration preserves what they wrote.

**Versioning is a counter, not an archive.** Reopening a finalised report increments `version`
and returns it to DRAFT. No previous copy of the document is stored; the change history lives
in the audit log with its old and new values, which is where item 11's "өмнөх болон шинэ
утга" is read from.

### 34.6 Report structure, from the supplied document

`Үзлэгийн тайлан (2).docx` gives the layout the report must follow:

- Heading: Төслийн нэр, Ерөнхий гүйцэтгэгчийн нэр, Ил ба далд ажлын актны нэр
- Per sub-task: Ажлын нэр, Байршил, photos, Тайлбар, Зөвлөмж
- Closing table: Байршил, Үзлэгээр шалгасан, Дүгнэлт with the findings and their risk
  explanations, then Шинэчлэх шаардлагатай самбарууд and Шинэчлэх шаардлагатай холболт
- Зөвлөмж
- Signature block: Тайлан гүйцэтгэсэн and Хянасан, each with a name and a position

`contractorName` is the operator's own company and comes from settings — it is **not**
hardcoded in source, so a rename or a second operating entity does not require a code change.

### 34.7 The map picker

`apps/web/src/components/ui/MapPicker.tsx`, Leaflet 1.9.4 with OpenStreetMap tiles.

This is **the first and only place the web app fetches from an outside host**, so the building
form needs internet access. The trade was made deliberately in favour of a real map over
typed coordinates; self-hosting the tiles later changes one constant, `TILE_URL`.

Two details worth knowing. Leaflet's default marker icon resolves its image URLs relative to
the stylesheet, which the bundler rewrites and breaks, so the pin is a `divIcon` with no
image. And the coordinate boxes accept a pasted "47.9175, 106.9172" pair and split it, because
that is the shape people copy out of other maps.

Leaflet needs real layout and does not work under jsdom, so tests that render a form
containing the picker mock the component rather than Leaflet's internals.

### 34.8 Test suite runtime

The backend suite ran 366 seconds and the slowest file intermittently hit its 60 second
timeout. The cause was not the tests: at cost factor 12 every fixture user creation and login
cost about 250ms of bcrypt, and the heaviest file spends most of its time hashing.

`BCRYPT_ROUNDS` is now 4 when `NODE_ENV === 'test'` and 12 otherwise. The suite runs in **78
seconds** and the flake is gone with wide margin.

This does not weaken production hashing. Cost is a property of each stored hash and bcrypt
reads it back out when comparing, so only test fixtures are affected. The comparison is
equality against `'test'` rather than a check for "not production", so anything unexpected in
`NODE_ENV` yields 12: the weak factor must be asked for explicitly and cannot be reached by
accident. `src/test/setup.ts` sets `NODE_ENV` before any module loads.

### 34.9 Consolidated report: implementation notes

**Endpoints**, all under `/api/v1/planned-work/:plannedWorkId/inspection-report`:
`GET` (404 when none), `GET /readiness`, `POST` (generate, 201), `PATCH`, and
`POST /submit`, `/approve`, `/return`, `/finalise`, `/reopen`. Permissions reuse
`planned_work.view`, `planned_work.submit_report` and `planned_work.approve_report`. No new
permission key was introduced.

**The score gate is grandfathered by transition, not by date.** `hasScore` is satisfied when
the task is already stored as DONE, so a task that is not yet DONE must carry a score to get
there. Everything completed from now on has one, nothing in flight is pulled back out, and no
data migration is needed for this half.

**`SCORES_MISSING` is advisory.** Generation requires only that the work has at least one
sub-task and every non-skipped one is DONE, so `canGenerate` can be true while `blockers`
still reports a missing үнэлгээ. That follows directly from the grandfathering decision:
making it blocking would permanently withhold the report from every pre-existing work. The
per-task Үнэлгээгүй marker on the report body is where this stays visible.

**`contractorName` reuses the existing `general.company_name` setting**
("Байгууллагын нэр — Тайлан, хэвлэх баримт дээр гарна") rather than adding a second key. Its
seeded catalogue default is `'Монхорус ХХК'` and it is editable in Тохиргоо; no company name
is hardcoded in report source.

**`inspectionStart` / `inspectionEnd` come from the work's actual dates**, with no fallback to
the planned ones. A report generated before the work finishes shows a null end rather than a
date nobody achieved.

**Reopening clears the review stamps**, because a new version starts unreviewed. The previous
approver and dates are preserved in the `INSPECTION_REPORT_REOPENED` audit row.

**Generation is not gated on the work's lifecycle status.** Item 7 conditions the report on
the sub-tasks being finished, not on the work being closed, so a STARTED work whose sub-tasks
are all done can produce one.

**Skipped sub-tasks are marked in the report body** with their own badge and background. A
skipped check that renders like a completed one is the dangerous misreading of a safety
document, so the status label alone was not enough.

### 34.10 Still open

1. **Төсөл бүртгэх has no missing fields.** Every column the backend stores is already on the
   form, so item 5's complaint must refer to a field that does not exist yet — a schema
   change, not a form fix. Awaiting which field was expected.
2. **Шинэчлэх шаардлагатай самбарууд versus холболт.** Nothing in the sub-task data
   distinguishes a самбар from a холболт, so both lists are seeded with the same worst
   findings for the administrator to edit down. A real classifier would let them separate.
3. **Circuit start and end points.** The backend accepts them; the form sends null. Wiring
   them needs a rule for what qualifies as an endpoint and whether it must be on the same
   floor.
4. **Restoring a `must_change_password` account** returns it to `active`, dropping the pending
   forced change. Contained, but preserving it needs a new field on `User`.

### 34.11 Verified state

Backend **511 tests / 26 files**. Web **351 tests / 42 files**. Both typechecks clean, shared
builds, both production builds succeed. Web bundle **257KB gzipped**, up from 196KB: the
increase is Leaflet, the cost of picking GPS on a real map.

## 35. Row actions, and evidence for an үнэлгээ

### 35.1 Three-dot row menus

Every table's row actions now sit behind one button that opens a menu
(`apps/web/src/components/ui/RowActions.tsx`). The action column used to be the widest thing
on several pages, and it put Устгах one mis-click from Засах.

Three details that are not obvious from the screenshot:

- **Permission-gated actions are omitted, not disabled.** A greyed-out item still tells the
  reader the action exists. The exception is where the old UI already explained the reason, in
  which case the item stays with its `disabledReason` so the explanation is not lost.
- **Navigating items render as real links.** Харах and Засах were `<a href>` before, so
  cmd-click and middle-click opened a record in a new tab. Rendering them as buttons silently
  removed that, so `RowActions` takes a `to` for navigation and only uses a button for
  actions. A test pins it.
- **The menu is positioned against the viewport**, not the row. Tables scroll horizontally and
  clip their own overflow, so a menu inside the row is cut off at the table edge on exactly
  the narrow screens that need it most.

### 35.2 Үнэлгээ requires a photo

Confirmed by the product owner: recording an assessment requires at least one photo.

Enforced in the schema and again in the service, so a request made straight at the API without
one fails exactly as the form does. Frontend-only validation would have left the rule
unenforced for anything but the browser.

Photos follow the existing park-then-claim pattern already used by service-request
attachments: uploaded against the uploader, then transferred to the object when the assessment
is written. No second storage mechanism was introduced.

**Existing assessments are grandfathered**, on the same principle as the sub-task scores: the
model keeps `photos` optional, history stays readable, and only new entries need evidence.

A pending photo can be removed before saving. The assessment stays append-only once recorded;
removing an unsaved attachment is editing a draft, not rewriting history. Without it, a
wrongly chosen file would have been a trap in a form that cannot be submitted empty.

### 35.3 Smaller items

- **Давхрын дугаар** removed from the floor create form. `floorNumber` is optional in both the
  Zod schema and the model, so nothing had to be derived; it remains editable on the floor page.
- **The Устгах боломжгүй box** moved to the bottom of the project, building and object pages.
- **Үнэлгээний түүх is a table** with a column picker, one datum per cell, and deliberately no
  action column: the history is append-only, and the test asserts both that no Засах or Устгах
  control exists and that there is no Үйлдэл header.

## 36. Customer tenancy: the security boundary

### 36.1 What was wrong

`customerId` was a client-supplied **filter, not a boundary**. Any authenticated caller who
sent another organisation's id received that organisation's records, and detail endpoints
fetched by id alone with no ownership predicate. `listServiceRequests(req.query)` was never
even passed the auth context, while the sibling POST on the same router was.

It had not been exploitable in practice only because every account belonged to staff. The
moment a customer could sign in, it was.

`service-request.model.ts` already carried an index commented "Customer-scoped list", and
`ObjectNode.customer` was already denormalised onto every node with a comment saying it
existed so a tenant-scoped query would never need a hierarchy walk. The design anticipated
this. The predicate was simply never applied.

### 36.2 The boundary

`apps/backend/src/common/security/customer-scope.ts`. One file, four functions, tested
directly rather than only through the endpoints that use it.

```ts
type ResolvedCustomerScope =
  | { mode: 'CUSTOMER'; customerId: string }
  | { mode: 'STAFF'; customerId?: string };
```

Three properties make it safe rather than merely scoped:

- **`resolveCustomerScope(auth, requested)` accepts the client's id and discards it for a
  customer.** Callers may pass it in freely, so safety does not depend on every controller
  remembering to withhold it. Forgetting was the original failure.
- **Cross-tenant detail misses report 404, not 403.** A forbidden reply for an id that exists
  in another tenant confirms the record is real, turning every detail endpoint into an oracle
  for probing other organisations' identifiers.
- **A customer account with no organisation is refused, not defaulted.** No filter would
  expose every tenant; match-nothing would look like an empty account and hide the
  misconfiguration from the administrator who has to fix it.

`customerScopeFilter` returns `{}` for unscoped staff, so existing internal behaviour is
byte-identical.

### 36.3 Two independent layers

Customers hold a separate `portal.*` permission family and **not one staff key**. This is
deliberate defence in depth: with distinct keys a customer holds nothing that would be
dangerous even if a scope predicate were missed somewhere.

Endpoints a customer must reach moved from `requirePermission(staffKey)` to
`requireAnyPermission(staffKey, portalKey)`. Permission answers "may you look at this
module"; scope answers "at whose records". Both are enforced; neither is sufficient alone.

The load-bearing tests prove the layers are independent by handing a `customer`-role account
a **staff** key, a combination the CUSTOMER role never grants, and showing the write is still
refused. That demonstrates the scope, not the guard, is what stops it.

### 36.4 Scope is a required parameter

Every service function reading or writing customer-owned data takes
`scope: ResolvedCustomerScope`. There is **no defaulted or optional overload**, because such
an overload is exactly the hole being closed. Internal callers needing cross-tenant reads
pass an explicit staff scope at the call site, so the intent is visible in the code.

### 36.5 Notable decisions

- **Work-report endpoints kept their staff-only guards.** `GET /:id/report` creates an empty
  draft attributed to the reader; letting a customer trigger it would forge authorship on a
  technician's document. Scope is enforced there regardless. Showing conclusions in the
  portal wants a separate read-only endpoint rather than widening this one.
- **The project graph route** loads the project through the scoped path before building.
  `buildProjectGraph` takes an id and knows nothing about tenants, so without this it stayed
  reachable by id alone: the exact shape of the original bug, in the last place it survived.
- **Staff accounts and the customer link** split into two rules: sending a `customerId` for a
  staff role is a 400, because an ignored field leaves an administrator believing a link
  exists; but demoting a customer account to staff clears the link, because the account has
  stopped being a tenant.
- **Sessions are not revoked when a link changes.** `authenticate` re-reads `customer` from
  the account every request, for the same reason it re-reads permissions, so an existing
  session is already scoped to the new organisation on its next call.
- **No `/me/...` route group.** The existing endpoints were fixed, so every client is
  protected by the same code. A safe path beside an unsafe one would have left the unsafe one.

### 36.6 Existing data

No user was auto-assigned. Staff accounts are untouched. A customer-role account with no link
fails safely with a clear Mongolian message telling the holder to contact an administrator,
rather than silently reading nothing.

### 36.7 The Flutter app chooses nothing

The scope comes from the authenticated session and nowhere else. There is deliberately **no
customer picker**: since the server discards a customer's requested id, a device-side choice
would decide nothing while looking like it decides everything.

Four source-level invariant tests enforce this rather than leaving it to discipline: exactly
one construction site for `ResolvedCustomerScope` outside the entity and it reads
`user.customerId`; no `overrideWith` or `.notifier` on the scope provider anywhere in `lib/`;
the provider is not a `StateProvider`; and every scoped repository read still demands the
scope. The screen tests inject only the signed-in account and run the real resolution path,
so a test cannot hand the app a scope production could never produce.

An empty-string `customerId` is read as absent, because an empty string would otherwise
produce a scope matching nothing while looking resolved, rendering as an organisation with no
buildings rather than an account awaiting linking.

### 36.8 Verified

Backend **601 tests / 28 files**. Web **378 tests / 45 files**. Flutter **67 tests**,
`flutter analyze` clean. All three typechecks and all three production builds pass.

## 37. Local development accounts

### 37.1 The defect this section exists for

"Can't find employee" in the employee mobile app. All four tabs showed
**"ажилтны карттай холбогдоогүй"**.

Nothing was wrong with the request chain. Route order, base path, RBAC, the response envelope
and the DTO shape were all verified live against a running backend. The cause was the
**database**: `Employee` and `User` are separate entities joined only by
`Employee.systemUser` (section 12), and no seeded environment ever wrote that field.

- `src/scripts/seed-dev-data.ts` created seven employees and **no accounts at all**. It did
  not import `User`.
- `src/scripts/bootstrap-head-admin.ts` creates the only out-of-the-box login, `head_admin`,
  and that account has **no employee card**.

So on a freshly bootstrapped and seeded environment, every account that existed hit the 404
from `GET /employees/me`, and the Flutter client correctly read that 404 as `notLinked`. The
app was unusable out of the box and looked broken rather than unseeded.

### 37.2 Setup, in order

```bash
cd apps/backend
cp .env.example .env          # then set MONGODB_URI and the two JWT secrets
npm run bootstrap:admin --workspace @monhorus/backend
npm run seed:dev --workspace @monhorus/backend
npm run dev --workspace @monhorus/backend
```

`seed:dev` is safe to re-run and now calls `seedRbac()` itself, so the permission catalogue
and the system roles exist even if the server has never been started.

### 37.3 Credentials

**Web admin.** Whatever `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` held when
`bootstrap:admin` ran. This account is `head_admin` and has **no employee card by design**, so
`GET /employees/me` 404s for it. That is correct behaviour, not the bug above — an
administrator is not an employee.

**Employee mobile app.** `seed:dev` provisions a `technician` login for each **ACTIVE** seeded
employee and links it to that employee's card. Password for all of them is
`SEED_DEV_PASSWORD`, default `Monhorus.dev2026`.

| Employee | Email (login) | Position |
| --- | --- | --- |
| EMP-0001 Батаа Энхтөр | `b.enkhtur@monhorus.mn` | Ахлах инженер |
| EMP-0002 Дорж Ganbold | `d.ganbold@monhorus.mn` | Цахилгааны инженер |
| EMP-0003 Пүрэв Сараа | `p.saraa@monhorus.mn` | Цахилгаанчин |
| EMP-0004 Батбаяр Тэмүүлэн | `b.temuulen@monhorus.mn` | Цахилгаанчин |

EMP-0005 (ON_LEAVE), EMP-0006 (TERMINATED) and EMP-0007 (DRAFT) get **no** account, on
purpose: a non-active employee holding a working login would misrepresent the lifecycle the
admin screens are reviewed against, and EMP-0007 is the fixture `employee-self.api.test.ts`
uses for the unlinked case.

### 37.4 Decisions in the seeded accounts

**`status: 'active'`, not `must_change_password`.** The admin-driven CREATE_NEW path in
`employee-access.service.ts` mints an account the holder must re-credential, and
`enforcePasswordChange` then refuses every route except `/auth/me` and `/auth/change-password`.
A seeded account in that state would sign in and be **403'd by `/employees/me`** — the same
blank shell reached by a different status code. There is no administrator present to hand over
a passcode and nothing secret about `SEED_DEV_PASSWORD`, so there is nothing to force a change
of.

**Roles come from `resolveDefaultRoleIds('technician')`.** The same function the runtime uses
when an account is provisioned with no explicit role selection, so a seeded technician holds
exactly what a technician provisioned from the admin screen holds. The seed names no role of
its own and restates nothing about the permission model. Both `role: 'technician'` (the legacy
coarse tier, still what the mobile client and the older guards read) and the `roles` array are
written, because an account with an empty `roles` array resolves to an **empty permission set**
and is refused by every guard.

**The link is written the way the production path writes it.** `employee.systemUser = user._id`,
behind the same "one user maps to at most one employee" check `manageSystemAccess` performs, so
the unique partial index produces a readable skip instead of a duplicate-key crash.

**`src/scripts/seed-dev-data.ts` is now on the allowlist in
`role-assignment.invariant.test.ts`.** It is the third of the three operator scripts the
chokepoint documents as its exception (bootstrap, backfill, dev seed): no HTTP actor, refuses
`NODE_ENV=production`, not reachable over the network.

### 37.5 Re-running the seed does not clobber anything

- An employee that already has a `systemUser` is left **entirely** alone, hand-made or not.
- An account that already exists under the same email is **reused and its password is not
  reset**. The seed logs that `SEED_DEV_PASSWORD` does not apply to it.
- A user already linked to a *different* employee is refused, not stolen.
- A link pointing at a user document that no longer exists is the one case repaired, because
  the middleware would otherwise resolve an `employeeId` whose account is gone.

The login pass is separate from the employee pass, so a database seeded before logins existed
picks them up on the next run without the employee cards being recreated.

### 37.6 Diagnosing it next time

`GET /employees/me` still returns **404** with the same Mongolian message for all three of its
refusals, and it must: the Flutter client maps 404 to `notLinked` and `employee-self.api.test.ts`
pins both. The three cases are now told apart in the **server log** instead, and the missing-link
one names the fix:

```
GET /employees/me: no Employee has systemUser set to this user id, so the account is not
linked to an employee card. Link it with POST /employees/:employeeId/system-access
{mode:'LINK_EXISTING', userId}, or run npm run seed:dev --workspace @monhorus/backend to
provision linked dev technicians.
```

To check the links directly:

```
db.employees.aggregate([
  { $lookup: { from: 'users', localField: 'systemUser', foreignField: '_id', as: 'u' } },
  { $project: { employeeCode: 1, status: 1, email: { $first: '$u.email' } } },
])
```
