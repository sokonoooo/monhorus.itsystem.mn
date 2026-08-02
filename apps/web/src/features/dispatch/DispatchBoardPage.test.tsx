import { PERMISSIONS, type DispatchBoardDto } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { dispatchService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { DispatchBoardPage } from './DispatchBoardPage';

function makeBoard(overrides?: Partial<DispatchBoardDto>): DispatchBoardDto {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    columns: [
      {
        status: 'UNASSIGNED',
        total: 1,
        items: [
          {
            id: 'r1',
            requestNumber: 'SR-202601-0001',
            customer: { id: 'c1', name: 'Central Tower ХХК' },
            project: null,
            building: { id: 'b1', name: 'Main Tower' },
            floor: null,
            room: null,
            device: null,
            requestType: 'URGENT_CALL',
            isUrgent: true,
            status: 'UNASSIGNED',
            assignedEmployees: [],
            assignedTeam: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            slaDueAt: '2026-01-01T06:00:00.000Z',
            slaState: 'STARTED',
            slaRemainingMinutes: 300,
          },
        ],
      },
      { status: 'ASSIGNED', total: 0, items: [] },
    ],
    ...overrides,
  };
}

describe('DispatchBoardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a column per workflow status with its card', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(makeBoard());

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    expect(await screen.findByRole('region', { name: 'Хуваарилагдаагүй' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Хуваарилагдсан' })).toBeInTheDocument();
    expect(screen.getByText('SR-202601-0001')).toBeInTheDocument();
  });

  it('marks an empty column rather than hiding it', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(makeBoard());

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    const assigned = await screen.findByRole('region', { name: 'Хуваарилагдсан' });
    expect(assigned).toHaveTextContent('Хоосон');
  });

  it('shows an empty state when every column is empty', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue({
      generatedAt: '2026-01-01T00:00:00.000Z',
      columns: [{ status: 'UNASSIGNED', total: 0, items: [] }],
    });

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    expect(await screen.findByText('Идэвхтэй хүсэлт байхгүй')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(dispatchService, 'board').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });
});
