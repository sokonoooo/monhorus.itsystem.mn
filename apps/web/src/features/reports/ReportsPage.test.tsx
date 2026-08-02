import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
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
