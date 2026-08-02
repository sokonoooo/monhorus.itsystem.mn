import { DEFAULT_DASHBOARD_LAYOUT, PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dashboardService } from '../../services/org.service';
import { makeDashboardSummary, makeTodaySummary } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { DashboardPage } from './DashboardPage';

function render() {
  return renderWithAuth(<DashboardPage />, { permissions: [PERMISSIONS.DASHBOARD_VIEW] });
}

describe('DashboardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The page asks for the caller's arrangement alongside the summary; without it the
    // combined load rejects and every assertion below fails for the wrong reason.
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      widgets: DEFAULT_DASHBOARD_LAYOUT,
      customWidgets: [],
      isCustomised: false,
    });
  });

  /**
   * The audit-log tail used to sit at the bottom of this page. It listed what had already
   * been recorded, which is a different question from what still has to be done.
   */
  it("leads with today's outstanding work, not a log of past activity", async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByRole('heading', { name: 'Өнөөдрийн ажил' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Сүүлийн үйл ажиллагаа' }),
    ).not.toBeInTheDocument();
  });

  it('lists each outstanding item with its reference and owner', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    // Scoped to the list: several of these words also label the counters above it.
    const list = await screen.findByRole('list', { name: 'Өнөөдрийн ажлын жагсаалт' });
    expect(within(list).getByText('SR-202607-0001')).toBeInTheDocument();
    expect(within(list).getByText('PW-202607-0001')).toBeInTheDocument();
    expect(within(list).getByText('Дорж Бат')).toBeInTheDocument();
    expect(within(list).getByText('Хуваарилагдаагүй')).toBeInTheDocument();
  });

  it('marks an overdue item so it stands out from the rest', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    const list = await screen.findByRole('list', { name: 'Өнөөдрийн ажлын жагсаалт' });
    expect(within(list).getByText('Хугацаа хэтэрсэн')).toBeInTheDocument();
  });

  it('links each item to its own record', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    const link = await screen.findByRole('link', { name: /SR-202607-0001/ });
    expect(link).toHaveAttribute('href', '/service-requests/507f1f77bcf86cd799439301');
  });

  it('says so plainly when there is nothing to do today', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(
      makeDashboardSummary({
        today: makeTodaySummary({ items: [], dueCount: 0, overdueCount: 0, urgentCount: 0 }),
      }),
    );

    render();

    expect(await screen.findByText('Өнөөдөр хийх ажил алга')).toBeInTheDocument();
  });

  /** Requirements 15.1 asks for the risk distribution; it is drawn, not tabulated. */
  it('draws the risk distribution as a chart', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    const chart = await screen.findByRole('img', { name: /Төхөөрөмжийн эрсдэл/ });
    expect(chart).toHaveAccessibleName(expect.stringContaining('Хэвийн 6'));
    expect(chart).toHaveAccessibleName(expect.stringContaining('Ноцтой эрсдэлтэй 2'));
  });

  it('draws the fourteen day request trend', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByRole('img', { name: /Хүсэлтийн урсгал/ })).toBeInTheDocument();
  });

  it('draws the invoice status breakdown and the month revenue', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByRole('img', { name: /Нэхэмжлэлийн төлөв/ })).toBeInTheDocument();
    expect(screen.getByText('2,350,000 MNT')).toBeInTheDocument();
  });

  /** Section 19.2 leaves the aggregation method unapproved. */
  it('states that no aggregate risk score is produced', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByText(/Нэгдсэн оноо гаргахгүй/)).toBeInTheDocument();
  });

  /** Blocks are omitted, not zeroed, so an absent section must simply not render. */
  it('renders only the blocks the payload carries', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue({
      generatedAt: '2026-07-29T06:00:00.000Z',
    });

    render();

    expect(await screen.findByRole('heading', { name: 'Хяналтын самбар' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Өнөөдрийн ажил' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Төхөөрөмжийн эрсдэл/ })).not.toBeInTheDocument();
  });

  /** The layout decides order and visibility; a hidden widget must not render at all. */
  it('renders only the widgets the saved layout marks visible', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      widgets: DEFAULT_DASHBOARD_LAYOUT.map((entry) =>
        entry.key === 'RISK' ? { ...entry, visible: false } : entry,
      ),
      customWidgets: [],
      isCustomised: true,
    });

    render();

    expect(await screen.findByRole('heading', { name: 'Өнөөдрийн ажил' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Төхөөрөмжийн эрсдэл/ })).not.toBeInTheDocument();
  });

  it('says so plainly when every widget is hidden', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      widgets: DEFAULT_DASHBOARD_LAYOUT.map((entry) => ({ ...entry, visible: false })),
      customWidgets: [],
      isCustomised: true,
    });

    render();

    expect(await screen.findByText('Харагдах хэсэг сонгогдоогүй байна.')).toBeInTheDocument();
  });

  /**
   * The shipped arrangement is charts first. A bare count says nothing without something
   * to compare it against, so the counters follow the figures rather than opening the page.
   */
  it('leads with the trend chart and leaves the plain counts until the end', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    const trend = await screen.findByRole('img', { name: /Хүсэлтийн урсгал/ });
    const counts = screen.getByRole('heading', { name: 'Үйлчилгээний хүсэлтийн үзүүлэлт' });

    expect(trend.compareDocumentPosition(counts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('offers the customise action', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByRole('button', { name: 'Тохируулах' })).toBeInTheDocument();
  });

  /** Halves alone cannot express the shipped layout; the drawer must offer every width. */
  it('offers all four widths when customising a widget', async () => {
    const user = userEvent.setup();
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    await user.click(await screen.findByRole('button', { name: 'Тохируулах' }));

    const size = await screen.findByLabelText('Өргөн', { selector: '#size-TREND' });
    expect(within(size).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Гуравны нэг',
      'Хагас өргөн',
      'Гуравны хоёр',
      'Бүтэн өргөн',
    ]);
  });

  /** The schematic editor was removed from this page; it belongs nowhere near it. */
  it('no longer renders the asset schematic', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    await screen.findByRole('heading', { name: 'Хяналтын самбар' });
    expect(screen.queryByText('Цахилгааны схем')).not.toBeInTheDocument();
  });

  it('counts today completions separately from outstanding work', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    // The completed count is a counter, never a row: finished work needs no action.
    const counters = await screen.findByRole('group', { name: 'Өнөөдрийн үзүүлэлт' });
    expect(within(counters).getByText('Дууссан')).toBeInTheDocument();
    expect(within(counters).getByText('3')).toBeInTheDocument();

    const list = screen.getByRole('list', { name: 'Өнөөдрийн ажлын жагсаалт' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
  });
});

/**
 * User-built widgets.
 *
 * A definition is the caller's own saved question, so the board has to title it from the
 * definition rather than from the widget catalogue, which has no entry for it.
 */
describe('DashboardPage custom widgets', () => {
  const widget = {
    id: 'cw1',
    title: 'Барилгаар ирсэн хүсэлт',
    metric: 'COUNT' as const,
    dimension: 'BUILDING' as const,
    range: 'LAST_2_MONTHS' as const,
    chart: 'BAR' as const,
    createdAt: '2026-07-01T00:00:00.000Z',
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      widgets: [
        { key: 'CUSTOM', customWidgetId: 'cw1', visible: true, size: 'THIRD' },
        ...DEFAULT_DASHBOARD_LAYOUT,
      ],
      customWidgets: [widget],
      isCustomised: true,
    });
  });

  it('draws a saved question with its own title and figures', async () => {
    vi.spyOn(dashboardService, 'insight').mockResolvedValue({
      widget,
      from: '2026-06-01',
      to: '2026-07-30',
      timezone: 'Asia/Ulaanbaatar',
      total: 9,
      slices: [
        { key: 'b1', label: 'Төв оффис', count: 6 },
        { key: 'b2', label: 'Салбар 2', count: 3 },
      ],
    });

    render();

    // Titled from the definition, and the buckets are the aggregation's own labels.
    const chart = await screen.findByRole('img', { name: /Барилгаар ирсэн хүсэлт/ });
    expect(chart).toHaveAccessibleName(expect.stringContaining('Төв оффис 6'));
    expect(chart).toHaveAccessibleName(expect.stringContaining('Салбар 2 3'));
  });

  it('reports a failed widget in place rather than dropping it', async () => {
    vi.spyOn(dashboardService, 'insight').mockRejectedValue(new Error('boom'));

    render();

    // The card stays on the board: a widget that vanished would read as a lost definition.
    expect(await screen.findByText('Барилгаар ирсэн хүсэлт')).toBeInTheDocument();
    expect(screen.getByText('Тооцоолж чадсангүй.')).toBeInTheDocument();
  });

  it('leaves a row whose definition is gone unrendered', async () => {
    const insight = vi.spyOn(dashboardService, 'insight');
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      // Reconciliation drops such a row server-side; this is the window before the reload.
      widgets: [{ key: 'CUSTOM', customWidgetId: 'missing', visible: true, size: 'THIRD' }],
      customWidgets: [],
      isCustomised: true,
    });

    render();

    await screen.findByText('Харагдах хэсэг сонгогдоогүй байна.');
    expect(insight).not.toHaveBeenCalled();
  });
});
