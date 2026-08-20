/**
 * Canonical permission catalogue.
 *
 * These keys are the single source of truth shared by the backend guard, the seed
 * routine that populates the Permission collection, and the web permission guards.
 * A key that is not listed here cannot be granted.
 *
 * Naming convention: `<module>.<action>`, lower snake case for the action.
 */
export const PERMISSIONS = {
  // Dashboard. Reading the board is near-universal; authoring a saved analytical section
  // over the whole request history is not, so it carries its own key.
  DASHBOARD_VIEW: 'dashboard.view',
  DASHBOARD_CUSTOMISE: 'dashboard.customise',

  // Employee module (explicitly required by the Phase 1 specification)
  EMPLOYEE_VIEW: 'employee.view',
  EMPLOYEE_CREATE: 'employee.create',
  EMPLOYEE_UPDATE: 'employee.update',
  EMPLOYEE_CHANGE_STATUS: 'employee.change_status',
  EMPLOYEE_MANAGE_DOCUMENTS: 'employee.manage_documents',
  EMPLOYEE_VIEW_SALARY: 'employee.view_salary',
  EMPLOYEE_MANAGE_SALARY: 'employee.manage_salary',
  EMPLOYEE_MANAGE_SYSTEM_ACCESS: 'employee.manage_system_access',
  EMPLOYEE_VIEW_AUDIT: 'employee.view_audit',
  EMPLOYEE_PRINT_CERTIFICATE: 'employee.print_certificate',

  // Organisation master data
  ORG_VIEW: 'org.view',
  ORG_MANAGE: 'org.manage',

  // Customer and object hierarchy
  CUSTOMER_VIEW: 'customer.view',
  CUSTOMER_MANAGE: 'customer.manage',
  OBJECT_VIEW: 'object.view',
  OBJECT_MANAGE: 'object.manage',

  // Object master data (requirements 4.1 and 4.2). Separate from object.* because the
  // hierarchy and the master catalogue are different modules with different owners:
  // object.* governs Project/Building/Floor, object_master.* governs the objects a floor
  // links to, and assessment is split out because it writes append-only history.
  OBJECT_MASTER_VIEW: 'object_master.view',
  OBJECT_MASTER_MANAGE: 'object_master.manage',
  OBJECT_MASTER_ASSESS: 'object_master.assess',
  OBJECT_TYPE_MANAGE: 'object_type.manage',

  // Service requests
  SERVICE_REQUEST_VIEW: 'service_request.view',
  SERVICE_REQUEST_CREATE: 'service_request.create',
  SERVICE_REQUEST_UPDATE: 'service_request.update',
  SERVICE_REQUEST_CHANGE_STATUS: 'service_request.change_status',
  SERVICE_REQUEST_CANCEL: 'service_request.cancel',

  /**
   * Moving a request through the states only the person standing at the site can
   * truthfully report: ACCEPTED, ON_THE_WAY, ON_SITE, IN_PROGRESS, WAITING and
   * REPORT_SUBMITTED. See `SELF_PROGRESS_STATUSES` in `constants/service-request.ts`,
   * which is the authoritative list and the one the backend enforces.
   *
   * A SEPARATE KEY BECAUSE `service_request.change_status` COULD NOT BE GRANTED. That key
   * is the office's whole authority over a request — it also gates cancelling, returning,
   * un-assigning, verifying and completing, AND it gates `report/approve` and
   * `report/return`. Handing it to a technician so that they could say "I have arrived"
   * would also let them close their own job and return a colleague's write-up. So the
   * field half is named on its own.
   *
   * IT NEVER WIDENS THE LEGAL GRAPH. `SERVICE_REQUEST_TRANSITIONS` remains the only
   * authority on which move is possible at all; this key authorises a SUBSET of that
   * graph and can add nothing to it. The `reason` requirement on WAITING is likewise
   * untouched — a paused job still has to say why.
   *
   * ASSIGNMENT-SCOPED, and that is half of what makes it safe. A holder may only progress
   * a request that names them or their team; the predicate is the same
   * `resolveAssignedWorkFilter` the detail read uses, minus the unclaimed branch —
   * taking an open request is `service_request.claim`, a separate deliberate act, and a
   * request nobody holds must not be driven through its lifecycle by a passer-by.
   *
   * DELIBERATELY NOT IN THIS SET: CANCELLED, RETURNED, UNASSIGNED, VERIFICATION,
   * COMPLETED, REVISIT_REQUIRED. Each is a decision ABOUT the work rather than a report
   * FROM it — cancelling and un-assigning are planning, returning is a judgement on
   * somebody's write-up, and verification and completion are the office's sign-off that
   * rule 17.7 keeps downstream of an approved conclusion.
   */
  SERVICE_REQUEST_SELF_PROGRESS: 'service_request.self_progress',

  /**
   * Approving a work conclusion. Named to mirror `planned_work.approve_report`, which is
   * the same act in the other module.
   *
   * APPROVE ONLY. `report/return` stays on `service_request.change_status` and is not
   * reachable from here, because returning is a judgement on somebody else's work and
   * belongs to the office; approving is settling a conclusion that has been submitted.
   * Assignment-scoped exactly as `service_request.self_progress` is.
   *
   * THE TRADE-OFF, ACCEPTED DELIBERATELY AND RECORDED HERE SO IT IS NOT REDISCOVERED AS A
   * BUG: granted to TECHNICIAN, this means one person can score a conclusion, write it,
   * submit it and approve it, with nobody else in the loop. That breaks the section 9.2
   * submit/approve separation for service requests, and the consequence is not only
   * paperwork — `approveWorkReport` publishes the approved conclusion to the central
   * report store and on to the equipment it names, so a score in the OUT_OF_SERVICE band
   * (0–20) decommissions that equipment on one person's say-so. It was chosen anyway,
   * because a technician who cannot settle their own visit leaves every job parked at
   * REPORT_SUBMITTED until an office account happens to look. An organisation that wants
   * the separation back withdraws this one key from the TECHNICIAN role in the access
   * screen; nothing else has to change.
   */
  SERVICE_REQUEST_APPROVE_REPORT: 'service_request.approve_report',

  // Planned work (requirements section 7). Rescheduling and cancellation are separate
  // keys because both require an explicit reason and an audit record, and neither may
  // ride along with ordinary editing.
  PLANNED_WORK_VIEW: 'planned_work.view',
  PLANNED_WORK_CREATE: 'planned_work.create',
  PLANNED_WORK_UPDATE: 'planned_work.update',
  PLANNED_WORK_CHANGE_STATUS: 'planned_work.change_status',
  PLANNED_WORK_RESCHEDULE: 'planned_work.reschedule',
  PLANNED_WORK_CANCEL: 'planned_work.cancel',
  PLANNED_WORK_RECORD_PROGRESS: 'planned_work.record_progress',
  /**
   * Approving or refusing a customer-raised PLAN, before any work happens.
   *
   * NOT the same key as `planned_work.approve_report`, and the two are easy to confuse:
   * this one decides whether a job the customer asked for goes ahead and therefore becomes
   * assignable; that one decides whether a finished job's write-up is accepted. Merging
   * them would mean granting sign-off over paperwork also handed somebody the authority to
   * commit the company's technicians to new work.
   */
  PLANNED_WORK_APPROVE: 'planned_work.approve',
  PLANNED_WORK_SUBMIT_REPORT: 'planned_work.submit_report',
  PLANNED_WORK_APPROVE_REPORT: 'planned_work.approve_report',

  // Dispatch
  DISPATCH_VIEW: 'dispatch.view',
  DISPATCH_ASSIGN: 'dispatch.assign',
  DISPATCH_EXTEND_SLA: 'dispatch.extend_sla',

  // Invoicing and receivables (requirements 12). Sending, recording a payment and
  // cancelling are separate keys because each is an irreversible money event that must be
  // grantable on its own: a clerk may prepare a draft without being able to issue it.
  INVOICE_VIEW: 'invoice.view',
  INVOICE_MANAGE: 'invoice.manage',
  INVOICE_SEND: 'invoice.send',
  INVOICE_RECORD_PAYMENT: 'invoice.record_payment',
  INVOICE_CANCEL: 'invoice.cancel',

  // Reporting (requirements 15.2). Export is separate from reading because a report
  // export leaves the system as a file and section 14.2 restricts who may take one.
  REPORT_VIEW: 'report.view',
  REPORT_EXPORT: 'report.export',
  /**
   * Reviewing a report in the canonical store — approving it or returning it for
   * correction. A separate key because nothing existing covers it honestly:
   * `planned_work.approve_report` is that module's own chain and would let a planned-work
   * reviewer sign off consolidations they had no part in, and `object_master.assess` is
   * the AUTHORING half, which the submit/approve separation exists to keep apart.
   */
  REPORT_APPROVE: 'report.approve',
  /**
   * Releasing an approved report to the customer it describes. Split from approval the
   * same way `invoice.send` is split from `invoice.manage`: approval settles the finding
   * internally, publication lets it leave the organisation, and the two decisions do not
   * always belong to the same person.
   */
  REPORT_PUBLISH: 'report.publish',

  /**
   * The material catalogue, and claiming open work.
   *
   * `material.view` is separated from `material.manage` for the same reason every other
   * catalogue is: a technician picks from the list constantly and must never edit it.
   *
   * `service_request.claim` is deliberately NOT `dispatch.assign`. Assigning is choosing
   * somebody else's work and is a dispatcher's authority; claiming is taking unassigned
   * work for yourself, which a technician must be able to do without being handed the
   * power to reassign a colleague's job.
   */
  /**
   * The satisfaction survey.
   *
   * Three keys, split by three different acts. Writing the questions is admin
   * configuration; reading the results is a performance review of named employees, which
   * management needs and dispatch does not; and submitting is a customer act, so it is a
   * `portal.*` key and never a staff one.
   *
   * TECHNICIAN holds NONE of these. A response identifies the request and therefore the
   * customer who scored them, so letting somebody read their own would hand them the
   * complaint and its author together. If self-view is wanted later it is a fourth key and
   * a scoped query, not a loosening of `survey.view_results`.
   */
  SURVEY_MANAGE_QUESTIONS: 'survey.manage_questions',
  SURVEY_VIEW_RESULTS: 'survey.view_results',
  PORTAL_SURVEY_SUBMIT: 'portal.survey.submit',
  MATERIAL_VIEW: 'material.view',
  MATERIAL_MANAGE: 'material.manage',
  SERVICE_REQUEST_CLAIM: 'service_request.claim',

  // Notifications (requirements 14.3). There is no manage key: a notification is written
  // by the system in response to a domain event and is never authored by hand.
  NOTIFICATION_VIEW: 'notification.view',

  // Asset diagram on the dashboard. Editing is separate from reading because the diagram
  // is shared: everyone reads the same canvas, and only some may rearrange it.
  DIAGRAM_VIEW: 'diagram.view',
  DIAGRAM_MANAGE: 'diagram.manage',

  // System configuration (requirements 16.1). Reading is separated from changing,
  // because a setting change alters how every other module behaves.
  SETTINGS_VIEW: 'settings.view',
  SETTINGS_MANAGE: 'settings.manage',

  /**
   * The user directory itself, separate from `rbac.*`.
   *
   * `rbac.*` governs ROLES — what a permission set contains and who holds it. These two
   * govern the ACCOUNT: creating a login, resetting its passcode, suspending it. The two
   * authorities are genuinely different — an operator who provisions accounts has no
   * business rewriting the permission catalogue — and the `/users` router previously asked
   * for neither, gating on the legacy tier alone, so the web UI and the API disagreed
   * about who could suspend an account.
   */
  USER_VIEW: 'user.view',
  USER_MANAGE: 'user.manage',

  // Governance
  AUDIT_VIEW: 'audit.view',
  RBAC_VIEW: 'rbac.view',
  RBAC_MANAGE: 'rbac.manage',

  /**
   * Authority over the roles that can hand out the whole system.
   *
   * `rbac.manage` governs ORDINARY roles: creating a role, editing its permission set,
   * and assigning it to an account. It is deliberately NOT enough for anything that
   * touches the top of the hierarchy, because a key that can grant the superuser role is
   * the superuser key by another name — an actor holding only `rbac.manage` was able to
   * assign SYSTEM_ADMIN to a target AND to itself, and then hold every permission in the
   * catalogue on its very next request.
   *
   * "Protected" means exactly three things, and this key is required for all of them:
   *
   *   1. Assigning or removing a role whose key is SYSTEM_ADMIN.
   *   2. Moving an account's legacy tier to or from `head_admin`, and changing the roles
   *      of an account that already sits at that tier. The tier is a hardcoded superuser
   *      in `resolveEffectivePermissions`, so it is the same authority under another name.
   *   3. Editing or deleting the SYSTEM_ADMIN role document itself.
   *
   * There is no HEAD_ADMIN role key and none is introduced: `head_admin` is a legacy tier
   * in `USER_ROLES`, SYSTEM_ADMIN is an RBAC role key, and both forms of the same
   * authority are guarded together rather than one being folded into the other.
   *
   * Seeded on SYSTEM_ADMIN only — it is inside `ALL_PERMISSIONS`, which is that role's
   * whole contract, and appears in no other default below. The `head_admin` tier keeps its
   * hardcoded superuser status as a backstop, so a bootstrap administrator still works
   * even if the seeded role set has drifted.
   */
  RBAC_MANAGE_PROTECTED: 'rbac.manage_protected',

  /**
   * Customer self-service. Deliberately separate keys rather than reusing the staff
   * `object.view` family.
   *
   * A staff permission means "read this module". A portal permission means "read your own
   * records in this module", and the two must not be spelled the same way: granting a
   * customer `object.view` would make them one missing scope predicate away from reading
   * every tenant. With distinct keys, a customer holds nothing that would be dangerous if
   * a scope check were ever missed.
   *
   * These are necessary but never sufficient. Every customer-owned read also passes
   * through the customer scope resolver, so the permission answers "may you look at this
   * module" and the scope answers "at whose records".
   */
  PORTAL_PROJECT_VIEW: 'portal.project.view',
  PORTAL_BUILDING_VIEW: 'portal.building.view',
  PORTAL_FLOOR_VIEW: 'portal.floor.view',
  PORTAL_OBJECT_VIEW: 'portal.object.view',
  PORTAL_SERVICE_REQUEST_VIEW: 'portal.service_request.view',
  PORTAL_SERVICE_REQUEST_CREATE: 'portal.service_request.create',
  PORTAL_PROFILE_VIEW: 'portal.profile.view',
  /**
   * Raising, and then following, a request for scheduled maintenance on the caller's own
   * sites.
   *
   * These admit a customer to the planned-work module as a REQUESTER and a reader of their
   * own records, and to nothing else. The lifecycle, the crew, the sub-tasks and the
   * reports stay behind the `planned_work.*` keys, which no customer holds. A work created
   * on this key is forced to PENDING_APPROVAL with no crew, whatever the request body says.
   */
  PORTAL_PLANNED_WORK_VIEW: 'portal.planned_work.view',
  PORTAL_PLANNED_WORK_CREATE: 'portal.planned_work.create',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.values(PERMISSIONS);

/** Grouping used by the permission picker in the RBAC admin screen. */
export const PERMISSION_MODULES = [
  'dashboard',
  'employee',
  'org',
  'customer',
  'object',
  'object_master',
  'object_type',
  'service_request',
  'planned_work',
  'dispatch',
  'invoice',
  'report',
  'notification',
  'diagram',
  'settings',
  'audit',
  'user',
  'rbac',
  'portal',
  'survey',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export const PERMISSION_MODULE_LABELS: Record<PermissionModule, string> = {
  dashboard: 'Хяналтын самбар',
  employee: 'Ажилтан',
  org: 'Байгууллагын бүтэц',
  customer: 'Харилцагч',
  object: 'Төсөл ба объект',
  object_master: 'Объектын мастер бүртгэл',
  object_type: 'Тоноглолын төрөл',
  service_request: 'Үйлчилгээний хүсэлт',
  planned_work: 'Төлөвлөгөөт ажил',
  dispatch: 'Dispatch',
  invoice: 'Нэхэмжлэл ба төлбөр',
  report: 'Тайлан',
  notification: 'Мэдэгдэл',
  diagram: 'Схем зураг',
  settings: 'Тохиргоо',
  audit: 'Audit log',
  user: 'Хэрэглэгчийн бүртгэл',
  rbac: 'Хэрэглэгчийн эрх',
  portal: 'Харилцагчийн хандалт',
  survey: 'Үйлчилгээний үнэлгээ',
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  'dashboard.view': 'Хяналтын самбар харах',
  'dashboard.customise': 'Хяналтын самбарт хэсэг үүсгэх',

  'employee.view': 'Ажилтан харах',
  'employee.create': 'Ажилтан үүсгэх',
  'employee.update': 'Ажилтан засах',
  'employee.change_status': 'Ажилтны төлөв өөрчлөх',
  'employee.manage_documents': 'Баримт бичиг удирдах',
  'employee.view_salary': 'Цалингийн мэдээлэл харах',
  'employee.manage_salary': 'Цалингийн мэдээлэл удирдах',
  'employee.manage_system_access': 'Системийн эрх удирдах',
  'employee.view_audit': 'Ажилтны audit харах',
  'employee.print_certificate': 'Ажилтны тодорхойлолт хэвлэх',

  'org.view': 'Байгууллагын бүтэц харах',
  'org.manage': 'Байгууллагын бүтэц удирдах',

  'customer.view': 'Харилцагч харах',
  'customer.manage': 'Харилцагч удирдах',
  'object.view': 'Объект харах',
  'object.manage': 'Объект удирдах',

  'object_master.view': 'Объектын бүртгэл харах',
  'object_master.manage': 'Объектын бүртгэл удирдах',
  'object_master.assess': 'Объектод үнэлгээ, дүгнэлт бүртгэх',
  'object_type.manage': 'Тоноглолын төрөл удирдах',

  'service_request.view': 'Үйлчилгээний хүсэлт харах',
  'service_request.create': 'Үйлчилгээний хүсэлт үүсгэх',
  'service_request.update': 'Үйлчилгээний хүсэлт засах',
  'service_request.change_status': 'Хүсэлтийн төлөв өөрчлөх',
  'service_request.cancel': 'Хүсэлт цуцлах',
  'service_request.self_progress': 'Өөрийн ажлын явцын төлөв өөрчлөх',
  'service_request.approve_report': 'Ажлын дүгнэлт батлах',

  'planned_work.view': 'Төлөвлөгөөт ажил харах',
  'planned_work.create': 'Төлөвлөгөөт ажил үүсгэх',
  'planned_work.update': 'Төлөвлөгөөт ажил засах',
  'planned_work.change_status': 'Төлөвлөгөөт ажлын төлөв өөрчлөх',
  'planned_work.reschedule': 'Төлөвлөгөөт ажлын хугацаа сунгах',
  'planned_work.cancel': 'Төлөвлөгөөт ажил цуцлах',
  'planned_work.record_progress': 'Ажлын биелэлт бүртгэх',
  'planned_work.approve': 'Төлөвлөгөөт ажил батлах',
  'planned_work.submit_report': 'Тайлан хянуулахаар илгээх',
  'planned_work.approve_report': 'Тайлан батлах',

  'dispatch.view': 'Dispatch board харах',
  'dispatch.assign': 'Ажил хуваарилах',
  'dispatch.extend_sla': 'SLA сунгах',

  'invoice.view': 'Нэхэмжлэл харах',
  'invoice.manage': 'Нэхэмжлэл үүсгэх, засах',
  'invoice.send': 'Нэхэмжлэл илгээх',
  'invoice.record_payment': 'Төлбөр бүртгэх',
  'invoice.cancel': 'Нэхэмжлэл цуцлах',

  'report.view': 'Тайлан харах',
  'report.export': 'Тайлан татаж авах',
  'report.approve': 'Тайлан батлах, буцаах',
  'report.publish': 'Тайлан нийтлэх',
  'survey.manage_questions': 'Асуулга тохируулах',
  'survey.view_results': 'Асуулгын дүн харах',
  'portal.survey.submit': 'Үйлчилгээний үнэлгээ өгөх',
  'material.view': 'Материалын жагсаалт харах',
  'material.manage': 'Материалын жагсаалт удирдах',
  'service_request.claim': 'Нээлттэй ажил өөртөө авах',

  'notification.view': 'Мэдэгдэл харах',

  'diagram.view': 'Схем зураг харах',
  'diagram.manage': 'Схем зураг засах',

  'settings.view': 'Системийн тохиргоо харах',
  'settings.manage': 'Системийн тохиргоо өөрчлөх',

  'audit.view': 'Audit log харах',
  'user.view': 'Хэрэглэгчийн бүртгэл харах',
  'user.manage': 'Хэрэглэгчийн бүртгэл удирдах',
  'rbac.view': 'Role, permission харах',
  'rbac.manage': 'Role, permission удирдах',
  'rbac.manage_protected': 'Системийн админ эрх олгох, хасах',

  'portal.project.view': 'Өөрийн төслүүдийг харах',
  'portal.building.view': 'Өөрийн барилгуудыг харах',
  'portal.floor.view': 'Өөрийн давхруудыг харах',
  'portal.object.view': 'Өөрийн тоноглолыг харах',
  'portal.service_request.view': 'Өөрийн үйлчилгээний хүсэлтийг харах',
  'portal.service_request.create': 'Үйлчилгээний хүсэлт илгээх',
  'portal.profile.view': 'Өөрийн профайл харах',
  'portal.planned_work.view': 'Өөрийн төлөвлөгөөт ажил харах',
  'portal.planned_work.create': 'Төлөвлөгөөт ажлын хүсэлт илгээх',
};

export function permissionModuleOf(key: PermissionKey): PermissionModule {
  const prefix = key.split('.')[0];
  return (PERMISSION_MODULES as readonly string[]).includes(prefix ?? '')
    ? (prefix as PermissionModule)
    : 'dashboard';
}

/**
 * System role keys seeded on first boot. These correspond to the internal admin
 * duties in requirements section 3.1 plus the six Web Admin user types.
 * `isSystem` roles cannot be deleted, but their permission sets remain editable
 * by a holder of rbac.manage.
 */
export const SYSTEM_ROLE_KEYS = {
  SYSTEM_ADMIN: 'SYSTEM_ADMIN',
  ADMIN: 'ADMIN',
  MANAGEMENT: 'MANAGEMENT',
  DISPATCH: 'DISPATCH',
  FINANCE: 'FINANCE',
  SALES: 'SALES',
  /**
   * The field technician, i.e. the `technician` legacy tier.
   *
   * Added because none of the six Web Admin duties above describes one: the closest,
   * DISPATCH, carries `dispatch.assign` and `dispatch.extend_sla`, which are the
   * dispatcher's authority over other people's work and not something a technician
   * doing the work should hold. Without a role of its own the tier had no default and
   * every technician account was created with an empty permission set, which is how
   * they ended up unable to sign into the employee mobile app at all.
   */
  TECHNICIAN: 'TECHNICIAN',
  /** The signed-in customer. Holds portal permissions only, never a staff one. */
  CUSTOMER: 'CUSTOMER',
} as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[keyof typeof SYSTEM_ROLE_KEYS];

export const SYSTEM_ROLE_LABELS: Record<SystemRoleKey, string> = {
  SYSTEM_ADMIN: 'Системийн админ',
  ADMIN: 'Админ',
  MANAGEMENT: 'Менежер',
  DISPATCH: 'Dispatcher',
  FINANCE: 'Санхүү',
  SALES: 'Борлуулалт/харилцагч',
  TECHNICIAN: 'Ажилтан (гүйцэтгэгч)',
  CUSTOMER: 'Харилцагч',
};

const P = PERMISSIONS;

/**
 * Default permission grants per system role, derived from the permission matrix in
 * requirements section 14.2 and the duty descriptions in section 3.1.
 *
 * Salary permissions belong to FINANCE and SYSTEM_ADMIN only. Section 3 states that
 * employees must not see customer finance data, and section 3.1 assigns all monetary
 * responsibility to the Санхүү duty, so MANAGEMENT does not receive them by default.
 *
 * planned_work.approve_report is granted to MANAGEMENT, ADMIN and SYSTEM_ADMIN only.
 * Approval is never inferred from a reporting line, because an assigned employee does
 * not always have a valid manager for the work in question.
 *
 * Every grant here is a seeded default. A holder of rbac.manage may adjust any role's
 * permission set afterwards through the access administration screen.
 */
export const SYSTEM_ROLE_DEFAULT_PERMISSIONS: Record<SystemRoleKey, readonly PermissionKey[]> = {
  SYSTEM_ADMIN: ALL_PERMISSIONS,

  ADMIN: [
    P.DASHBOARD_VIEW, P.DASHBOARD_CUSTOMISE,
    P.SURVEY_MANAGE_QUESTIONS, P.SURVEY_VIEW_RESULTS,
    // The account-provisioning half of what this role already did through the legacy tier
    // gate on /users. Seeded so tightening that router to require a permission takes
    // nothing away from an administrator who could already do it.
    P.USER_VIEW, P.USER_MANAGE,
    P.EMPLOYEE_VIEW, P.EMPLOYEE_CREATE, P.EMPLOYEE_UPDATE, P.EMPLOYEE_CHANGE_STATUS,
    P.EMPLOYEE_MANAGE_DOCUMENTS, P.EMPLOYEE_VIEW_AUDIT, P.EMPLOYEE_PRINT_CERTIFICATE,
    P.ORG_VIEW, P.ORG_MANAGE,
    P.CUSTOMER_VIEW, P.CUSTOMER_MANAGE, P.OBJECT_VIEW, P.OBJECT_MANAGE,
    P.OBJECT_MASTER_VIEW, P.OBJECT_MASTER_MANAGE, P.OBJECT_MASTER_ASSESS,
    P.OBJECT_TYPE_MANAGE,
    P.SERVICE_REQUEST_VIEW, P.SERVICE_REQUEST_CREATE, P.SERVICE_REQUEST_UPDATE,
    P.SERVICE_REQUEST_CHANGE_STATUS, P.SERVICE_REQUEST_CANCEL, P.SERVICE_REQUEST_CLAIM,
    P.MATERIAL_VIEW, P.MATERIAL_MANAGE,
    P.PLANNED_WORK_VIEW, P.PLANNED_WORK_CREATE, P.PLANNED_WORK_UPDATE,
    P.PLANNED_WORK_CHANGE_STATUS, P.PLANNED_WORK_RESCHEDULE, P.PLANNED_WORK_CANCEL,
    P.PLANNED_WORK_RECORD_PROGRESS, P.PLANNED_WORK_APPROVE,
    P.PLANNED_WORK_SUBMIT_REPORT, P.PLANNED_WORK_APPROVE_REPORT,
    P.DISPATCH_VIEW, P.DISPATCH_ASSIGN, P.DISPATCH_EXTEND_SLA,
    P.INVOICE_VIEW, P.INVOICE_MANAGE, P.INVOICE_SEND, P.INVOICE_RECORD_PAYMENT,
    P.INVOICE_CANCEL,
    P.REPORT_VIEW, P.REPORT_EXPORT, P.REPORT_APPROVE, P.REPORT_PUBLISH,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW, P.DIAGRAM_MANAGE,
    P.SETTINGS_VIEW, P.SETTINGS_MANAGE,
    P.AUDIT_VIEW, P.RBAC_VIEW,
  ],

  MANAGEMENT: [
    P.DASHBOARD_VIEW,
    P.SURVEY_VIEW_RESULTS,
    P.EMPLOYEE_VIEW, P.EMPLOYEE_CREATE, P.EMPLOYEE_UPDATE, P.EMPLOYEE_CHANGE_STATUS,
    P.EMPLOYEE_MANAGE_DOCUMENTS, P.EMPLOYEE_VIEW_AUDIT, P.EMPLOYEE_PRINT_CERTIFICATE,
    P.ORG_VIEW,
    P.CUSTOMER_VIEW, P.OBJECT_VIEW,
    P.OBJECT_MASTER_VIEW, P.OBJECT_MASTER_ASSESS,
    P.SERVICE_REQUEST_VIEW, P.SERVICE_REQUEST_CREATE, P.SERVICE_REQUEST_UPDATE,
    P.SERVICE_REQUEST_CHANGE_STATUS,
    P.PLANNED_WORK_VIEW, P.PLANNED_WORK_CREATE, P.PLANNED_WORK_UPDATE,
    P.PLANNED_WORK_CHANGE_STATUS, P.PLANNED_WORK_RESCHEDULE, P.PLANNED_WORK_CANCEL,
    P.PLANNED_WORK_RECORD_PROGRESS, P.PLANNED_WORK_APPROVE,
    P.PLANNED_WORK_SUBMIT_REPORT, P.PLANNED_WORK_APPROVE_REPORT,
    P.DISPATCH_VIEW, P.DISPATCH_EXTEND_SLA,
    // Section 14.2 gives Менежер sight of revenue and receivables but no money actions.
    P.INVOICE_VIEW,
    P.REPORT_VIEW, P.REPORT_EXPORT,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW, P.DIAGRAM_MANAGE,
    P.SETTINGS_VIEW,
    P.AUDIT_VIEW,
  ],

  DISPATCH: [
    P.DASHBOARD_VIEW,
    P.EMPLOYEE_VIEW,
    P.ORG_VIEW,
    P.CUSTOMER_VIEW, P.OBJECT_VIEW, P.OBJECT_MASTER_VIEW,
    P.SERVICE_REQUEST_VIEW, P.SERVICE_REQUEST_CREATE, P.SERVICE_REQUEST_UPDATE,
    P.SERVICE_REQUEST_CHANGE_STATUS,
    P.PLANNED_WORK_VIEW, P.PLANNED_WORK_CHANGE_STATUS, P.PLANNED_WORK_RECORD_PROGRESS,
    P.DISPATCH_VIEW, P.DISPATCH_ASSIGN, P.DISPATCH_EXTEND_SLA,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW,
  ],

  FINANCE: [
    P.DASHBOARD_VIEW,
    P.EMPLOYEE_VIEW, P.EMPLOYEE_VIEW_SALARY, P.EMPLOYEE_MANAGE_SALARY,
    P.ORG_VIEW,
    P.CUSTOMER_VIEW, P.OBJECT_VIEW, P.OBJECT_MASTER_VIEW,
    P.SERVICE_REQUEST_VIEW,
    P.PLANNED_WORK_VIEW,
    // Section 3.1 assigns every monetary duty to Санхүү, so the full invoice lifecycle
    // sits here: prepare, issue, take payment and cancel with a reason.
    P.INVOICE_VIEW, P.INVOICE_MANAGE, P.INVOICE_SEND, P.INVOICE_RECORD_PAYMENT,
    P.INVOICE_CANCEL,
    P.REPORT_VIEW, P.REPORT_EXPORT,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW,
    P.SETTINGS_VIEW,
    P.AUDIT_VIEW,
  ],

  SALES: [
    P.DASHBOARD_VIEW,
    P.ORG_VIEW,
    P.CUSTOMER_VIEW, P.CUSTOMER_MANAGE, P.OBJECT_VIEW, P.OBJECT_MANAGE,
    P.OBJECT_MASTER_VIEW,
    P.SERVICE_REQUEST_VIEW, P.SERVICE_REQUEST_CREATE,
    P.PLANNED_WORK_VIEW,
    // Sales negotiates the agreement that an invoice is billed from, so it reads
    // invoices without being able to issue one or take a payment.
    P.INVOICE_VIEW,
    P.REPORT_VIEW,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW,
  ],

  /**
   * The field technician who actually carries out the work.
   *
   * Scoped to "do the job and report on it", never to "decide who does it". Every key
   * here is one the employee mobile app needs to be usable: see the assigned planned
   * work and service requests, record progress on them, write and submit the section 9.2
   * conclusion with the materials used, and record an on-site object assessment.
   *
   * Deliberately absent, and each for a reason rather than an oversight:
   *   - `dispatch.*`. Assigning work and extending an SLA are the dispatcher's authority
   *     over other people's jobs. This is the whole reason the tier could not simply be
   *     pointed at DISPATCH.
   *   - `service_request.change_status`. A request is opened, triaged and closed by the
   *     office; the technician writes the work up under `service_request.update`, reports
   *     their own progress under `service_request.self_progress` and settles the
   *     conclusion under `service_request.approve_report`. Those two are granted below and
   *     are strictly narrower — neither can cancel, return, un-assign, verify or complete.
   *   - `planned_work.approve_report` and `planned_work.cancel`. Approving is the other
   *     half of the section 9.2 separation and is defined as MANAGEMENT, ADMIN or
   *     SYSTEM_ADMIN only; cancelling a job is a planning decision, not a field one.
   *   - `employee.create/update/change_status/view_salary/manage_*`, `invoice.*`,
   *     `report.*`, `settings.*`, `audit.*`, `rbac.*`. None of these is field work, and
   *     salary and money in particular are section 3 FINANCE.
   *
   * A technician who genuinely needs more, a team lead say, is given a second role from
   * the access screen. Widening this default would widen it for every technician.
   */
  TECHNICIAN: [
    P.DASHBOARD_VIEW,
    /*
     * `employee.view` IS NOT GRANTED, AND MUST NOT BE ADDED BACK.
     *
     * It was granted once, on the reasoning that the mobile app had to resolve the
     * signed-in account to its own employee record and had no other way to do it. The
     * consequence was live and confirmed: `GET /employees` returned every colleague's
     * registration number (РД), phone and email to every technician in the field.
     *
     * The premise is gone. `AuthContext.employeeId` now resolves the link server-side on
     * every request, and `GET /employees/me` returns the caller's own record on
     * authentication alone — no permission at all — so self-resolution needs nothing
     * here. The other stated use, naming the colleagues assigned alongside on a job card,
     * is served by the `EmployeeRefDto` embedded in the planned-work and service-request
     * payloads (code, name, photo), gated by `planned_work.view` — never by a directory
     * read.
     *
     * What this key still buys a holder is the thing to weigh: listing the entire staff
     * directory and fetching any colleague by id. A field technician has no duty that
     * requires either. Anyone who genuinely does — a team lead, a dispatcher — is given a
     * second role from the access screen rather than having it widened for every
     * technician in the company.
     *
     * Removing it here only fixes databases seeded FROM NOW ON. `seedRbac` is prune-only
     * for non-superuser system roles, so an existing TECHNICIAN document keeps the key
     * until `npm run migrate:technician-permissions` withdraws it.
     */
    // The job card names the organisation and the place, so the hierarchy is readable.
    P.CUSTOMER_VIEW, P.OBJECT_VIEW,
    // Reads the equipment being worked on, and records the on-site assessment that
    // section 4.2 makes part of carrying out the work.
    P.OBJECT_MASTER_VIEW, P.OBJECT_MASTER_ASSESS,
    // `service_request.update` is what the work conclusion is written and submitted
    // under; RETURNING it still needs change_status, which is not granted.
    P.SERVICE_REQUEST_VIEW, P.SERVICE_REQUEST_UPDATE,
    /*
     * Saying where the job has got to, and settling the conclusion it produced.
     *
     * Both are assignment-scoped server-side, so neither reaches a colleague's request or
     * an unclaimed one. `self_progress` covers only the six states a person in the field
     * can truthfully report and never CANCELLED, RETURNED, UNASSIGNED, VERIFICATION,
     * COMPLETED or REVISIT_REQUIRED; `approve_report` covers approving and NOT returning.
     *
     * `approve_report` is the one grant here that gives up a separation on purpose: with
     * it, the same person scores, writes, submits and approves a conclusion, and an
     * approved conclusion moves the equipment's own figures. Read the key's own comment —
     * the reasoning and the way to reverse it are written down there rather than implied.
     */
    P.SERVICE_REQUEST_SELF_PROGRESS, P.SERVICE_REQUEST_APPROVE_REPORT,
    P.PLANNED_WORK_VIEW, P.PLANNED_WORK_RECORD_PROGRESS, P.PLANNED_WORK_SUBMIT_REPORT,
    /**
     * Moves the job itself through its lifecycle: START, PAUSE, RESUME, COMPLETE, PLAN.
     *
     * This key was previously withheld on the grounds that it would let a technician
     * sign off their own section 9.2 conclusion. It does not. Every one of those five
     * actions is a statement about the WORK — I have started, I am blocked, I am done —
     * and none of them touches the consolidated report: completing a job creates the
     * report in DRAFT, submitting it is `planned_work.submit_report`, and approving it
     * is `planned_work.approve_report`, which stays with MANAGEMENT/ADMIN/SYSTEM_ADMIN.
     * The submit/approve separation is between those last two keys and is untouched.
     *
     * There is no narrower key: `PLANNED_WORK_ACTION_RULES` maps all five actions to
     * this one permission, so without it the Ажил tab's primary action is dead and a
     * technician can record progress on a job they were never able to start. CANCEL is
     * the one action on that endpoint keyed separately (`planned_work.cancel`), and it
     * is deliberately not granted.
     */
    P.PLANNED_WORK_CHANGE_STATUS,
    /*
     * Taking unassigned work, and reading the material list in order to record what a
     * sub-task consumed. Neither widens what a technician may do to a colleague: claiming
     * only ever writes the caller's own employee id onto work that has none, and
     * `material.manage` — editing the catalogue itself — is not granted.
     */
    P.SERVICE_REQUEST_CLAIM, P.MATERIAL_VIEW,
    P.NOTIFICATION_VIEW,
    P.DIAGRAM_VIEW,
  ],

  /**
   * The signed-in customer.
   *
   * Portal keys only. Not one staff permission appears here, so even if a scope predicate
   * were ever missed on a staff endpoint, a customer would still be refused at the guard.
   * `portal.service_request.create` is granted because raising a request is the point of
   * the portal; the remaining write actions stay with staff.
   */
  CUSTOMER: [
    P.PORTAL_PROJECT_VIEW,
    P.PORTAL_BUILDING_VIEW,
    P.PORTAL_FLOOR_VIEW,
    P.PORTAL_OBJECT_VIEW,
    P.PORTAL_SERVICE_REQUEST_VIEW,
    P.PORTAL_SERVICE_REQUEST_CREATE,
    P.PORTAL_PROFILE_VIEW,
    P.PORTAL_PLANNED_WORK_VIEW,
    P.PORTAL_PLANNED_WORK_CREATE,
    P.PORTAL_SURVEY_SUBMIT,
    P.NOTIFICATION_VIEW,
  ],
};
