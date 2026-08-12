import { PERMISSIONS, type ObjectListItemDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { makePage, makeServiceRequest } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { planMarkerObjects, unplacedOnPlanCount } from './PortalFloorPlan';
import { PortalRequestCreatePage } from './PortalRequestCreatePage';
import { PortalRequestListPage } from './PortalRequestListPage';

const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const BUILDING_ID = '507f1f77bcf86cd799439021';
const REQUEST_ID = '507f1f77bcf86cd799439061';

const PORTAL_PERMISSIONS = [
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
] as const;

const CUSTOMER_IDENTITY = {
  customerId: CUSTOMER_ID,
  customerName: 'Central Tower ХХК',
  fullName: 'Д. Болор',
  phone: '99112233',
};

function renderPortal(ui: Parameters<typeof renderWithAuth>[0], route: string) {
  return renderWithAuth(ui, {
    permissions: PORTAL_PERMISSIONS,
    role: 'customer',
    user: CUSTOMER_IDENTITY,
    route,
  });
}

function makeObject(overrides: Partial<ObjectListItemDto> = {}): ObjectListItemDto {
  return {
    id: 'o1',
    code: 'DB-01',
    name: 'Түгээх самбар',
    category: 'PANEL',
    objectType: {
      id: 't1',
      code: 'DB',
      name: 'Түгээх самбар',
      icon: 'PANEL',
      iconUrl: null,
      showOnPlan: true,
    },
    customerId: CUSTOMER_ID,
    customerName: 'Central Tower ХХК',
    floorId: 'f1',
    floorName: '2-р давхар',
    buildingName: 'Төв барилга',
    planPosition: { x: 0.5, y: 0.5 },
    latestAssessment: null,
    ...overrides,
  } as ObjectListItemDto;
}

describe('PortalRequestListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lists the customer own requests', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue(
      makePage([makeServiceRequest({ id: REQUEST_ID, requestNumber: 'SR-202608-0001' })]),
    );

    renderPortal(<PortalRequestListPage />, '/portal/requests');

    // Scoped to the table: every status label also appears as a filter option.
    const table = await screen.findByRole('table');
    expect(within(table).getByText('SR-202608-0001')).toBeInTheDocument();
  });

  /**
   * The staff list answers "who inside this company is on it". That is the reason this
   * screen exists rather than a flag on the staff one, so it is asserted, not assumed.
   */
  it('never shows who inside the company is working on it', async () => {
    vi.spyOn(portalService, 'listRequests').mockResolvedValue(
      makePage([
        makeServiceRequest({
          id: REQUEST_ID,
          assignedEmployees: [
            { id: 'e1', employeeCode: 'E-001', firstName: 'Дорж', lastName: 'Бат' },
          ] as never,
          assignedTeam: { id: 't1', name: 'Баг 1' },
        }),
      ]),
    );

    renderPortal(<PortalRequestListPage />, '/portal/requests');

    const table = await screen.findByRole('table');
    expect(within(table).queryByText('E-001')).not.toBeInTheDocument();
    expect(within(table).queryByText('Баг 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Dispatch board')).not.toBeInTheDocument();
  });

  it('offers a retry when the list fails rather than reading as empty', async () => {
    vi.spyOn(portalService, 'listRequests').mockRejectedValue(
      new ApiError('Сервер алдаа.', 'INTERNAL', 500, []),
    );

    renderPortal(<PortalRequestListPage />, '/portal/requests');

    expect(await screen.findByText('Сервер алдаа.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дахин оролдох' })).toBeInTheDocument();
    expect(screen.queryByText('Хүсэлт олдсонгүй')).not.toBeInTheDocument();
  });
});

describe('requesting scheduled maintenance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portalService, 'listProjects').mockResolvedValue(makePage([]));
    vi.spyOn(portalService, 'listBuildingsIn').mockResolvedValue(
      makePage([{ id: BUILDING_ID, name: 'Төв барилга' } as never]),
    );
    vi.spyOn(portalService, 'listFloors').mockResolvedValue(makePage([]));
  });

  /**
   * Scheduled maintenance is an existing REQUEST TYPE, not a new endpoint or status. This
   * is the whole mechanism, so it is pinned.
   */
  it('offers Төлөвлөгөөт үзлэг as a request type', async () => {
    renderPortal(<PortalRequestCreatePage />, '/portal/requests/new');

    const typeSelect = await screen.findByLabelText(/^Төрөл/);
    expect(within(typeSelect).getByRole('option', { name: 'Төлөвлөгөөт үзлэг' })).toBeInTheDocument();
  });

  it('prefills the type from the link so it is one click from the home page', async () => {
    renderPortal(<PortalRequestCreatePage />, '/portal/requests/new?type=PLANNED_INSPECTION');

    const typeSelect = await screen.findByLabelText(/^Төрөл/);
    expect(typeSelect).toHaveValue('PLANNED_INSPECTION');
    // And says plainly that a person has to accept it before anyone is assigned.
    expect(screen.getByText(/Хүлээн авч баталсны дараа ажилтан хуваарилагдаж/)).toBeInTheDocument();
  });

  it('submits it as an ordinary service request owned by the caller organisation', async () => {
    const create = vi
      .spyOn(portalService, 'createRequest')
      .mockResolvedValue({ id: REQUEST_ID, requestNumber: 'SR-202608-0002' } as never);

    const user = userEvent.setup();
    renderPortal(<PortalRequestCreatePage />, '/portal/requests/new?type=PLANNED_INSPECTION');

    await user.selectOptions(await screen.findByLabelText(/^Барилга/), BUILDING_ID);
    await user.type(screen.getByLabelText(/^Тайлбар/), 'Улирлын урьдчилан сэргийлэх үзлэг.');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: CUSTOMER_ID,
          buildingId: BUILDING_ID,
          requestType: 'PLANNED_INSPECTION',
        }),
      );
    });
  });

  /**
   * The staff form opens with a select of every customer organisation, behind a staff key
   * this caller does not hold. Asking the question at all would be a disclosure.
   */
  it('never asks the customer which organisation they belong to', async () => {
    renderPortal(<PortalRequestCreatePage />, '/portal/requests/new');

    expect(await screen.findByText('Байршил')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Харилцагч/)).not.toBeInTheDocument();
  });

  it('refuses to submit when the account is linked to no organisation', async () => {
    const create = vi.spyOn(portalService, 'createRequest');

    const user = userEvent.setup();
    renderWithAuth(<PortalRequestCreatePage />, {
      permissions: PORTAL_PERMISSIONS,
      role: 'customer',
      user: { customerId: null, customerName: null },
      route: '/portal/requests/new',
    });

    await screen.findByText('Байршил');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    expect(
      await screen.findByText(/Таны бүртгэл байгууллагад холбогдоогүй байна/),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('floor plan marker rules', () => {
  it('draws only equipment that is placed and meant to be shown', () => {
    const drawn = makeObject({ id: 'drawn' });
    const notOnPlanType = makeObject({
      id: 'hidden-type',
      objectType: { ...makeObject().objectType!, showOnPlan: false },
    });
    const unplaced = makeObject({ id: 'unplaced', planPosition: null });

    const markers = planMarkerObjects([drawn, notOnPlanType, unplaced]);

    expect(markers.map((object) => object.id)).toEqual(['drawn']);
    // Only the one that SHOULD be on the plan and is not counts as unplaced.
    expect(unplacedOnPlanCount([drawn, notOnPlanType, unplaced])).toBe(1);
  });

  /**
   * A dot clamped to the border is indistinguishable from a real placement there, so an
   * impossible coordinate is skipped and reported as unplaced instead.
   */
  it('skips a coordinate that is not on the drawing at all', () => {
    const offPlan = makeObject({ id: 'off', planPosition: { x: 1.4, y: 0.2 } });
    const notANumber = makeObject({ id: 'nan', planPosition: { x: Number.NaN, y: 0.2 } });

    expect(planMarkerObjects([offPlan, notANumber])).toHaveLength(0);
    expect(unplacedOnPlanCount([offPlan, notANumber])).toBe(2);
  });

  /** Overlap is normal on a dense floor, and the marker a reader must not lose is the red one. */
  it('paints the worst band last so it wins an overlap', () => {
    const normal = makeObject({
      id: 'normal',
      latestAssessment: { riskLevel: 'NORMAL' } as never,
    });
    const critical = makeObject({
      id: 'critical',
      latestAssessment: { riskLevel: 'CRITICAL' } as never,
    });
    const unassessed = makeObject({ id: 'unassessed' });

    const order = planMarkerObjects([critical, unassessed, normal]).map((object) => object.id);

    expect(order).toEqual(['unassessed', 'normal', 'critical']);
  });
});
