import {
  DEFAULT_SERVICE_REQUEST_STAGES,
  PERMISSIONS,
  type PaginatedData,
  type ServiceRequestListItemDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRequestStages } from '../../hooks/use-request-stages';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';
import { vocabularyService } from '../../services/vocabulary.service';
import { makeVocabulary } from '../../test/fixtures';
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

function makePage(items: ServiceRequestListItemDto[]): PaginatedData<ServiceRequestListItemDto> {
  return { items, page: 1, limit: 20, total: items.length, totalPages: 1 };
}

describe('ServiceRequestListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The stage list is cached for the page's lifetime, which spans test cases here.
    invalidateRequestStages();
    vi.spyOn(vocabularyService, 'get').mockResolvedValue(makeVocabulary());
  });

  it('shows a loading state before data arrives', () => {
    vi.spyOn(serviceRequestService, 'list').mockReturnValue(new Promise(() => undefined));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    expect(screen.getByRole('status', { name: 'Ачааллаж байна' })).toBeInTheDocument();
  });

  it('renders request rows with SLA but no urgency column', async () => {
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

    // Urgency is derived from the equipment type's SLA window rather than chosen, and is
    // no longer shown: the fixture row is urgent, so a surviving badge would show here.
    expect(headers).not.toContain('Яаралтай');
    expect(within(table).queryByText('Яаралтай')).not.toBeInTheDocument();
    // "Хуваарилагдаагүй" appears both as the status badge and as the assignee
    // placeholder, so assert on the count rather than a single match.
    expect(within(table).getAllByText('Хуваарилагдаагүй')).toHaveLength(2);
    expect(within(row).getAllByRole('cell')[headers.indexOf('Давхар')]).toHaveTextContent(
      '2-р давхар',
    );
    // Countdown is derived from the backend deadline, five hours remaining.
    expect(within(table).getByText(/5ц 0м/)).toBeInTheDocument();
  });

  /**
   * Row numbers only mean something if they are continuous: asked to "check request 21",
   * a reader must find it as row 21 on page two, not as row 1 all over again.
   */
  it('numbers page two from 21 rather than restarting at 1', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue({
      ...makePage([makeRow()]),
      page: 2,
      total: 21,
      totalPages: 2,
    });

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: '/service-requests?page=2',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^21$/);
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

  /**
   * The badge says what the ADMINISTRATOR calls this step, not what the engine calls it.
   *
   * `UNASSIGNED` is «Хуваарилагдаагүй» in the shared status vocabulary and «Нээлттэй» once
   * it is grouped, so a row carrying a stage proves the stage won.
   */
  it('paints the stage the server resolved rather than the raw status', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(
      makePage([makeRow({ stage: { key: 'OPEN', label: 'Нээлттэй', colour: 'grey' } })]),
    );

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Нээлттэй')).toBeInTheDocument();
    // Still present once, as the assignee placeholder — never as the status badge.
    expect(within(table).getAllByText('Хуваарилагдаагүй')).toHaveLength(1);
  });

  /**
   * Nine steps the business recognises, not fourteen engine statuses. `ON_SITE` («Очсон»)
   * and `IN_PROGRESS` are one step of a job and were two entries in the old dropdown, so
   * the absence of «Очсон» is what makes the grouping visible.
   */
  it('offers the configured stages in the filter, not the raw statuses', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    const select = await screen.findByLabelText('Төлөв');
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(
        DEFAULT_SERVICE_REQUEST_STAGES.length + 1,
      );
    });

    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toContain('Гүйцэтгэж байна');
    expect(options).not.toContain('Очсон');
  });

  it('filters by stage key, which the server expands to that stage statuses', async () => {
    const list = vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));

    const user = userEvent.setup();
    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    const select = await screen.findByLabelText('Төлөв');
    await waitFor(() => {
      expect(within(select).getAllByRole('option').length).toBeGreaterThan(1);
    });
    await user.selectOptions(select, 'IN_PROGRESS');

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ stage: 'IN_PROGRESS', page: 1, limit: 20 }),
      );
    });
    // The exact status is the narrower filter server-side, so sending both would ignore
    // the stage just chosen.
    expect(list.mock.calls.at(-1)?.[0]).not.toHaveProperty('status');
  });

  /**
   * A stage the administrator hid is hidden from the picker, not from the data. Filters are
   * where `hidden` has to be honoured, since a hidden stage still owns live requests.
   */
  it('leaves a hidden stage out of the filter', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));
    vi.spyOn(vocabularyService, 'get').mockResolvedValue(
      makeVocabulary({
        stages: DEFAULT_SERVICE_REQUEST_STAGES.map((stage) =>
          stage.key === 'CANCELLED' ? { ...stage, hidden: true } : stage,
        ),
      }),
    );

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    const select = await screen.findByLabelText('Төлөв');
    await waitFor(() => {
      expect(within(select).getAllByRole('option')).toHaveLength(
        DEFAULT_SERVICE_REQUEST_STAGES.length,
      );
    });
    expect(within(select).queryByRole('option', { name: 'Цуцалсан' })).not.toBeInTheDocument();
  });

  /**
   * A link from before stages still filters. `status` was in the URL for a year of saved
   * links, and the server keeps honouring it as the narrower of the two.
   */
  it('still sends a status that arrived in the URL', async () => {
    const list = vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
      route: '/service-requests?status=WAITING',
    });

    await waitFor(() => {
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: 'WAITING' }));
    });
  });

  /**
   * An offline or failed vocabulary read must not leave the dropdown empty: there would be
   * no way to narrow the list at all, and the shipped keys are the ones the server expands
   * anyway. A stale LABEL is cosmetic where a stale THRESHOLD would not be — see the note in
   * `use-request-stages.ts`.
   */
  it('falls back to the shipped stages when the vocabulary cannot be read', async () => {
    vi.spyOn(serviceRequestService, 'list').mockResolvedValue(makePage([makeRow()]));
    vi.spyOn(vocabularyService, 'get').mockRejectedValue(
      new ApiError('Сүлжээний алдаа', 'NETWORK', 503),
    );

    renderWithAuth(<ServiceRequestListPage />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW],
    });

    const select = await screen.findByLabelText('Төлөв');
    expect(within(select).getAllByRole('option')).toHaveLength(
      DEFAULT_SERVICE_REQUEST_STAGES.length + 1,
    );
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
