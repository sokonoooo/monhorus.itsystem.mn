import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { dispatchService } from '../../services/service-request.service';
import { makeCustomer, makeProject } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ProjectFormPage } from './ProjectFormPage';

const EMPLOYEE_ID = '507f1f77bcf86cd799439031';

describe('ProjectFormPage', () => {
  beforeEach(() => {
    vi.spyOn(objectService, 'customers').mockResolvedValue([makeCustomer()]);
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([
      {
        id: EMPLOYEE_ID,
        firstName: 'Дорж',
        lastName: 'Бат',
      } as Awaited<ReturnType<typeof dispatchService.employeeCandidates>>[number],
    ]);
  });

  /**
   * Every column the backend stores for a project has to be reachable here: the create
   * endpoint accepts nothing beyond this set, so this is the whole form.
   */
  it('sends every field the create endpoint accepts', async () => {
    const create = vi.spyOn(projectService, 'createProject').mockResolvedValue(makeProject());
    const user = userEvent.setup();

    renderWithAuth(<ProjectFormPage />, { permissions: [PERMISSIONS.OBJECT_MANAGE] });

    await user.selectOptions(await screen.findByLabelText(/^Байгууллага/), '507f1f77bcf86cd799439011');
    await user.type(screen.getByLabelText(/^Код/), 'PRJ-9');
    await user.type(screen.getByLabelText(/^Төслийн нэр/), 'Жилийн үзлэг');
    await user.type(screen.getByLabelText('Гэрээний дугаар'), 'C-2026-009');
    await user.selectOptions(screen.getByLabelText('Хариуцагч'), EMPLOYEE_ID);
    await user.type(screen.getByLabelText('Эхлэх огноо'), '2026-02-01');
    await user.type(screen.getByLabelText('Дуусах огноо'), '2026-11-30');
    await user.type(screen.getByLabelText('Тайлбар'), 'Улирал тутмын үзлэг');

    await user.click(screen.getByRole('button', { name: 'Хадгалаад барилга нэмэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        customerId: '507f1f77bcf86cd799439011',
        code: 'PRJ-9',
        name: 'Жилийн үзлэг',
        contractNumber: 'C-2026-009',
        responsibleEmployeeId: EMPLOYEE_ID,
        startDate: '2026-02-01T00:00:00.000Z',
        endDate: '2026-11-30T00:00:00.000Z',
        description: 'Улирал тутмын үзлэг',
      });
    });
  });

  it('reports the date order rule instead of sending an impossible range', async () => {
    const create = vi.spyOn(projectService, 'createProject').mockResolvedValue(makeProject());
    const user = userEvent.setup();

    renderWithAuth(<ProjectFormPage />, { permissions: [PERMISSIONS.OBJECT_MANAGE] });

    await user.selectOptions(await screen.findByLabelText(/^Байгууллага/), '507f1f77bcf86cd799439011');
    await user.type(screen.getByLabelText(/^Код/), 'PRJ-8');
    await user.type(screen.getByLabelText(/^Төслийн нэр/), 'Буруу огноо');
    await user.type(screen.getByLabelText('Эхлэх огноо'), '2026-11-30');
    await user.type(screen.getByLabelText('Дуусах огноо'), '2026-02-01');

    await user.click(screen.getByRole('button', { name: 'Хадгалаад барилга нэмэх' }));

    expect(
      await screen.findByText('Дуусах огноо эхлэх огнооноос эрт байж болохгүй.'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});
