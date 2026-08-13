import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { plannedWorkService } from '../../services/planned-work.service';
import { portalService } from '../../services/portal.service';
import { dispatchService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { PlannedWorkFormPage } from './PlannedWorkFormPage';
import { TransitionActions } from './TransitionActions';

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

describe('approving a submitted work', () => {
  const APPROVER_PERMISSIONS: readonly PermissionKey[] = [
    PERMISSIONS.PLANNED_WORK_VIEW,
    PERMISSIONS.PLANNED_WORK_APPROVE,
    PERMISSIONS.DISPATCH_VIEW,
  ];

  const APPROVE_ACTION = {
    action: 'APPROVE' as const,
    label: 'Батлах',
    requiresReason: false,
    assignsCrew: true,
    targetStatus: 'PLANNED' as const,
  };

  function pendingWork() {
    return {
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'PENDING_APPROVAL',
      effectiveStatus: 'PENDING_APPROVAL',
      availableActions: [APPROVE_ACTION],
    } as never;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([
      { id: 'e1', firstName: 'Бат', lastName: 'Дорж' } as never,
    ]);
  });

  /**
   * Approval and staffing are one decision, so the dialog will not close without somebody
   * named. The client mirrors the server rule rather than letting the request 400.
   */
  it('will not approve until an employee is chosen', async () => {
    const transition = vi.spyOn(plannedWorkService, 'transition');
    const user = userEvent.setup();

    renderWithAuth(<TransitionActions work={pendingWork()} onChanged={() => {}} />, {
      permissions: APPROVER_PERMISSIONS,
      role: 'admin',
      route: '/planned-work/w1',
    });

    await user.click(await screen.findByRole('button', { name: 'Батлах' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Батлах' });
    expect(confirm).toBeDisabled();
    await user.click(confirm);
    expect(transition).not.toHaveBeenCalled();
  });

  it('sends the chosen crew with the approval', async () => {
    const transition = vi
      .spyOn(plannedWorkService, 'transition')
      .mockResolvedValue(pendingWork());
    const user = userEvent.setup();

    renderWithAuth(<TransitionActions work={pendingWork()} onChanged={() => {}} />, {
      permissions: APPROVER_PERMISSIONS,
      role: 'admin',
      route: '/planned-work/w1',
    });

    await user.click(await screen.findByRole('button', { name: 'Батлах' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByLabelText('Дорж Бат'));
    await user.click(within(dialog).getByRole('button', { name: 'Батлах' }));

    await vi.waitFor(() =>
      expect(transition).toHaveBeenCalledWith('w1', 'APPROVE', null, ['e1']),
    );
  });
});
