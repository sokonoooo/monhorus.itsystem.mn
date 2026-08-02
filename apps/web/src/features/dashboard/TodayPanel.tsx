import type { DashboardTodayItem, DashboardTodaySummary } from '@monhorus/shared';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { WidgetCard } from '../../components/charts/Charts';
import { EmptyState } from '../../components/ui/States';

function formatTime(iso: string | null, timeZone: string): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleTimeString('mn-MN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDate(date: string): string {
  // The backend already resolved the local calendar day, so this only reformats it and
  // must not re-interpret it in the browser's zone.
  const [year, month, day] = date.split('-');
  return `${year}.${month}.${day}`;
}

/**
 * One of the five day counters.
 *
 * A chip rather than a stacked tile: the labels are full Mongolian phrases and five of
 * them across a one-third-width column only stay readable if they wrap as a line of text
 * instead of being forced into equal columns. The inset grey matches the stat tiles the
 * rest of the dashboard uses, so the panel still reads as part of the same system.
 */
function Counter({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: number;
  tone?: 'slate' | 'red' | 'amber' | 'green';
}): ReactElement {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    red: 'text-red-700',
    amber: 'text-amber-700',
    green: 'text-green-700',
  };

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] ring-1 ring-inset ring-slate-200">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold tabular-nums ${tones[tone]}`}>{value}</span>
    </span>
  );
}

/**
 * One outstanding item.
 *
 * Everything stacks in one narrow column: the deadline and the reference share the top
 * line, and owner and status sit on the meta line rather than in a right-hand column that
 * would have nowhere to go here.
 */
function TodayRow({
  item,
  timeZone,
}: {
  item: DashboardTodayItem;
  timeZone: string;
}): ReactElement {
  return (
    <li>
      <Link
        to={item.linkPath}
        className={`block border-l-[3px] px-3 py-2 transition-colors hover:bg-slate-50 ${
          item.isOverdue
            ? 'border-red-500 bg-red-50/40'
            : item.isUrgent
              ? 'border-amber-400 bg-amber-50/40'
              : 'border-transparent'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="shrink-0 text-xs font-medium tabular-nums text-slate-500">
            {formatTime(item.dueAt, timeZone)}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
            {item.reference}
          </span>
          <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
            {item.kind === 'SERVICE_REQUEST' ? 'Хүсэлт' : 'Төлөвлөгөөт'}
          </span>
        </span>

        <span className="mt-0.5 block truncate text-xs text-slate-700">{item.title}</span>

        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-slate-500">
          <span className="truncate">{item.statusLabel}</span>
          <span aria-hidden="true">·</span>
          <span className="truncate">
            {item.assigneeNames.length > 0 ? item.assigneeNames.join(', ') : 'Хуваарилагдаагүй'}
          </span>
          {item.isUrgent && (
            <span className="rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">
              Яаралтай
            </span>
          )}
          {item.isOverdue && (
            <span className="rounded bg-red-600 px-1.5 py-0.5 font-medium text-white">
              Хугацаа хэтэрсэн
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

/**
 * What still needs doing today.
 *
 * This is where the recent-audit-log tail used to be. A list of what has already been
 * recorded answers a different question from what is still outstanding, and only the
 * second one can be acted on from a dashboard. Rows are ordered the way the day should be
 * worked: overdue first, then urgent, then by deadline.
 *
 * It sits beside the trend chart as a narrow column: the numbers lead the page, and this
 * is the one list on it anybody acts on, so it stays in view rather than below the fold.
 */
export function TodayPanel({ today }: { today: DashboardTodaySummary }): ReactElement {
  return (
    <WidgetCard title="Өнөөдрийн ажил" hint={`${formatDate(today.date)} · ${today.timezone}`} flush>
      <div role="group" aria-label="Өнөөдрийн үзүүлэлт" className="flex flex-wrap gap-1.5 px-4">
        <Counter label="Өнөөдөр" value={today.dueCount} />
        <Counter label="Хугацаа хэтэрсэн" value={today.overdueCount} tone="red" />
        <Counter label="Яаралтай" value={today.urgentCount} tone="amber" />
        <Counter label="Хуваарилагдаагүй" value={today.unassignedCount} />
        <Counter label="Дууссан" value={today.completedCount} tone="green" />
      </div>

      {today.items.length === 0 ? (
        <EmptyState
          title="Өнөөдөр хийх ажил алга"
          description="Хугацаа нь өнөөдөр дуусах, хэтэрсэн болон яаралтай ажил байхгүй байна."
        />
      ) : (
        // Capped rather than free-running: the card sits in a grid row whose height is set
        // by its neighbours, and an unbounded list would drag the whole row down.
        <ul
          aria-label="Өнөөдрийн ажлын жагсаалт"
          className="mt-3 max-h-[26rem] flex-1 divide-y divide-slate-100 overflow-y-auto border-t border-slate-100"
        >
          {today.items.map((item) => (
            <TodayRow key={`${item.kind}-${item.id}`} item={item} timeZone={today.timezone} />
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
