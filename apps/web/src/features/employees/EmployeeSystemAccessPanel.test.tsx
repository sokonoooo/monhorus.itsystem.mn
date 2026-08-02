import { PERMISSIONS, type EmployeeSystemAccessDto, type RoleDto } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { employeeService } from '../../services/employee.service';
import { rbacService } from '../../services/rbac.service';
import { userService } from '../../services/user.service';
import { renderWithAuth } from '../../test/render';
import { EmployeeSystemAccessPanel } from './EmployeeSystemAccessPanel';

const MANAGE = [PERMISSIONS.EMPLOYEE_VIEW, PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS];

function makeAccess(overrides: Partial<EmployeeSystemAccessDto> = {}): EmployeeSystemAccessDto {
  return {
    hasAccount: true,
    userId: 'u9',
    email: 'enkhtur@monhorus.mn',
    fullName: 'Батаа Энхтөр',
    role: 'technician',
    roleIds: ['r-dispatch'],
    roles: [{ id: 'r-dispatch', key: 'DISPATCH', name: 'Диспетчер' }],
    accountStatus: 'active',
    lastLoginAt: '2026-07-01T08:00:00.000Z',
    isSelf: false,
    ...overrides,
  };
}

function makeRole(overrides: Partial<RoleDto> = {}): RoleDto {
  return {
    id: 'r-finance',
    key: 'FINANCE',
    name: 'Санхүү',
    description: null,
    permissions: [],
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderPanel(
  access: EmployeeSystemAccessDto,
  permissions: readonly (typeof MANAGE)[number][] | readonly string[] = MANAGE,
  onChanged: () => void = () => undefined,
): void {
  renderWithAuth(
    <EmployeeSystemAccessPanel employeeId="e1" access={access} onChanged={onChanged} />,
    { permissions: permissions as never },
  );
}

describe('EmployeeSystemAccessPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the linked account state including the role names', () => {
    renderPanel(makeAccess());

    expect(screen.getByText('Холбогдсон')).toBeInTheDocument();
    expect(screen.getByText('enkhtur@monhorus.mn')).toBeInTheDocument();
    expect(screen.getByText('Идэвхтэй')).toBeInTheDocument();
    expect(screen.getByText('Диспетчер')).toBeInTheDocument();
  });

  it('offers no action without employee.manage_system_access', async () => {
    renderPanel(makeAccess(), [PERMISSIONS.EMPLOYEE_VIEW]);

    // Permissions arrive from the stubbed /auth/me, so the assertion waits for the
    // provider to settle before concluding that no control was rendered.
    expect(await screen.findByText('Холбогдсон')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Түр хаах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Хүчингүй болгох' })).not.toBeInTheDocument();
  });

  it('offers account creation when the employee has no login', async () => {
    renderPanel(
      makeAccess({
        hasAccount: false,
        userId: null,
        email: null,
        fullName: null,
        role: null,
        roleIds: [],
        roles: [],
        accountStatus: null,
        lastLoginAt: null,
      }),
    );

    expect(await screen.findByRole('button', { name: 'Нэвтрэх эрх үүсгэх' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Түр хаах' })).not.toBeInTheDocument();
  });

  it('refuses to offer any action on the caller own account', async () => {
    renderPanel(makeAccess({ isSelf: true }));

    expect(
      await screen.findByText('Өөрийн эрхийг энэ дэлгэцээс өөрчлөх боломжгүй.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Түр хаах' })).not.toBeInTheDocument();
  });

  it('suspends the account after confirmation', async () => {
    const suspend = vi
      .spyOn(employeeService, 'suspendSystemAccess')
      .mockResolvedValue(makeAccess({ accountStatus: 'suspended' }));
    const onChanged = vi.fn();

    renderPanel(makeAccess(), MANAGE, onChanged);

    await userEvent.click(await screen.findByRole('button', { name: 'Түр хаах' }));
    await userEvent.click(screen.getByRole('button', { name: 'Тийм, түр хаах' }));

    await waitFor(() => {
      expect(suspend).toHaveBeenCalledWith('e1', {});
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('offers restore instead of suspend for a suspended account', async () => {
    const restore = vi
      .spyOn(employeeService, 'restoreSystemAccess')
      .mockResolvedValue(makeAccess());

    renderPanel(makeAccess({ accountStatus: 'suspended' }));

    const restoreButton = await screen.findByRole('button', { name: 'Сэргээх' });
    expect(screen.queryByRole('button', { name: 'Түр хаах' })).not.toBeInTheDocument();

    await userEvent.click(restoreButton);
    await userEvent.click(screen.getByRole('button', { name: 'Тийм, сэргээх' }));

    await waitFor(() => {
      expect(restore).toHaveBeenCalledWith('e1', {});
    });
  });

  it('revokes the account and passes the typed reason through', async () => {
    const revoke = vi.spyOn(employeeService, 'revokeSystemAccess').mockResolvedValue(
      makeAccess({
        hasAccount: false,
        userId: null,
        email: null,
        roles: [],
        roleIds: [],
        accountStatus: null,
      }),
    );

    renderPanel(makeAccess());

    await userEvent.click(await screen.findByRole('button', { name: 'Хүчингүй болгох' }));
    await userEvent.click(screen.getByRole('button', { name: 'Тийм, хүчингүй болгох' }));

    await waitFor(() => {
      expect(revoke).toHaveBeenCalledWith('e1', {});
    });
  });

  it('changes the assigned roles', async () => {
    vi.spyOn(rbacService, 'roles').mockResolvedValue([
      makeRole(),
      makeRole({ id: 'r-dispatch', key: 'DISPATCH', name: 'Диспетчер' }),
    ]);
    const update = vi
      .spyOn(employeeService, 'updateSystemAccessRoles')
      .mockResolvedValue(makeAccess());

    renderPanel(makeAccess(), [...MANAGE, PERMISSIONS.RBAC_VIEW]);

    await userEvent.click(await screen.findByRole('button', { name: 'Эрх өөрчлөх' }));

    const financeOption = await screen.findByRole('checkbox', { name: /Санхүү/ });
    await userEvent.click(financeOption);
    await userEvent.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('e1', { roleIds: ['r-dispatch', 'r-finance'] });
    });
  });

  it('hides the role editor without rbac.view', async () => {
    renderPanel(makeAccess());

    // The lifecycle controls prove the permission set has arrived; the role editor is
    // still absent because listing the role catalogue needs rbac.view.
    await screen.findByRole('button', { name: 'Түр хаах' });
    expect(screen.queryByRole('button', { name: 'Эрх өөрчлөх' })).not.toBeInTheDocument();
  });

  // -- Passcode reset --------------------------------------------------------
  //
  // The recovery path for an employee who has forgotten their password. The mobile app's
  // own "Нууц үг солих" cannot serve them: it asks for the current password.

  it('resets the passcode of the linked account', async () => {
    const reset = vi.spyOn(userService, 'resetPasscode').mockResolvedValue({
      user: {
        id: 'u9',
        fullName: 'Батаа Энхтөр',
        email: 'enkhtur@monhorus.mn',
        phone: null,
        role: 'technician',
        status: 'must_change_password',
        customerId: null,
        customerName: null,
        lastLoginAt: null,
        createdBy: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
      temporaryPassword: 'Shine.Passcode2026',
    });
    const onChanged = vi.fn();

    renderPanel(makeAccess(), [...MANAGE, PERMISSIONS.USER_MANAGE], onChanged);

    await userEvent.click(await screen.findByRole('button', { name: 'Нууц үг шинэчлэх' }));
    await userEvent.click(screen.getByRole('button', { name: 'Шинэчлэх' }));

    // The passcode itself is generated in the modal, so the assertion pins the account it
    // was sent for rather than the value.
    await waitFor(() => {
      expect(reset).toHaveBeenCalledWith(
        'u9',
        expect.objectContaining({ newPassword: expect.any(String) }),
      );
    });

    // The new passcode is shown once, and the panel re-reads because the account status
    // has just become must_change_password.
    expect(await screen.findByText('Shine.Passcode2026')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalled();
  });

  it('hides the passcode reset without user.manage', async () => {
    renderPanel(makeAccess());

    // Suspend proves the permission set has landed; reset is still absent because the
    // endpoint behind it asks for user.manage, which this caller does not hold.
    await screen.findByRole('button', { name: 'Түр хаах' });
    expect(screen.queryByRole('button', { name: 'Нууц үг шинэчлэх' })).not.toBeInTheDocument();
  });

  it('withholds the passcode reset while the account is suspended', async () => {
    renderPanel(makeAccess({ accountStatus: 'suspended' }), [...MANAGE, PERMISSIONS.USER_MANAGE]);

    // A reset writes must_change_password unconditionally, which would quietly undo the
    // suspension. Restoring is the deliberate step, so it is the only one offered.
    await screen.findByRole('button', { name: 'Сэргээх' });
    expect(screen.queryByRole('button', { name: 'Нууц үг шинэчлэх' })).not.toBeInTheDocument();
  });

  it('offers no passcode reset on the caller own account', async () => {
    renderPanel(makeAccess({ isSelf: true }), [...MANAGE, PERMISSIONS.USER_MANAGE]);

    expect(
      await screen.findByText('Өөрийн эрхийг энэ дэлгэцээс өөрчлөх боломжгүй.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Нууц үг шинэчлэх' })).not.toBeInTheDocument();
  });
});
