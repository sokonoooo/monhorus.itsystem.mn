import {
  type PlannedWorkFloorProgressDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useId, type ReactElement } from 'react';

import { DataTable, type Column } from '../../components/ui/DataTable';
import { ProgressBar } from './PlannedWorkBadges';

/** Label the backend already uses for the floorless bucket of `floorProgress`. */
export const UNASSIGNED_FLOOR_LABEL = 'Давхар заагаагүй';

/**
 * The floorless bucket's key.
 *
 * Empty string rather than a sentinel word because that is exactly what the backend puts
 * in `floorProgress[].floorId` for the same bucket, so a group found here lines up with
 * its rollup without a translation step. A real floor id is an ObjectId and can never
 * collide with it.
 */
export const UNASSIGNED_FLOOR_KEY = '';

export interface FloorGroup {
  key: string;
  name: string;
  tasks: readonly PlannedWorkTaskDto[];
  /** Server rollup for this floor, when it has one. */
  progress: PlannedWorkFloorProgressDto | undefined;
}

/**
 * Splits the work's sub-tasks into one group per floor.
 *
 * Driven by the TASKS, not by the building's floor list: a floor nobody planned work on
 * has nothing to show, and fetching the whole building to prove that would be a request
 * spent on empty sections. `floorProgress` supplies the rollup and the order — the server
 * sorts it by name in the Mongolian collation — and anything it does not cover (every
 * task on that floor is skipped, so it carries no rollup) is appended by name. The
 * floorless bucket is always last, because it is a leftover rather than a place.
 */
export function groupTasksByFloor(
  tasks: readonly PlannedWorkTaskDto[],
  floorProgress: readonly PlannedWorkFloorProgressDto[],
): FloorGroup[] {
  const rollups = new Map(floorProgress.map((entry) => [entry.floorId, entry]));
  const order = new Map(floorProgress.map((entry, index) => [entry.floorId, index]));

  const groups = new Map<string, PlannedWorkTaskDto[]>();
  for (const task of tasks) {
    const key = task.floorId ?? UNASSIGNED_FLOOR_KEY;
    const bucket = groups.get(key);
    if (bucket) bucket.push(task);
    else groups.set(key, [task]);
  }

  const rows: FloorGroup[] = [...groups].map(([key, grouped]) => ({
    key,
    name:
      key === UNASSIGNED_FLOOR_KEY
        ? UNASSIGNED_FLOOR_LABEL
        : (rollups.get(key)?.floorName ?? grouped[0]?.floorName ?? UNASSIGNED_FLOOR_LABEL),
    tasks: grouped,
    progress: rollups.get(key),
  }));

  return rows.sort((left, right) => {
    if (left.key === UNASSIGNED_FLOOR_KEY) return 1;
    if (right.key === UNASSIGNED_FLOOR_KEY) return -1;

    const leftIndex = order.get(left.key);
    const rightIndex = order.get(right.key);
    if (leftIndex !== undefined && rightIndex !== undefined) return leftIndex - rightIndex;
    // A floor with no rollup has no place in the server's order; it sorts by name, after
    // every floor that does have one.
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return left.name.localeCompare(right.name, 'mn');
  });
}

/**
 * The equipment one sub-task covers, listed under its row.
 *
 * Straight off the DTO — `relatedObjects` already arrives with the work — so opening a row
 * costs no request. It answers the question the table otherwise cannot: which equipment a
 * sub-task's score will land on, and therefore whether its result reaches Үзлэг ба дүгнэлт
 * at all. A sub-task naming none says so, because that is the case worth noticing.
 */
export function TaskEquipmentPanel({ task }: { task: PlannedWorkTaskDto }): ReactElement {
  if (task.relatedObjects.length === 0) {
    return (
      <p className="text-xs text-slate-500">
        Тоноглол сонгоогүй: энэ дэд ажлын үр дүн Үзлэг ба дүгнэлт хэсэгт харагдахгүй.
      </p>
    );
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-slate-600">
        Хамрах тоноглол ({task.relatedObjects.length})
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {task.relatedObjects.map((object) => (
          <li
            key={object.id}
            className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200"
          >
            {object.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface FloorTaskSectionProps {
  group: FloorGroup;
  /**
   * Shared across every section. One controller for the whole page is what makes the
   * column choice a property of the sub-task table rather than of one floor's copy of it.
   */
  columns: ReadonlyArray<Column<PlannedWorkTaskDto>>;
  expanded: boolean;
  onToggle: () => void;
  /** Ids of the sub-tasks whose equipment panel is open, across every floor. */
  expandedTaskIds: readonly string[];
  onToggleTask: (taskId: string) => void;
}

/** One floor, its rollup, and the sub-tasks planned on it. */
export function FloorTaskSection({
  group,
  columns,
  expanded,
  onToggle,
  expandedTaskIds,
  onToggleTask,
}: FloorTaskSectionProps): ReactElement {
  const panelId = useId();

  return (
    <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3">
        {/* Accordion as the ARIA pattern describes it: the heading carries the level so a
            screen reader can still navigate the page by floor, and the button inside it is
            what opens the panel. */}
        <h3 className="min-w-0 text-sm font-semibold text-slate-900">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex min-w-0 items-center gap-2 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <svg
              className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${
                expanded ? 'rotate-90' : ''
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="truncate">{group.name}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-normal text-slate-600">
              {group.tasks.length} дэд ажил
            </span>
          </button>
        </h3>
        {group.progress && (
          <div className="w-40 shrink-0">
            <ProgressBar
              percent={group.progress.progressPercent}
              completedQuantity={group.progress.completedQuantity}
              totalQuantity={group.progress.totalQuantity}
            />
          </div>
        )}
      </div>

      <div id={panelId} hidden={!expanded}>
        {expanded && (
          <DataTable
            columns={columns}
            rows={group.tasks}
            rowKey={(row) => row.id}
            // Numbered per floor, and restarting at 1 in each section is the point: these
            // are separate tables under separate headings, and a reader checking the third
            // task on this floor counts down this table, not across the page.
            numbering
            ariaLabel={`${group.name} дэд ажил`}
            emptyTitle="Дэд ажил бүртгэгдээгүй"
            renderExpanded={(row) => <TaskEquipmentPanel task={row} />}
            expandedKeys={expandedTaskIds}
            onToggleExpand={(key) => onToggleTask(key)}
            expandLabel={(row) => `${row.title} — хамрах тоноглол`}
          />
        )}
      </div>
    </section>
  );
}
