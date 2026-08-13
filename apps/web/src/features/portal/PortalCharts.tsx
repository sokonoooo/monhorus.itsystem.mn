import { RISK_LEVELS, RISK_LEVEL_LABELS, type BuildingDto, type RiskLevel } from '@monhorus/shared';
import type { ReactElement } from 'react';

/**
 * The customer portal's charts.
 *
 * PLAIN SVG-FREE BARS. There is no charting library in this repo and this does not add one:
 * a proportional bar is a div with a width, and a dependency whose only job is to draw one
 * would be the largest thing in the bundle. The marks follow one spec — 16px thick, a 4px
 * rounded data-end with a square baseline, a 2px surface gap between neighbours, and the
 * value labelled at the tip.
 *
 * WHAT IS DELIBERATELY NOT DRAWN. No trend over time, and no single "health score". The
 * customer mobile app made both of those calls first and wrote down why: there is no
 * endpoint behind a historical trend, so drawing one means inventing the data; and the
 * backend refuses to publish an aggregate score for a node because the aggregation method
 * is unapproved, so the client must not manufacture one either. Everything below is a count
 * the server already stands behind.
 */

/**
 * The severity ramp, and why it is not the badge colours.
 *
 * The badges are pale chips — `bg-red-50` behind dark text — which is right when the colour
 * sits behind a word that already says the answer. Here the fill IS the data, so it needs
 * weight. The hue identity is kept (green, amber, orange, red, near-black) so a red bar and
 * a red badge still mean the same thing.
 *
 * THE STEPS WERE COMPUTED, NOT PICKED. The obvious choice — the Tailwind 600 step of each
 * hue — puts CRITICAL and SCHEDULE_REPAIR at ΔE 8.7 for NORMAL vision, well under the 15
 * floor: the two bands a customer must act on differently would have been hard to tell
 * apart. These steps measure ΔE 21.8 on the worst adjacent pair with full colour vision and
 * 15.2 under simulated protanopia.
 *
 * Two checks still fail and are accepted knowingly: the terminal band is near-black, so it
 * sits outside the lightness band and under the chroma floor. That is what «Ашиглах
 * боломжгүй» means in this product, and a chromatic substitute would misreport it. The
 * amber and orange steps also sit under 3:1 against white, which obliges a visible label
 * rather than colour alone — every bar here carries its band name and count, so that
 * relief is present by construction rather than by promise.
 */
const RISK_FILL: Record<RiskLevel | 'UNASSESSED', string> = {
  NORMAL: '#15803d',
  ATTENTION: '#fcd34d',
  SCHEDULE_REPAIR: '#f97316',
  CRITICAL: '#991b1b',
  OUT_OF_SERVICE: '#1c1917',
  UNASSESSED: '#cbd5e1',
};

export interface Slice {
  key: string;
  label: string;
  count: number;
  fill: string;
}

/**
 * Every ASSESSED risk band across the customer's buildings, worst last.
 *
 * Summed from `BuildingDto.riskSummary`, which the server already computes per building —
 * so this is a re-presentation of published counts, not a second opinion about them.
 *
 * UNASSESSED IS NOT A BAND HERE, and is reported separately by `unassessedTotal`. It was a
 * sixth bar until the chart was looked at on real data: 112 uninspected devices next to
 * three healthy ones flattened every actionable band into a two-pixel sliver. The two are
 * different questions — "how much of this have we looked at" and "of what we looked at,
 * how bad is it" — and a single scale can only answer one of them. Dropping it from the
 * bars is not hiding it: the count is stated in full beneath them, and it still drives the
 * headline when there is nothing assessed to report.
 */
export function riskSlices(buildings: readonly BuildingDto[]): Slice[] {
  const totals = new Map<string, number>();
  for (const building of buildings) {
    for (const entry of building.riskSummary.counts) {
      totals.set(entry.level, (totals.get(entry.level) ?? 0) + entry.count);
    }
    totals.set(
      'UNASSESSED',
      (totals.get('UNASSESSED') ?? 0) + building.riskSummary.unassessedCount,
    );
  }

  const slices: Slice[] = RISK_LEVELS.map((level) => ({
    key: level,
    label: RISK_LEVEL_LABELS[level],
    count: totals.get(level) ?? 0,
    fill: RISK_FILL[level],
  }));

  // A band nobody is in is noise on a five-row chart, not information.
  return slices.filter((slice) => slice.count > 0);
}

/** Equipment nobody has assessed yet, across every building. Reported, never charted. */
export function unassessedTotal(buildings: readonly BuildingDto[]): number {
  return buildings.reduce((sum, building) => sum + building.riskSummary.unassessedCount, 0);
}

/**
 * A row of proportional bars with the value at each tip.
 *
 * ONE SERIES, SO NO LEGEND BOX: every bar is named on its own row, which is the dependable
 * identity channel a legend would otherwise provide. Widths are relative to the largest
 * slice rather than to the total, because the question these answer is "how do these
 * compare" — against the total, a 3 next to a 900 is an invisible sliver.
 */
export function BarChart({
  slices,
  emptyMessage,
}: {
  slices: readonly Slice[];
  emptyMessage: string;
}): ReactElement {
  if (slices.length === 0) {
    return <p className="py-6 text-center text-sm text-slate-500">{emptyMessage}</p>;
  }

  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const largest = Math.max(...slices.map((slice) => slice.count));

  return (
    // 2px between rows is the surface gap that separates neighbouring marks — a stroke
    // around each bar would add ink that is not data.
    <ul className="flex flex-col gap-0.5">
      {slices.map((slice) => {
        const share = total > 0 ? Math.round((slice.count / total) * 100) : 0;
        return (
          <li
            key={slice.key}
            className="grid grid-cols-[minmax(9rem,11rem)_1fr_auto] items-center gap-3 py-1"
            title={`${slice.label}: ${slice.count} (${share}%)`}
          >
            <span className="truncate text-xs text-slate-600">{slice.label}</span>
            <span className="flex h-4 items-center">
              <span
                className="h-4 rounded-r-[4px]"
                style={{
                  // A zero-width bar would vanish; the smallest non-zero count still needs
                  // to be visibly present next to its label.
                  width: `${Math.max(2, (slice.count / largest) * 100)}%`,
                  backgroundColor: slice.fill,
                }}
              />
            </span>
            <span className="tabular-nums text-xs font-medium text-slate-700">{slice.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The one sentence worth reading first.
 *
 * Worst state first, the way the mobile app words it: a customer opening this wants to know
 * whether anything is on fire before they want a distribution. Deliberately a sentence and
 * not a gauge — there is no approved way to reduce these bands to a single number.
 */
export function riskHeadline(slices: readonly Slice[], unassessed = 0): string {
  const countOf = (key: string): number => slices.find((s) => s.key === key)?.count ?? 0;
  const outOfService = countOf('OUT_OF_SERVICE');
  const critical = countOf('CRITICAL');
  const repair = countOf('SCHEDULE_REPAIR');
  const attention = countOf('ATTENTION');
  const assessed = slices.reduce((sum, slice) => sum + slice.count, 0);

  if (outOfService > 0) return `${outOfService} тоноглол ашиглах боломжгүй байна.`;
  if (critical > 0) return `${critical} тоноглол ноцтой эрсдэлтэй байна.`;
  if (repair > 0) return `${repair} тоноглол ойрын хугацаанд засвар шаардлагатай.`;
  if (attention > 0) return `${attention} тоноглол анхаарал шаардаж байна.`;
  if (assessed > 0) return 'Үнэлгээ хийгдсэн бүх тоноглол хэвийн байна.';
  if (unassessed > 0) return `${unassessed} тоноглолд үнэлгээ хийгдээгүй байна.`;
  return 'Тоноглолын мэдээлэл алга байна.';
}

/**
 * The workflow palette, for planned work by status.
 *
 * Categorical rather than ordinal — these are places in a process, not degrees of one
 * thing — so the hues follow the badges a customer already reads in the list. Two changes
 * were forced: the badge palette paints PLANNED and STARTED the same blue, which is fine
 * beside a word naming the state and useless as two slices of one chart, so they take a
 * light and a dark step of that blue; and DRAFT stays deliberately grey.
 *
 * Measured: worst adjacent pair ΔE 20.8 with full colour vision, 18.1 under protanopia.
 * The one failing check is the chroma floor on the grey, which is the point of it — "not
 * started" reads as absence in this product, and giving it a hue would make it a state.
 * Tritan separation on that same pair sits at 6.3, inside the band that is permitted only
 * with a second encoding: every row here is named and counted, so that is satisfied.
 */
const WORK_STATUS_FILL: Record<string, string> = {
  DRAFT: '#94a3b8',
  PENDING_APPROVAL: '#f59e0b',
  REJECTED: '#dc2626',
  PLANNED: '#60a5fa',
  STARTED: '#1d4ed8',
  COMPLETED: '#15803d',
};

/** The statuses worth charting, in the order work moves through them. */
export const CHARTED_WORK_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'REJECTED',
  'PLANNED',
  'STARTED',
  'COMPLETED',
] as const;

/** Turns exact per-status totals into slices, dropping the statuses nothing is in. */
export function workSlices(
  totals: Readonly<Record<string, number>>,
  labels: Readonly<Record<string, string>>,
): Slice[] {
  return CHARTED_WORK_STATUSES.map((status) => ({
    key: status,
    label: labels[status] ?? status,
    count: totals[status] ?? 0,
    fill: WORK_STATUS_FILL[status] ?? '#94a3b8',
  })).filter((slice) => slice.count > 0);
}
