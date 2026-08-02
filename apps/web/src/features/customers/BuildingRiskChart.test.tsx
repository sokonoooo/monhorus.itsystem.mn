import type { BuildingDto } from '@monhorus/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { makeBuilding, makeRiskSummary } from '../../test/fixtures';
import { BuildingRiskChart } from './BuildingRiskChart';

function renderChart(buildings: BuildingDto[]) {
  return render(
    <MemoryRouter>
      <BuildingRiskChart buildings={buildings} />
    </MemoryRouter>,
  );
}

describe('BuildingRiskChart', () => {
  it('draws one bar per building, numbered in order', () => {
    renderChart([
      makeBuilding({ id: 'b1', name: 'Төв байр' }),
      makeBuilding({ id: 'b2', name: 'Ар талын байр' }),
    ]);

    const list = screen.getByRole('img', { name: /Барилгын эрсдэл/ });
    expect(within(list).getByText('1')).toBeInTheDocument();
    expect(within(list).getByText('2')).toBeInTheDocument();
  });

  it('names every building in its accessible label and in the key below', () => {
    renderChart([makeBuilding({ id: 'b1', name: 'Төв байр' })]);

    expect(screen.getByRole('img', { name: /Төв байр/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Төв байр' })).toHaveAttribute(
      'href',
      '/buildings/b1',
    );
  });

  /** Section 10.2 requires a marker where a red or black object sits. */
  it('marks a building that holds a critical object', () => {
    renderChart([
      makeBuilding({
        id: 'b1',
        riskSummary: makeRiskSummary({
          counts: [{ level: 'CRITICAL', count: 2 }],
          hasCritical: true,
        }),
      }),
    ]);

    // The marker rides on the bar's own tooltip, not on the chart's label.
    expect(screen.getByTitle(/анхаарах шаардлагатай/)).toBeInTheDocument();
  });

  it('leaves a healthy building unmarked', () => {
    renderChart([
      makeBuilding({
        id: 'b1',
        riskSummary: makeRiskSummary({ counts: [{ level: 'NORMAL', count: 4 }] }),
      }),
    ]);

    expect(screen.queryByTitle(/анхаарах шаардлагатай/)).not.toBeInTheDocument();
  });

  it('counts unassessed objects toward the bar rather than dropping them', () => {
    renderChart([
      makeBuilding({
        id: 'b1',
        name: 'Төв байр',
        riskSummary: makeRiskSummary({
          counts: [{ level: 'NORMAL', count: 3 }],
          unassessedCount: 2,
        }),
      }),
    ]);

    // Three assessed plus two unassessed.
    expect(screen.getByRole('img', { name: /Төв байр 5 объект/ })).toBeInTheDocument();
  });

  it('shows a building with nothing recorded rather than omitting it', () => {
    renderChart([makeBuilding({ id: 'b1', name: 'Хоосон байр' })]);

    expect(screen.getByRole('img', { name: /Хоосон байр 0 объект/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Хоосон байр' })).toBeInTheDocument();
  });

  /** Section 19.2 leaves the building-level aggregation unapproved. */
  it('shows band counts and never a single building score', () => {
    renderChart([
      makeBuilding({
        id: 'b1',
        riskSummary: makeRiskSummary({
          counts: [
            { level: 'NORMAL', count: 3 },
            { level: 'CRITICAL', count: 1 },
          ],
        }),
      }),
    ]);

    expect(screen.queryByText(/%$/)).not.toBeInTheDocument();
    expect(screen.getByText('Хэвийн')).toBeInTheDocument();
    expect(screen.getByText('Ноцтой эрсдэлтэй')).toBeInTheDocument();
  });

  it('explains the unassessed colour in the key', () => {
    renderChart([makeBuilding({ id: 'b1' })]);

    expect(screen.getByText('Үнэлгээгүй')).toBeInTheDocument();
  });
});
