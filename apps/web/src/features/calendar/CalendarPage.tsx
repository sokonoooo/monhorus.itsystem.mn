import {
  CALENDAR_SOURCES,
  CALENDAR_SOURCE_LABELS,
  CALENDAR_VIEWS,
  CALENDAR_VIEW_LABELS,
  PERMISSIONS,
  type CalendarEventDto,
  type CalendarResultDto,
  type CalendarSource,
  type CalendarView,
  type DispatchCandidateDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { calendarService } from '../../services/calendar.service';
import { dispatchService } from '../../services/service-request.service';

const TIME_ZONE = 'Asia/Ulaanbaatar';
const DAY_MS = 86_400_000;

/** Weekday headings, Monday first, matching the Mongolian working week. */
const WEEKDAY_LABELS = ['Дав', 'Мяг', 'Лха', 'Пүр', 'Баа', 'Бям', 'Ням'];

/** Midnight of the given day, in local terms. Used only for grid arithmetic. */
function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Monday of the week containing `date`. */
function startOfWeek(date: Date): Date {
  const copy = startOfDay(date);
  const weekday = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - weekday);
  return copy;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The window a view needs.
 *
 * The month grid always shows whole weeks, so the fetched window is the padded grid rather
 * than the calendar month, otherwise the leading and trailing days would render empty.
 */
function windowFor(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') {
    return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  if (view === 'agenda') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 30) };
  }

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const monthEnd = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  const from = startOfWeek(monthStart);
  const to = addDays(startOfWeek(monthEnd), 7);
  return { from, to };
}

function shift(view: CalendarView, anchor: Date, direction: -1 | 1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, direction * 7);
  if (view === 'agenda') return addDays(anchor, direction * 30);
  return new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1);
}

function periodLabel(view: CalendarView, anchor: Date): string {
  if (view === 'month') {
    return anchor.toLocaleDateString('mn-MN', {
      year: 'numeric',
      month: 'long',
      timeZone: TIME_ZONE,
    });
  }
  if (view === 'day') {
    return anchor.toLocaleDateString('mn-MN', { dateStyle: 'full', timeZone: TIME_ZONE });
  }
  const { from, to } = windowFor(view, anchor);
  const formatter = new Intl.DateTimeFormat('mn-MN', { dateStyle: 'medium', timeZone: TIME_ZONE });
  return `${formatter.format(from)} - ${formatter.format(addDays(to, -1))}`;
}

/** Colour by source and urgency, matching the Phase 1 palette. */
function eventTone(event: CalendarEventDto): string {
  if (event.isOverdue) return 'bg-red-50 text-red-800 ring-red-200';
  if (event.isUrgent) return 'bg-orange-50 text-orange-800 ring-orange-200';
  if (event.source === 'PLANNED_WORK') return 'bg-blue-50 text-blue-800 ring-blue-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

/**
 * Grid and agenda presentation.
 *
 * These live at module scope on purpose. A component declared inside the page body gets a
 * fresh identity on every render, which makes React unmount and remount the entire grid
 * and throws away its DOM; hoisting them keeps the tree stable.
 */
function EventChip({
  event,
  onOpen,
}: {
  event: CalendarEventDto;
  onOpen: (event: CalendarEventDto) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-xs ring-1 ring-inset hover:brightness-95 ${eventTone(event)}`}
      title={`${event.reference} · ${event.title} · ${event.statusLabel}`}
    >
      {event.title}
    </button>
  );
}

function DayCell({
  date,
  dayEvents,
  dimmed,
  isToday,
  onOpen,
}: {
  date: Date;
  dayEvents: readonly CalendarEventDto[];
  dimmed: boolean;
  isToday: boolean;
  onOpen: (event: CalendarEventDto) => void;
}): ReactElement {
  return (
    <div
      className={`min-h-[92px] border-b border-r border-slate-200 p-1.5 ${
        dimmed ? 'bg-slate-50' : 'bg-white'
      }`}
    >
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`text-xs ${
            isToday
              ? 'rounded-full bg-blue-600 px-1.5 py-0.5 font-semibold text-white'
              : 'text-slate-500'
          }`}
        >
          {date.getDate()}
        </span>
        {dayEvents.length > 3 && (
          <span className="text-xs text-slate-400">+{dayEvents.length - 3}</span>
        )}
      </div>
      <div className="space-y-1">
        {dayEvents.slice(0, 3).map((event) => (
          <EventChip key={event.id} event={event} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function AgendaRow({
  event,
  showDate = false,
  onOpen,
}: {
  event: CalendarEventDto;
  showDate?: boolean;
  onOpen: (event: CalendarEventDto) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onOpen(event)}
      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
    >
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${eventTone(event)}`}
      >
        {event.statusLabel}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-slate-900">{event.title}</span>
        <span className="block truncate text-xs text-slate-500">
          {event.reference} · {CALENDAR_SOURCE_LABELS[event.source]}
          {event.customerName ? ` · ${event.customerName}` : ''}
          {event.buildingName ? ` · ${event.buildingName}` : ''}
        </span>
      </span>
      {showDate && (
        <span className="whitespace-nowrap text-xs text-slate-500">
          {new Date(event.start).toLocaleDateString('mn-MN', { timeZone: TIME_ZONE })} -{' '}
          {new Date(event.end).toLocaleDateString('mn-MN', { timeZone: TIME_ZONE })}
        </span>
      )}
      {event.progressPercent !== null && (
        <span className="whitespace-nowrap text-xs font-medium text-slate-700">
          {event.progressPercent}%
        </span>
      )}
    </button>
  );
}

/**
 * Calendar.
 *
 * Every entry is a projection of a planned work or a service request; there are no
 * calendar-only records. Statuses, deadlines and progress are all taken from the backend
 * response, so the calendar cannot disagree with the module it came from.
 */
export function CalendarPage(): ReactElement {
  const navigate = useNavigate();
  const { can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const view = (searchParams.get('view') as CalendarView | null) ?? 'month';
  const anchor = useMemo(() => {
    const raw = searchParams.get('date');
    const parsed = raw ? new Date(`${raw}T00:00:00`) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }, [searchParams]);

  const selectedSources = useMemo<CalendarSource[]>(() => {
    const raw = searchParams.get('sources');
    if (!raw) return [...CALENDAR_SOURCES];
    const parts = raw.split(',').filter((part): part is CalendarSource =>
      (CALENDAR_SOURCES as readonly string[]).includes(part),
    );
    return parts.length > 0 ? parts : [...CALENDAR_SOURCES];
  }, [searchParams]);

  const employeeId = searchParams.get('employeeId') ?? '';

  const [result, setResult] = useState<CalendarResultDto | null>(null);
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const bounds = useMemo(() => windowFor(view, anchor), [view, anchor]);
  const windowKey = `${bounds.from.toISOString()}|${bounds.to.toISOString()}|${selectedSources.join(',')}|${employeeId}`;

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    const [fromIso, toIso, sourcesRaw, employee] = windowKey.split('|');
    try {
      const data = await calendarService.range({
        from: fromIso!,
        to: toIso!,
        sources: (sourcesRaw ?? '').split(',').filter(Boolean) as CalendarSource[],
        ...(employee ? { employeeId: employee } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      setResult(data);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Хуанли ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!can(PERMISSIONS.PLANNED_WORK_VIEW) && !can(PERMISSIONS.DISPATCH_VIEW)) return undefined;
    let cancelled = false;
    dispatchService
      .employeeCandidates({})
      .then((candidates) => {
        if (!cancelled) setEmployees(candidates);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [can]);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next);
  }

  const openEvent = useCallback(
    (event: CalendarEventDto) => navigate(event.detailPath),
    [navigate],
  );

  const todayKey = toDateKey(new Date());

  function toggleSource(source: CalendarSource): void {
    const next = selectedSources.includes(source)
      ? selectedSources.filter((entry) => entry !== source)
      : [...selectedSources, source];
    // An empty selection would silently mean "everything"; keep at least one source.
    updateParam('sources', next.length > 0 ? next.join(',') : source);
  }

  /** Events keyed by every day they span, so a multi-day work shows on each day. */
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEventDto[]>();
    for (const event of result?.events ?? []) {
      const start = startOfDay(new Date(event.start));
      const end = startOfDay(new Date(event.end));
      for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
        const key = toDateKey(cursor);
        const bucket = map.get(key);
        if (bucket) bucket.push(event);
        else map.set(key, [event]);
        // Guard against a malformed range producing an unbounded loop.
        if (cursor.getTime() - start.getTime() > 400 * DAY_MS) break;
      }
    }
    return map;
  }, [result]);

  function renderGrid(): ReactElement {
    const days: Date[] = [];
    const total = Math.round((bounds.to.getTime() - bounds.from.getTime()) / DAY_MS);
    for (let index = 0; index < total; index += 1) {
      days.push(addDays(bounds.from, index));
    }

    if (view === 'day') {
      const dayEvents = eventsByDay.get(toDateKey(bounds.from)) ?? [];
      return dayEvents.length === 0 ? (
        <EmptyState title="Тухайн өдөр ажил байхгүй" description="Өөр өдөр сонгоно уу." />
      ) : (
        <ul className="divide-y divide-slate-200">
          {dayEvents.map((event) => (
            <li key={event.id}>
              <AgendaRow event={event} onOpen={openEvent} />
            </li>
          ))}
        </ul>
      );
    }

    if (view === 'agenda') {
      const rows = result?.events ?? [];
      return rows.length === 0 ? (
        <EmptyState
          title="Хуваарь хоосон"
          description="Сонгосон хугацаанд төлөвлөгдсөн ажил байхгүй."
        />
      ) : (
        <ul className="divide-y divide-slate-200">
          {rows.map((event) => (
            <li key={event.id}>
              <AgendaRow event={event} showDate onOpen={openEvent} />
            </li>
          ))}
        </ul>
      );
    }

    return (
      <div>
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="border-r border-slate-200 px-2 py-1.5 text-xs font-medium text-slate-600"
            >
              {label}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-slate-200">
          {days.map((day) => (
            <DayCell
              key={toDateKey(day)}
              date={day}
              dayEvents={eventsByDay.get(toDateKey(day)) ?? []}
              dimmed={view === 'month' && day.getMonth() !== anchor.getMonth()}
              isToday={toDateKey(day) === todayKey}
              onOpen={openEvent}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Calendar"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Calendar' }]}
        actions={
          <Button variant="secondary" onClick={() => updateParam('date', '')}>
            Өнөөдөр
          </Button>
        }
      />

      <div className={FILTER_BAR}>
        <div className="flex items-center gap-1">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateParam('date', toDateKey(shift(view, anchor, -1)))}
            aria-label="Өмнөх"
          >
            Өмнөх
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => updateParam('date', toDateKey(shift(view, anchor, 1)))}
            aria-label="Дараах"
          >
            Дараах
          </Button>
        </div>

        <p className="min-w-[180px] text-sm font-medium text-slate-900">
          {periodLabel(view, anchor)}
        </p>

        <div>
          <label htmlFor="cal-view" className={FILTER_LABEL}>
            Харагдац
          </label>
          <select
            id="cal-view"
            value={view}
            onChange={(event) => updateParam('view', event.target.value)}
            className={FILTER_SELECT}
          >
            {CALENDAR_VIEWS.map((entry) => (
              <option key={entry} value={entry}>
                {CALENDAR_VIEW_LABELS[entry]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="cal-employee" className={FILTER_LABEL}>
            Ажилтан
          </label>
          <select
            id="cal-employee"
            value={employeeId}
            onChange={(event) => updateParam('employeeId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх ажилтан</option>
            {employees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.lastName} {employee.firstName}
              </option>
            ))}
          </select>
        </div>

        <fieldset aria-label="Эх сурвалж" className="flex items-end gap-3">
          {CALENDAR_SOURCES.map((source) => (
            <label key={source} className="flex items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={selectedSources.includes(source)}
                onChange={() => toggleSource(source)}
                className="h-4 w-4 rounded border-slate-300"
              />
              {CALENDAR_SOURCE_LABELS[source]}
            </label>
          ))}
        </fieldset>
      </div>

      {result && (
        <p className="mb-2 text-xs text-slate-500">
          Цагийн бүс: {result.timezone}
        </p>
      )}

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        {loading && (
          <div className="space-y-2 p-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {!loading && error && (
          <div className="p-4">
            <ErrorState
              description={error}
              action={
                <Button variant="secondary" size="sm" onClick={() => void load()}>
                  Дахин оролдох
                </Button>
              }
            />
          </div>
        )}
        {!loading && !error && renderGrid()}
      </div>

      {!loading && !error && (result?.events.length ?? 0) === 0 && view === 'month' && (
        <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-600">
          Сонгосон хугацаанд төлөвлөгдсөн ажил, хүсэлт байхгүй.
        </p>
      )}
    </>
  );
}
