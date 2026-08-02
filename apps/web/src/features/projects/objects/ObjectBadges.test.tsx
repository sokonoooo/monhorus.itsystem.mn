import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RiskLegend, RiskSummaryCell, ScoreBar, ScorePercent } from './ObjectBadges';

describe('ScorePercent', () => {
  /** Section 10.1: the score is a 0-100 figure, so the percent is the score itself. */
  it('renders the score as a percent', () => {
    render(<ScorePercent level="NORMAL" score={92} />);

    expect(screen.getByText('92%')).toBeInTheDocument();
  });

  it('keeps the band as the accessible name so the meaning is not lost', () => {
    render(<ScorePercent level="CRITICAL" score={38} />);

    const badge = screen.getByLabelText('Ноцтой эрсдэлтэй 38%');
    expect(badge).toHaveTextContent('38%');
    expect(badge).toHaveAttribute('title', 'Ноцтой эрсдэлтэй');
  });

  it('says an object is unassessed rather than showing a zero percent', () => {
    render(<ScorePercent level={null} score={null} />);

    expect(screen.getByText('Үнэлгээгүй')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('RiskSummaryCell', () => {
  it('shows a count for every non-zero band plus the unassessed objects', () => {
    render(
      <RiskSummaryCell
        summary={{
          counts: [
            { level: 'NORMAL', count: 4 },
            { level: 'ATTENTION', count: 2 },
          ],
          unassessedCount: 5,
          hasCritical: false,
          lastAssessedAt: '2026-07-01T00:00:00.000Z',
        }}
      />,
    );

    expect(screen.getByLabelText('Хэвийн 4')).toBeInTheDocument();
    expect(screen.getByLabelText('Анхаарах шаардлагатай 2')).toBeInTheDocument();
    expect(screen.getByLabelText('Үнэлгээгүй 5')).toBeInTheDocument();
  });

  /** Section 19.2 leaves the aggregation method unapproved, so no rolled-up number exists. */
  it('never renders a single aggregate score', () => {
    render(
      <RiskSummaryCell
        summary={{
          counts: [
            { level: 'NORMAL', count: 4 },
            { level: 'CRITICAL', count: 1 },
          ],
          unassessedCount: 0,
          hasCritical: true,
          lastAssessedAt: null,
        }}
      />,
    );

    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    // Section 10.2 requires the warning marker once a red or black object is present.
    expect(screen.getByText('Анхаар')).toBeInTheDocument();
  });

  it('renders a dash when nothing has been registered yet', () => {
    render(
      <RiskSummaryCell
        summary={{ counts: [], unassessedCount: 0, hasCritical: false, lastAssessedAt: null }}
      />,
    );

    expect(screen.getByText('-')).toBeInTheDocument();
  });
});

describe('ScoreBar', () => {
  /** Item 3: the level is told apart by colour, carried on the figure itself. */
  it('shows the score as a percent in its band colour', () => {
    render(<ScoreBar level="ATTENTION" score={68} />);

    const badge = screen.getByLabelText('Анхаарах шаардлагатай 68%');
    expect(badge).toHaveTextContent('68%');
    expect(badge.className).toContain('bg-amber-400');
  });

  /**
   * The band name is not printed in a table cell. Item 1 requires one datum per cell, and
   * the legend is what states what each colour means.
   */
  it('does not print the band name by default', () => {
    render(<ScoreBar level="NORMAL" score={92} />);

    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.queryByText('Хэвийн')).not.toBeInTheDocument();
  });

  it('prints the band name where it is asked for', () => {
    render(<ScoreBar level="NORMAL" score={92} showPill />);

    expect(screen.getByText('92%')).toBeInTheDocument();
    expect(screen.getByText('Хэвийн')).toBeInTheDocument();
  });

  /** Every band must be distinguishable, not merely coloured. */
  it('gives each band its own fill', () => {
    const fills = (['NORMAL', 'ATTENTION', 'SCHEDULE_REPAIR', 'CRITICAL', 'OUT_OF_SERVICE'] as const).map(
      (level) => {
        const { unmount } = render(<ScoreBar level={level} score={50} />);
        const className = screen.getByText('50%').className;
        unmount();
        return className.split(' ').find((token) => token.startsWith('bg-'));
      },
    );

    expect(new Set(fills).size).toBe(5);
  });

  it('says unassessed rather than showing a zero percent', () => {
    render(<ScoreBar level={null} score={null} />);

    expect(screen.getByText('Үнэлгээгүй')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });
});

describe('RiskLegend', () => {
  /** The boundaries come from settings, so the legend cannot drift from the thresholds. */
  it('prints the band range it was given rather than a hardcoded one', () => {
    render(
      <RiskLegend
        bands={[
          { level: 'NORMAL', min: 90, max: 100 },
          { level: 'CRITICAL', min: 0, max: 89 },
        ]}
      />,
    );

    expect(screen.getByText('90-100% Хэвийн')).toBeInTheDocument();
    expect(screen.getByText('0-89% Ноцтой эрсдэлтэй')).toBeInTheDocument();
  });
});
