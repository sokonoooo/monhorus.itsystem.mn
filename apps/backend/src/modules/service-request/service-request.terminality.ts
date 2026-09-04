import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TRANSITIONS,
  type ServiceRequestStatus,
} from '@monhorus/shared';

/**
 * "Is this request finished?", answered once.
 *
 * WHY THIS FILE EXISTS. The same question was written down six times — as a
 * `TERMINAL_STATUSES` array in `sla.service.ts`, as `$nin: ['COMPLETED', 'CANCELLED']` in
 * the reminder sweep, and as an inline `status === 'COMPLETED' || status === 'CANCELLED'`
 * in the calendar and in `assignServiceRequest`. Six copies of one rule is six places to
 * update and five places to forget, and forgetting is silent: a request in a newly terminal
 * status keeps a live SLA clock, keeps drawing an overdue marker on the calendar, and stays
 * assignable, all while the status screen calls it closed.
 *
 * WHY IT IS DERIVED RATHER THAN LISTED. `SERVICE_REQUEST_TRANSITIONS` already says which
 * statuses are terminal, by giving them nowhere to go. Reading the answer out of the matrix
 * means the matrix stays the single description of the lifecycle: a status that becomes
 * terminal later is picked up here without anybody remembering to come back, and a status
 * that stops being terminal likewise. `service-request.notify.ts` already worked this way;
 * this is that derivation, moved somewhere the rest of the backend can reach it.
 *
 * WHERE THIS BELONGS EVENTUALLY. `packages/shared`, next to the matrix it is derived from —
 * the web console restates the same rule in `OpenServiceRequestsPage.tsx:28`, and only a
 * shared definition can reach it. It lives in the backend for now because this change did
 * not own that package.
 */
export const TERMINAL_SERVICE_REQUEST_STATUSES: readonly ServiceRequestStatus[] =
  SERVICE_REQUEST_STATUSES.filter((status) => SERVICE_REQUEST_TRANSITIONS[status].length === 0);

/**
 * The mutable copy Mongoose needs.
 *
 * `$in` / `$nin` take a plain array, and a `readonly` one does not satisfy their type. This
 * is the same set, spread once at module load rather than at every query site.
 */
export const TERMINAL_SERVICE_REQUEST_STATUS_LIST: ServiceRequestStatus[] = [
  ...TERMINAL_SERVICE_REQUEST_STATUSES,
];

/** Whether a request in this status can still move. */
export function isTerminalServiceRequestStatus(status: ServiceRequestStatus): boolean {
  return TERMINAL_SERVICE_REQUEST_STATUSES.includes(status);
}
