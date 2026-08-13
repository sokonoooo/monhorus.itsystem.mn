import { PLANNED_WORK_STATUS_LABELS } from '@monhorus/shared';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuildingSilhouette, barHeight, worstRiskLevel } from './BuildingSilhouette';
import { BarChart, riskHeadline, riskSlices, unassessedTotal, workSlices } from './PortalCharts';

/**
 * The arithmetic behind the portal charts.
 *
 * A chart that is merely pretty is still wrong if the numbers behind it are, and a wrong
 * number is much harder to spot in a bar than in a table — which is why the aggregation is
 * pure and tested here rather than inlined into the page.
 */

function building(counts: Record<string, number>, unassessed = 0) {
  return {
    riskSummary: {
      counts: Object.entries(counts).map(([level, count]) => ({ level, count })),
      unassessedCount: unassessed,
      hasCritical: (counts.CRITICAL ?? 0) > 0,
      lastAssessedAt: null,
    },
  } as never;
}

describe('risk aggregation across buildings', () => {
  it('sums the same band across every building', () => {
    const slices = riskSlices([
      building({ NORMAL: 4, CRITICAL: 1 }),
      building({ NORMAL: 3, ATTENTION: 2 }),
    ]);

    expect(slices.find((s) => s.key === 'NORMAL')?.count).toBe(7);
    expect(slices.find((s) => s.key === 'ATTENTION')?.count).toBe(2);
    expect(slices.find((s) => s.key === 'CRITICAL')?.count).toBe(1);
  });

  /**
   * "Not looked at yet" is not "fine": it must never be folded into NORMAL, which would
   * make a building nobody has inspected look like a clean one. It is reported separately
   * rather than charted, because on one scale a large uninspected count flattens every
   * band a customer can act on — see the note on `riskSlices`.
   */
  it('reports unassessed equipment separately, never as a healthy band', () => {
    const slices = riskSlices([building({ NORMAL: 2 }, 5)]);

    expect(slices.map((s) => s.key)).toEqual(['NORMAL']);
    expect(slices.find((s) => s.key === 'NORMAL')?.count).toBe(2);
    expect(unassessedTotal([building({ NORMAL: 2 }, 5)])).toBe(5);
  });

  /** The actionable bands keep a readable share whatever the uninspected count is. */
  it('does not let a large uninspected count squash the bands', () => {
    const buildings = [building({ NORMAL: 3, ATTENTION: 2 }, 112)];
    const slices = riskSlices(buildings);

    expect(slices.reduce((sum, s) => sum + s.count, 0)).toBe(5);
    expect(unassessedTotal(buildings)).toBe(112);
  });

  it('drops bands nothing is in, and orders worst last', () => {
    const slices = riskSlices([building({ NORMAL: 1, CRITICAL: 2 })]);

    expect(slices.map((s) => s.key)).toEqual(['NORMAL', 'CRITICAL']);
  });

  it('returns nothing at all for a customer with no buildings', () => {
    expect(riskSlices([])).toEqual([]);
  });
});

describe('the headline sentence', () => {
  /** Worst first: a customer needs the alarming number, not the biggest one. */
  it('leads with the worst band present, not the largest', () => {
    const slices = riskSlices([building({ NORMAL: 900, CRITICAL: 1 })]);
    expect(riskHeadline(slices)).toMatch(/1 тоноглол ноцтой эрсдэлтэй/);
  });

  it('reports out-of-service ahead of critical', () => {
    const slices = riskSlices([building({ CRITICAL: 3, OUT_OF_SERVICE: 1 })]);
    expect(riskHeadline(slices)).toMatch(/1 тоноглол ашиглах боломжгүй/);
  });

  it('says everything is normal only when something was actually assessed', () => {
    expect(riskHeadline(riskSlices([building({ NORMAL: 5 })]), 0)).toMatch(/бүх тоноглол хэвийн/);
    expect(riskHeadline(riskSlices([building({}, 5)]), 5)).toMatch(/үнэлгээ хийгдээгүй/);
    expect(riskHeadline(riskSlices([]), 0)).toMatch(/мэдээлэл алга/);
  });
});

describe('planned work by status', () => {
  it('drops statuses nothing is in and keeps workflow order', () => {
    const slices = workSlices(
      { DRAFT: 2, PENDING_APPROVAL: 0, PLANNED: 1, COMPLETED: 4 },
      PLANNED_WORK_STATUS_LABELS,
    );

    expect(slices.map((s) => s.key)).toEqual(['DRAFT', 'PLANNED', 'COMPLETED']);
    expect(slices.map((s) => s.count)).toEqual([2, 1, 4]);
  });

  /** PLANNED and STARTED share one blue on the badges; as two slices they must not. */
  it('gives every charted status its own fill', () => {
    const slices = workSlices(
      Object.fromEntries(
        ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'PLANNED', 'STARTED', 'COMPLETED'].map((s) => [
          s,
          1,
        ]),
      ),
      PLANNED_WORK_STATUS_LABELS,
    );

    expect(new Set(slices.map((s) => s.fill)).size).toBe(slices.length);
  });
});

describe('the bars themselves', () => {
  it('names and counts every bar, so colour is never the only channel', () => {
    render(
      <BarChart
        slices={[
          { key: 'a', label: 'Хэвийн', count: 7, fill: '#15803d' },
          { key: 'b', label: 'Ноцтой эрсдэлтэй', count: 1, fill: '#991b1b' },
        ]}
        emptyMessage="none"
      />,
    );

    expect(screen.getByText('Хэвийн')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('Ноцтой эрсдэлтэй')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  /** A count of 1 beside a count of 900 must still be visible, not a hairline of nothing. */
  it('never draws a non-zero count as a zero-width bar', () => {
    const { container } = render(
      <BarChart
        slices={[
          { key: 'a', label: 'Их', count: 900, fill: '#15803d' },
          { key: 'b', label: 'Бага', count: 1, fill: '#991b1b' },
        ]}
        emptyMessage="none"
      />,
    );

    const widths = [...container.querySelectorAll('span[style*="width"]')].map(
      (el) => Number.parseFloat((el as HTMLElement).style.width) || 0,
    );
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(2);
  });

  it('says so when there is nothing to draw rather than drawing an empty frame', () => {
    render(<BarChart slices={[]} emptyMessage="Мэдээлэл алга" />);
    expect(screen.getByText('Мэдээлэл алга')).toBeInTheDocument();
  });
});

describe('the building silhouette', () => {
  function floor(id: string, floorNumber: number | null, counts: Record<string, number>, un = 0) {
    return {
      id,
      name: `${floorNumber ?? '?'}-р давхар`,
      floorNumber,
      objectCount: 3,
      riskSummary: {
        counts: Object.entries(counts).map(([level, count]) => ({ level, count })),
        unassessedCount: un,
        hasCritical: false,
        lastAssessedAt: null,
      },
    } as never;
  }

  it('takes the worst band on the floor, not the commonest', () => {
    expect(worstRiskLevel(floor('f', 1, { NORMAL: 20, CRITICAL: 1 }))).toBe('CRITICAL');
  });

  /** An uninspected floor must not render in the same colour as a healthy one. */
  it('reads an unassessed floor as unassessed, never as normal', () => {
    expect(worstRiskLevel(floor('f', 1, {}, 4))).toBe('UNASSESSED');
  });

  it('makes higher floors taller, within bounds', () => {
    expect(barHeight(1, 10)).toBeLessThan(barHeight(10, 10));
    expect(barHeight(0, 10)).toBeGreaterThanOrEqual(28);
    expect(barHeight(10, 10)).toBeLessThanOrEqual(98);
  });

  it('stands the floors up from the ground, whatever order they arrive in', () => {
    render(<BuildingSilhouette floors={[floor('c', 3, {}), floor('a', 1, {}), floor('b', 2, {})]} />);

    const bars = within(screen.getByRole('list', { name: 'Барилгын харагдац' })).getAllByRole(
      'button',
    );
    expect(bars.map((bar) => bar.textContent)).toEqual(['1', '2', '3']);
  });

  it('says so when a building has no floors', () => {
    render(<BuildingSilhouette floors={[]} />);
    expect(screen.getByText(/давхар бүртгэгдээгүй/)).toBeInTheDocument();
  });
});
