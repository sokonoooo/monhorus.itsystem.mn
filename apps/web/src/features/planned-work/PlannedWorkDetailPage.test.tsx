import {
  PERMISSIONS,
  type PlannedWorkFloorProgressDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import * as fileUrl from '../../lib/file-url';
import { materialService } from '../../services/material.service';
import { plannedWorkService } from '../../services/planned-work.service';
import { objectMasterService } from '../../services/object-master.service';
import { objectService } from '../../services/object.service';
import { dispatchService } from '../../services/service-request.service';
import {
  makeObjectListItem,
  makeObjectNode,
  makeMaterialItem,
  makePage,
  makePlannedWork,
  makePlannedWorkMaterial,
  makePlannedWorkReport,
  makePlannedWorkTask,
  makeTaskMaterialUsage,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkDetailPage } from './PlannedWorkDetailPage';

const WORK_ID = '507f1f77bcf86cd799439061';
const TASK_ONE = '507f1f77bcf86cd799439071';
const TASK_TWO = '507f1f77bcf86cd799439072';

function makeFloorProgress(
  overrides: Partial<PlannedWorkFloorProgressDto> = {},
): PlannedWorkFloorProgressDto {
  return {
    floorId: 'f1',
    floorName: '1 давхар',
    taskCount: 1,
    totalQuantity: 10,
    completedQuantity: 4,
    remainingQuantity: 6,
    progressPercent: 40,
    ...overrides,
  };
}

/** A work spread over two floors, so section boundaries are observable. */
function twoFloorWork() {
  return makePlannedWork({
    tasks: [
      makePlannedWorkTask({ id: TASK_ONE, title: 'Самбарын үзлэг', floorId: 'f1', floorName: '1 давхар' }),
      makePlannedWorkTask({ id: TASK_TWO, title: 'Гэрэлтүүлгийн үзлэг', floorId: 'f2', floorName: '2 давхар' }),
    ],
    floorProgress: [
      makeFloorProgress(),
      makeFloorProgress({ floorId: 'f2', floorName: '2 давхар', progressPercent: 80 }),
    ],
  });
}

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
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([]));
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

  it('prints a closed pause shorter than an hour instead of truncating it to zero', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        pauseHistory: [
          {
            pausedAt: '2026-07-10T00:00:00.000Z',
            pausedById: 'u1',
            pausedByName: 'Тест Хэрэглэгч',
            reason: 'Материал хүлээгдэж байна',
            resumedAt: '2026-07-10T00:45:00.000Z',
            resumedById: 'u1',
            resumedByName: 'Тест Хэрэглэгч',
            durationMinutes: 45,
          },
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    // Math.floor(45 / 60) used to render this whole episode as "(0ц)".
    expect(await screen.findByText(/\(45 мин\)/)).toBeInTheDocument();
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
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true,
            assignsCrew: false, targetStatus: 'PAUSED' },
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
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true,
            assignsCrew: false, targetStatus: 'PAUSED' },
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
          { action: 'PAUSE', label: 'Түр зогсоох', requiresReason: true,
            assignsCrew: false, targetStatus: 'PAUSED' },
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
      // An empty crew: PAUSE does not assign, and only APPROVE carries one.
      expect(transition).toHaveBeenCalledWith(WORK_ID, 'PAUSE', 'Материал хүлээгдэж байна', []);
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

  /**
   * Read-only is not the same as unreachable. The list hid archived work, so the report
   * an approval had just filed could not be opened by anyone; the detail page itself was
   * always willing to render it.
   */
  it('keeps an archived work readable, report included', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        lifecycleStatus: 'ARCHIVED',
        effectiveStatus: 'ARCHIVED',
        report: makePlannedWorkReport({ status: 'APPROVED', visibleToCustomer: true }),
        availableActions: [],
        completionBlockers: [],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(await screen.findByText('Архивласан')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Тайлан' })).toBeInTheDocument();
  });

  it('lists a material as registered, used and remaining', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        materials: [
          makePlannedWorkMaterial({ quantity: 100, consumedQuantity: 40, remainingQuantity: 60 }),
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const table = await screen.findByRole('table', { name: 'Материал ба зарцуулалт' });
    expect(within(table).getByText('Кабель 3x2.5')).toBeInTheDocument();
    for (const header of ['Бүртгэсэн', 'Зарцуулсан', 'Үлдэгдэл']) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }
    expect(within(table).getByText('100')).toBeInTheDocument();
    expect(within(table).getByText('40')).toBeInTheDocument();
    expect(within(table).getByText('60')).toBeInTheDocument();
    expect(within(table).getByText('Метр')).toBeInTheDocument();
  });

  /**
   * The figure is the SERVER'S, not `quantity - consumedQuantity`.
   *
   * A screen that subtracts cannot be wrong here only because the invariant holds; it is
   * wrong the moment the two disagree, and the stored remainder is what the backend's
   * over-consumption guard actually compares against. Feeding it a remainder that does not
   * match the subtraction is the only way to tell the two implementations apart.
   */
  it('reads the remaining figure rather than subtracting for itself', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        materials: [
          makePlannedWorkMaterial({ quantity: 100, consumedQuantity: 40, remainingQuantity: 55 }),
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const table = await screen.findByRole('table', { name: 'Материал ба зарцуулалт' });
    expect(within(table).getByText('55')).toBeInTheDocument();
    expect(within(table).queryByText('60')).not.toBeInTheDocument();
  });

  /** Nothing drawn yet is the ordinary state of a work that has just been planned. */
  it('renders a material nothing has been drawn from without a stray percentage', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        materials: [
          makePlannedWorkMaterial({ quantity: 0, consumedQuantity: 0, remainingQuantity: 0 }),
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const table = await screen.findByRole('table', { name: 'Материал ба зарцуулалт' });
    // A registered quantity of zero must not divide its way to NaN%.
    expect(within(table).getByText('0%')).toBeInTheDocument();
    expect(within(table).queryByText(/NaN/)).not.toBeInTheDocument();
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

    // A sub-task now carries its own Дүгнэлт. It used to be barred from having one, on
    // the rule that the conclusion belonged to the consolidated report alone — but the
    // rows in Үзлэг ба дүгнэлт ARE the per-object items fanned out from a sub-task, so
    // that rule left their Дүгнэлт column permanently empty. The consolidated report
    // still keeps its own conclusion; this is an addition to it.
    await user.type(within(dialog).getByLabelText('Тайлбар'), 'Холболт чангалсан');
    await user.type(within(dialog).getByLabelText('Дүгнэлт'), 'Ашиглалтад тэнцэнэ');
    await user.type(within(dialog).getByLabelText(/^Үнэлгээ/), '88');
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(record).toHaveBeenCalled();
    });
    const payload = record.mock.calls[0]![2] as Record<string, unknown>;
    expect(payload.note).toBe('Холболт чангалсан');
    expect(payload.conclusion).toBe('Ашиглалтад тэнцэнэ');
    expect(payload.score).toBe(88);
    // The band is still derived by the backend and never sent from here.
    expect(payload).not.toHaveProperty('riskLevel');
  });

  /**
   * The equipment a sub-task covers.
   *
   * This is the whole reason a planned-work result reaches Үзлэг ба дүгнэлт: the report
   * emits one item per related object, so a sub-task saved with none is invisible there
   * no matter how it was scored. The form defaulted to sending none, which is what these
   * cover.
   */
  describe('sub-task equipment', () => {
    // Real ObjectIds: the shared schema validates the ids before the request is made, so
    // a readable placeholder would fail the form rather than reach the service.
    const PANEL_ID = '507f1f77bcf86cd799439161';
    const LIGHT_ID = '507f1f77bcf86cd799439162';
    const FLOOR_ONE = '507f1f77bcf86cd799439121';
    const FLOOR_TWO = '507f1f77bcf86cd799439122';
    const PANEL = makeObjectListItem({ id: PANEL_ID, code: 'DB-1', name: 'Самбар 1' });
    const LIGHT = makeObjectListItem({ id: LIGHT_ID, code: 'LT-1', name: 'Гэрэлтүүлэг 1' });

    beforeEach(() => {
      vi.spyOn(objectService, 'children').mockResolvedValue([
        makeObjectNode({ id: FLOOR_ONE, name: '1 давхар', kind: 'FLOOR' }),
        makeObjectNode({ id: FLOOR_TWO, name: '2 давхар', kind: 'FLOOR' }),
      ]);
      vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([PANEL, LIGHT]));
    });

    async function openNewTaskForm(
      user: ReturnType<typeof userEvent.setup>,
    ): Promise<HTMLElement> {
      await user.click(await screen.findByRole('button', { name: 'Дэд ажил нэмэх' }));
      return screen.findByRole('dialog', { name: 'Шинэ дэд ажил' });
    }

    it('sends the picked equipment when a sub-task is created', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const create = vi
        .spyOn(plannedWorkService, 'createTask')
        .mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      await user.type(within(dialog).getByLabelText(/Дэд ажлын нэр/), 'Самбар шалгах');
      await user.type(within(dialog).getByLabelText(/Хийх тоо хэмжээ/), '4');

      await waitFor(() =>
        expect(within(dialog).getByLabelText(/Хамрах тоноглол/)).toBeInTheDocument(),
      );
      await user.selectOptions(within(dialog).getByLabelText(/Хамрах тоноглол/), PANEL_ID);
      await user.selectOptions(within(dialog).getByLabelText(/Хамрах тоноглол/), LIGHT_ID);

      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => expect(create).toHaveBeenCalled());
      const payload = create.mock.calls[0]![1] as Record<string, unknown>;
      expect(payload.relatedObjectIds).toEqual([PANEL_ID, LIGHT_ID]);
    });

    it('pre-populates from the saved task and sends the edited equipment on update', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        makePlannedWork({
          tasks: [
            makePlannedWorkTask({
              floorId: FLOOR_ONE,
              // The shared fixture's readable 'e1' is not an ObjectId, and an update
              // re-sends every field, so it would fail the schema before the service.
              assignedEmployeeId: null,
              relatedObjects: [{ id: PANEL_ID, name: 'Самбар 1' }],
            }),
          ],
        }),
      );
      const update = vi
        .spyOn(plannedWorkService, 'updateTask')
        .mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      await openTaskMenu(user);
      await user.click(screen.getByRole('menuitem', { name: 'Засах' }));
      const dialog = await screen.findByRole('dialog');

      // What was saved is what the form opens with; an edit must not silently drop it.
      expect(within(dialog).getByRole('button', { name: 'Самбар 1 хасах' })).toBeInTheDocument();

      await user.selectOptions(within(dialog).getByLabelText(/Хамрах тоноглол/), LIGHT_ID);
      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => expect(update).toHaveBeenCalled());
      const payload = update.mock.calls[0]![2] as Record<string, unknown>;
      expect(payload.relatedObjectIds).toEqual([PANEL_ID, LIGHT_ID]);
    });

    it('clears equipment the new floor cannot contain, and says so', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const create = vi
        .spyOn(plannedWorkService, 'createTask')
        .mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      await user.type(within(dialog).getByLabelText(/Дэд ажлын нэр/), 'Самбар шалгах');
      await user.type(within(dialog).getByLabelText(/Хийх тоо хэмжээ/), '4');
      await user.selectOptions(within(dialog).getByLabelText('Давхар'), FLOOR_ONE);
      await user.selectOptions(within(dialog).getByLabelText(/Хамрах тоноглол/), PANEL_ID);
      // The chip, not the <option> of the same text still sitting in the select.
      expect(within(dialog).getByRole('button', { name: 'Самбар 1 хасах' })).toBeInTheDocument();

      // Equipment on floor 1 cannot be on floor 2, so the backend would refuse the save.
      // The selection goes rather than the save 400ing, and the user is told why.
      await user.selectOptions(within(dialog).getByLabelText('Давхар'), FLOOR_TWO);
      expect(
        within(dialog).queryByRole('button', { name: 'Самбар 1 хасах' }),
      ).not.toBeInTheDocument();
      expect(within(dialog).getByText(/Давхар өөрчлөгдсөн тул сонгосон тоноглол цуцлагдлаа/))
        .toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));
      await waitFor(() => expect(create).toHaveBeenCalled());
      expect((create.mock.calls[0]![1] as Record<string, unknown>).relatedObjectIds).toEqual([]);
    });

    it('keeps the selection when the floor is cleared, because the building still contains it', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      await user.selectOptions(within(dialog).getByLabelText('Давхар'), FLOOR_ONE);
      await user.selectOptions(within(dialog).getByLabelText(/Хамрах тоноглол/), PANEL_ID);

      // Widening, not narrowing: a floorless sub-task admits anything in the building.
      await user.selectOptions(within(dialog).getByLabelText('Давхар'), '');
      expect(within(dialog).getByRole('button', { name: 'Самбар 1 хасах' })).toBeInTheDocument();
      expect(
        within(dialog).queryByText(/Давхар өөрчлөгдсөн тул сонгосон тоноглол цуцлагдлаа/),
      ).not.toBeInTheDocument();
    });

    /**
     * The query, not merely "something rendered".
     *
     * The picker asked for `limit: 200`, which `objectListQuerySchema` rejects before the
     * handler runs, so every request 400ed and the catch turned the field into an empty,
     * dead select. A test that only mocked the service and asserted on rows could not see
     * that, because a mock answers any query. This asserts what is actually sent.
     */
    it('asks for the equipment page the API will serve, and offers what comes back', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const list = vi
        .spyOn(objectMasterService, 'list')
        .mockResolvedValue(makePage([PANEL, LIGHT]));
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);

      // No floor named yet, so the scope is the parent building — the same scope the
      // backend admits equipment from for a floorless sub-task.
      await waitFor(() => expect(list).toHaveBeenCalledWith({ buildingId: 'b1', limit: 100 }));

      await user.selectOptions(within(dialog).getByLabelText('Давхар'), FLOOR_ONE);
      await waitFor(() => expect(list).toHaveBeenCalledWith({ floorId: FLOOR_ONE, limit: 100 }));

      // The cap the shared schema enforces. Above it the request is a 400, not a bigger page.
      for (const [query] of list.mock.calls) {
        expect(query?.limit ?? 0).toBeLessThanOrEqual(100);
      }

      expect(within(dialog).getByRole('option', { name: 'DB-1 · Самбар 1' })).toBeInTheDocument();
      expect(
        within(dialog).getByRole('option', { name: 'LT-1 · Гэрэлтүүлэг 1' }),
      ).toBeInTheDocument();
    });

    it('saves a sub-task with no equipment picked, sending an empty list', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const create = vi
        .spyOn(plannedWorkService, 'createTask')
        .mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      await user.type(within(dialog).getByLabelText(/Дэд ажлын нэр/), 'Самбар шалгах');
      await user.type(within(dialog).getByLabelText(/Хийх тоо хэмжээ/), '4');
      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => expect(create).toHaveBeenCalled());
      expect((create.mock.calls[0]![1] as Record<string, unknown>).relatedObjectIds).toEqual([]);
      // Nothing was rejected on the way: equipment is not a requirement.
      expect(
        screen.queryByText('Оруулсан мэдээлэл шаардлага хангахгүй байна.'),
      ).not.toBeInTheDocument();
    });

    it('presents the empty selection as optional rather than as a validation failure', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);

      // The label says it, so the claim survives even if the notice is scrolled past.
      expect(within(dialog).getByLabelText('Хамрах тоноглол (заавал бус)')).toBeInTheDocument();
      expect(
        within(dialog).getByText('Тоноглол заавал биш — сонгоогүй ч хадгална.'),
      ).toBeInTheDocument();
      expect(
        within(dialog).getByText(
          /Тоноглол сонгоогүй бол энэ дэд ажлын дүгнэлт Үзлэг ба дүгнэлт хэсэгт харагдахгүй/,
        ),
      ).toBeInTheDocument();
      // A validation message would be announced as one; this is not that.
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });

    it('says the scope holds no registered equipment instead of leaving a dead select', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([]));
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      expect(
        await within(dialog).findByText(/Энэ барилгад бүртгэлтэй тоноглол алга/),
      ).toBeInTheDocument();

      await user.selectOptions(within(dialog).getByLabelText('Давхар'), FLOOR_ONE);
      expect(
        await within(dialog).findByText(/Энэ давхарт бүртгэлтэй тоноглол алга/),
      ).toBeInTheDocument();
      expect(within(dialog).getByLabelText(/Хамрах тоноглол/)).toBeDisabled();
    });

    it('says the equipment list failed to load rather than passing it off as empty', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      vi.spyOn(objectMasterService, 'list').mockRejectedValue(new Error('network'));
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      expect(
        await within(dialog).findByText(/Тоноглолын жагсаалтыг ачаалж чадсангүй/),
      ).toBeInTheDocument();
    });

    it('admits when the scope holds more equipment than one page can offer', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(makePlannedWork());
      vi.spyOn(objectMasterService, 'list').mockResolvedValue({
        ...makePage([PANEL, LIGHT]),
        total: 140,
        totalPages: 2,
      });
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);

      const dialog = await openNewTaskForm(user);
      expect(
        await within(dialog).findByText(/Нийт 140 тоноглолоос эхний 2 нь жагсав/),
      ).toBeInTheDocument();
    });

    it('lists a sub-task’s equipment in its expanded row', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        makePlannedWork({
          tasks: [
            makePlannedWorkTask({
              relatedObjects: [
                { id: PANEL_ID, name: 'Самбар 1' },
                { id: LIGHT_ID, name: 'Гэрэлтүүлэг 1' },
              ],
            }),
          ],
        }),
      );
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

      const expander = await screen.findByRole('button', {
        name: 'Самбарын үзлэг — тоноглол ба материал',
      });
      // Closed until asked for: the row is a summary, the equipment is the detail.
      expect(expander).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByText('Хамрах тоноглол (2)')).not.toBeInTheDocument();

      await user.click(expander);

      expect(screen.getByText('Хамрах тоноглол (2)')).toBeInTheDocument();
      expect(screen.getByText('Самбар 1')).toBeInTheDocument();
      expect(screen.getByText('Гэрэлтүүлэг 1')).toBeInTheDocument();
    });

    it('says so in the expanded row when a sub-task covers nothing', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        makePlannedWork({ tasks: [makePlannedWorkTask({ relatedObjects: [] })] }),
      );
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

      await user.click(
        await screen.findByRole('button', { name: 'Самбарын үзлэг — тоноглол ба материал' }),
      );

      expect(
        screen.getByText(/Тоноглол сонгоогүй: энэ дэд ажлын үр дүн Үзлэг ба дүгнэлт/),
      ).toBeInTheDocument();
    });
  });

  it('warns that a sub-task with no equipment keeps its Дүгнэлт out of Үзлэг ба дүгнэлт', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({ tasks: [makePlannedWorkTask({ relatedObjects: [] })] }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Биелэлт' }));
    const dialog = await screen.findByRole('dialog');

    expect(
      within(dialog).getByText(/Тоноглол сонгоогүй бол энэ дүгнэлт Үзлэг ба дүгнэлт/),
    ).toBeInTheDocument();
  });

  it('names who wrote the sub-task Дүгнэлт and how long the work took', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        tasks: [
          makePlannedWorkTask({
            conclusion: 'Тусгаарлагч хэвийн.',
            conclusionById: 'u9',
            conclusionByName: 'Батаа Энхтөр',
            conclusionAt: '2026-07-29T06:30:00.000Z',
            durationMinutes: 150,
          }),
        ],
      }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Дэлгэрэнгүй' }));
    const drawer = await screen.findByRole('dialog', { name: /дэлгэрэнгүй/ });

    // The verdict alone is anonymous — anyone on the job can overwrite it.
    expect(within(drawer).getByText('Дүгнэлт бичсэн')).toBeInTheDocument();
    expect(within(drawer).getByText(/Батаа Энхтөр ·/)).toBeInTheDocument();

    // 150 minutes, not "2ц" and not a bare 150.
    expect(within(drawer).getByText('Гүйцэтгэсэн хугацаа')).toBeInTheDocument();
    expect(within(drawer).getByText('2 цаг 30 мин')).toBeInTheDocument();
  });

  it('says nothing rather than zero for a sub-task with no duration yet', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({ tasks: [makePlannedWorkTask({ durationMinutes: null })] }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    await openTaskMenu(user);
    await user.click(screen.getByRole('menuitem', { name: 'Дэлгэрэнгүй' }));
    const drawer = await screen.findByRole('dialog', { name: /дэлгэрэнгүй/ });

    const label = within(drawer).getByText('Гүйцэтгэсэн хугацаа');
    expect(label.parentElement).toHaveTextContent('-');
    expect(within(drawer).queryByText('0 мин')).not.toBeInTheDocument();
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

  it('files each sub-task under the floor it is planned on', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(twoFloorWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const first = await screen.findByRole('table', { name: '1 давхар дэд ажил' });
    const second = screen.getByRole('table', { name: '2 давхар дэд ажил' });

    expect(within(first).getByText('Самбарын үзлэг')).toBeInTheDocument();
    expect(within(first).queryByText('Гэрэлтүүлгийн үзлэг')).not.toBeInTheDocument();
    expect(within(second).getByText('Гэрэлтүүлгийн үзлэг')).toBeInTheDocument();

    // The floor rollup is the section header now, not a separate read-only list.
    expect(screen.queryByText('Давхрын биелэлт')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^1 давхар/ })).toHaveTextContent('1 дэд ажил');
  });

  /**
   * Numbered but not paged, and numbered per floor. These sections are separate tables
   * under separate headings, so a reader asked to check the second task on the second
   * floor counts down that table — a number running across the whole page would send them
   * to the wrong row.
   */
  it('numbers the sub-tasks from 1 within each floor section', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(twoFloorWork());

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const first = await screen.findByRole('table', { name: '1 давхар дэд ажил' });
    const second = screen.getByRole('table', { name: '2 давхар дэд ажил' });

    for (const table of [first, second]) {
      expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
      const rows = within(table).getAllByRole('row');
      // Row 0 is the header. These rows expand, so the first cell is the expander and the
      // number sits in the second — the same order the header renders them in.
      expect(within(rows[1]!).getAllByRole('cell')[1]?.textContent?.trim()).toBe('1');
    }
  });

  it('collects the floorless sub-tasks into a trailing unassigned section', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({
        tasks: [
          makePlannedWorkTask({ id: TASK_ONE, floorId: 'f1', floorName: '1 давхар' }),
          makePlannedWorkTask({
            id: TASK_TWO,
            title: 'Ерөнхий цэвэрлэгээ',
            floorId: null,
            floorName: null,
          }),
        ],
        floorProgress: [
          makeFloorProgress(),
          makeFloorProgress({ floorId: '', floorName: 'Давхар заагаагүй' }),
        ],
      }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const unassigned = await screen.findByRole('table', { name: 'Давхар заагаагүй дэд ажил' });
    expect(within(unassigned).getByText('Ерөнхий цэвэрлэгээ')).toBeInTheDocument();

    // Last, because a missing floor is a leftover rather than a place in the building.
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.at(-1)).toHaveTextContent('Давхар заагаагүй');
  });

  it('applies one column choice to every floor section', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(twoFloorWork());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const first = await screen.findByRole('table', { name: '1 давхар дэд ажил' });
    expect(within(first).getByRole('columnheader', { name: 'Ажилтан' })).toBeInTheDocument();

    // The planned-material card carries a picker of its own; the sub-task one comes first.
    await user.click(screen.getAllByRole('button', { name: 'Багана' })[0]!);
    await user.click(screen.getByLabelText('Ажилтан'));

    for (const name of ['1 давхар дэд ажил', '2 давхар дэд ажил']) {
      const table = screen.getByRole('table', { name });
      expect(
        within(table).queryByRole('columnheader', { name: 'Ажилтан' }),
      ).not.toBeInTheDocument();
    }
  });

  it('remembers which floor sections the user closed', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(twoFloorWork());
    const user = userEvent.setup();

    const first = renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    // Open by default: this page IS the work, so it does not start behind a click per floor.
    const toggle = await screen.findByRole('button', { name: /^1 давхар/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: '1 давхар дэд ажил' })).not.toBeInTheDocument();
    // The other section is untouched.
    expect(screen.getByRole('table', { name: '2 давхар дэд ажил' })).toBeInTheDocument();

    first.unmount();
    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    const reopened = await screen.findByRole('button', { name: /^1 давхар/ });
    expect(reopened).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('table', { name: '1 давхар дэд ажил' })).not.toBeInTheDocument();
  });

  it('names the material card for the plan AND the consumption it now carries', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({ materials: [makePlannedWorkMaterial()] }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    // The card used to be the plan alone and said so. It now carries what was drawn against
    // each row as well, so a heading claiming to be only a plan would be false.
    expect(
      await screen.findByRole('heading', { name: 'Материал ба зарцуулалт' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Төлөвлөсөн материал' }),
    ).not.toBeInTheDocument();
  });

  /**
   * The bug `lib/duration.ts` was written to kill: the summary rendered the paused total
   * as `Math.floor(minutes / 1440) өдөр ...`, so a 45-minute pause printed `0 өдөр 0 цаг`
   * — a real figure turned into a confident zero.
   */
  it('states a sub-day pause in minutes rather than as a zero day count', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
      makePlannedWork({ totalPausedMinutes: 45 }),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(await screen.findByText('45 мин')).toBeInTheDocument();
    expect(screen.queryByText(/0 өдөр/)).not.toBeInTheDocument();
  });

  /**
   * Registration: which catalogue item, and how much of it the plan allows.
   *
   * The list stopped being free text once sub-tasks began drawing against it — a pool
   * identified by a typed-in name splits the moment two people spell the cable differently
   * — so this drawer picks and no longer types, and the unit comes with the item.
   */
  describe('material registration drawer', () => {
    const MATERIAL_ID = '507f1f77bcf86cd799439091';

    async function openDrawer(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
      await user.click(await screen.findByRole('button', { name: 'Материал засах' }));
      return screen.findByRole('dialog');
    }

    it('picks a material from the catalogue and shows its unit rather than asking for one', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        makePlannedWork({ materials: [makePlannedWorkMaterial({ materialItemId: MATERIAL_ID })] }),
      );
      const list = vi
        .spyOn(materialService, 'list')
        .mockResolvedValue(makePage([makeMaterialItem({ id: MATERIAL_ID })]));
      const save = vi
        .spyOn(plannedWorkService, 'setMaterials')
        .mockResolvedValue(makePlannedWork());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);
      const dialog = await openDrawer(user);

      // Retired items are never offered, and the whole catalogue arrives in one page.
      await waitFor(() =>
        expect(list).toHaveBeenCalledWith({ isActive: true, limit: 200 }),
      );

      expect(
        await within(dialog).findByRole('option', { name: 'CBL-3X2.5 · Кабель 3x2.5' }),
      ).toBeInTheDocument();
      // The unit belongs to the catalogue entry, so there is nothing here to choose it with.
      expect(within(dialog).queryByLabelText('Нэгж')).not.toBeInTheDocument();
      expect(within(dialog).getByText('Метр')).toBeInTheDocument();

      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

      // No name and no unit: both are the catalogue's to state.
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith(WORK_ID, {
          materials: [{ materialItemId: MATERIAL_ID, quantity: 100 }],
        }),
      );
    });

    it('paints a rejected quantity on the row the server names', async () => {
      const second = '507f1f77bcf86cd799439092';
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        makePlannedWork({
          materials: [
            makePlannedWorkMaterial({ materialItemId: MATERIAL_ID }),
            makePlannedWorkMaterial({
              materialItemId: second,
              name: 'Автомат таслуур',
              quantity: 4,
              consumedQuantity: 3,
              remainingQuantity: 1,
            }),
          ],
        }),
      );
      vi.spyOn(materialService, 'list').mockResolvedValue(
        makePage([
          makeMaterialItem({ id: MATERIAL_ID }),
          makeMaterialItem({
            id: second,
            code: 'BRK-16A',
            name: 'Автомат таслуур',
            category: 'BREAKER',
            defaultUnit: 'PIECE',
          }),
        ]),
      );
      vi.spyOn(plannedWorkService, 'setMaterials').mockRejectedValue(
        new ApiError('Материал хадгалж чадсангүй.', 'VALIDATION_ERROR', 400, [
          { field: 'materials.1.quantity', message: 'Аль хэдийн 3 ширхэг зарцуулсан байна.' },
        ]),
      );
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_UPDATE]);
      const dialog = await openDrawer(user);

      const quantities = await within(dialog).findAllByLabelText(/^Тоо хэмжээ/);
      await user.clear(quantities[1]!);
      await user.type(quantities[1]!, '1');
      await user.click(within(dialog).getByRole('button', { name: 'Хадгалах' }));

      // Keyed by the schema's own dotted path, so the message lands on the second row
      // instead of being flattened into one banner that names no row at all.
      expect(
        await within(dialog).findByText('Аль хэдийн 3 ширхэг зарцуулсан байна.'),
      ).toBeInTheDocument();
    });
  });

  /**
   * Consumption, recorded against the sub-task that did the consuming.
   *
   * The pool it draws from belongs to the WORK, so nothing here may decide on its own that
   * a draw is too large: another sub-task can empty the pool between this page loading and
   * the button being pressed. The screen sends the figure and shows what the server says.
   */
  describe('sub-task material usage', () => {
    const MATERIAL_ID = '507f1f77bcf86cd799439091';

    function workWithMaterial(task: Partial<PlannedWorkTaskDto> = {}) {
      return makePlannedWork({
        materials: [makePlannedWorkMaterial({ materialItemId: MATERIAL_ID })],
        tasks: [makePlannedWorkTask({ id: TASK_ONE, ...task })],
      });
    }

    async function openPanel(user: ReturnType<typeof userEvent.setup>): Promise<void> {
      await user.click(
        await screen.findByRole('button', { name: 'Самбарын үзлэг — тоноглол ба материал' }),
      );
    }

    it('lists what the sub-task drew and sends a correction as an absolute figure', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        workWithMaterial({ materialUsage: [makeTaskMaterialUsage({ taskId: TASK_ONE })] }),
      );
      const record = vi
        .spyOn(plannedWorkService, 'recordMaterialUsage')
        .mockResolvedValue(workWithMaterial());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);
      await openPanel(user);

      expect(screen.getByText('Зарцуулсан материал (1)')).toBeInTheDocument();
      expect(screen.getByText('40 Метр')).toBeInTheDocument();

      // Only what the work registered may be drawn from, and the option says what is left.
      const picker = screen.getByLabelText('Материал');
      expect(within(picker).getAllByRole('option')).toHaveLength(2); // placeholder + the one
      await user.selectOptions(picker, MATERIAL_ID);

      // Selecting fills the box with what is already recorded, because the field is a total
      // rather than an increment; typing 45 must mean 45 in all, not 85.
      const quantity = screen.getByLabelText('Зарцуулсан тоо хэмжээ');
      expect(quantity).toHaveValue(40);

      await user.clear(quantity);
      await user.type(quantity, '45');
      await user.click(screen.getByRole('button', { name: 'Бүртгэх' }));

      await waitFor(() =>
        expect(record).toHaveBeenCalledWith(WORK_ID, TASK_ONE, {
          materialItemId: MATERIAL_ID,
          quantity: 45,
        }),
      );
    });

    it('sends an over-draw and shows the refusal against the quantity', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(workWithMaterial());
      const record = vi.spyOn(plannedWorkService, 'recordMaterialUsage').mockRejectedValue(
        new ApiError('Зарцуулалт бүртгэж чадсангүй.', 'VALIDATION_ERROR', 400, [
          { field: 'quantity', message: 'Үлдэгдэл ердөө 60 Метр байна.' },
        ]),
      );
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);
      await openPanel(user);

      await user.selectOptions(screen.getByLabelText('Материал'), MATERIAL_ID);
      await user.type(screen.getByLabelText('Зарцуулсан тоо хэмжээ'), '500');
      await user.click(screen.getByRole('button', { name: 'Бүртгэх' }));

      // Sent, not pre-empted: 500 against a remainder of 60 is the server's call to make.
      await waitFor(() =>
        expect(record).toHaveBeenCalledWith(WORK_ID, TASK_ONE, {
          materialItemId: MATERIAL_ID,
          quantity: 500,
        }),
      );
      expect(await screen.findByText('Үлдэгдэл ердөө 60 Метр байна.')).toBeInTheDocument();
      expect(screen.getByText('Зарцуулалт бүртгэж чадсангүй.')).toBeInTheDocument();
    });

    it('offers no recording control without planned_work.record_progress', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(
        workWithMaterial({ materialUsage: [makeTaskMaterialUsage({ taskId: TASK_ONE })] }),
      );
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);
      await openPanel(user);

      // The record stays readable; only the write disappears.
      expect(screen.getByText('Зарцуулсан материал (1)')).toBeInTheDocument();
      expect(screen.queryByLabelText('Зарцуулсан тоо хэмжээ')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Бүртгэх' })).not.toBeInTheDocument();
    });

    it('says so when a sub-task consumed nothing', async () => {
      vi.spyOn(plannedWorkService, 'getById').mockResolvedValue(workWithMaterial());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);
      await openPanel(user);

      expect(screen.getByText('Зарцуулсан материал (0)')).toBeInTheDocument();
      expect(screen.getByText('Энэ дэд ажилд материал зарцуулаагүй байна.')).toBeInTheDocument();
    });
  });

  it('shows an error state when the work cannot be loaded', async () => {
    vi.spyOn(plannedWorkService, 'getById').mockRejectedValue(
      new ApiError('Төлөвлөгөөт ажил олдсонгүй.', 'NOT_FOUND', 404),
    );

    renderDetail([PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(await screen.findByText('Төлөвлөгөөт ажил олдсонгүй.')).toBeInTheDocument();
  });
});
