import {
  PERMISSIONS,
  type PaginatedData,
  type PermissionKey,
  type ServiceRequestListItemDto,
  type ServiceRequestListQuery,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Read the router the same way the help-coverage suite does, so the route's permission gate
// is asserted against the real declaration rather than against a copy of it here.
import appSource from '../../App.tsx?raw';

import { SubNav } from '../../components/ui/SubNav';
import { SERVICE_REQUEST_TABS } from '../../config/navigation';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { OpenServiceRequestsPage } from './OpenServiceRequestsPage';

const CLAIMER: PermissionKey[] = [PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_CLAIM];

function makeRow(overrides: Partial<ServiceRequestListItemDto> = {}): ServiceRequestListItemDto {
  return {
    id: 'r1',
    requestNumber: 'SR-202608-0001',
    customer: { id: 'c1', name: 'Central Tower ХХК' },
    project: null,
    building: { id: 'b1', name: 'Main Tower' },
    floor: null,
    room: null,
    device: null,
    isUrgent: false,
    status: 'UNASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    createdByName: 'Д. Болор',
    slaDueAt: '2026-08-01T06:00:00.000Z',
    slaState: 'STARTED',
    slaRemainingMinutes: 300,
    ...overrides,
  };
}

function makeEmployee(): ServiceRequestListItemDto['assignedEmployees'][number] {
  return {
    id: 'e1',
    employeeCode: 'EMP-001',
    firstName: 'Энхтөр',
    lastName: 'Б',
    photoUrl: null,
  };
}

function makePage(items: ServiceRequestListItemDto[]): PaginatedData<ServiceRequestListItemDto> {
  return { items, page: 1, limit: 100, total: items.length, totalPages: 1 };
}

/**
 * Answers each status query with only the rows in that status.
 *
 * The page asks once per claimable status, so a mock that returned the same page to both
 * would hand it every row twice — a duplication the server can never produce, since a
 * request has exactly one status.
 */
function mockList(rows: ServiceRequestListItemDto[]) {
  return vi
    .spyOn(serviceRequestService, 'list')
    .mockImplementation((query: ServiceRequestListQuery = {}) =>
      Promise.resolve(makePage(rows.filter((row) => row.status === query.status))),
    );
}

function render(permissions: readonly PermissionKey[] = CLAIMER) {
  return renderWithAuth(<OpenServiceRequestsPage />, {
    permissions,
    route: '/service-requests/open',
  });
}

describe('OpenServiceRequestsPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The definition of "unclaimed", which is the whole point of this screen.
   *
   * All three fixtures sit in a claimable status, so the only thing separating them is the
   * assignment pair the backend filters on. The team-only row is the one that matters: it
   * names no individual, so a page testing `assignedEmployees` alone would show it and offer
   * a button on work that already belongs to a team.
   */
  it('lists only requests with neither an employee nor a team on them', async () => {
    mockList([
      makeRow({ id: 'r1', requestNumber: 'SR-OPEN', status: 'UNASSIGNED' }),
      makeRow({
        id: 'r2',
        requestNumber: 'SR-HAS-EMPLOYEE',
        status: 'UNASSIGNED',
        assignedEmployees: [makeEmployee()],
      }),
      makeRow({
        id: 'r3',
        requestNumber: 'SR-TEAM-ONLY',
        status: 'NEW',
        assignedTeam: { id: 't1', name: 'Баг А' },
      }),
    ]);

    render();

    const table = await screen.findByRole('table', { name: 'Нээлттэй ажил' });
    expect(within(table).getByText('SR-OPEN')).toBeInTheDocument();
    expect(within(table).queryByText('SR-HAS-EMPLOYEE')).not.toBeInTheDocument();
    // A team-assigned request is somebody's work even though it names no individual.
    expect(within(table).queryByText('SR-TEAM-ONLY')).not.toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: 'Өөртөө авах' })).toHaveLength(1);
  });

  it('asks only for the statuses a request can still be claimed in', async () => {
    const list = mockList([makeRow()]);

    render();
    await screen.findByText('SR-202608-0001');

    const statuses = list.mock.calls.map(([query]) => query?.status);
    expect(statuses).toEqual(['NEW', 'UNASSIGNED']);
  });

  it('claims the row that was pressed and re-reads the queue afterwards', async () => {
    const list = mockList([makeRow({ id: 'r1', requestNumber: 'SR-OPEN' })]);
    const claim = vi
      .spyOn(serviceRequestService, 'claim')
      .mockResolvedValue({ requestNumber: 'SR-OPEN' } as never);

    render();
    await screen.findByText('SR-OPEN');
    const readsBeforeClaim = list.mock.calls.length;

    // The queue is empty on the way back: the request has been taken, so it is no longer
    // unclaimed and the server stops returning it.
    list.mockImplementation(() => Promise.resolve(makePage([])));
    await userEvent.click(screen.getByRole('button', { name: 'Өөртөө авах' }));

    expect(claim).toHaveBeenCalledWith('r1');
    expect(claim).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThan(readsBeforeClaim));

    // Named in the toast, and gone from the list.
    expect(await screen.findByText('SR-OPEN ажлыг өөртөө авлаа.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Нээлттэй ажил алга')).toBeInTheDocument());
  });

  /**
   * Losing a race is an outcome, not a bug, and the server is the only party that observed
   * it. Its refusal is shown verbatim rather than restated in words invented here.
   */
  it('shows the server the message when somebody else got there first', async () => {
    mockList([makeRow()]);
    vi.spyOn(serviceRequestService, 'claim').mockRejectedValue(
      new ApiError('Энэ ажлыг өөр ажилтан аль хэдийн авсан байна.', 'DUPLICATE_KEY', 409),
    );

    render();
    await screen.findByText('SR-202608-0001');
    await userEvent.click(screen.getByRole('button', { name: 'Өөртөө авах' }));

    expect(
      await screen.findByText('Энэ ажлыг өөр ажилтан аль хэдийн авсан байна.'),
    ).toBeInTheDocument();
  });

  /**
   * A second click must not be able to race the first. The backend settles concurrent claims
   * atomically and refuses the loser, so a live-looking button during a claim would be
   * inviting a refusal the UI could have prevented.
   */
  it('disables every claim button while one claim is in flight', async () => {
    mockList([
      makeRow({ id: 'r1', requestNumber: 'SR-ONE' }),
      makeRow({ id: 'r2', requestNumber: 'SR-TWO' }),
    ]);
    const claim = vi
      .spyOn(serviceRequestService, 'claim')
      .mockReturnValue(new Promise(() => undefined));

    render();
    await screen.findByText('SR-ONE');

    const buttons = screen.getAllByRole('button', { name: 'Өөртөө авах' });
    expect(buttons).toHaveLength(2);
    await userEvent.click(buttons[0]!);

    await waitFor(() => {
      for (const button of screen.getAllByRole('button', { name: 'Өөртөө авах' })) {
        expect(button).toBeDisabled();
      }
    });

    // The guard is not merely visual: a click that lands anyway must not reach the server.
    await userEvent.click(screen.getAllByRole('button', { name: 'Өөртөө авах' })[1]!);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it('says the queue is clear rather than rendering a bare table', async () => {
    mockList([]);

    render();

    expect(await screen.findByText('Нээлттэй ажил алга')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('surfaces a load failure with a retry action', async () => {
    vi.spyOn(serviceRequestService, 'list').mockRejectedValue(
      new ApiError('Сервер алдаа', 'INTERNAL_ERROR', 500),
    );

    render();

    expect(await screen.findByText('Сервер алдаа')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
  });
});

/**
 * Who can reach the screen at all.
 *
 * The page and its single action are gated on the same key the endpoint enforces, so a
 * caller without `service_request.claim` meets neither: the route refuses them, and the tab
 * that would take them there is not drawn.
 */
describe('open queue access', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('gates the route on service_request.claim in the router itself', () => {
    const route = /path="\/service-requests\/open"[\s\S]{0,220}?<\/Page>/.exec(appSource);

    expect(route).not.toBeNull();
    expect(route?.[0]).toContain('PERMISSIONS.SERVICE_REQUEST_CLAIM');
    expect(route?.[0]).toContain('<OpenServiceRequestsPage />');
  });

  it('offers the tab to a caller who may claim', async () => {
    renderWithAuth(<SubNav items={SERVICE_REQUEST_TABS} />, {
      permissions: CLAIMER,
      route: '/service-requests',
    });

    // Awaited, because the provider resolves the session before it knows any permission.
    const nav = await screen.findByRole('navigation', { name: 'Дэд цэс' });
    expect(within(nav).getByRole('link', { name: 'Нээлттэй ажил' })).toHaveAttribute(
      'href',
      '/service-requests/open',
    );
  });

  /**
   * Paired with a second permitted tab on purpose. SubNav draws nothing at all when only one
   * tab survives the filter, so a caller holding `service_request.view` alone would pass this
   * assertion whether the gate worked or not; giving them the dispatch tab as well makes the
   * nav render, and the absence of this one tab a real result.
   */
  it('hides the tab from a caller who may view requests but not claim', async () => {
    renderWithAuth(<SubNav items={SERVICE_REQUEST_TABS} />, {
      permissions: [PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.DISPATCH_VIEW],
      route: '/service-requests',
    });

    const nav = await screen.findByRole('navigation', { name: 'Дэд цэс' });
    expect(within(nav).getByRole('link', { name: 'Хүсэлтийн жагсаалт' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Нээлттэй ажил' })).not.toBeInTheDocument();
  });
});
