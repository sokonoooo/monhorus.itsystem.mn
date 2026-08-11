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
        name: 'Жилийн үзлэг',
        contractNumber: 'C-2026-009',
        responsibleEmployeeId: EMPLOYEE_ID,
        startDate: '2026-02-01T00:00:00.000Z',
        endDate: '2026-11-30T00:00:00.000Z',
        description: 'Улирал тутмын үзлэг',
      });
    });
  });

  /**
   * The code is issued by the server, so there is nothing here for anyone to type. The
   * pattern carries `^` and no `$` on purpose: `Field` appends a `*` to a required label,
   * so a plain equality query would pass even if the field came back.
   */
  it('asks for no code when creating', async () => {
    renderWithAuth(<ProjectFormPage />, { permissions: [PERMISSIONS.OBJECT_MANAGE] });

    await screen.findByLabelText(/^Төслийн нэр/);
    expect(screen.queryByLabelText(/^Код/)).toBeNull();
  });

  /**
   * Absent rather than empty. `createProjectSchema` strips what it does not declare, so an
   * empty string would be dropped silently and the form would look correct while still
   * proposing a number only the server can draw.
   */
  it('sends a create payload with no code key at all', async () => {
    const create = vi.spyOn(projectService, 'createProject').mockResolvedValue(makeProject());
    const user = userEvent.setup();

    renderWithAuth(<ProjectFormPage />, { permissions: [PERMISSIONS.OBJECT_MANAGE] });

    await user.selectOptions(await screen.findByLabelText(/^Байгууллага/), '507f1f77bcf86cd799439011');
    await user.type(screen.getByLabelText(/^Төслийн нэр/), 'Кодгүй төсөл');

    await user.click(screen.getByRole('button', { name: 'Хадгалаад барилга нэмэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ code: expect.anything() }));
    });
    expect('code' in create.mock.calls[0]![0]).toBe(false);
  });

  it('asks for no code when editing', async () => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(makeProject());

    renderWithAuth(<ProjectFormPage />, {
      permissions: [PERMISSIONS.OBJECT_MANAGE],
      route: `/projects/${makeProject().id}/edit`,
      path: '/projects/:projectId/edit',
    });

    // The prefilled name is what says the edit form has finished loading the project.
    expect(await screen.findByDisplayValue('Урьдчилан сэргийлэх үйлчилгээ')).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Код/)).toBeNull();
  });

  it('reports the date order rule instead of sending an impossible range', async () => {
    const create = vi.spyOn(projectService, 'createProject').mockResolvedValue(makeProject());
    const user = userEvent.setup();

    renderWithAuth(<ProjectFormPage />, { permissions: [PERMISSIONS.OBJECT_MANAGE] });

    await user.selectOptions(await screen.findByLabelText(/^Байгууллага/), '507f1f77bcf86cd799439011');
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
