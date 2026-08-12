import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../lib/api-client';
import * as fileUrl from '../../lib/file-url';
import { objectMasterService } from '../../services/object-master.service';
import { projectService } from '../../services/project.service';
import {
  makeFloor,
  makeFloorLoad,
  makeFloorPlan,
  makeObjectListItem,
  makePage,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { FloorDetailPage } from './FloorDetailPage';

const FLOOR_ID = '507f1f77bcf86cd799439121';

function renderFloor(permissions: readonly string[]) {
  return renderWithAuth(<FloorDetailPage />, {
    permissions: permissions as never,
    route: `/floors/${FLOOR_ID}`,
    path: '/floors/:floorId',
  });
}

describe('FloorDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // The plan preview fetches the authenticated file; stub it so jsdom does not attempt a
    // real request and the object URL lifecycle stays deterministic.
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(projectService, 'floorLoad').mockResolvedValue(makeFloorLoad());
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([]));
  });

  it('shows general information and the plan before the object list', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    // Await the settled state: the permission set arrives after the first render, so the
    // object section appears on a second pass.
    const objects = await screen.findByRole('heading', { name: 'Холбогдсон объект' });
    const general = screen.getByRole('heading', { name: 'Ерөнхий мэдээлэл' });
    const plan = screen.getByRole('heading', { name: 'План зураг' });

    // Required order: general and plan, then objects.
    const order = [general, plan, objects];
    for (let index = 1; index < order.length; index += 1) {
      const previous = order[index - 1]!;
      const current = order[index]!;
      expect(previous.compareDocumentPosition(current)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  });

  /**
   * Counts, load and risk describe the same floor, so they belong to the general
   * information card rather than to a separate block further down the page.
   */
  it('shows the object counts, the load figures and the risk breakdown in one card', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(projectService, 'floorLoad').mockResolvedValue(
      makeFloorLoad({
        riskCounts: [{ level: 'NORMAL', count: 4 }],
        unassessedCount: 5,
      }),
    );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    // Wait for the load roll-up itself: the permission set arrives after the first render,
    // so the heading alone is on screen before the figures are.
    await screen.findByText('Эрсдэлийн түвшний тоо');
    const heading = screen.getByRole('heading', { name: 'Ерөнхий мэдээлэл' });
    const card = heading.closest('div');
    expect(card).not.toBeNull();

    for (const label of [
      'Самбар',
      'Хэлхээ',
      'Тоноглол',
      'Давхрын нийт ачаалал',
      'Хэмжсэн нийт',
      'Зөрүү',
      'Эрсдэлийн түвшний тоо',
    ]) {
      expect(within(card as HTMLElement).getByText(label)).toBeInTheDocument();
    }
    expect(within(card as HTMLElement).getByText(/Үнэлгээгүй объект/)).toBeInTheDocument();

    // The separate bottom section is gone.
    expect(screen.queryByRole('heading', { name: 'Ачааллын тооцоо' })).not.toBeInTheDocument();
  });

  it('links back to the building it belongs to', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW]);

    const back = await screen.findByRole('link', { name: 'Барилга руу буцах' });
    expect(back).toHaveAttribute('href', '/buildings/507f1f77bcf86cd799439111');
  });

  /** Objects are created on the floor; linking an existing one stays as the secondary action. */
  it('offers creating an object on the floor as the primary action', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByRole('button', { name: 'Тоноглол нэмэх' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Байгаа объект холбох' })).toBeEnabled();
  });

  it('renders the floor general fields', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW]);

    expect(await screen.findByText('1,245 м²')).toBeInTheDocument();
    expect(screen.getByText('Оффис')).toBeInTheDocument();
  });

  it('shows an empty plan state with an upload action for an authorised user', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor({ hasPlanImage: false }));
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(null);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE]);

    expect(await screen.findByText('План зураг хавсаргаагүй байна')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'План зураг хуулах' })).toBeInTheDocument();
  });

  it('hides the upload action from a read-only caller', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor({ hasPlanImage: false }));
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(null);

    renderFloor([PERMISSIONS.OBJECT_VIEW]);

    expect(await screen.findByText('План зураг хавсаргаагүй байна')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'План зураг хуулах' })).not.toBeInTheDocument();
  });

  /** No version list, no version switch, no coordinate overlay: section 19.2 is unresolved. */
  it('offers no version workflow on the plan', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE]);

    await screen.findByRole('heading', { name: 'План зураг' });
    expect(screen.queryByText(/хувилбар/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Хувилбар/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Зураг солих' })).toBeInTheDocument();
  });

  /**
   * The plan image was never an API requirement: `assertFloorUsable` checks the floor's
   * kind, tenant and active flag and nothing else. A floor whose drawing has not been
   * scanned yet still has real equipment on it, so registering it must not wait on a file.
   */
  it('registers objects on a floor that has no plan image yet', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor({ hasPlanImage: false }));
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(null);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByRole('button', { name: 'Тоноглол нэмэх' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Байгаа объект холбох' })).toBeEnabled();
    expect(
      screen.queryByText('План зураг хавсаргасны дараа объект холбоно.'),
    ).not.toBeInTheDocument();
  });

  it('enables object linking once the plan exists', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByRole('button', { name: 'Байгаа объект холбох' })).toBeEnabled();
  });

  it('lists linked objects with their technical figures', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(
      makePage([
        makeObjectListItem({
          latestAssessment: {
            id: 'a1',
            score: 74,
            riskLevel: 'ATTENTION',
            assessedAt: '2026-07-01T00:00:00.000Z',
            assessedByName: 'Бат Дорж',
            conclusion: 'Сул холболт илэрсэн',
            recommendation: 'Чангалах',
            repairRequired: true,
            revisitRequired: false,
            revisitDate: null,
          },
        }),
      ]),
    );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText('Түгээх самбар 2A')).toBeInTheDocument();
    expect(screen.getByText('18.4 kW')).toBeInTheDocument();
    expect(screen.getByText('Сул холболт илэрсэн')).toBeInTheDocument();
    expect(screen.getByText('Чангалах')).toBeInTheDocument();
  });

  /**
   * The list endpoint caps a page at 100, so one request quietly lost everything past the
   * first page — a floor with 120 devices showed 100 and said nothing about the rest.
   */
  it('walks every page of objects rather than stopping at the first hundred', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    const page = (index: number, items: number) => ({
      items: Array.from({ length: items }, (_, offset) =>
        makeObjectListItem({
          id: `o-${index}-${offset}`,
          code: `EQ-${index}-${offset}`,
          name: `Тоноглол ${index}-${offset}`,
        }),
      ),
      page: index,
      limit: 100,
      total: 150,
      totalPages: 2,
    });

    const list = vi
      .spyOn(objectMasterService, 'list')
      .mockImplementation(async (query) =>
        (query?.page ?? 1) === 1 ? page(1, 100) : page(2, 50),
      );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    // The table windows its rows now, so the object that only exists on the second fetched
    // page is no longer on screen at first paint. What proves both fetches were merged is
    // the count over the whole set: 150 is only reachable if the second request landed.
    expect(await screen.findByText(/Нийт 150/)).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith({ floorId: FLOOR_ID, limit: 100, page: 1 });
    expect(list).toHaveBeenCalledWith({ floorId: FLOOR_ID, limit: 100, page: 2 });
    // And it stops when the pages run out rather than asking forever.
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('reports Бүрэн бус instead of a zero when a load figure is incomplete', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(
      makePage([
        makeObjectListItem({
          calculatedLoad: { valueKw: null, complete: false, reasons: ['MISSING_RATED_POWER'] },
        }),
      ]),
    );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Бүрэн бус')).toBeInTheDocument();
  });

  it('reports unattached equipment as excluded from the floor total', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(projectService, 'floorLoad').mockResolvedValue(
      makeFloorLoad({
        unattachedEquipmentCount: 2,
        unattachedEquipmentKw: { valueKw: 3, complete: true, reasons: [] },
      }),
    );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText('Хэлхээнд холбогдоогүй тоноглол')).toBeInTheDocument();
    expect(screen.getByText(/давхрын нийт ачаалалд ороогүй/)).toBeInTheDocument();
  });

  /** Section 19.2 leaves the aggregation method unapproved, so only counts are shown. */
  it('shows risk counts and never a single aggregate score', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(projectService, 'floorLoad').mockResolvedValue(
      makeFloorLoad({
        riskCounts: [
          { level: 'NORMAL', count: 4 },
          { level: 'CRITICAL', count: 1 },
        ],
        unassessedCount: 2,
      }),
    );

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    // The sentence explaining the absence has been removed from the UI, so the rule is
    // asserted against the rendering itself: the bands are counted, and nowhere in the risk
    // block is there a single percentage, which is the only shape a rolled-up score takes.
    const risk = within(await screen.findByRole('group', { name: 'Эрсдэлийн түвшний тоо' }));
    expect(risk.getByText('4')).toBeInTheDocument();
    expect(risk.getByText('1')).toBeInTheDocument();
    expect(risk.getByText('2')).toBeInTheDocument();
    expect(risk.queryByText(/^\d{1,3}%$/)).not.toBeInTheDocument();
  });

  it('hides objects and load from a caller without object_master.view', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW]);

    await screen.findByRole('heading', { name: 'Ерөнхий мэдээлэл' });
    expect(screen.queryByRole('heading', { name: 'Холбогдсон объект' })).not.toBeInTheDocument();
    expect(screen.queryByText('Давхрын нийт ачаалал')).not.toBeInTheDocument();
  });

  it('warns that an archived floor cannot be changed', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor({ isActive: false }));
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE, PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText(/Архивласан давхар/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Тоноглол нэмэх' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Байгаа объект холбох' })).not.toBeInTheDocument();
  });

  it('unlinks an object without deleting it', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([makeObjectListItem()]));
    const unlink = vi.spyOn(projectService, 'unlinkObject').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE, PERMISSIONS.OBJECT_MASTER_VIEW]);

    // Row actions live behind the three-dot control, so the menu is opened first.
    await user.click(await screen.findByRole('button', { name: 'Үйлдэл' }));
    const menu = await screen.findByRole('menu', { name: 'Үйлдэл' });
    await user.click(within(menu).getByRole('menuitem', { name: 'Салгах' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Объект өөрөө устахгүй/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Салгах' }));

    await waitFor(() => {
      expect(unlink).toHaveBeenCalledWith(FLOOR_ID, '507f1f77bcf86cd799439161');
    });
  });

  /** Permission gating omits the item from the menu rather than showing it greyed out. */
  it('omits unlinking from the row menu without object.manage', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([makeObjectListItem()]));
    const user = userEvent.setup();

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    await user.click(await screen.findByRole('button', { name: 'Үйлдэл' }));
    const menu = await screen.findByRole('menu', { name: 'Үйлдэл' });
    expect(within(menu).getByRole('menuitem', { name: 'Түүх' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Салгах' })).not.toBeInTheDocument();
  });

  /**
   * `FLR-001` is issued by the server and `updateFloorSchema` is `.strict()`, so a code
   * sent from this drawer would be refused rather than ignored. The pattern keeps `^` and
   * drops `$` because `Field` appends a `*` to a required label, so a plain equality query
   * would pass even with the field still on screen.
   */
  it('asks for no code on the edit drawer', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    const user = userEvent.setup();

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE]);

    await user.click(await screen.findByRole('button', { name: 'Засах' }));
    const drawer = await screen.findByRole('dialog');

    expect(within(drawer).queryByLabelText(/^Код/)).toBeNull();
    // The name is still editable, so this is the drawer and not an empty match.
    expect(within(drawer).getByLabelText(/^Давхрын нэр/)).toHaveValue('2 давхар');
  });

  /** The floor stores a free-text description; the edit drawer has to be able to set it. */
  it('sends the description along with the other general fields on edit', async () => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    const update = vi.spyOn(projectService, 'updateFloor').mockResolvedValue(makeFloor());
    const user = userEvent.setup();

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE]);

    await user.click(await screen.findByRole('button', { name: 'Засах' }));
    const drawer = await screen.findByRole('dialog');

    await user.type(within(drawer).getByLabelText('Тайлбар'), 'Сүүлийн үзлэгээр асуудалгүй');
    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        FLOOR_ID,
        expect.objectContaining({
          purpose: 'Оффис',
          description: 'Сүүлийн үзлэгээр асуудалгүй',
        }),
      );
    });
  });

  it('shows an error state when the floor cannot be loaded', async () => {
    vi.spyOn(projectService, 'getFloor').mockRejectedValue(
      new ApiError('Давхар олдсонгүй.', 'NOT_FOUND', 404),
    );
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(null);

    renderFloor([PERMISSIONS.OBJECT_VIEW]);

    expect(await screen.findByText('Давхар олдсонгүй.')).toBeInTheDocument();
  });
});

/**
 * The object table pages, and the plan above it does not.
 *
 * This is the one table in the app that pages in the browser rather than at the server,
 * because the plan needs every object at once to draw its markers. These pin both halves:
 * the table shows a window with continuous numbering, and turning a page costs no request.
 */
describe('FloorDetailPage object table paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'getFloorPlan').mockResolvedValue(makeFloorPlan());
    vi.spyOn(projectService, 'floorLoad').mockResolvedValue(makeFloorLoad());
  });

  /** 25 objects: one full page of 20 and a second page holding the rest. */
  function mockObjects(count: number) {
    return vi.spyOn(objectMasterService, 'list').mockResolvedValue(
      makePage(
        Array.from({ length: count }, (_, index) =>
          makeObjectListItem({
            id: `o-${index}`,
            code: `EQ-${index}`,
            name: `Тоноглол ${index}`,
          }),
        ),
        100,
      ),
    );
  }

  it('shows one page of objects and numbers it from 1', async () => {
    mockObjects(25);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('1');
    // The 21st object belongs to the second page and must not be on screen yet.
    expect(within(table).queryByText('Тоноглол 20')).not.toBeInTheDocument();
  });

  it('counts the pager against every object on the floor', async () => {
    mockObjects(25);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);
    await screen.findByRole('table');

    expect(screen.getByText(/Нийт 25/)).toBeInTheDocument();
  });

  it('continues the numbering onto the second page without fetching again', async () => {
    const user = userEvent.setup();
    const list = mockObjects(25);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);
    await screen.findByRole('table');
    const before = list.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('21'),
    );
    expect(within(table).getByText('Тоноглол 20')).toBeInTheDocument();
    // The whole list was already in hand; a second page of it is not a second request.
    expect(list.mock.calls.length).toBe(before);
  });

  it('offers no pager when the floor fits on one page', async () => {
    mockObjects(3);

    renderFloor([PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MASTER_VIEW]);
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Дараах' })).not.toBeInTheDocument();
  });
});
