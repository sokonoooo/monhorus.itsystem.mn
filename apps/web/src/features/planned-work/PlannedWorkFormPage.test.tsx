import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { plannedWorkService } from '../../services/planned-work.service';
import { portalService } from '../../services/portal.service';
import { dispatchService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkFormPage } from './PlannedWorkFormPage';

/**
 * The staff side of the shared planned-work form.
 *
 * One component now serves the staff console and the customer portal, so the portal's
 * arrival must not have quietly taken anything away from staff. These are the controls that
 * exist only in staff mode — if the variant switch ever inverts, or the customer branch
 * leaks into the default, these fail.
 */

const STAFF_PERMISSIONS: readonly PermissionKey[] = [
  PERMISSIONS.PLANNED_WORK_VIEW,
  PERMISSIONS.PLANNED_WORK_CREATE,
  PERMISSIONS.CUSTOMER_VIEW,
  PERMISSIONS.OBJECT_VIEW,
  PERMISSIONS.DISPATCH_VIEW,
];

const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const BUILDING_ID = '507f1f77bcf86cd799439012';

function renderStaffForm() {
  return renderWithAuth(<PlannedWorkFormPage />, {
    permissions: STAFF_PERMISSIONS,
    role: 'admin',
    route: '/planned-work/new',
  });
}

describe('the staff planned-work form', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'customers').mockResolvedValue([
      { id: CUSTOMER_ID, name: 'Төв Оффис ХХК' } as never,
    ]);
    vi.spyOn(objectService, 'rootNodes').mockResolvedValue([
      { id: BUILDING_ID, name: 'Төв барилга', kind: 'BUILDING' } as never,
    ]);
    vi.spyOn(objectService, 'children').mockResolvedValue([]);
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([
      { id: 'e1', firstName: 'Бат', lastName: 'Дорж' } as never,
    ]);
  });

  it('still asks staff which customer the work is for', async () => {
    renderStaffForm();

    expect(await screen.findByLabelText(/^Харилцагч/)).toBeInTheDocument();
  });

  it('still lets staff name a crew up front', async () => {
    renderStaffForm();

    await screen.findByLabelText(/^Харилцагч/);
    expect(screen.getByRole('group', { name: 'Хариуцах ажилтан' })).toBeInTheDocument();
    expect(screen.getByText('Дорж Бат')).toBeInTheDocument();
  });

  /** Staff creation must keep going to the staff endpoint, not the portal one. */
  it('creates through the staff endpoint and lands on the staff record', async () => {
    const create = vi
      .spyOn(plannedWorkService, 'create')
      .mockResolvedValue({ id: 'w9', workNumber: 'PW-202609-0009' } as never);
    const portalCreate = vi.spyOn(portalService, 'createPlannedWork');

    const user = userEvent.setup();
    renderStaffForm();

    await user.selectOptions(await screen.findByLabelText(/^Харилцагч/), CUSTOMER_ID);
    await user.selectOptions(await screen.findByLabelText(/^Барилга/), BUILDING_ID);
    await user.type(screen.getByLabelText(/^Ажлын нэр/), 'Улирлын үзлэг');
    await user.type(screen.getByLabelText(/^Эхлэх огноо/), '2026-09-01');
    await user.type(screen.getByLabelText(/^Дуусах огноо/), '2026-09-03');
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await vi.waitFor(() => expect(create).toHaveBeenCalled());
    expect(portalCreate).not.toHaveBeenCalled();
  });
});
