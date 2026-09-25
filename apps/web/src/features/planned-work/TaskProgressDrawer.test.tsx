import type { PlannedWorkDto, PlannedWorkPhotoDto, PlannedWorkTaskDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { plannedWorkService } from '../../services/planned-work.service';
import { makePlannedWork, makePlannedWorkTask } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { TaskProgressDrawer } from './TaskProgressDrawer';

/**
 * THE PROGRESS DRAWER MUST NOT EAT WHAT WAS TYPED INTO IT.
 *
 * The drawer seeds its fields from the task it was handed, and the detail page deliberately
 * hands back a NEW task object after every photo save so the drawer stays open on the
 * refreshed evidence. Keyed on the object, the seeding effect therefore re-ran on every
 * attachment and overwrote the write-up from the stored copy — behind a green success
 * toast, which is the part that makes it costly: a technician who typed a Дүгнэлт, attached
 * the photo that proves it and pressed Бүртгэх saved an empty conclusion and was told the
 * save worked.
 *
 * The harness below is the detail page's own wiring, reduced to the two lines that matter.
 */

const WORK_ID = '507f1f77bcf86cd799439061';
const TASK_ID = '507f1f77bcf86cd799439071';

function makePhoto(overrides: Partial<PlannedWorkPhotoDto> = {}): PlannedWorkPhotoDto {
  return {
    id: 'photo-1',
    name: 'before.png',
    downloadUrl: '/api/v1/files/photo-1',
    mimeType: 'image/png',
    sizeBytes: 1024,
    uploadedByName: 'Бат Дорж',
    uploadedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

function baseWork(task: PlannedWorkTaskDto): PlannedWorkDto {
  return makePlannedWork({ id: WORK_ID, tasks: [task] });
}

/**
 * The detail page's own handler: keep the drawer open on the refreshed task.
 *
 * Reproduced rather than referenced because it is the behaviour under test — the parent
 * returns a structurally new object with the same id, exactly as the server response does.
 */
function Harness({ initial }: { initial: PlannedWorkTaskDto }): ReactElement {
  const [work, setWork] = useState<PlannedWorkDto>(baseWork(initial));
  const [task, setTask] = useState<PlannedWorkTaskDto | null>(initial);
  return (
    <TaskProgressDrawer
      work={work}
      task={task}
      onClose={() => setTask(null)}
      onSaved={(updated) => {
        setWork(updated);
        setTask(updated.tasks.find((entry) => entry.id === task?.id) ?? null);
      }}
    />
  );
}

function renderDrawer(task: PlannedWorkTaskDto) {
  return renderWithAuth(<Harness initial={task} />, { route: '/planned-work', path: '/planned-work' });
}

describe('TaskProgressDrawer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the typed write-up when a photo is attached', async () => {
    const task = makePlannedWorkTask({ id: TASK_ID, note: null, conclusion: null, recommendation: null });
    // What the server sends back: the same task, plus the attachment, with the narrative
    // still empty because it was never saved.
    vi.spyOn(plannedWorkService, 'uploadTaskPhoto').mockResolvedValue(
      baseWork({ ...task, beforePhotos: [makePhoto()] }),
    );

    renderDrawer(task);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Тайлбар'), 'Гурван самбар шалгасан');
    await user.type(screen.getByLabelText('Дүгнэлт'), 'Хэвийн ажиллагаатай');
    await user.type(screen.getByLabelText('Зөвлөмж'), 'Холболтыг чангална');

    await user.upload(
      screen.getByLabelText('Ажлын өмнөх зураг нэмэх'),
      new File(['x'], 'before.png', { type: 'image/png' }),
    );

    expect(await screen.findByText('before.png')).toBeInTheDocument();
    expect(screen.getByLabelText('Тайлбар')).toHaveValue('Гурван самбар шалгасан');
    expect(screen.getByLabelText('Дүгнэлт')).toHaveValue('Хэвийн ажиллагаатай');
    expect(screen.getByLabelText('Зөвлөмж')).toHaveValue('Холболтыг чангална');
  });

  it('keeps the typed quantity and score when a photo is removed', async () => {
    const task = makePlannedWorkTask({
      id: TASK_ID,
      completedQuantity: 4,
      score: null,
      beforePhotos: [makePhoto()],
    });
    vi.spyOn(plannedWorkService, 'deleteTaskPhoto').mockResolvedValue(
      baseWork({ ...task, beforePhotos: [] }),
    );

    renderDrawer(task);
    const user = userEvent.setup();

    const quantity = screen.getByLabelText(/Биелэсэн тоо хэмжээ/);
    await user.clear(quantity);
    await user.type(quantity, '9');
    await user.type(screen.getByLabelText(/Үнэлгээ \(0-100\)/), '72');

    await user.click(screen.getByRole('button', { name: 'Устгах' }));

    await waitFor(() => {
      expect(screen.queryByText('before.png')).not.toBeInTheDocument();
    });
    expect(quantity).toHaveValue(9);
    expect(screen.getByLabelText(/Үнэлгээ \(0-100\)/)).toHaveValue(72);
  });

  /**
   * The other half of the rule: a DIFFERENT sub-task must still re-seed, or the drawer
   * would carry one task's write-up onto the next.
   */
  it('re-seeds when a different sub-task is opened', async () => {
    const first = makePlannedWorkTask({ id: TASK_ID, conclusion: 'Эхний дүгнэлт' });
    const second = makePlannedWorkTask({
      id: '507f1f77bcf86cd799439072',
      title: 'Гэрэлтүүлгийн үзлэг',
      conclusion: 'Хоёр дахь дүгнэлт',
    });

    function Switcher(): ReactElement {
      const [task, setTask] = useState<PlannedWorkTaskDto>(first);
      return (
        <>
          <button type="button" onClick={() => setTask(second)}>
            Дараагийн ажил
          </button>
          <TaskProgressDrawer
            work={makePlannedWork({ id: WORK_ID, tasks: [first, second] })}
            task={task}
            onClose={() => undefined}
            onSaved={() => undefined}
          />
        </>
      );
    }

    renderWithAuth(<Switcher />, { route: '/planned-work', path: '/planned-work' });
    const user = userEvent.setup();

    expect(screen.getByLabelText('Дүгнэлт')).toHaveValue('Эхний дүгнэлт');
    await user.click(screen.getByRole('button', { name: 'Дараагийн ажил' }));
    expect(screen.getByLabelText('Дүгнэлт')).toHaveValue('Хоёр дахь дүгнэлт');
  });
});
