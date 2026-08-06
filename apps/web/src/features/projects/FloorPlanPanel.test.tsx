import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fileUrl from '../../lib/file-url';
import { objectMasterService, objectTypeService } from '../../services/object-master.service';
import {
  makeFloorPlan,
  makeObjectDetail,
  makeObjectListItem,
  makeObjectType,
  makePage,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { FloorPlanPanel } from './FloorPlanPanel';
import { PLAN_FLOW_WIDTH, DEFAULT_PLAN_ASPECT } from './plan-geometry';

const FLOOR_ID = '507f1f77bcf86cd799439121';
const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const TYPE_ID = '507f1f77bcf86cd799439151';

/** A type flagged as placeable. `showOnPlan` is what decides, so it is set explicitly. */
const PLACEABLE = makeObjectType({ id: TYPE_ID, showOnPlan: true, category: 'EQUIPMENT' });

/** The registry entry as the list endpoint inlines it on every object row. */
const PLACEABLE_INLINE = {
  id: TYPE_ID,
  code: 'MCB',
  name: 'Автомат таслуур',
  icon: 'BREAKER' as const,
  showOnPlan: true,
};

/**
 * The canvas's own units.
 *
 * The drawing is laid into a box `PLAN_FLOW_WIDTH` units wide whose height follows the
 * image's aspect. jsdom never decodes an image, so the assumed aspect is what the tests see
 * and a stored fraction lands at a coordinate this file can predict.
 */
const PLAN_BOX = { width: PLAN_FLOW_WIDTH, height: PLAN_FLOW_WIDTH / DEFAULT_PLAN_ASPECT };

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;

function rectOf(width: number, height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * The canvas laid out at a known size.
 *
 * jsdom lays nothing out: every box is zero wide, and a canvas with no size can neither fit
 * a drawing into itself nor turn a click into a coordinate. The size is stated in both of
 * the ways the canvas asks for it — the offset box it measures itself with, and the client
 * rect it converts pointer positions against.
 *
 * Only the canvas's own boxes are given a size. A marker's box is deliberately left at
 * nothing, because a pin is drawn by transform out of a box one unit across; telling jsdom
 * otherwise would make the canvas believe every pin was the size of the whole viewport and
 * shove them all back inside its own extent.
 */
function layOutCanvas(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('react-flow') ? CANVAS_WIDTH : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('react-flow') ? CANVAS_HEIGHT : 0;
    },
  });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const isCanvasSurface =
      this.classList.contains('react-flow') ||
      this.classList.contains('react-flow__renderer') ||
      this.classList.contains('react-flow__pane');
    return isCanvasSurface ? rectOf(CANVAS_WIDTH, CANVAS_HEIGHT) : rectOf(0, 0);
  });
}

/**
 * A mouse gesture d3 will accept.
 *
 * `d3-drag` reads `event.view` to suppress the click that a completed drag would otherwise
 * fire, and jsdom's `MouseEvent` constructor rejects the window this environment exposes,
 * so the property is attached after construction rather than passed in.
 */
function mouse(type: string, target: EventTarget, x: number, y: number): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button: 0,
  });
  Object.defineProperty(event, 'view', { value: globalThis.window });
  target.dispatchEvent(event);
}

function drag(target: EventTarget, from: [number, number], to: [number, number]): void {
  mouse('mousedown', target, from[0], from[1]);
  // The move listeners are on the window, which is where a real gesture delivers them
  // once the press has been captured.
  mouse('mousemove', globalThis.window, to[0], to[1]);
  mouse('mouseup', globalThis.window, to[0], to[1]);
}

function parseTransform(style: string | null): { x: number; y: number; zoom: number } {
  const translate = /translate\((-?[\d.]+)px\s*,\s*(-?[\d.]+)px\)/.exec(style ?? '');
  const scale = /scale\((-?[\d.]+)\)/.exec(style ?? '');
  return {
    x: translate ? Number(translate[1]) : 0,
    y: translate ? Number(translate[2]) : 0,
    zoom: scale ? Number(scale[1]) : 1,
  };
}

/** Where the canvas has panned and zoomed to. */
function viewport(): { x: number; y: number; zoom: number } {
  return parseTransform(document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null);
}

function markerNode(objectId: string): HTMLElement {
  const node = document.querySelector(`.react-flow__node[data-id="${objectId}"]`);
  if (!node) throw new Error(`no marker node for ${objectId}`);
  return node as HTMLElement;
}

/** The marker's spot in the canvas's units — the thing a stored position resolves to. */
function markerPoint(objectId: string): { x: number; y: number } {
  const { x, y } = parseTransform(markerNode(objectId).getAttribute('style'));
  return { x, y };
}

/** Where the marker is on the screen: its canvas point through the viewport transform. */
function markerScreenPoint(objectId: string): { x: number; y: number } {
  const point = markerPoint(objectId);
  const view = viewport();
  return { x: view.x + point.x * view.zoom, y: view.y + point.y * view.zoom };
}

/**
 * How large the marker is drawn, relative to its unzoomed size.
 *
 * The marker sits inside the viewport, so what reaches the screen is the viewport's zoom
 * multiplied by whatever the marker does to itself. A pin that keeps its size has a product
 * of exactly one at every zoom.
 */
function markerScreenScale(objectId: string): number {
  const inner = markerNode(objectId).firstElementChild as HTMLElement;
  return parseTransform(inner.getAttribute('style')).zoom * viewport().zoom;
}

function pane(): HTMLElement {
  const element = document.querySelector('.react-flow__pane');
  if (!element) throw new Error('no canvas pane');
  return element as HTMLElement;
}

function placedObject(overrides: Parameters<typeof makeObjectListItem>[0] = {}) {
  return makeObjectListItem({
    id: 'o1',
    code: 'EQ-01',
    name: 'Гэрэл',
    objectType: PLACEABLE_INLINE,
    planPosition: { x: 0.5, y: 0.25 },
    ...overrides,
  });
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof FloorPlanPanel>> = {}) {
  const props = {
    floorId: FLOOR_ID,
    plan: makeFloorPlan(),
    canManage: true,
    objects: [],
    customerId: CUSTOMER_ID,
    canPlace: true,
    onChanged: vi.fn(),
    ...overrides,
  };
  return {
    props,
    ...renderWithAuth(<FloorPlanPanel {...props} />, { route: '/', path: '/' }),
  };
}

/** Waits for the authenticated image to resolve and the canvas to fit the drawing. */
async function readyCanvas(): Promise<void> {
  await screen.findByAltText('2 давхарын төлөвлөгөө');
  await waitFor(() => expect(viewport().zoom).not.toBe(1));
}

describe('FloorPlanPanel placement', () => {
  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  it('registers an object at the clicked spot with normalised coordinates', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    const { props } = renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    /*
      The reference marker is drawn at 0.5, 0.25 of the drawing, so wherever it has landed
      on screen is by definition that spot. Clicking there has to produce the same pair of
      fractions back — without this file needing to know how the canvas is framed.
    */
    const spot = markerScreenPoint('o1');
    fireEvent.click(pane(), { clientX: spot.x, clientY: spot.y });

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByText('План дээр тоноглол бүртгэх')).toBeInTheDocument();

    await user.selectOptions(within(drawer).getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(within(drawer).getByLabelText(/^Код/), 'EQ-77');
    await user.type(within(drawer).getByLabelText(/^Нэр/), 'Шинэ гэрэлтүүлэг');
    await user.click(within(drawer).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'EQ-77',
          name: 'Шинэ гэрэлтүүлэг',
          customerId: CUSTOMER_ID,
          objectTypeId: TYPE_ID,
          floorId: FLOOR_ID,
          category: 'EQUIPMENT',
          planPosition: { x: expect.closeTo(0.5, 3), y: expect.closeTo(0.25, 3) },
        }),
      );
    });

    // The markers are redrawn from the refreshed floor, not patched in locally.
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  /** The same spot after the view has been moved: zooming is not editing. */
  it('reports the same fraction after the plan has been zoomed and panned', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    const fitted = viewport().zoom;
    fireEvent.wheel(pane(), { deltaY: -400, clientX: 200, clientY: 200 });
    await waitFor(() => expect(viewport().zoom).toBeGreaterThan(fitted));
    drag(pane(), [400, 300], [520, 380]);
    await waitFor(() => expect(viewport().x).not.toBe(22));

    const spot = markerScreenPoint('o1');
    fireEvent.click(pane(), { clientX: spot.x, clientY: spot.y });

    const drawer = await screen.findByRole('dialog');
    await user.selectOptions(within(drawer).getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(within(drawer).getByLabelText(/^Код/), 'EQ-78');
    await user.type(within(drawer).getByLabelText(/^Нэр/), 'Хоёр дахь');
    await user.click(within(drawer).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          planPosition: { x: expect.closeTo(0.5, 3), y: expect.closeTo(0.25, 3) },
        }),
      );
    });
  });

  it('draws a marker for every placed object of a placeable type', async () => {
    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    expect(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' })).toBeInTheDocument();
    expect(markerPoint('o1')).toEqual({
      x: 0.5 * PLAN_BOX.width,
      y: 0.25 * PLAN_BOX.height,
    });
  });

  /** Icon shows what it is; the risk band shows how it is. Both are on the marker. */
  it('draws the type icon and the risk band on the marker', async () => {
    renderPanel({
      objects: [
        placedObject({
          latestAssessment: {
            id: 'a1',
            score: 20,
            riskLevel: 'CRITICAL',
            assessedAt: '2026-07-01T00:00:00.000Z',
            assessedByName: null,
            conclusion: null,
            recommendation: null,
            repairRequired: true,
            revisitRequired: false,
            revisitDate: null,
          },
        }),
      ],
    });
    await readyCanvas();

    const marker = screen.getByRole('button', { name: 'EQ-01 · Гэрэл' });
    expect(marker.querySelector('svg')).not.toBeNull();
    expect(marker.className).toContain('red');
    // The code stays readable, and the type is named on hover.
    expect(marker).toHaveAttribute('title', 'EQ-01 · Гэрэл · Автомат таслуур');
  });

  /**
   * Defect regression: the panel used to fetch the whole type registry to decide which
   * objects were placeable, and swallowed the failure, so one bad request blanked every
   * marker with nothing said. The flag rides along on the object row, so it cannot.
   */
  it('still draws markers when the type registry cannot be read', async () => {
    vi.spyOn(objectTypeService, 'list').mockRejectedValue(new Error('offline'));

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    expect(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' })).toBeInTheDocument();
    expect(
      await screen.findByText(/Тоноглолын төрлийн жагсаалт ачаалж чадсангүй/),
    ).toBeInTheDocument();
  });

  /**
   * `showOnPlan` is the registry's answer to "may this type appear on a plan", so a type
   * without it is neither offered nor drawn even when a position was stored.
   */
  it('draws nothing for a type that is not marked as shown on the plan', async () => {
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(
      makePage([makeObjectType({ id: TYPE_ID, showOnPlan: false })]),
    );

    renderPanel({
      objects: [placedObject({ objectType: { ...PLACEABLE_INLINE, showOnPlan: false } })],
    });
    await readyCanvas();

    expect(
      await screen.findByText(/План дээр байрлуулах тоноглолын төрөл тохируулагдаагүй/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EQ-01 · Гэрэл' })).not.toBeInTheDocument();
  });

  /** No rasteriser here: the plan stays readable and placement says why it is unavailable. */
  it('keeps a PDF plan as a link and withholds placement', async () => {
    renderPanel({
      plan: makeFloorPlan({ mimeType: 'application/pdf', fileName: 'plan.pdf' }),
    });

    expect(await screen.findByText(/PDF план дээр тоноглол байрлуулах боломжгүй/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'PDF нээх' })).toBeInTheDocument();
    expect(screen.queryByAltText('2 давхарын төлөвлөгөө')).not.toBeInTheDocument();
  });

  it('does not open the quick-create drawer for a caller who cannot place', async () => {
    renderPanel({ canPlace: false, objects: [placedObject()] });
    await readyCanvas();

    const spot = markerScreenPoint('o1');
    fireEvent.click(pane(), { clientX: spot.x, clientY: spot.y });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('FloorPlanPanel zoom and pan', () => {
  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  it('zooms on the wheel, pans on a drag, and returns to the fitted view', async () => {
    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    const fitted = viewport();

    fireEvent.wheel(pane(), { deltaY: -400, clientX: 400, clientY: 300 });
    await waitFor(() => expect(viewport().zoom).toBeGreaterThan(fitted.zoom));

    const zoomed = viewport();
    drag(pane(), [400, 300], [460, 350]);
    await waitFor(() => expect(viewport().x).not.toBe(zoomed.x));

    const panned = viewport();
    // A pan moves the drawing and nothing else.
    expect(panned.zoom).toBe(zoomed.zoom);
    expect(panned.x - zoomed.x).toBeCloseTo(60, 5);
    expect(panned.y - zoomed.y).toBeCloseTo(50, 5);

    fireEvent.click(screen.getByRole('button', { name: 'Дэлгэцэд багтаах' }));
    await waitFor(() => expect(viewport()).toEqual(fitted));
  });

  /**
   * The one that matters: a pin is a pin at any magnification.
   *
   * Markers are placed in the drawing's coordinate space, so without the counter-scale they
   * would grow with the plan and a floor zoomed in would be covered by enormous pills.
   */
  it('keeps a marker the same size on screen as the plan is zoomed', async () => {
    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    const fitted = viewport().zoom;
    expect(markerScreenScale('o1')).toBeCloseTo(1, 6);

    fireEvent.wheel(pane(), { deltaY: -500, clientX: 400, clientY: 300 });
    await waitFor(() => expect(viewport().zoom).toBeGreaterThan(fitted));
    expect(markerScreenScale('o1')).toBeCloseTo(1, 6);

    fireEvent.wheel(pane(), { deltaY: 900, clientX: 400, clientY: 300 });
    await waitFor(() => expect(viewport().zoom).toBeLessThan(fitted));
    expect(markerScreenScale('o1')).toBeCloseTo(1, 6);
  });

  /** Looking at a plan is not editing it: the stored coordinate must come through intact. */
  it('leaves the stored coordinate untouched while zooming and panning', async () => {
    const update = vi.spyOn(objectMasterService, 'updatePosition');

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    fireEvent.click(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' }));
    expect(await screen.findByText('50.0% · 25.0%')).toBeInTheDocument();
    // Pressing a marker selects it. It is not also a press on bare plan, so nothing
    // asks to register a second object on top of the one just clicked.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const before = markerPoint('o1');
    const fitted = viewport().zoom;

    fireEvent.wheel(pane(), { deltaY: -400, clientX: 300, clientY: 200 });
    await waitFor(() => expect(viewport().zoom).toBeGreaterThan(fitted));
    const zoomed = viewport().x;
    drag(pane(), [400, 300], [500, 380]);
    await waitFor(() => expect(viewport().x).not.toBe(zoomed));

    expect(markerPoint('o1')).toEqual(before);
    expect(screen.getByText('50.0% · 25.0%')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('FloorPlanPanel position editing', () => {
  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  const second = (): ReturnType<typeof makeObjectListItem> =>
    placedObject({ id: 'o2', code: 'EQ-02', name: 'Залгуур', planPosition: { x: 0.2, y: 0.6 } });

  it('offers no way in without object_master.manage', async () => {
    renderPanel({ canPlace: false, objects: [placedObject()] });
    await readyCanvas();

    expect(screen.queryByRole('button', { name: 'Байрлал засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Байрлал хадгалах' })).not.toBeInTheDocument();
  });

  it('does not move a marker until the mode is entered', async () => {
    const update = vi.spyOn(objectMasterService, 'updatePosition');

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    const before = markerPoint('o1');
    const from = markerScreenPoint('o1');
    drag(markerNode('o1'), [from.x, from.y], [from.x + 120, from.y + 90]);

    expect(markerPoint('o1')).toEqual(before);
    expect(update).not.toHaveBeenCalled();
  });

  it('drags a marker live and writes nothing until Save', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    const { props } = renderPanel({ objects: [placedObject(), second()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Байрлал засах' }));

    const before = markerPoint('o1');
    const from = markerScreenPoint('o1');
    drag(markerNode('o1'), [from.x, from.y], [from.x + 120, from.y + 90]);

    // Moved on screen, and the count says it has not been written.
    await waitFor(() => expect(markerPoint('o1')).not.toEqual(before));
    expect(screen.getByText('Хадгалаагүй 1 өөрчлөлт')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    const moved = markerPoint('o1');
    await user.click(screen.getByRole('button', { name: 'Байрлал хадгалах' }));

    // Exactly the marker that moved, at the coordinate it was left at.
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('o1', {
      planPosition: {
        x: expect.closeTo(moved.x / PLAN_BOX.width, 6),
        y: expect.closeTo(moved.y / PLAN_BOX.height, 6),
      },
    });
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
    // The mode closes on a clean save.
    expect(screen.getByRole('button', { name: 'Байрлал засах' })).toBeInTheDocument();
  });

  it('puts every dragged marker back on Cancel and writes nothing', async () => {
    const update = vi.spyOn(objectMasterService, 'updatePosition');
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), second()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Байрлал засах' }));

    const originals = { o1: markerPoint('o1'), o2: markerPoint('o2') };
    for (const id of ['o1', 'o2'] as const) {
      const from = markerScreenPoint(id);
      drag(markerNode(id), [from.x, from.y], [from.x + 70, from.y + 60]);
    }

    await waitFor(() => expect(screen.getByText('Хадгалаагүй 2 өөрчлөлт')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Болих' }));

    expect(markerPoint('o1')).toEqual(originals.o1);
    expect(markerPoint('o2')).toEqual(originals.o2);
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Байрлал засах' })).toBeInTheDocument();
  });

  it('drafts a cleared position and only writes it on Save', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Байрлал засах' }));
    // Pressed rather than typed at: a marker in edit mode carries a drag gesture, and
    // the synthetic press `userEvent` sends carries no window for d3 to read.
    fireEvent.click(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' }));
    await user.click(await screen.findByRole('button', { name: 'Байрлал арилгах' }));

    // Off the plan, but not yet off the record.
    expect(screen.queryByRole('button', { name: 'EQ-01 · Гэрэл' })).not.toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Байрлал хадгалах' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('o1', { planPosition: null }));
  });

  it('keeps the failed markers pending when a write is rejected', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockRejectedValue(new Error('server down'));
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Байрлал засах' }));
    const from = markerScreenPoint('o1');
    drag(markerNode('o1'), [from.x, from.y], [from.x + 100, from.y + 80]);
    await waitFor(() => expect(screen.getByText('Хадгалаагүй 1 өөрчлөлт')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Байрлал хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    // Still in the mode, still one change outstanding: nothing has been quietly lost.
    expect(await screen.findByText('Хадгалаагүй 1 өөрчлөлт')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Байрлал хадгалах' })).toBeInTheDocument();
  });
});
