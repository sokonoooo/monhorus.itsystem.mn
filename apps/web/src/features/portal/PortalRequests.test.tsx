import { PERMISSIONS, type ObjectListItemDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { portalService } from '../../services/portal.service';
import { dispatchService, serviceRequestService } from '../../services/service-request.service';
import {
  makeBuilding,
  makeFloor,
  makeObjectListItem,
  makePage,
  makeServiceRequest,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { planMarkerObjects, unplacedOnPlanCount } from './PortalFloorPlan';
import { PortalRequestCreatePage } from './PortalRequestCreatePage';
import { PlannedWorkFormPage } from '../planned-work/PlannedWorkFormPage';
import { PortalPlannedWorkDetailPage } from './PortalPlannedWorkDetailPage';
import { PortalFloorPage } from './PortalFloorPage';
import { PortalPlannedWorkListPage } from './PortalPlannedWorkListPage';
import { PortalRequestListPage } from './PortalRequestListPage';
import { PortalSiteDetailPage } from './PortalSiteDetailPage';
import { PortalSitesPage } from './PortalSitesPage';

const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const OBJECT_TYPE_ID = '507f1f77bcf86cd799439199';
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
    attributes: [],
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
    // The create form now has a required equipment-type field; with no options it cannot
    // be filled, and nothing submits.
    vi.spyOn(serviceRequestService, 'callableObjectTypes').mockResolvedValue([
      { id: OBJECT_TYPE_ID, name: 'Гэрэл', callSlaHours: 24 },
    ]);
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


  it('submits it as an ordinary service request owned by the caller organisation', async () => {
    const create = vi
      .spyOn(portalService, 'createRequest')
      .mockResolvedValue({ id: REQUEST_ID, requestNumber: 'SR-202608-0002' } as never);

    const user = userEvent.setup();
    renderPortal(<PortalRequestCreatePage />, '/portal/requests/new?type=PLANNED_INSPECTION');

    await user.selectOptions(await screen.findByLabelText(/^Барилга/), BUILDING_ID);
    await user.selectOptions(
      await screen.findByLabelText(/^Тоног төхөөрөмжийн төрөл/),
      OBJECT_TYPE_ID,
    );
    await user.type(screen.getByLabelText(/^Тайлбар/), 'Улирлын урьдчилан сэргийлэх үзлэг.');
    await user.click(screen.getByRole('button', { name: 'Илгээх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: CUSTOMER_ID,
          buildingId: BUILDING_ID,
          objectTypeId: OBJECT_TYPE_ID,
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
   * The customer is told what saving actually does, because it does NOT submit. A form whose
   * button says one thing and whose record does another is how a request sits unsent for a
   * week while its author believes it is being reviewed.
   */
  it('says that saving stores a draft rather than submitting it', async () => {
    renderPortal(<PlannedWorkFormPage variant="portal" />, '/portal/planned-work/new');

    expect(await screen.findByText(/эхлээд «Ноорог» болж хадгалагдана/)).toBeInTheDocument();
    expect(screen.getByText(/«Төлөвлөх» дарж батлуулахаар илгээнэ үү/)).toBeInTheDocument();
    // And the button promises only what it does.
    expect(screen.getByRole('button', { name: 'Хадгалах' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Илгээх' })).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

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

describe('the customer breaks their own request down', () => {
  /** A freshly raised request: a DRAFT the customer has not submitted yet. */
  function draftWork(overrides: Record<string, unknown> = {}) {
    return {
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: 'DRAFT',
      effectiveStatus: 'DRAFT',
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
      materials: [],
      availableActions: [],
      ...overrides,
    } as never;
  }

  function openDetail() {
    return renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portalService, 'listFloors').mockResolvedValue(
      makePage([{ id: '507f1f77bcf86cd799439033', name: '1-р давхар' } as never]),
    );
  });

  it('invites a draft with no breakdown to add one', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(draftWork());

    openDetail();

    expect(await screen.findByRole('button', { name: 'Дэд ажил нэмэх' })).toBeInTheDocument();
    expect(screen.getByText(/дэд ажил болгон задалж оруулна уу/)).toBeInTheDocument();
  });

  /**
   * The controls must vanish exactly when the server stops accepting them. Approval settles
   * the scope, so an approved request is read-only again.
   */
  it.each(['PENDING_APPROVAL', 'PLANNED', 'STARTED', 'COMPLETED'] as const)(
    'withdraws the breakdown controls once the request is %s',
    async (status) => {
      vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(
        draftWork({ lifecycleStatus: status, effectiveStatus: status }),
      );

      openDetail();

      await screen.findByRole('heading', { name: 'Улирлын үзлэг' });
      expect(screen.queryByRole('button', { name: 'Дэд ажил нэмэх' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Засах' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();
    },
  );

  it('offers no assignee control and touches no staff endpoint', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(draftWork());
    const nodes = vi.spyOn(objectService, 'children').mockResolvedValue([]);
    const roster = vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);

    const user = userEvent.setup();
    openDetail();

    await user.click(await screen.findByRole('button', { name: 'Дэд ажил нэмэх' }));

    await screen.findByLabelText(/^Дэд ажлын нэр/);
    expect(screen.queryByLabelText(/^Хариуцах ажилтан/)).not.toBeInTheDocument();
    expect(nodes).not.toHaveBeenCalled();
    expect(roster).not.toHaveBeenCalled();
    // The floor list comes from the portal-scoped endpoint instead.
    expect(portalService.listFloors).toHaveBeenCalledWith(BUILDING_ID);
  });

  it('saves a sub-task through the portal endpoint', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(draftWork());
    const createTask = vi
      .spyOn(portalService, 'createTask')
      .mockResolvedValue(draftWork({ tasks: [] }));

    const user = userEvent.setup();
    openDetail();

    await user.click(await screen.findByRole('button', { name: 'Дэд ажил нэмэх' }));
    await user.type(await screen.findByLabelText(/^Дэд ажлын нэр/), 'Гэрэлтүүлэг шалгах');
    await user.type(screen.getByLabelText(/^Хийх тоо хэмжээ/), '6');
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'w1',
        expect.objectContaining({ title: 'Гэрэлтүүлэг шалгах', totalQuantity: 6 }),
      );
    });
  });

  /**
   * Submitting is the customer's own act now. The button comes from the server's
   * `availableActions`, not from a client-side status check, which is why the portal cannot
   * offer a transition the server would refuse.
   */
  it('lets a customer submit their own draft for approval', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(
      draftWork({
        availableActions: [
          {
            action: 'PLAN',
            label: 'Төлөвлөх',
            requiresReason: false,
            assignsCrew: false,
            targetStatus: 'PENDING_APPROVAL',
          },
        ],
      }),
    );
    const transition = vi
      .spyOn(portalService, 'transition')
      .mockResolvedValue(draftWork({ lifecycleStatus: 'PENDING_APPROVAL' }));

    const user = userEvent.setup();
    openDetail();

    await user.click(await screen.findByRole('button', { name: 'Төлөвлөх' }));

    await waitFor(() => {
      expect(transition).toHaveBeenCalledWith('w1', 'PLAN', null);
    });
  });

  /** The round trip: read why it came back, correct it, send it again. */
  it('shows a returned request its reason and lets the customer act on it', async () => {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue(
      draftWork({
        lifecycleStatus: 'REJECTED',
        effectiveStatus: 'REJECTED',
        cancelReason: 'Огноо тохирохгүй байна.',
        availableActions: [
          {
            action: 'PLAN',
            label: 'Төлөвлөх',
            requiresReason: false,
            assignsCrew: false,
            targetStatus: 'PENDING_APPROVAL',
          },
        ],
      }),
    );

    openDetail();

    expect(await screen.findByText('Огноо тохирохгүй байна.')).toBeInTheDocument();
    // Editable again, and submittable again — the same record, not a fresh one.
    expect(screen.getByRole('button', { name: 'Засах' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Төлөвлөх' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Дэд ажил нэмэх' })).toBeInTheDocument();
  });
});

describe('the portal planned-work list', () => {
  /** The list call plus the two count calls the banner makes, answered by status. */
  function stubList(totals: Partial<Record<string, number>>, rows: unknown[] = []) {
    return vi
      .spyOn(portalService, 'listPlannedWork')
      .mockImplementation(async (query: { status?: string; limit?: number } = {}) => {
        const status = query.status;
        if (status && query.limit === 1) {
          return { items: [], page: 1, limit: 1, total: totals[status] ?? 0, totalPages: 1 } as never;
        }
        return makePage(rows as never[]) as never;
      });
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * The point of the banner: a draft nobody submitted and a request that came back are the
   * two states where nothing moves until the customer acts, and both are easy to lose in a
   * table of coloured chips.
   */
  it('tells the customer how much is waiting on them', async () => {
    stubList({ DRAFT: 2, REJECTED: 1 });

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work');

    expect(await screen.findByText('Таны хийх ажил байна')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Илгээгээгүй 2 ноорог/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Буцаагдсан 1 хүсэлт/ })).toBeInTheDocument();
  });

  it('says nothing when nothing is waiting on them', async () => {
    stubList({ DRAFT: 0, REJECTED: 0 });

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work');

    await screen.findByLabelText('Төлөв');
    expect(screen.queryByText('Таны хийх ажил байна')).not.toBeInTheDocument();
  });

  /**
   * Counted with their own requests, not tallied from the rows. The list is one capped and
   * possibly filtered page, so counting it would understate the banner exactly when there is
   * most to miss — here the table shows nothing at all and the counts are still right.
   */
  it('counts what is waiting even when the table is showing something else', async () => {
    const list = stubList({ DRAFT: 5, REJECTED: 0 });

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work?status=COMPLETED');

    expect(await screen.findByRole('button', { name: /Илгээгээгүй 5 ноорог/ })).toBeInTheDocument();
    // The table itself asked only for the filtered status.
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'COMPLETED', page: 1, limit: 20 }),
    );
  });

  /**
   * The list used to fetch one capped page of 50 and render no pager at all, so a customer
   * with more work than that simply never saw the rest — and nothing on screen said so.
   */
  it('pages through the list rather than silently stopping at the cap', async () => {
    const list = vi
      .spyOn(portalService, 'listPlannedWork')
      .mockImplementation(async (query: { limit?: number } = {}) => {
        if (query.limit === 1) {
          return { items: [], page: 1, limit: 1, total: 0, totalPages: 1 } as never;
        }
        return {
          items: [{ id: 'w1', workNumber: 'PW-1', title: 'Нэг', effectiveStatus: 'PLANNED' }],
          page: 1,
          limit: 20,
          total: 45,
          totalPages: 3,
        } as never;
      });
    const user = userEvent.setup();

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work');

    expect(await screen.findByText(/Нийт 45, хуудас 1\/3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 20 })),
    );
  });

  /** Continuous numbering: a reader asked to check row 21 must find it on page 2. */
  it('numbers rows continuously across pages', async () => {
    vi.spyOn(portalService, 'listPlannedWork').mockImplementation(
      async (query: { limit?: number } = {}) => {
        if (query.limit === 1) {
          return { items: [], page: 1, limit: 1, total: 0, totalPages: 1 } as never;
        }
        return {
          items: [{ id: 'w21', workNumber: 'PW-21', title: 'Хорин нэг', effectiveStatus: 'PLANNED' }],
          page: 2,
          limit: 20,
          total: 45,
          totalPages: 3,
        } as never;
      },
    );

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work?page=2');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('21')).toBeInTheDocument();
  });

  it('filters the table by the chosen status', async () => {
    const list = stubList({ DRAFT: 0, REJECTED: 0 });
    const user = userEvent.setup();

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work');

    await user.selectOptions(await screen.findByLabelText('Төлөв'), 'PENDING_APPROVAL');

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PENDING_APPROVAL', page: 1, limit: 20 }),
      ),
    );
  });

  /** Chips offered one axis and no search at all; searching goes to the server, not the page. */
  it('sends a typed search to the server', async () => {
    const list = stubList({ DRAFT: 0, REJECTED: 0 });
    const user = userEvent.setup();

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work');

    await user.type(await screen.findByLabelText('Хайлт'), 'PW-2026{Enter}');

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'PW-2026', page: 1, limit: 20 }),
      ),
    );
  });

  /** Narrowing from page 3 must not leave the reader on a page the result no longer has. */
  it('returns to the first page when the filter changes', async () => {
    const list = stubList({ DRAFT: 0, REJECTED: 0 });
    const user = userEvent.setup();

    renderPortal(<PortalPlannedWorkListPage />, '/portal/planned-work?page=3');

    await user.selectOptions(await screen.findByLabelText('Төлөв'), 'COMPLETED');

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'COMPLETED', page: 1 }),
      ),
    );
  });
});

describe('the portal status trail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portalService, 'listFloors').mockResolvedValue(makePage([]));
  });

  function openWith(status: string, extra: Record<string, unknown> = {}) {
    vi.spyOn(portalService, 'getPlannedWork').mockResolvedValue({
      id: 'w1',
      workNumber: 'PW-202609-0001',
      title: 'Улирлын үзлэг',
      lifecycleStatus: status,
      effectiveStatus: status,
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
      materials: [],
      availableActions: [],
      ...extra,
    } as never);

    return renderPortal(
      <PortalPlannedWorkDetailPage />,
      '/portal/planned-work/w1',
      '/portal/planned-work/:plannedWorkId',
    );
  }

  it('marks the stage the request has actually reached', async () => {
    openWith('PENDING_APPROVAL');

    const trail = await screen.findByRole('list', { name: 'Явц' });
    expect(within(trail).getByText('Хүлээгдэж буй')).toHaveAttribute('aria-current', 'step');
    expect(within(trail).getByText('Ноорог')).not.toHaveAttribute('aria-current');
  });

  /** A returned request is back at the beginning, because correcting it is all still to do. */
  it('draws a returned request back at the first stage', async () => {
    openWith('REJECTED', { cancelReason: 'Огноо тохирохгүй.' });

    const trail = await screen.findByRole('list', { name: 'Явц' });
    expect(within(trail).getByText('Ноорог')).toHaveAttribute('aria-current', 'step');
  });

  /**
   * A cancelled request never reaches an end stage, and a frozen trail would imply it might.
   *
   * The blank-card assertion is not decoration. The trail declining to render left the card
   * it was supposed to sit in behind — an empty white box above every cancelled request,
   * which the "no list" assertion above passes straight over. Found by looking at the
   * running page, not by a test, which is why there is now one.
   */
  it('shows no trail for a cancelled request, and leaves no empty card behind', async () => {
    const { container } = openWith('CANCELLED', { cancelReason: 'Шаардлагагүй болсон.' });

    await screen.findByRole('heading', { name: 'Улирлын үзлэг' });
    expect(screen.queryByRole('list', { name: 'Явц' })).not.toBeInTheDocument();

    const blankCards = [...container.querySelectorAll('div.rounded-xl.bg-white')].filter(
      (card) => (card.textContent ?? '').trim() === '',
    );
    expect(blankCards).toHaveLength(0);
  });
});

/**
 * The two site tables used to fetch one capped page and render no pager, so a customer with
 * more buildings — or a tower with more floors — than the cap simply never saw the rest, and
 * nothing on screen said so. Both now page, and both search server-side.
 */
describe('the customer site lists', () => {
  /** One page of a longer list, as the server answers it. */
  function serverPage<T>(items: T[], page: number, total: number) {
    return {
      items,
      page,
      limit: 20,
      total,
      totalPages: Math.ceil(total / 20),
    } as never;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('pages through the buildings rather than silently stopping at the cap', async () => {
    const list = vi
      .spyOn(portalService, 'listBuildings')
      .mockResolvedValue(serverPage([makeBuilding()], 1, 45));
    const user = userEvent.setup();

    renderPortal(<PortalSitesPage />, '/portal/sites');

    expect(await screen.findByText(/Нийт 45, хуудас 1\/3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(expect.objectContaining({ page: 2, limit: 20 })),
    );
  });

  /** Continuous numbering: a reader asked to check row 21 must find it on page 2. */
  it('numbers the buildings continuously across pages', async () => {
    vi.spyOn(portalService, 'listBuildings').mockResolvedValue(
      serverPage([makeBuilding()], 2, 45),
    );

    renderPortal(<PortalSitesPage />, '/portal/sites?page=2');

    const table = await screen.findByRole('table');
    expect(within(table).getByText('21')).toBeInTheDocument();
  });

  /**
   * Server-side, and starting again from page 1. Filtering the page in hand would search
   * only the twenty rows on screen, and keeping the old page would land the search on a
   * page a shorter result set does not have.
   */
  it('sends the building search to the server and restarts the paging', async () => {
    const list = vi
      .spyOn(portalService, 'listBuildings')
      .mockResolvedValue(serverPage([makeBuilding()], 3, 45));
    const user = userEvent.setup();

    renderPortal(<PortalSitesPage />, '/portal/sites?page=3');

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Хайлт'), 'Төв{Enter}');

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ page: 1, limit: 20, search: 'Төв' }),
    );
  });

  it('pages through the floors of one building', async () => {
    vi.spyOn(portalService, 'getBuilding').mockResolvedValue(makeBuilding({ id: BUILDING_ID }));
    const list = vi
      .spyOn(portalService, 'listFloors')
      .mockResolvedValue(serverPage([makeFloor()], 1, 45));
    const user = userEvent.setup();

    renderPortal(
      <PortalSiteDetailPage />,
      `/portal/sites/${BUILDING_ID}`,
      '/portal/sites/:buildingId',
    );

    expect(await screen.findByText(/Нийт 45, хуудас 1\/3/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(
        BUILDING_ID,
        expect.objectContaining({ page: 2, limit: 20 }),
      ),
    );
  });

  it('sends the floor search to the server and restarts the paging', async () => {
    vi.spyOn(portalService, 'getBuilding').mockResolvedValue(makeBuilding({ id: BUILDING_ID }));
    const list = vi
      .spyOn(portalService, 'listFloors')
      .mockResolvedValue(serverPage([makeFloor()], 2, 45));
    const user = userEvent.setup();

    renderPortal(
      <PortalSiteDetailPage />,
      `/portal/sites/${BUILDING_ID}?page=2`,
      '/portal/sites/:buildingId',
    );

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Хайлт'), '2 давхар{Enter}');

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith(BUILDING_ID, {
        page: 1,
        limit: 20,
        search: '2 давхар',
      }),
    );
  });

  /** Turning a page must not blank out the heading that says which building this is. */
  it('keeps the building heading while a floor page loads', async () => {
    vi.spyOn(portalService, 'getBuilding').mockResolvedValue(
      makeBuilding({ id: BUILDING_ID, name: 'Төв барилга' }),
    );
    vi.spyOn(portalService, 'listFloors').mockResolvedValue(serverPage([makeFloor()], 1, 45));
    const user = userEvent.setup();

    renderPortal(
      <PortalSiteDetailPage />,
      `/portal/sites/${BUILDING_ID}`,
      '/portal/sites/:buildingId',
    );

    await screen.findByText(/Нийт 45, хуудас 1\/3/);
    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    expect(screen.getByRole('heading', { name: 'Төв барилга' })).toBeInTheDocument();
  });
});

describe('the portal floor equipment table', () => {
  const FLOOR_ID = '507f1f77bcf86cd799439033';

  function page(index: number, count: number, totalPages: number, total: number) {
    return {
      items: Array.from({ length: count }, (_, offset) =>
        makeObjectListItem({
          id: `o-${index}-${offset}`,
          code: `EQ-${index}-${offset}`,
          name: `Тоноглол ${index}-${offset}`,
        }),
      ),
      page: index,
      limit: 100,
      total,
      totalPages,
    };
  }

  function openFloor() {
    return renderPortal(
      <PortalFloorPage />,
      `/portal/sites/${BUILDING_ID}/floors/${FLOOR_ID}`,
      '/portal/sites/:buildingId/floors/:floorId',
    );
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(portalService, 'getFloor').mockResolvedValue({
      id: FLOOR_ID,
      name: '1-р давхар',
      buildingId: BUILDING_ID,
      customerId: 'c1',
    } as never);
    vi.spyOn(portalService, 'getFloorPlan').mockResolvedValue(null);
  });

  /**
   * The plan draws one marker per object, so a fetch that stopped at the endpoint's 100-row
   * cap would lose pins off the drawing and say nothing about it — the same bug the staff
   * floor screen already walks pages to avoid.
   */
  it('walks every page of equipment rather than stopping at the cap', async () => {
    const list = vi
      .spyOn(portalService, 'listObjects')
      .mockImplementation(async (_floorId: string, p = 1) =>
        (p === 1 ? page(1, 100, 2, 150) : page(2, 50, 2, 150)) as never,
      );

    openFloor();

    expect(await screen.findByText(/Нийт 150/, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(FLOOR_ID, 1);
    expect(list).toHaveBeenCalledWith(FLOOR_ID, 2);
  });

  it('pages the table and numbers it continuously', async () => {
    vi.spyOn(portalService, 'listObjects').mockResolvedValue(page(1, 45, 1, 45) as never);
    const user = userEvent.setup();

    openFloor();

    const table = await screen.findByRole('table', { name: 'Тоноглол' });
    expect(within(table).getByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(within(screen.getByRole('table', { name: 'Тоноглол' })).getByText('21')).toBeInTheDocument(),
    );
  });

  /** In-memory search is honest here only because every page has already been fetched. */
  it('searches the whole floor, not the page on screen', async () => {
    vi.spyOn(portalService, 'listObjects').mockResolvedValue(
      {
        items: [
          makeObjectListItem({ id: 'a', code: 'PNL-001', name: 'Гол самбар' }),
          makeObjectListItem({ id: 'b', code: 'LGT-014', name: 'Коридор гэрэл' }),
        ],
        page: 1,
        limit: 100,
        total: 2,
        totalPages: 1,
      } as never,
    );
    const user = userEvent.setup();

    openFloor();

    await user.type(await screen.findByLabelText('Хайлт'), 'LGT');

    const table = screen.getByRole('table', { name: 'Тоноглол' });
    await waitFor(() => expect(within(table).getByText('LGT-014')).toBeInTheDocument());
    expect(within(table).queryByText('PNL-001')).not.toBeInTheDocument();
  });
});
