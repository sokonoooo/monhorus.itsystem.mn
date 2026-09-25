/**
 * What the audit log is allowed to print.
 *
 * WHY THIS IS A FILE AND NOT TWO OBJECTS INSIDE THE PAGE. It was two objects inside the
 * page, both typed `Record<string, string>` with a `?? row.action` fallback behind them,
 * and that combination is exactly a gap that cannot be seen: the maps covered 24 of the
 * backend's 34 actions and 9 of its 20 entity types, every miss fell through to the raw
 * wire token, and nothing — not the compiler, not a test, not a reviewer reading the
 * page — could tell the difference between a token that was deliberately left in English
 * and one nobody had got round to. So an auditor reading a Mongolian screen met
 * `INSPECTION_REPORT_FINALISED` sitting in a column next to «Тайлан баталсан», with no way
 * to know the two were about different documents.
 *
 * The entire `INSPECTION_REPORT_*` approval chain was unlabelled — seven actions covering
 * the safety document that goes to the customer — along with both password-reset actions,
 * which are the two rows anybody investigating a compromised account comes here to read.
 *
 * WHAT CHANGED. The catalogues are declared as literal tuples and the maps are typed
 * `Record<AuditAction, string>` and `Record<AuditEntityType, string>`, so a label that is
 * missing is a build failure rather than an English word on a Mongolian screen. That is
 * the whole point of them being here: the exhaustiveness, not the tidiness.
 *
 * WHAT IS STILL WRONG, AND WHO HAS TO FIX IT. `AUDIT_ACTIONS` is DECLARED TWICE — once in
 * `apps/backend/src/modules/audit/audit-log.model.ts` and once here. That is the same class
 * of duplication that produced the original gap, moved rather than removed: the compiler
 * now catches a label missing from THIS list, but nothing catches this list falling behind
 * the backend's. `audit-vocabulary.test.ts` reads the backend file and compares the two,
 * which turns the drift into a failing test instead of a silent one, and a test is a
 * weaker guarantee than a type.
 *
 *   THE DURABLE FIX IS TO MOVE `AUDIT_ACTIONS` INTO `packages/shared` and import it here,
 *   at which point this tuple and its test both disappear and a new backend action fails
 *   the web build the same day it is added. That package was not this change's to edit.
 *
 * The entity catalogue has no backend list to move at all — `entityType` is a bare `string`
 * on the model and the twenty values below were recovered by sweeping every `auditLog` call
 * site. Publishing it as a union alongside the actions is the same follow-up.
 */

/**
 * Every action the backend writes, verbatim from `AUDIT_ACTIONS` in
 * `apps/backend/src/modules/audit/audit-log.model.ts`. Order follows that file so the two
 * can be read side by side.
 */
export const AUDIT_ACTIONS = [
  'Created',
  'Updated',
  'StatusChanged',
  'Assigned',
  'Submitted',
  'Approved',
  'Returned',
  'Published',
  'Closed',
  'Cancelled',
  'PasscodeReset',
  'PasswordChanged',
  'LoginSucceeded',
  'LoginFailed',
  'LoggedOut',
  'AccountLocked',
  'TokenReuseDetected',
  'PasswordResetRequested',
  'PasswordResetCompleted',
  'PLANNED_WORK_BECAME_OVERDUE',
  'PLANNED_WORK_RESCHEDULED',
  'PLANNED_WORK_ARCHIVED',
  'REPORT_CREATED',
  'REPORT_UPDATED',
  'REPORT_SUBMITTED',
  'REPORT_RETURNED',
  'REPORT_APPROVED',
  'INSPECTION_REPORT_GENERATED',
  'INSPECTION_REPORT_UPDATED',
  'INSPECTION_REPORT_SUBMITTED',
  'INSPECTION_REPORT_APPROVED',
  'INSPECTION_REPORT_RETURNED',
  'INSPECTION_REPORT_FINALISED',
  'INSPECTION_REPORT_REOPENED',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/**
 * Every `entityType` any service writes.
 *
 * Recovered by sweep rather than read off a list, because the model types the field as a
 * bare `string` and there is no list. `Diagram` is written through a module-level `ENTITY`
 * constant rather than a literal, so a grep for the literal alone misses it — which is a
 * fair measure of how reliable this catalogue can be until the backend declares one.
 */
export const AUDIT_ENTITY_TYPES = [
  'Building',
  'Customer',
  'Diagram',
  'Employee',
  'Equipment',
  'Floor',
  'FloorPlan',
  'InspectionReport',
  'Invoice',
  'Object',
  'ObjectType',
  'Permission',
  'PlannedWork',
  'PlannedWorkReport',
  'PlannedWorkTask',
  'Project',
  'Report',
  'Setting',
  'User',
  'Work',
] as const;

export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

/**
 * Mongolian for every action. Base vocabulary from requirements 14.4.
 *
 * THE TWO REPORT CHAINS ARE NAMED APART. `REPORT_*` is the planned-work report and
 * `INSPECTION_REPORT_*` is the consolidated inspection report — two different documents
 * with two different approval chains, and the audit log is precisely where somebody needs
 * to tell them apart. `REPORT_APPROVED` used to read «Тайлан баталсан», a phrase that
 * describes both, so these carry the document in the label the way `ENTITY_LABELS` already
 * distinguishes «Ажлын тайлан» from «Үзлэгийн тайлан».
 *
 * The inspection wording follows `INSPECTION_REPORT_STATUS_LABELS` in shared, so «эцэслэсэн»
 * means what «Эцэслэгдсэн» means on the report itself rather than being a second word for
 * the same step.
 */
export const ACTION_LABELS: Record<AuditAction, string> = {
  Created: 'Үүсгэсэн',
  Updated: 'Шинэчилсэн',
  StatusChanged: 'Төлөв өөрчилсөн',
  Assigned: 'Хуваарилсан',
  Submitted: 'Илгээсэн',
  Approved: 'Баталсан',
  Returned: 'Буцаасан',
  // Publication is the step past approval: what makes a report visible to the customer.
  Published: 'Нийтэлсэн',
  Closed: 'Хаасан',
  Cancelled: 'Цуцалсан',
  PasscodeReset: 'Нууц үг шинэчилсэн',
  PasswordChanged: 'Нууц үг сольсон',
  LoginSucceeded: 'Нэвтэрсэн',
  LoginFailed: 'Нэвтрэх оролдлого',
  LoggedOut: 'Гарсан',
  AccountLocked: 'Бүртгэл хаагдсан',
  TokenReuseDetected: 'Token дахин ашиглалт',
  // Two rows, not one, because the backend writes two: the request is made by whoever typed
  // an address into a public form and proves nothing, while the completion is the event
  // that actually changed a credential. A request with no matching completion is the thing
  // an investigator is looking for, so the labels must not read as the same event.
  PasswordResetRequested: 'Нууц үг сэргээх хүсэлт',
  PasswordResetCompleted: 'Нууц үг сэргээсэн',
  PLANNED_WORK_BECAME_OVERDUE: 'Хугацаа хэтэрсэн (систем)',
  PLANNED_WORK_RESCHEDULED: 'Хугацаа сунгасан',
  PLANNED_WORK_ARCHIVED: 'Архивласан',
  REPORT_CREATED: 'Ажлын тайлан үүссэн',
  REPORT_UPDATED: 'Ажлын тайлан шинэчилсэн',
  REPORT_SUBMITTED: 'Ажлын тайлан илгээсэн',
  REPORT_RETURNED: 'Ажлын тайлан буцаасан',
  REPORT_APPROVED: 'Ажлын тайлан баталсан',
  INSPECTION_REPORT_GENERATED: 'Үзлэгийн тайлан үүсгэсэн',
  INSPECTION_REPORT_UPDATED: 'Үзлэгийн тайлан шинэчилсэн',
  INSPECTION_REPORT_SUBMITTED: 'Үзлэгийн тайлан илгээсэн',
  INSPECTION_REPORT_APPROVED: 'Үзлэгийн тайлан баталсан',
  INSPECTION_REPORT_RETURNED: 'Үзлэгийн тайлан буцаасан',
  INSPECTION_REPORT_FINALISED: 'Үзлэгийн тайлан эцэслэсэн',
  // Reopening does not edit the finalised document: it advances the version number and
  // returns the report to DRAFT. «Шинэ хувилбар» is the wording the report screen uses.
  INSPECTION_REPORT_REOPENED: 'Үзлэгийн тайлангийн шинэ хувилбар нээсэн',
};

/** Mongolian for every entity type, in the words the navigation already uses. */
export const ENTITY_LABELS: Record<AuditEntityType, string> = {
  Building: 'Барилга',
  Customer: 'Харилцагч',
  Diagram: 'Схем',
  Employee: 'Ажилтан',
  Equipment: 'Объект/Төхөөрөмж',
  Floor: 'Давхар',
  FloorPlan: 'Давхрын төлөвлөгөө',
  InspectionReport: 'Үзлэгийн тайлан',
  Invoice: 'Нэхэмжлэл',
  // The object-master record. `Equipment` above is the older objects module writing about
  // the same kind of thing under a different name; both are on the wire, so both are named.
  Object: 'Тоноглол',
  ObjectType: 'Тоноглолын төрөл',
  Permission: 'Role/Permission',
  PlannedWork: 'Төлөвлөгөөт ажил',
  PlannedWorkReport: 'Ажлын тайлан',
  PlannedWorkTask: 'Дэд ажил',
  Project: 'Төсөл',
  Report: 'Нэгдсэн тайлан',
  Setting: 'Тохиргоо',
  User: 'Хэрэглэгч',
  Work: 'Ажил/Хүсэлт',
};

/**
 * The Mongolian for an action, or the raw token when the backend sends one this build has
 * never heard of.
 *
 * The fallback is kept — a row must render whatever arrives, and an audit log that hid a
 * row it could not name would be worse than one that prints a token. What is gone is the
 * fallback being the SILENT answer for actions this build does know about.
 */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action as AuditAction] ?? action;
}

/** The Mongolian for an entity type, or the raw token. Same reasoning as `actionLabel`. */
export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType as AuditEntityType] ?? entityType;
}
