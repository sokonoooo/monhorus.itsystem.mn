import {
  PERMISSIONS,
  type PermissionKey,
  type PlannedWorkReportDto,
  type PlannedWorkReportPreviewDto,
} from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { makePlannedWork, makePlannedWorkReport } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkReportPage } from './PlannedWorkReportPage';

/**
 * THE CONSOLIDATED REPORT SCREEN.
 *
 * One thing is pinned here and it is the write-up. «Хянуулахаар илгээх» read nothing from
 * the form: it posted the submit, then reloaded — re-seeding the two fields from the
 * stored copy — and SUBMITTED takes the fields out of `REPORT_SUBMITTABLE_STATUSES`, so
 * they lock. A performer who typed the Дүгнэлт and pressed the button they were told to
 * press lost it, and the only route back was to ask a reviewer to return the report.
 */

const WORK_ID = '507f1f77bcf86cd799439061';

function makePreview(
  overrides: Partial<PlannedWorkReportPreviewDto> = {},
): PlannedWorkReportPreviewDto {
  return {
    plannedWorkId: WORK_ID,
    workNumber: 'PW-2026-0001',
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    customerName: 'Монгол Барилга ХХК',
    projectName: 'Төв оффисын цахилгаан хангамж',
    buildingName: 'А блок',
    status: 'DRAFT',
    plannedStartDate: '2026-07-01T00:00:00.000Z',
    plannedEndDate: '2026-07-31T00:00:00.000Z',
    originalPlannedEndDate: '2026-07-31T00:00:00.000Z',
    actualStartDate: '2026-07-02T00:00:00.000Z',
    actualEndDate: '2026-07-30T00:00:00.000Z',
    completedLate: false,
    delayMinutes: null,
    totalPausedMinutes: 0,
    totalQuantity: 10,
    completedQuantity: 10,
    remainingQuantity: 0,
    progressPercent: 100,
    floorProgress: [],
    tasks: [],
    materials: [],
    conclusion: null,
    recommendation: null,
    generatedAt: '2026-07-31T00:00:00.000Z',
    ...overrides,
  };
}

function mountReport(
  report: PlannedWorkReportDto,
  permissions: readonly PermissionKey[] = [
    PERMISSIONS.PLANNED_WORK_VIEW,
    PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
  ],
) {
  vi.spyOn(plannedWorkService, 'report').mockResolvedValue({
    report,
    preview: makePreview({ status: report.status }),
  });
  return renderWithAuth(<PlannedWorkReportPage />, {
    permissions,
    route: `/planned-work/${WORK_ID}/report`,
    path: '/planned-work/:plannedWorkId/report',
  });
}

/** Submittable, with nothing standing in the way of the button. */
function submittableReport(overrides: Partial<PlannedWorkReportDto> = {}) {
  return makePlannedWorkReport({ status: 'DRAFT', submissionBlockers: [], ...overrides });
}

describe('PlannedWorkReportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('saves an unsaved write-up before it submits the report', async () => {
    mountReport(submittableReport());
    const order: string[] = [];
    const update = vi
      .spyOn(plannedWorkService, 'updateReport')
      .mockImplementation(async () => {
        order.push('update');
        return makePlannedWork();
      });
    const submit = vi.spyOn(plannedWorkService, 'submitReport').mockImplementation(async () => {
      order.push('submit');
      return makePlannedWork();
    });
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Дүгнэлт'), 'Ажил бүрэн хийгдсэн');
    await user.click(screen.getByRole('button', { name: 'Хянуулахаар илгээх' }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });
    // Saved, and saved FIRST: a submit that landed before the PATCH would lock the report
    // against it.
    expect(order).toEqual(['update', 'submit']);
    expect(update.mock.calls[0]![1]).toMatchObject({ conclusion: 'Ажил бүрэн хийгдсэн' });
  });

  it('does not submit when the pre-submit save is refused', async () => {
    mountReport(submittableReport());
    vi.spyOn(plannedWorkService, 'updateReport').mockRejectedValue(
      new ApiError('Тайлан хадгалагдсангүй.', 'VALIDATION_ERROR', 400),
    );
    const submit = vi.spyOn(plannedWorkService, 'submitReport');
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText('Зөвлөмж'), 'Дараагийн улиралд дахин үзнэ');
    await user.click(screen.getByRole('button', { name: 'Хянуулахаар илгээх' }));

    expect(await screen.findByText(/Тайлан хадгалагдсангүй/)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });

  it('submits without a PATCH when nothing was typed', async () => {
    mountReport(submittableReport());
    const update = vi.spyOn(plannedWorkService, 'updateReport');
    const submit = vi
      .spyOn(plannedWorkService, 'submitReport')
      .mockResolvedValue(makePlannedWork());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Хянуулахаар илгээх' }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalled();
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('says the write-up is unsaved while it is', async () => {
    mountReport(submittableReport());
    const user = userEvent.setup();

    expect(screen.queryByText(/Хадгалагдаагүй өөрчлөлт/)).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText('Дүгнэлт'), 'Т');
    expect(await screen.findByText(/Хадгалагдаагүй өөрчлөлт/)).toBeInTheDocument();
  });

  it('locks the write-up once the report is submitted', async () => {
    mountReport(submittableReport({ status: 'SUBMITTED' }));

    expect(await screen.findByLabelText('Дүгнэлт')).toBeDisabled();
    expect(
      screen.queryByRole('button', { name: 'Хянуулахаар илгээх' }),
    ).not.toBeInTheDocument();
  });
});
