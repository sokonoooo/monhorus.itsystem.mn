import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarChart, CHART_COLOURS, DonutChart, LineChart, ProgressChart } from './Charts';

const RISK = [
  { key: 'NORMAL', label: 'Хэвийн', value: 6, colour: CHART_COLOURS.green },
  { key: 'CRITICAL', label: 'Ноцтой эрсдэлтэй', value: 2, colour: CHART_COLOURS.red },
];

describe('DonutChart', () => {
  /** The shape conveys nothing to a screen reader, so the figures travel in the label. */
  it('summarises every slice in its accessible name', () => {
    render(<DonutChart title="Эрсдэл" data={RISK} />);

    const chart = screen.getByRole('img', { name: /Эрсдэл/ });
    expect(chart).toHaveAccessibleName(expect.stringContaining('Хэвийн 6 (75%)'));
    expect(chart).toHaveAccessibleName(expect.stringContaining('Ноцтой эрсдэлтэй 2 (25%)'));
  });

  it('prints the total in the centre and each slice in the legend', () => {
    render(<DonutChart title="Эрсдэл" data={RISK} centreLabel="объект" />);

    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('объект')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows an empty state rather than an empty circle', () => {
    render(<DonutChart title="Эрсдэл" data={[]} emptyMessage="Үнэлгээ алга" />);

    expect(screen.getByText('Үнэлгээ алга')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  /** A single slice cannot be drawn as an arc, because its ends coincide. */
  it('renders a full ring when one slice covers everything', () => {
    render(
      <DonutChart
        title="Эрсдэл"
        data={[{ key: 'NORMAL', label: 'Хэвийн', value: 5, colour: CHART_COLOURS.green }]}
      />,
    );

    expect(screen.getByRole('img', { name: /Хэвийн 5 \(100%\)/ })).toBeInTheDocument();
  });
});

describe('BarChart', () => {
  it('lists every bar with its value', () => {
    render(
      <BarChart
        title="Төрлөөр"
        data={[
          { key: 'REPAIR', label: 'Засвар', value: 4, colour: CHART_COLOURS.blue },
          { key: 'URGENT_CALL', label: 'Яаралтай', value: 1, colour: CHART_COLOURS.red },
        ]}
      />,
    );

    expect(screen.getByText('Засвар')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Засвар 4, Яаралтай 1/ })).toBeInTheDocument();
  });

  it('shows an empty state when every bar is zero', () => {
    render(
      <BarChart
        title="Төрлөөр"
        data={[{ key: 'A', label: 'A', value: 0, colour: CHART_COLOURS.blue }]}
        emptyMessage="Хоосон"
      />,
    );

    expect(screen.getByText('Хоосон')).toBeInTheDocument();
  });
});

describe('LineChart', () => {
  it('plots each series and names them in the legend', () => {
    render(
      <LineChart
        title="Урсгал"
        labels={['2026-07-01', '2026-07-02', '2026-07-03']}
        series={[
          { key: 'created', label: 'Шинэ', colour: CHART_COLOURS.blue, values: [1, 3, 2] },
          { key: 'completed', label: 'Дууссан', colour: CHART_COLOURS.green, values: [0, 1, 4] },
        ]}
      />,
    );

    expect(screen.getByText('Шинэ')).toBeInTheDocument();
    expect(screen.getByText('Дууссан')).toBeInTheDocument();
    // Totals travel in the accessible name so the trend is readable without the shape.
    expect(screen.getByRole('img', { name: /Шинэ: 6, Дууссан: 5/ })).toBeInTheDocument();
  });

  it('shows an empty state when every point is zero', () => {
    render(
      <LineChart
        title="Урсгал"
        labels={['2026-07-01', '2026-07-02']}
        series={[{ key: 'created', label: 'Шинэ', colour: CHART_COLOURS.blue, values: [0, 0] }]}
        emptyMessage="Хөдөлгөөн алга"
      />,
    );

    expect(screen.getByText('Хөдөлгөөн алга')).toBeInTheDocument();
  });
});

describe('ProgressChart', () => {
  it('renders the percentage', () => {
    render(<ProgressChart title="Гүйцэтгэл" percent={64} caption="3 дууссан" />);

    expect(screen.getByText('64%')).toBeInTheDocument();
    expect(screen.getByText('3 дууссан')).toBeInTheDocument();
  });

  it('clamps a value outside 0 to 100', () => {
    render(<ProgressChart title="Гүйцэтгэл" percent={140} />);
    expect(screen.getByRole('img', { name: 'Гүйцэтгэл: 100%' })).toBeInTheDocument();
  });
});
