import {
  PERMISSIONS,
  type PaginatedData,
  type ServiceRequestListItemDto,
} from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { ServiceRequestListPage } from './ServiceRequestListPage';

function makeRow(overrides: Partial<ServiceRequestListItemDto> = {}): ServiceRequestListItemDto {
  return {
    id: 'r1',
    requestNumber: 'SR-202601-0001',
    customer: { id: 'c1', name: 'Central Tower ХХК' },
    project: null,
    building: { id: 'b1', name: 'Main Tower' },
    floor: { id: 'f1', name: '2-р давхар' },
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
    ...overrides,
  };
}

function makePage(items: ServiceRequestListItemDto[]): PaginatedData<ServiceRequestListItemDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

describe('ServiceRequestListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(serviceRequestService, 'list').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders request rows with urgency and SLA', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    expect(await screen.findByText('SR-202601-0001')).toBeInTheDocument();
    const table = screen.getByRole('table');
    const row = within(table).getAllByRole('row')[1]!;
    const headers = within(table)
      .getAllByRole('columnheader')
      .map((header) => header.textContent);

    expect(within(row).getAllByRole('cell')[headers.indexOf('Яаралтай')]).toHaveTextContent(
      'Яаралтай',
    );
    // "Хуваарилагдаагүй" appears both as the status badge and as the assignee
    // placeholder, so assert on the count rather than a single match.
    expect(within(table).getAllByText('Хуваарилагдаагүй')).toHaveLength(2);
    expect(within(row).getAllByRole('cell')[headers.indexOf('Давхар')]).toHaveTextContent(
      '2-р давхар',
    );
    // Countdown is derived from the backend deadline, five hours remaining.
    expect(within(table).getByText(/5ц 0м/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    expect(await screen.findByText('Хүсэлт олдсонгүй')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', async () => {
    vi.spyOn(serviceRequestService, 'list').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });

  it('hides the create action without service_request.create', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    await screen.findByText('SR-202601-0001');
    expect(screen.queryByRole('button', { name: 'Шинэ хүсэлт' })).not.toBeInTheDocument();
  });
});
