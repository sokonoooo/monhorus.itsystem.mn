import {
  PERMISSIONS,
  type DispatchBoardDto,
  type ServiceRequestListItemDto,
} from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { dispatchService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { DispatchBoardPage } from './DispatchBoardPage';

function makeItem(
  overrides: Partial<ServiceRequestListItemDto> & { id: string },
): ServiceRequestListItemDto {
  return {
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
    createdByName: 'Б. Энхтөр',
    slaDueAt: '2026-01-01T06:00:00.000Z',
    slaState: 'STARTED',
    slaRemainingMinutes: 300,
    ...overrides,
  };
}

function makeBoard(overrides?: Partial<DispatchBoardDto>): DispatchBoardDto {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    columns: [
      {
        id: 'OPEN',
        statuses: ['NEW', 'UNASSIGNED'],
        label: 'Хуваарилаагүй',
        total: 2,
        items: [
          // A NEW request: the status every request is created with. It shares the open
          // column with UNASSIGNED and must be assignable exactly like one.
          makeItem({ id: 'r0', requestNumber: 'SR-202601-0000', status: 'NEW' }),
          makeItem({ id: 'r1', requestNumber: 'SR-202601-0001', status: 'UNASSIGNED' }),
        ],
      },
      {
        id: 'ASSIGNED',
        statuses: ['ASSIGNED'],
        label: 'Хуваарилагдсан',
        total: 0,
        items: [],
      },
      {
        id: 'WAITING',
        statuses: ['WAITING'],
        label: 'Түр хүлээгдсэн',
        total: 1,
        items: [
          makeItem({ id: 'r2', requestNumber: 'SR-202601-0002', status: 'WAITING' }),
        ],
      },
    ],
    ...overrides,
  };
}

describe('DispatchBoardPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a column per board column with its cards', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(makeBoard());

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    const open = await screen.findByRole('region', { name: 'Хуваарилаагүй' });
    expect(screen.getByRole('region', { name: 'Хуваарилагдсан' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Түр хүлээгдсэн' })).toBeInTheDocument();

    // Both open statuses land in the one merged column.
    expect(open).toHaveTextContent('SR-202601-0000');
    expect(open).toHaveTextContent('SR-202601-0001');
    expect(screen.getByText('SR-202601-0002')).toBeInTheDocument();
  });

  it('offers assignment on a NEW card in the merged open column', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(makeBoard());

    renderWithAuth(<DispatchBoardPage />, {
      permissions: [PERMISSIONS.DISPATCH_VIEW, PERMISSIONS.DISPATCH_ASSIGN],
    });

    const open = await screen.findByRole('region', { name: 'Хуваарилаагүй' });
    // One per card: the NEW one and the UNASSIGNED one both get the action.
    expect(within(open).getAllByRole('button', { name: 'Хуваарилах' })).toHaveLength(2);
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
      columns: [
        {
          id: 'OPEN',
          statuses: ['NEW', 'UNASSIGNED'],
          label: 'Хуваарилаагүй',
          total: 0,
          items: [],
        },
      ],
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
