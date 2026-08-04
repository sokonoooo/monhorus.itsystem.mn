import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { makePage, makePlannedWorkListItem } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkListPage } from './PlannedWorkListPage';

describe('PlannedWorkListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(plannedWorkService, 'list').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders the work number, objects and quantity based progress', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([makePlannedWorkListItem()]),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    expect(await screen.findByText('Хагас жилийн урьдчилан сэргийлэх үзлэг')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('PW-202607-0001')).toBeInTheDocument();
    expect(within(table).getByText('Төв барилга')).toBeInTheDocument();
    // The percentage is the backend figure, not recomputed from the quantities.
    expect(within(table).getByText('45%')).toBeInTheDocument();
    expect(within(table).getByText('90 / 200')).toBeInTheDocument();
  });

  it('renders the backend supplied effective status, including OVERDUE', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([
        makePlannedWorkListItem({
          lifecycleStatus: 'STARTED',
          effectiveStatus: 'OVERDUE',
          overdueAt: '2026-08-01T00:00:00.000Z',
        }),
      ]),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Хугацаа хэтэрсэн')).toBeInTheDocument();
    // The lifecycle label must not also be shown; effective status is the single truth.
    expect(within(table).queryByText('Хэрэгжиж байна')).not.toBeInTheDocument();
  });

  it('marks a late completion in the list', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([
        makePlannedWorkListItem({
          lifecycleStatus: 'COMPLETED',
          effectiveStatus: 'COMPLETED',
          completedLate: true,
          delayMinutes: 2880,
        }),
      ]),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Дууссан')).toBeInTheDocument();
    expect(within(table).getByText(/Хоцорсон/)).toBeInTheDocument();
  });

  it('shows an empty state', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    expect(await screen.findByText('Төлөвлөгөөт ажил олдсонгүй')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(plannedWorkService, 'list').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('hides the create action from a read-only caller', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([makePlannedWorkListItem()]),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Шинэ ажил' })).not.toBeInTheDocument();
  });

  it('offers the create action to a caller holding planned_work.create', async () => {
    vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([makePlannedWorkListItem()]),
    );

    renderWithAuth(<PlannedWorkListPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_CREATE],
    });

    expect(await screen.findByRole('button', { name: 'Шинэ ажил' })).toBeInTheDocument();
  });

  it('sends OVERDUE to the backend as a status filter rather than filtering locally', async () => {
    const list = vi
      .spyOn(plannedWorkService, 'list')
      .mockResolvedValue(makePage([makePlannedWorkListItem()]));
    const user = userEvent.setup();

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Төлөв'), 'OVERDUE');

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'OVERDUE' }));
  });

  /**
   * A planned work is archived the moment its report is approved, so "finished work" and
   * "archived work" are the same rows in practice. The board asked for neither, and a
   * signed-off job disappeared from the menu.
   */
  it('keeps archived work on the board by default', async () => {
    const list = vi.spyOn(plannedWorkService, 'list').mockResolvedValue(
      makePage([
        makePlannedWorkListItem({
          lifecycleStatus: 'ARCHIVED',
          effectiveStatus: 'ARCHIVED',
          reportStatus: 'APPROVED',
        }),
      ]),
    );

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Архивласан')).toBeInTheDocument();
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }));
  });

  it('drops archived work only when the toggle is cleared', async () => {
    const list = vi
      .spyOn(plannedWorkService, 'list')
      .mockResolvedValue(makePage([makePlannedWorkListItem()]));
    const user = userEvent.setup();

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    await screen.findByRole('table');
    const toggle = screen.getByLabelText('Архивласныг харуулах');
    expect(toggle).toBeChecked();

    await user.click(toggle);
    expect(list).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ includeArchived: expect.anything() }),
    );

    // And it comes back, so the default view is never a dead end.
    await user.click(screen.getByLabelText('Архивласныг харуулах'));
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ includeArchived: true }));
  });

  it('still narrows to a single lifecycle status, archived included', async () => {
    const list = vi
      .spyOn(plannedWorkService, 'list')
      .mockResolvedValue(makePage([makePlannedWorkListItem()]));
    const user = userEvent.setup();

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Төлөв'), 'ARCHIVED');
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'ARCHIVED' }));

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'COMPLETED');
    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'COMPLETED' }));
  });

  it('sends the report status filter to the backend', async () => {
    const list = vi
      .spyOn(plannedWorkService, 'list')
      .mockResolvedValue(makePage([makePlannedWorkListItem()]));
    const user = userEvent.setup();

    renderWithAuth(<PlannedWorkListPage />, { permissions: [PERMISSIONS.PLANNED_WORK_VIEW] });

    await screen.findByRole('table');
    await user.selectOptions(screen.getByLabelText('Тайлангийн төлөв'), 'SUBMITTED');

    expect(list).toHaveBeenLastCalledWith(
      expect.objectContaining({ reportStatus: 'SUBMITTED' }),
    );
  });
});
