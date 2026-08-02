import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithAuth } from '../test/render';
import { PermissionGuard } from './PermissionGuard';

describe('PermissionGuard', () => {
  it('renders children when the permission is held', async () => {
    renderWithAuth(
      <PermissionGuard anyOf={[PERMISSIONS.EMPLOYEE_VIEW]}>
        <p>Нууц агуулга</p>
      </PermissionGuard>,
      { permissions: [PERMISSIONS.EMPLOYEE_VIEW] },
    );

    expect(await screen.findByText('Нууц агуулга')).toBeInTheDocument();
  });

  it('renders the forbidden panel when the permission is missing', async () => {
    renderWithAuth(
      <PermissionGuard anyOf={[PERMISSIONS.EMPLOYEE_VIEW_SALARY]}>
        <p>Цалингийн мэдээлэл</p>
      </PermissionGuard>,
      { permissions: [PERMISSIONS.EMPLOYEE_VIEW] },
    );

    expect(await screen.findByText('Хандах эрхгүй')).toBeInTheDocument();
    expect(screen.queryByText('Цалингийн мэдээлэл')).not.toBeInTheDocument();
  });

  it('renders nothing in silent mode when the permission is missing', async () => {
    renderWithAuth(
      <PermissionGuard anyOf={[PERMISSIONS.EMPLOYEE_VIEW_SALARY]} silent>
        <p>Далд товч</p>
      </PermissionGuard>,
      { permissions: [] },
    );

    await waitFor(() => {
      expect(screen.queryByText('Далд товч')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Хандах эрхгүй')).not.toBeInTheDocument();
  });

  it('allows any authenticated user when the list is empty', async () => {
    renderWithAuth(
      <PermissionGuard anyOf={[]}>
        <p>Нээлттэй агуулга</p>
      </PermissionGuard>,
      { permissions: [] },
    );

    expect(await screen.findByText('Нээлттэй агуулга')).toBeInTheDocument();
  });
});
