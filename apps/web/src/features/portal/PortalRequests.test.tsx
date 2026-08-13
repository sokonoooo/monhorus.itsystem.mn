import { PERMISSIONS, type ObjectListItemDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { portalService } from '../../services/portal.service';
import { dispatchService } from '../../services/service-request.service';
import { makePage, makeServiceRequest } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { planMarkerObjects, unplacedOnPlanCount } from './PortalFloorPlan';
import { PortalRequestCreatePage } from './PortalRequestCreatePage';
import { PlannedWorkFormPage } from '../planned-work/PlannedWorkFormPage';
import { PortalPlannedWorkDetailPage } from './PortalPlannedWorkDetailPage';
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

function renderPortal(
  ui: Parameters<typeof renderWithAuth>[0],
  route: string,
  /** Required for a screen that reads `useParams` — without a matched route it gets none. */
  path?: string,
) {
  return renderWithAuth(ui, {
    permissions: PORTAL_PERMISSIONS,
    role: 'customer',
    user: CUSTOMER_IDENTITY,
    route,
    ...(path ? { path } : {}),
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

describe('raising planned work from the portal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portalService, 'listProjects').mockResolvedValue(makePage([]));
    vi.spyOn(portalService, 'listBuildingsIn').mockResolvedValue(
      makePage([{ id: BUILDING_ID, name: 'Төв барилга' } as never]),
    );
  });

  /**
   * The customer is told what will happen before they submit, because "you asked, nobody is
   * on it yet" is the whole difference between this and a service request.
   */
  it('says the request waits for approval before anyone is assigned', async () => {
    renderPortal(<PlannedWorkFormPage variant="portal" />, '/portal/planned-work/new');

    expect(
      await screen.findByText(/«Хүлээгдэж буй» төлөвтэй бүртгэгдэнэ/),
    ).toBeInTheDocument();
    expect(screen.getByText(/баталсны дараа ажилтан томилогдоно/)).toBeInTheDocument();
  });

  /** No crew field at all — the server forces it empty, and offering one would be a lie. */
  it('offers the customer no way to name a crew', async () => {
    renderPortal(<PlannedWorkFormPage variant="portal" />, '/portal/planned-work/new');

    await screen.findByLabelText(/^Ажлын нэр/);
    expect(screen.queryByText(/Хариуцах ажилтан/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Баг/)).not.toBeInTheDocument();
    // The organisation is implicit, so there is nothing to pick and no customer list to leak.
    expect(screen.queryByLabelText(/^Харилцагч/)).not.toBeInTheDocument();
  });

  /**
   * THE REASON THE FORM TAKES A VARIANT RATHER THAN BEING RENDERED AS-IS. The staff form
   * fills its dropdowns from `/objects/customers`, `/objects/nodes` and
   * `/dispatch/employee-candidates`, behind `customer.view`, `object.view` and
   * `dispatch.view`. A customer holds none of the three, so calling them would 403 — and if
   * they ever stopped 403-ing, the roster of every employee would be sitting in a customer's
   * browser. The portal variant must reach none of them.
   */
  it('reaches none of the staff-only reference endpoints', async () => {
    const customers = vi.spyOn(objectService, 'customers').mockResolvedValue([]);
    const nodes = vi.spyOn(objectService, 'rootNodes').mockResolvedValue([]);
    const children = vi.spyOn(objectService, 'children').mockResolvedValue([]);
    const roster = vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);

    renderPortal(<PlannedWorkFormPage variant="portal" />, '/portal/planned-work/new');

    await screen.findByLabelText(/^Ажлын нэр/);
    expect(customers).not.toHaveBeenCalled();
    expect(nodes).not.toHaveBeenCalled();
    expect(children).not.toHaveBeenCalled();
    expect(roster).not.toHaveBeenCalled();
  });

  it('posts a real planned work with an empty crew', async () => {
    const create = vi
      .spyOn(portalService, 'createPlannedWork')
      .mockResolvedValue({ id: 'w1', workNumber: 'PW-202609-0001' } as never);

    const user = userEvent.setup();
    renderPortal(<PlannedWorkFormPage variant="portal" />, '/portal/planned-work/new');

    await user.selectOptions(await screen.findByLabelText(/^Барилга/), BUILDING_ID);
    await user.type(screen.getByLabelText(/^Ажлын нэр/), 'Улирлын үзлэг');
    await user.type(screen.getByLabelText(/^Эхлэх огноо/), '2026-09-01');
    await user.type(screen.getByLabelText(/^Дуусах огноо/), '2026-09-03');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          buildingId: BUILDING_ID,
          title: 'Улирлын үзлэг',
          assignedEmployeeIds: [],
        }),
      );
    });
  });
});

describe('following planned work in the portal', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('tells a pending work that it is waiting on an approver', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue({
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'PENDING_APPROVAL',
      effectiveStatus: 'PENDING_APPROVAL',
      building: { id: BUILDING_ID, name: 'Төв барилга' },
      project: null,
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-03T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      description: null,
      cancelReason: null,
    } as never);

    renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );

    expect(await screen.findByText('Батлахыг хүлээж байна')).toBeInTheDocument();
    expect(screen.getByText(/батлагдсаны дараа гүйцэтгэх ажилтан томилогдож/)).toBeInTheDocument();
  });

  it('shows the reason when an approver refused it', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue({
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'CANCELLED',
      effectiveStatus: 'CANCELLED',
      building: { id: BUILDING_ID, name: 'Төв барилга' },
      project: null,
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-03T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      description: null,
      cancelReason: 'Тухайн хугацаанд боломжгүй.',
    } as never);

    renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );

    // The label appears twice by design — once as the alert heading, once on the status
    // badge — so the reason is what this asserts on, and the label only as a pair.
    expect(await screen.findAllByText('Цуцлагдсан')).toHaveLength(2);
    expect(screen.getByText('Тухайн хугацаанд боломжгүй.')).toBeInTheDocument();
  });

  /**
   * The customer detail mirrors the staff one — progress, floor grouping, sub-tasks — and
   * must not carry the people. `PlannedWorkTaskDto` has `assignedEmployeeName` on it, so
   * the omission is a rendering decision and therefore worth pinning.
   */
  it('shows the work breakdown by floor without naming anybody', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue({
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'STARTED',
      effectiveStatus: 'STARTED',
      building: { id: BUILDING_ID, name: 'Төв барилга' },
      project: null,
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-03T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      description: null,
      cancelReason: null,
      completedLate: false,
      delayMinutes: null,
      progressPercent: 60,
      completedQuantity: 6,
      totalQuantity: 10,
      floorProgress: [
        {
          floorId: 'f1',
          floorName: '2-р давхар',
          taskCount: 1,
          totalQuantity: 10,
          completedQuantity: 6,
          remainingQuantity: 4,
          progressPercent: 60,
        },
      ],
      tasks: [
        {
          id: 't1',
          plannedWorkId: 'w1',
          floorId: 'f1',
          floorName: '2-р давхар',
          title: 'Самбарын үзлэг',
          status: 'IN_PROGRESS',
          unit: 'PIECE',
          totalQuantity: 10,
          completedQuantity: 6,
          remainingQuantity: 4,
          progressPercent: 60,
          plannedStartDate: '2026-09-01T00:00:00.000Z',
          plannedEndDate: '2026-09-03T00:00:00.000Z',
          assignedEmployeeName: 'Бат Дорж',
          conclusionByName: 'Ням Цэрэн',
          relatedObjects: [],
          beforePhotos: [],
          afterPhotos: [],
          missingEvidence: [],
        },
      ],
    } as never);

    renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );

    // The breakdown is there …
    expect(await screen.findByText('2-р давхар')).toBeInTheDocument();
    expect(screen.getByText('Самбарын үзлэг')).toBeInTheDocument();
    expect(screen.getByText('1 дэд ажил')).toBeInTheDocument();

    // … and nobody is named on it.
    expect(screen.queryByText('Бат Дорж')).not.toBeInTheDocument();
    expect(screen.queryByText('Ням Цэрэн')).not.toBeInTheDocument();
    expect(screen.queryByText(/Хариуцагч/)).not.toBeInTheDocument();
  });

  /**
   * Read-only by construction: every planned-work write is keyed on a `planned_work.*`
   * permission no customer holds, so an edit control here would be an offer the server
   * refuses. Asserted rather than assumed, because the admin page this mirrors has them.
   */
  it('offers no way to change the work, and hides an unapproved report', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue({
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'STARTED',
      effectiveStatus: 'STARTED',
      building: { id: BUILDING_ID, name: 'Төв барилга' },
      project: null,
      plannedStartDate: '2026-09-01T00:00:00.000Z',
      plannedEndDate: '2026-09-03T00:00:00.000Z',
      createdAt: '2026-08-20T00:00:00.000Z',
      description: null,
      cancelReason: null,
      progressPercent: 0,
      completedQuantity: 0,
      totalQuantity: 0,
      tasks: [],
      floorProgress: [],
      materials: [{ name: 'Автомат таслуур', quantity: 2, unit: 'PIECE' }],
      // Submitted but NOT approved: the customer must not read it yet.
      report: { status: 'SUBMITTED', visibleToCustomer: false, conclusion: 'Дотоод бичвэр', recommendation: null },
    } as never);

    renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );

    // Materials are visible …
    expect(await screen.findByText('Автомат таслуур')).toBeInTheDocument();
    // … the unapproved conclusion is not …
    expect(screen.queryByText('Дотоод бичвэр')).not.toBeInTheDocument();
    expect(screen.getByText(/тайлан батлагдсаны дараа энд харагдана/i)).toBeInTheDocument();
    // … and nothing offers to change the work.
    for (const label of [/Засах/, /Хугацаа сунгах/, /Дэд ажил нэмэх/, /Материал засах/, /Цуцлах/]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
  });
});
