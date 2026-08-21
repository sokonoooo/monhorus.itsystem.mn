import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportService } from '../../services/report.service';
import { makeKpiSummary, makeReportResult } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ReportsPage } from './ReportsPage';

describe('ReportsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(reportService, 'kpis').mockResolvedValue(makeKpiSummary());
  });

  it('renders the rows using the columns the report supplied', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult());

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Хүсэлтийн №' })).toBeInTheDocument();
    expect(within(table).getByText('SR-202607-0001')).toBeInTheDocument();
  });

  /**
   * The catalogue used to ask for a thousand rows and render every one, so a longer report
   * silently lost its tail. These pin the window, the numbering across it, and that a
   * filter change sends the reader back to the first page.
   */
  it('numbers the rows, continuing across pages', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(
      makeReportResult({ page: 3, limit: 25, total: 120, totalPages: 5 }),
    );

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    // Page 3 of 25 begins at 51. Restarting at 1 is the failure this exists to catch.
    const cells = within(table).getAllByRole('cell');
    expect(cells[0]?.textContent?.trim()).toBe('51');
  });

  it('states the report total rather than the rows on screen', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(
      makeReportResult({ page: 1, limit: 25, total: 120, totalPages: 5 }),
    );

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    // The fixture carries two rows; the report has 120.
    expect(await screen.findByText(/Нийт 120 мөр/)).toBeInTheDocument();
  });

  it('asks the server for one page rather than for everything', async () => {
    const run = vi
      .spyOn(reportService, 'run')
      .mockResolvedValue(makeReportResult({ total: 120, totalPages: 5 }));

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });
    await screen.findByRole('table');

    // A page-sized window, not the thousand-row fetch this page used to make.
    expect(run).toHaveBeenCalledWith(
      'SLA',
      expect.objectContaining({ page: 1, limit: 25 }),
    );
  });

  it('offers a pager and asks for the next page when it is used', async () => {
    const user = userEvent.setup();
    const run = vi
      .spyOn(reportService, 'run')
      .mockResolvedValue(makeReportResult({ page: 1, limit: 25, total: 120, totalPages: 5 }));

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith('SLA', expect.objectContaining({ page: 2 })),
    );
  });

  it('sends the reader back to page one when the report changes', async () => {
    const user = userEvent.setup();
    const run = vi
      .spyOn(reportService, 'run')
      .mockResolvedValue(makeReportResult({ page: 1, limit: 25, total: 120, totalPages: 5 }));

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));
    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith('SLA', expect.objectContaining({ page: 2 })),
    );

    // Now change the filter. Page 2 of the old report is rarely page 2 of the new one and
    // is often past its end, which would answer with an empty table.
    await user.selectOptions(screen.getByLabelText('Тайлангийн төрөл'), 'INVOICE_RECEIVABLE');

    await waitFor(() =>
      expect(run).toHaveBeenLastCalledWith(
        'INVOICE_RECEIVABLE',
        expect.objectContaining({ page: 1 }),
      ),
    );
  });

  it('offers every report in the section 15.2 catalogue', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult());

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    const picker = await screen.findByLabelText('Тайлангийн төрөл');
    expect(within(picker).getAllByRole('option')).toHaveLength(9);
  });

  /** A KPI over an empty set is undefined, so it must not read as a zero. */
  it('renders a null KPI as a dash rather than as zero', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult());

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    expect(await screen.findByText('Хугацаандаа дууссан хувь')).toBeInTheDocument();
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('0%')).not.toBeInTheDocument();
  });

  /** Section 14.2 gates taking a file out of the system separately from reading. */
  it('hides the export action without report.export', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult());

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    await screen.findByRole('heading', { name: 'Тайлан' });
    expect(screen.queryByRole('button', { name: 'Excel (CSV) татах' })).not.toBeInTheDocument();
  });

  it('exports through the service when the caller may export', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult());
    const download = vi.spyOn(reportService, 'downloadCsv').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithAuth(<ReportsPage />, {
      permissions: [PERMISSIONS.REPORT_VIEW, PERMISSIONS.REPORT_EXPORT],
    });

    await user.click(await screen.findByRole('button', { name: 'Excel (CSV) татах' }));
    expect(download).toHaveBeenCalledWith('SLA', expect.objectContaining({ limit: 1000 }));
  });

  /** A capped row set must be stated, so an export is never mistaken for a complete one. */
  it('warns when the row set was truncated', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult({ truncatedAt: 1000 }));

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    expect(await screen.findByText(/1000-аар хязгаарлагдсан/)).toBeInTheDocument();
  });

  it('shows an empty state when the range has no rows', async () => {
    vi.spyOn(reportService, 'run').mockResolvedValue(makeReportResult({ rows: [] }));

    renderWithAuth(<ReportsPage />, { permissions: [PERMISSIONS.REPORT_VIEW] });

    expect(await screen.findByText('Мэдээлэл алга')).toBeInTheDocument();
  });
});
