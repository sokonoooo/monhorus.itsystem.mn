import type { PlannedWorkEffectiveStatus } from '../constants/planned-work';
import type { ServiceRequestStatus } from '../constants/service-request';

/**
 * Calendar sources.
 *
 * Every calendar entry is a projection of a record that already exists elsewhere.
 * There is deliberately no calendar-only entity: nothing may appear on the calendar
 * that is not reachable from its source module.
 */
export const CALENDAR_SOURCES = ['PLANNED_WORK', 'SERVICE_REQUEST'] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

export const CALENDAR_SOURCE_LABELS: Record<CalendarSource, string> = {
  PLANNED_WORK: 'Төлөвлөгөөт ажил',
  SERVICE_REQUEST: 'Үйлчилгээний хүсэлт',
};

export const CALENDAR_VIEWS = ['month', 'week', 'day', 'agenda'] as const;
export type CalendarView = (typeof CALENDAR_VIEWS)[number];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  month: 'Сар',
  week: 'Долоо хоног',
  day: 'Өдөр',
  agenda: 'Хуваарь',
};

export interface CalendarEventDto {
  /** Composite of source and record id, unique across sources. */
  id: string;
  source: CalendarSource;
  /** Id of the underlying record, for navigation back to its detail screen. */
  sourceId: string;
  reference: string;
  title: string;
  /** Inclusive UTC start instant. */
  start: string;
  /** Inclusive UTC end instant. For a request this is the SLA deadline. */
  end: string;
  /** Backend-derived status of the source record. */
  status: PlannedWorkEffectiveStatus | ServiceRequestStatus;
  statusLabel: string;
  /** True when the source record is past its deadline, per the source module. */
  isOverdue: boolean;
  isUrgent: boolean;
  customerName: string | null;
  buildingName: string | null;
  assignedNames: readonly string[];
  /** Backend-derived progress; null for sources that do not track quantity. */
  progressPercent: number | null;
  detailPath: string;
}

export interface CalendarQuery {
  /** Inclusive window start, ISO date or timestamp. */
  from: string;
  /** Inclusive window end. */
  to: string;
  sources?: readonly CalendarSource[];
  employeeId?: string;
  teamId?: string;
  customerId?: string;
  projectId?: string;
  buildingId?: string;
  status?: string;
}

export interface CalendarResultDto {
  from: string;
  to: string;
  /** Server timezone the caller should render in. */
  timezone: string;
  events: readonly CalendarEventDto[];
}
