import { PERMISSIONS, type MaterialItemDto, type TaskMaterialUsageDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { materialService } from '../../services/material.service';
import { makePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { TaskMaterialsPanel } from './TaskMaterialsPanel';

const WORK_ID = '507f1f77bcf86cd799439001';
const TASK_ID = '507f1f77bcf86cd799439002';
const MATERIAL_ID = '507f1f77bcf86cd799439003';

function makeMaterial(overrides: Partial<MaterialItemDto> = {}): MaterialItemDto {
  return {
    id: MATERIAL_ID,
    code: 'CBL-3X2.5',
    name: 'Кабель 3x2.5',
    category: 'CABLE',
    defaultUnit: 'METRE',
    description: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeUsage(overrides: Partial<TaskMaterialUsageDto> = {}): TaskMaterialUsageDto {
  return {
    id: '507f1f77bcf86cd799439004',
    taskId: TASK_ID,
    plannedWorkId: WORK_ID,
    materialItemId: MATERIAL_ID,
    materialCode: 'CBL-3X2.5',
    materialName: 'Кабель 3x2.5',
    quantity: 12,
    unit: 'METRE',
    note: '2-р самбар',
    usedByEmployeeId: null,
    usedByName: 'Б. Энхтөр',
    usedAt: '2026-08-02T00:00:00.000Z',
    recordedByName: 'Б. Энхтөр',
    createdAt: '2026-08-02T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

function render(permissions: string[], editable = true) {
  return renderWithAuth(
    <TaskMaterialsPanel plannedWorkId={WORK_ID} taskId={TASK_ID} editable={editable} />,
    { permissions: permissions as never },
  );
}

const READ_WRITE = [PERMISSIONS.MATERIAL_VIEW, PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS];

describe('TaskMaterialsPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists what the sub-task consumed', async () => {
    vi.spyOn(materialService, 'usage').mockResolvedValue([makeUsage()]);
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    render(READ_WRITE);

    expect(await screen.findByText('Ашигласан материал (1)')).toBeInTheDocument();
    // Scoped to the recorded row: the catalogue picker carries an <option> with the same
    // code, so a bare text query matches twice.
    const row = screen.getByRole('listitem');
    expect(within(row).getByText(/CBL-3X2.5/)).toBeInTheDocument();
    expect(within(row).getByText('12 Метр')).toBeInTheDocument();
  });

  /** Section 9.2 does not make materials mandatory, so their absence is explained. */
  it('says materials are optional when none were recorded', async () => {
    vi.spyOn(materialService, 'usage').mockResolvedValue([]);
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    render(READ_WRITE);

    expect(
      await screen.findByText(/Материал зарцуулаагүй ажлыг ч дуусгана/),
    ).toBeInTheDocument();
  });

  it('records a row against this sub-task', async () => {
    vi.spyOn(materialService, 'usage').mockResolvedValue([]);
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));
    const add = vi.spyOn(materialService, 'addUsage').mockResolvedValue(makeUsage());

    render(READ_WRITE);

    // Waits for the CATALOGUE, not the usage list. They are independent requests, and
    // waiting on the usage heading let the option be absent when the run was slow enough
    // for the catalogue to land second — which is exactly how this test flaked.
    const option = await screen.findByRole('option', { name: /CBL-3X2.5/ });
    await userEvent.selectOptions(screen.getByLabelText('Материал'), option);
    await userEvent.type(screen.getByLabelText('Тоо хэмжээ'), '7');
    await userEvent.click(screen.getByRole('button', { name: 'Нэмэх' }));

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith(
        WORK_ID,
        TASK_ID,
        expect.objectContaining({ materialItemId: MATERIAL_ID, quantity: 7 }),
      );
    });
  });

  /** The catalogue's own unit follows the pick so a metre of cable is not typed as pieces. */
  it('adopts the material default unit when one is chosen', async () => {
    vi.spyOn(materialService, 'usage').mockResolvedValue([]);
    vi.spyOn(materialService, 'list').mockResolvedValue(makePage([makeMaterial()]));

    render(READ_WRITE);

    const option = await screen.findByRole('option', { name: /CBL-3X2.5/ });
    await userEvent.selectOptions(screen.getByLabelText('Материал'), option);

    expect(screen.getByLabelText<HTMLSelectElement>('Нэгж').value).toBe('METRE');
  });

  it('closes editing once the sub-task is finished, but still shows the rows', async () => {
    vi.spyOn(materialService, 'usage').mockResolvedValue([makeUsage()]);

    render(READ_WRITE, false);

    expect(await screen.findByText(/CBL-3X2.5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Нэмэх' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();
    expect(screen.getByText(/Дэд ажил дууссан тул/)).toBeInTheDocument();
  });

  it('renders nothing at all without material.view', async () => {
    const usage = vi.spyOn(materialService, 'usage').mockResolvedValue([]);

    render([PERMISSIONS.PLANNED_WORK_RECORD_PROGRESS]);

    // The panel contributes nothing — asserted on its own heading rather than on an empty
    // container, because the test harness always mounts a toast region.
    await waitFor(() => {
      expect(screen.queryByText(/Ашигласан материал/)).not.toBeInTheDocument();
    });
    // Not merely hidden: the read is never issued either.
    expect(usage).not.toHaveBeenCalled();
  });
});
