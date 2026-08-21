import {
  DEFAULT_DASHBOARD_LAYOUT,
  PERMISSIONS,
  type DashboardSummaryDto,
} from '@monhorus/shared';
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
      isScoped: false,
      generatedAt: '2026-07-29T06:00:00.000Z',
    });

    render();

    expect(
      await screen.findByRole('heading', { name: 'Байгууллагын хяналтын самбар' }),
    ).toBeInTheDocument();
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

  /**
   * A scoped board has nothing to customise.
   *
   * The dialog lists the whole catalogue, and the blocks a scoped payload omits — risk,
   * workload, finance, headcount — would be switches that turn on a widget rendering as
   * nothing. Asserted through `isScoped` rather than a role name, because the API decides
   * this from the caller's assignments and the screen must not form a second opinion.
   */
  it('hides the customise action from a caller whose board is their own work', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(
      makeDashboardSummary({ isScoped: true }),
    );

    render();

    // Something rendered, so this is the button being absent rather than the page failing.
    expect(
      await screen.findByRole('heading', { name: 'Үйлчилгээний хүсэлтийн үзүүлэлт' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Тохируулах' })).not.toBeInTheDocument();
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

    await screen.findByRole('heading', { name: 'Байгууллагын хяналтын самбар' });
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
 * WHOSE FIGURES ARE THESE.
 *
 * The board used to say "Хяналтын самбар" over both payloads, which was accurate for an
 * administrator and a quiet untruth for a technician: identical wording over one person's
 * work and over the whole company's. The backend now bounds a technician's summary and
 * declares which of the two it sent; these cases assert the page repeats that answer to
 * the reader instead of keeping it to itself.
 *
 * A scoped payload is built by hand rather than from `makeDashboardSummary`, because the
 * fixture carries blocks a scoped caller is never sent — the API omits `customers`,
 * `employees`, `workload`, `risk` and `finance` rather than scoping them — and a fixture
 * that carried them would be testing a response the server cannot produce.
 */
describe('DashboardPage scope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dashboardService, 'layout').mockResolvedValue({
      widgets: DEFAULT_DASHBOARD_LAYOUT,
      customWidgets: [],
      isCustomised: false,
    });
  });

  /** As the API sends it to a bounded caller: the personal blocks and nothing else. */
  function scopedSummary(): DashboardSummaryDto {
    const full = makeDashboardSummary();
    return {
      isScoped: true,
      generatedAt: full.generatedAt,
      requests: full.requests,
      requestsByStatus: full.requestsByStatus,
      trend: full.trend,
      plannedWork: full.plannedWork,
      today: full.today,
    };
  }

  it('heads a technician board as their own work', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(scopedSummary());

    render();

    expect(
      await screen.findByRole('heading', { name: 'Миний хяналтын самбар' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Зөвхөн танд болон таны багт хуваарилагдсан ажил/)).toBeInTheDocument();
  });

  it("heads an administrator board as the organisation's", async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(
      await screen.findByRole('heading', { name: 'Байгууллагын хяналтын самбар' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Миний хяналтын самбар' }),
    ).not.toBeInTheDocument();
  });

  /**
   * The heading alone is not enough: a tile still labelled as everybody's, sitting under a
   * personal heading, is the same untruth moved down the page.
   */
  it('marks the scoped blocks as the reader\u2019s own, not the whole estate\u2019s', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(scopedSummary());

    render();

    expect(await screen.findByRole('heading', { name: 'Миний өнөөдрийн ажил' })).toBeInTheDocument();
    expect(screen.getByText('Зөвхөн танд хуваарилагдсан хүсэлт.')).toBeInTheDocument();
    // "Бүх" claims every request in the company; it must not appear over a bounded donut.
    expect(screen.getByText('Танд хуваарилагдсан хүсэлтийн төлвийн хуваарилалт.')).toBeInTheDocument();
    expect(screen.queryByText('Бүх хүсэлтийн төлвийн хуваарилалт.')).not.toBeInTheDocument();
  });

  /**
   * The organisation-wide blocks are absent from a scoped payload, so they must simply not
   * draw. This is the UI half of an omission the API already made — the page is not what
   * withholds them, and this only proves it does not invent a frame for what it was not sent.
   */
  it('draws no organisation-wide block on a scoped board', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(scopedSummary());

    render();

    await screen.findByRole('heading', { name: 'Миний хяналтын самбар' });
    expect(screen.queryByRole('img', { name: /Төхөөрөмжийн эрсдэл/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Нэхэмжлэлийн төлөв/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /Ажилтны ачаалал/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Санхүүгийн үзүүлэлт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Нөөц ба бүртгэл' })).not.toBeInTheDocument();
  });

  /** The unbounded board keeps every one of them. */
  it('keeps the organisation-wide blocks on an unscoped board', async () => {
    vi.spyOn(dashboardService, 'summary').mockResolvedValue(makeDashboardSummary());

    render();

    expect(await screen.findByRole('img', { name: /Төхөөрөмжийн эрсдэл/ })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Нэхэмжлэлийн төлөв/ })).toBeInTheDocument();
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
