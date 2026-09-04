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
        colour: 'grey',
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

  /**
   * The column wears the stage's own colour, sent with the column rather than derived here.
   * A board that picked its own would drift from the badge on the same request in the list
   * the moment an administrator recoloured a stage.
   *
   * A column with no colour gets no marker at all: inventing one would state a grouping
   * the server did not send.
   */
  it('marks a column with the stage colour the server sent, and only then', async () => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(makeBoard());

    renderWithAuth(<DispatchBoardPage />, { permissions: [PERMISSIONS.DISPATCH_VIEW] });

    const open = await screen.findByRole('region', { name: 'Хуваарилаагүй' });
    expect(open.querySelector('span[aria-hidden].bg-slate-400')).toBeInTheDocument();

    const assigned = screen.getByRole('region', { name: 'Хуваарилагдсан' });
    expect(assigned.querySelector('span[aria-hidden]')).not.toBeInTheDocument();
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

/**
 * WHO CAN STILL BE HANDED OVER.
 *
 * The board used to gate its Assign control on a six-status whitelist that stopped at
 * ACCEPTED, while `assignServiceRequest` refuses exactly two statuses: COMPLETED and
 * CANCELLED. Everything between the two — a technician who is on the way, on site, midway
 * through the work, blocked, or whose write-up is with the office — had no Assign control
 * on the board and none on the detail page either. A technician calling in sick at eleven
 * o'clock could not be replaced from anywhere in the product.
 *
 * These pin the line where the server draws it, in both directions: an in-flight job is
 * reassignable, and a settled one is not.
 */
describe('DispatchBoardPage - handing work over mid-job', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /** One column per status, so each assertion names the status it is about. */
  function boardOf(statuses: readonly ServiceRequestListItemDto['status'][]): DispatchBoardDto {
    return {
      generatedAt: '2026-01-01T00:00:00.000Z',
      columns: statuses.map((status, index) => ({
        id: status,
        statuses: [status],
        label: status,
        total: 1,
        items: [
          makeItem({
            id: `r${index}`,
            requestNumber: `SR-202601-000${index}`,
            status,
            // Already crewed: the control on an in-flight job is a HANDOVER, and it has to
            // say so rather than reading as a first assignment.
            assignedEmployees: [
              { id: 'e1', firstName: 'Дорж', lastName: 'Б', employeeCode: 'EMP-001', photoUrl: null },
            ],
          }),
        ],
      })),
    } as DispatchBoardDto;
  }

  const IN_FLIGHT = [
    'ON_THE_WAY',
    'ON_SITE',
    'IN_PROGRESS',
    'WAITING',
    'REPORT_SUBMITTED',
    'VERIFICATION',
  ] as const;

  it.each(IN_FLIGHT)('offers a handover on a %s card', async (status) => {
    vi.spyOn(dispatchService, 'board').mockResolvedValue(boardOf([status]));

    renderWithAuth(<DispatchBoardPage />, {
      permissions: [PERMISSIONS.DISPATCH_VIEW, PERMISSIONS.DISPATCH_ASSIGN],
    });

    const column = await screen.findByRole('region', { name: status });
    expect(
      within(column).getByRole('button', { name: 'Дахин хуваарилах' }),
    ).toBeInTheDocument();
  });

  /** The two the server itself refuses. Offering either would be an action that 400s. */
  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'offers no assignment on a %s card',
    async (status) => {
      vi.spyOn(dispatchService, 'board').mockResolvedValue(boardOf([status]));

      renderWithAuth(<DispatchBoardPage />, {
        permissions: [PERMISSIONS.DISPATCH_VIEW, PERMISSIONS.DISPATCH_ASSIGN],
      });

      const column = await screen.findByRole('region', { name: status });
      expect(
        within(column).queryByRole('button', { name: /хуваарилах/i }),
      ).not.toBeInTheDocument();
    },
  );
});
