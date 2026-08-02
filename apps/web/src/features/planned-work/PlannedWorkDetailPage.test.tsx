import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import * as fileUrl from '../../lib/file-url';
import { plannedWorkService } from '../../services/planned-work.service';
import { objectService } from '../../services/object.service';
import { dispatchService } from '../../services/service-request.service';
import {
  makePlannedWork,
  makePlannedWorkReport,
  makePlannedWorkTask,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkDetailPage } from './PlannedWorkDetailPage';

const WORK_ID = '507f1f77bcf86cd799439061';

function renderDetail(permissions: readonly string[]) {
  return renderWithAuth(<PlannedWorkDetailPage />, {
    permissions: permissions as never,
    route: `/planned-work/${WORK_ID}`,
    path: '/planned-work/:plannedWorkId',
  });
}

/**
 * Opens the action menu of the first sub-task row. Every row action lives behind the
 * three-dot button, so a test that acts on one has to open the menu first.
 */
async function openTaskMenu(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const taskTable = (await screen.findAllByRole('table'))[0]!;
  const row = within(taskTable).getAllByRole('row')[1]!;
  await user.click(within(row).getByRole('button', { name: 'Үйлдэл' }));
}

describe('PlannedWorkDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'children').mockResolvedValue([]);
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);
  });

  it('shows the backend supplied progress and completion blockers', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(
      await screen.findByRole('heading', { name: 'Хагас жилийн урьдчилан сэргийлэх үзлэг' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Дуусгахад дараах нь шаардлагатай')).toBeInTheDocument();
    expect(screen.getByText('"Самбарын үзлэг" биелэлт 40% байна.')).toBeInTheDocument();
  });

  it('warns that a paused work still runs against its original deadline', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        lifecycleStatus: 'PAUSED',
        effectiveStatus: 'PAUSED',
        currentPauseStartedAt: '2026-07-10T00:00:00.000Z',
        totalPausedMinutes: 2880,
        pauseHistory: [
          {
            pausedAt: '2026-07-10T00:00:00.000Z',
            pausedById: 'u1',
            pausedByName: 'Тест Хэрэглэгч',
            reason: 'Материал хүлээгдэж байна',
            resumedAt: null,
            resumedById: null,
            resumedByName: null,
            durationMinutes: null,
          },
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    // The label appears twice by design: once as the status badge, once as the banner
    // heading that explains the schedule rule.
    expect(await screen.findAllByText('Түр зогссон')).toHaveLength(2);
    expect(
      screen.getByText(/Түр зогсолт төлөвлөсөн хугацааг сунгадаггүй/),
    ).toBeInTheDocument();
    expect(screen.getByText('Материал хүлээгдэж байна')).toBeInTheDocument();
  });

  it('shows the overdue banner with the instant the breach was recorded', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        effectiveStatus: 'OVERDUE',
        overdueAt: '2026-08-01T03:00:00.000Z',
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    // Status badge plus the banner that names the recorded breach instant.
    expect(await screen.findAllByText('Хугацаа хэтэрсэн')).toHaveLength(2);
    expect(screen.getByText(/зөвхөн зөвшөөрөгдсөн/)).toBeInTheDocument();
  });

  it('renders only the lifecycle actions the backend offered', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        availableActions: [
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true, targetStatus: 'PAUSED' },
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);

    expect(await screen.findByRole('button', { name: 'Түр зогсоох' })).toBeInTheDocument();
    // COMPLETE was not offered, so no button exists even though the permission is held.
    expect(screen.queryByRole('button', { name: 'Дуусгах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Цуцлах' })).not.toBeInTheDocument();
  });

  it('demands a reason before a reason-carrying transition is sent', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        availableActions: [
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true, targetStatus: 'PAUSED' },
        ],
      }),
    );
    const transition = vi.spyOn(plannedWorkService, 'transition');
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);

    await user.click(await screen.findByRole('button', { name: 'Түр зогсоох' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Шалтгаан')).toBeInTheDocument();
    expect(transition).not.toHaveBeenCalled();
  });

  it('sends a transition with its reason', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        availableActions: [
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true, targetStatus: 'PAUSED' },
        ],
      }),
    );
    const transition = vi
      .spyOn(plannedWorkService, 'transition')
      .mockResolvedValue(makePlannedWork({ lifecycleStatus: 'PAUSED', effectiveStatus: 'PAUSED' }));
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_CHANGE_STATUS]);

    await user.click(await screen.findByRole('button', { name: 'Түр зогсоох' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Шалтгаан'), 'Материал хүлээгдэж байна');
    await user.click(within(dialog).getByRole('button', { name: 'Батлах' }));

    await waitFor(() => {
      expect(transition).toHaveBeenCalledWith(WORK_ID, 'PAUSE', 'Материал хүлээгдэж байна');
    });
  });

  it('lists the evidence a task still needs before it can be DONE', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const tables = await screen.findAllByRole('table');
    const taskTable = tables[0]!;
    expect(
      within(taskTable).getByText(
        'Ажлын өмнөх зураг, Ажлын дараах зураг, Тайлбар, Зөвлөмж',
      ),
    ).toBeInTheDocument();
  });

  it('offers no progress or edit action to a read-only caller', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    await openTaskMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Биелэлт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Дэд ажил нэмэх' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Хугацаа сунгах' })).not.toBeInTheDocument();
  });

  it('offers the reschedule action only with planned_work.reschedule', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RESCHEDULE]);

    expect(await screen.findByRole('button', { name: 'Хугацаа сунгах' })).toBeInTheDocument();
  });

  it('hides every edit affordance on an archived work', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        lifecycleStatus: 'ARCHIVED',
        effectiveStatus: 'ARCHIVED',
        report: makePlannedWorkReport({ status: 'APPROVED', visibleToCustomer: true }),
        availableActions: [],
        completionBlockers: [],
      }),
    );
    const user = userEvent.setup();

    renderDetail([
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_UPDATE,
      PERMISSIONS.PLANNED_WORK_RESCHEDULE,
      PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS,
    ]);

    expect(await screen.findByText('Архивласан')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Хугацаа сунгах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Дэд ажил нэмэх' })).not.toBeInTheDocument();

    // The sub-task menu is equally closed: only the read-only detail action survives.
    await openTaskMenu(user);
    expect(screen.queryByRole('menuitem', { name: 'Засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Биелэлт' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Устгах' })).not.toBeInTheDocument();
  });

  it('lists a material as a name, a quantity and a unit', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        materials: [{ name: 'Кабель 3x2.5', quantity: 100, unit: 'METRE' }],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(await screen.findByText('Кабель 3x2.5')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('Метр')).toBeInTheDocument();
  });

  it('records progress without ever sending a task status', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
    const record = vi
      .spyOn(plannedWorkService, 'recordProgress')
      .mockResolvedValue(
        makePlannedWork({ tasks: [makePlannedWorkTask({ completedQuantity: 7 })] }),
      );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Биелэлт' }));
    const dialog = await screen.findByRole('dialog');

    const quantity = within(dialog).getByLabelText(/^Биелэсэн тоо хэмжээ/);
    await user.clear(quantity);
    await user.type(quantity, '7');
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(record).toHaveBeenCalled();
    });
    const payload = record.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.completedQuantity).toBe(7);
    expect(payload).not.toHaveProperty('status');
  });

  it('surfaces the backend refusal when progress exceeds the planned quantity', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
    vi.spyOn(plannedWorkService, 'recordProgress').mockRejectedValue(
      new ApiError(
        'Биелэлт төлөвлөсөн тооноос их байж болохгүй. Дээд хэмжээ: 10.',
        'VALIDATION_ERROR',
        400,
      ),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Биелэлт' }));
    const dialog = await screen.findByRole('dialog');
    const quantity = within(dialog).getByLabelText(/^Биелэсэн тоо хэмжээ/);
    await user.clear(quantity);
    await user.type(quantity, '99');
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    expect(
      await within(dialog).findByText(/Биелэлт төлөвлөсөн тооноос их байж болохгүй/),
    ).toBeInTheDocument();
  });

  it('records the sub-task note and score, and never sends a band', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
    const record = vi
      .spyOn(plannedWorkService, 'recordProgress')
      .mockResolvedValue(makePlannedWork());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Биелэлт' }));
    const dialog = await screen.findByRole('dialog');

    // Section 10.1 keeps Дүгнэлт on the consolidated report, never on a sub-task.
    expect(within(dialog).queryByLabelText('Дүгнэлт')).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Тайлбар'), 'Холболт чангалсан');
    await user.type(within(dialog).getByLabelText(/^Үнэлгээ/), '88');
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(record).toHaveBeenCalled();
    });
    const payload = record.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.note).toBe('Холболт чангалсан');
    expect(payload.score).toBe(88);
    expect(payload).not.toHaveProperty('riskLevel');
    expect(payload).not.toHaveProperty('conclusion');
  });

  it('opens a sub-task attachment as an enlarged preview and offers a download', async () => {
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:task-photo');
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        tasks: [
          makePlannedWorkTask({
            note: 'Гурван самбар шалгасан',
            score: 88,
            riskLevel: 'NORMAL',
            beforePhotos: [
              {
                id: 'file-1',
                name: 'before.png',
                downloadUrl: '/api/v1/files/file-1',
                mimeType: 'image/png',
                sizeBytes: 2048,
                uploadedByName: 'Бат Дорж',
                uploadedAt: '2026-07-10T00:00:00.000Z',
              },
            ],
          }),
        ],
      }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Дэлгэрэнгүй' }));

    const drawer = await screen.findByRole('dialog', { name: /дэлгэрэнгүй/ });
    expect(within(drawer).getByText('Гурван самбар шалгасан')).toBeInTheDocument();

    const download = await within(drawer).findByRole('link', { name: 'Татах' });
    expect(download).toHaveAttribute('href', 'blob:task-photo');
    expect(download).toHaveAttribute('download', 'before.png');

    await user.click(within(drawer).getByRole('button', { name: 'before.png томруулж харах' }));

    const preview = await screen.findByRole('dialog', { name: 'before.png' });
    expect(within(preview).getByAltText('before.png')).toHaveAttribute('src', 'blob:task-photo');
  });

  it('offers a way through to the consolidated inspection report', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(
      await screen.findByRole('button', { name: 'Үзлэгийн нэгдсэн тайлан' }),
    ).toBeInTheDocument();
  });

  it('opens the sub-task the inspection report deep-linked to', async () => {
    const task = makePlannedWorkTask({ note: 'Гурван самбар шалгасан' });
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({ tasks: [task] }),
    );

    renderWithAuth(<PlannedWorkDetailPage />, {
      permissions: [PERMISSIONS.PLANNED_WORK_VIEW],
      route: `/planned-work/${WORK_ID}?task=${task.id}`,
      path: '/planned-work/:plannedWorkId',
    });

    const drawer = await screen.findByRole('dialog', { name: /дэлгэрэнгүй/ });
    expect(within(drawer).getByText('Гурван самбар шалгасан')).toBeInTheDocument();
  });

  it('shows an error state when the work cannot be loaded', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockRejectedValue(
      new ApiError('Төлөвлөгөөт ажил олдсонгүй.', 'NOT_FOUND', 404),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(await screen.findByText('Төлөвлөгөөт ажил олдсонгүй.')).toBeInTheDocument();
  });
});
