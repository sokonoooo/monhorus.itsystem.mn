import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { makeCustomer, makeObjectNode } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ObjectsPage } from './ObjectsPage';

const CUSTOMER = makeCustomer({ id: 'c1' });

const PROJECT = makeObjectNode({ id: 'p1', customerId: 'c1' });

describe('ObjectsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'rootNodes').mockResolvedValue([PROJECT]);
    vi.spyOn(objectService, 'children').mockResolvedValue([]);
  });

  it('prompts for a customer before loading any hierarchy', async () => {
    vi.spyOn(objectService, 'customers').mockResolvedValue([CUSTOMER]);

    renderWithAuth(<ObjectsPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    expect(await screen.findByText('Харилцагч сонгогдоогүй')).toBeInTheDocument();
    // The tree is loaded level by level, never up front.
    expect(objectService.rootNodes).not.toHaveBeenCalled();
  });

  it('loads the first level after a customer is selected', async () => {
    vi.spyOn(objectService, 'customers').mockResolvedValue([CUSTOMER]);
    const user = userEvent.setup();

    renderWithAuth(<ObjectsPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    await user.click(await screen.findByRole('button', { name: 'Central Tower ХХК' }));

    await waitFor(() => {
      expect(objectService.rootNodes).toHaveBeenCalledWith('c1', 'PROJECT');
    });
    expect(await screen.findByText('Preventive Service')).toBeInTheDocument();
  });

  it('shows an empty customer list without inventing rows', async () => {
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);

    renderWithAuth(<ObjectsPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    expect(await screen.findByText('Харилцагч олдсонгүй.')).toBeInTheDocument();
  });

  it('reports a customer load failure', async () => {
    vi.spyOn(objectService, 'customers').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<ObjectsPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
  });
});
