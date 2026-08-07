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
import { PLAN_FOCUS_ZOOM } from './FloorPlanCanvas';
import { FloorPlanPanel } from './FloorPlanPanel';
import { PLAN_FLOW_WIDTH, DEFAULT_PLAN_ASPECT } from './plan-geometry';

const FLOOR_ID = '507f1f77bcf86cd799439121';
const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const TYPE_ID = '507f1f77bcf86cd799439151';
const CAMERA_TYPE_ID = '507f1f77bcf86cd799439152';
const CABLE_TYPE_ID = '507f1f77bcf86cd799439153';

/** A type flagged as placeable. `showOnPlan` is what decides, so it is set explicitly. */
const PLACEABLE = makeObjectType({ id: TYPE_ID, showOnPlan: true, category: 'EQUIPMENT' });

/** The registry entry as the list endpoint inlines it on every object row. */
const PLACEABLE_INLINE = {
  id: TYPE_ID,
  code: 'MCB',
  name: 'Автомат таслуур',
  icon: 'BREAKER' as const,
  /** No uploaded icon: the built-in glyph is what this type draws with. */
  iconUrl: null,
  showOnPlan: true,
};

/** A second placeable type, so there is a layer to switch off independently. */
const CAMERA_INLINE = {
  id: CAMERA_TYPE_ID,
  code: 'CAM',
  name: 'Камер',
  icon: 'CAMERA' as const,
  iconUrl: null,
  showOnPlan: true,
};

/** A type the registry never draws on a plan. */
const CABLE_INLINE = {
  id: CABLE_TYPE_ID,
  code: 'CBL',
  name: 'Кабель',
  icon: 'CABLE' as const,
  iconUrl: null,
  showOnPlan: false,
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

/**
 * The middle of the view, in screen coordinates.
 *
 * Read off the drawing rather than assumed: a fitted plan sits centred in the canvas, so
 * the screen point of the plan box's own centre is by definition the centre of the view.
 * That keeps the assertion independent of how large jsdom believes the canvas to be — which
 * is not the size a browser would report, and is not what is being tested here.
 */
function viewCentre(): { x: number; y: number } {
  const view = viewport();
  return {
    x: view.x + (PLAN_BOX.width * view.zoom) / 2,
    y: view.y + (PLAN_BOX.height * view.zoom) / 2,
  };
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

/** A placed object of the second layer. */
function camera() {
  return makeObjectListItem({
    id: 'c1',
    code: 'CAM-01',
    name: 'Коридорын камер',
    objectType: CAMERA_INLINE,
    planPosition: { x: 0.8, y: 0.75 },
  });
}

/** A placeable type that has never been put on the drawing. */
function unplaced() {
  return makeObjectListItem({
    id: 'u1',
    code: 'EQ-09',
    name: 'Нөөц таслуур',
    objectType: PLACEABLE_INLINE,
    planPosition: null,
  });
}

/** An object of a type the plan never draws. */
function notDrawn() {
  return makeObjectListItem({
    id: 'n1',
    code: 'CBL-07',
    name: 'Тэжээлийн кабель',
    objectType: CABLE_INLINE,
    planPosition: null,
  });
}

function layerGroup(): HTMLElement {
  return screen.getByRole('group', { name: 'Харагдах тоноглолын төрөл' });
}

/** The switch for one type. Matched loosely, because the chip also carries its count. */
function layerChip(typeName: string): HTMLElement {
  return within(layerGroup()).getByRole('button', { name: new RegExp(typeName) });
}

function search(): HTMLElement {
  return screen.getByLabelText('Тоноглол хайх');
}

/**
 * The results, scoped.
 *
 * A result and the marker it points at carry the same name by design, so an unscoped query
 * for one would find both.
 */
function searchResults(): HTMLElement {
  return screen.getByRole('group', { name: 'Хайлтын илэрц' });
}

function searchResult(label: RegExp): HTMLElement {
  return within(searchResults()).getByRole('button', { name: label });
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

  /**
   * A layer switch is a view, so a hidden marker keeps everything it had: its draft stays,
   * the outstanding count still names it, and Save writes it like any other.
   */
  it('keeps a hidden marker draft and writes it on Save', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Байрлал засах' }));
    const from = markerScreenPoint('o1');
    drag(markerNode('o1'), [from.x, from.y], [from.x + 110, from.y + 70]);
    await waitFor(() => expect(screen.getByText('Хадгалаагүй 1 өөрчлөлт')).toBeInTheDocument());
    const moved = markerPoint('o1');

    await user.click(layerChip('Автомат таслуур'));

    // Off the screen, still on the books, and said so.
    expect(screen.queryByRole('button', { name: 'EQ-01 · Гэрэл' })).not.toBeInTheDocument();
    expect(screen.getByText('Хадгалаагүй 1 өөрчлөлт')).toBeInTheDocument();
    expect(
      screen.getByText(/Нуусан давхаргад хадгалаагүй 1 өөрчлөлт байна/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Байрлал хадгалах' }));

    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith('o1', {
      planPosition: {
        x: expect.closeTo(moved.x / PLAN_BOX.width, 6),
        y: expect.closeTo(moved.y / PLAN_BOX.height, 6),
      },
    });
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

describe('FloorPlanPanel layer filter', () => {
  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  /**
   * The list is the floor's own, not the registry's.
   *
   * Types the floor does not use are absent, a type the plan never draws is absent, and the
   * count on each is what switching it off would take off the drawing — so an object of a
   * placeable type that was never placed is listed nowhere and counted nowhere.
   */
  it('builds the layer list from the floor own types, with a count each', async () => {
    renderPanel({
      objects: [
        placedObject(),
        placedObject({ id: 'o2', code: 'EQ-02', name: 'Залгуур', planPosition: { x: 0.2, y: 0.6 } }),
        camera(),
        unplaced(),
        notDrawn(),
      ],
    });
    await readyCanvas();

    expect(layerChip('Автомат таслуур')).toHaveTextContent('2');
    expect(layerChip('Камер')).toHaveTextContent('1');
    expect(within(layerGroup()).queryByRole('button', { name: /Кабель/ })).not.toBeInTheDocument();
    // Every layer starts on.
    expect(layerChip('Автомат таслуур')).toHaveAttribute('aria-pressed', 'true');
  });

  it('hides exactly the markers of the type switched off', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.click(layerChip('Камер'));

    expect(screen.queryByRole('button', { name: 'CAM-01 · Коридорын камер' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' })).toBeInTheDocument();
    expect(layerChip('Камер')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText(/1 төрөл нуугдсан байна/)).toBeInTheDocument();

    // And back on again.
    await user.click(layerChip('Камер'));
    expect(screen.getByRole('button', { name: 'CAM-01 · Коридорын камер' })).toBeInTheDocument();
  });

  it('switches every layer off and on again in one press', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.click(screen.getByRole('button', { name: 'Бүгдийг нуух' }));
    expect(screen.queryByRole('button', { name: 'EQ-01 · Гэрэл' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CAM-01 · Коридорын камер' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Бүгдийг харуулах' }));
    expect(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CAM-01 · Коридорын камер' })).toBeInTheDocument();
  });

  /** A view choice, kept for the tab and no longer: stored per floor in sessionStorage. */
  it('remembers the switched-off layers for the session', async () => {
    const user = userEvent.setup();

    const first = renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();
    await user.click(layerChip('Камер'));
    first.unmount();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    expect(layerChip('Камер')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('button', { name: 'CAM-01 · Коридорын камер' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'EQ-01 · Гэрэл' })).toBeInTheDocument();
  });

  it('offers no filter at all on a floor with nothing placeable', async () => {
    renderPanel({ objects: [notDrawn()] });
    await readyCanvas();

    expect(screen.queryByRole('group', { name: 'Харагдах тоноглолын төрөл' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Тоноглол хайх')).not.toBeInTheDocument();
  });
});

describe('FloorPlanPanel search', () => {
  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  it('matches on the code and on the name, whatever the case', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.type(search(), 'cam-01');
    expect(await screen.findByText('CAM-01 · Коридорын камер')).toBeInTheDocument();
    expect(screen.queryByText('EQ-01 · Гэрэл')).not.toBeInTheDocument();

    await user.clear(search());
    await user.type(search(), 'ГЭРЭЛ');
    expect(await screen.findByText('EQ-01 · Гэрэл')).toBeInTheDocument();
    expect(screen.queryByText('CAM-01 · Коридорын камер')).not.toBeInTheDocument();

    await user.clear(search());
    await user.type(search(), 'нэгэн зүйл');
    expect(await screen.findByText('Илэрц олдсонгүй.')).toBeInTheDocument();
  });

  /**
   * The whole point of the search: the view travels to the marker and the marker is the
   * selected one, so the eye lands on it rather than hunting the drawing for it.
   */
  it('centres the view on the chosen result and selects it', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();
    // Taken while the plan is fitted, which is the one moment the middle of the drawing and
    // the middle of the view are the same point.
    const centre = viewCentre();

    await user.type(search(), 'CAM-01');
    await screen.findByText('CAM-01 · Коридорын камер');
    await user.click(searchResult(/CAM-01/));

    await waitFor(() => expect(viewport().zoom).toBeCloseTo(PLAN_FOCUS_ZOOM, 5));
    await waitFor(() => {
      const point = markerScreenPoint('c1');
      expect(point.x).toBeCloseTo(centre.x, 1);
      expect(point.y).toBeCloseTo(centre.y, 1);
    });
    // The marker travelled; it was not moved.
    expect(markerPoint('c1')).toEqual({ x: 0.8 * PLAN_BOX.width, y: 0.75 * PLAN_BOX.height });

    // Selected, so the marker is outlined and its details are on screen.
    expect(screen.getByRole('button', { name: 'CAM-01 · Коридорын камер' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('80.0% · 75.0%')).toBeInTheDocument();
    // The query is spent: the results no longer sit over the drawing.
    expect(search()).toHaveValue('');
  });

  /**
   * An object that exists but is not on the drawing is listed and told, rather than left
   * out: someone searching a code is asking whether the thing exists at all.
   */
  it('lists an unplaced object as unplaceable and refuses to travel to it', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), unplaced()] });
    await readyCanvas();

    await user.type(search(), 'EQ-09');

    expect(await screen.findByText('EQ-09 · Нөөц таслуур')).toBeInTheDocument();
    expect(screen.getByText('Энэ тоноглол планд байрлуулаагүй')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /EQ-09/ })).not.toBeInTheDocument();
  });

  it('says when a match belongs to a type the plan never draws', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), notDrawn()] });
    await readyCanvas();

    await user.type(search(), 'CBL');

    expect(await screen.findByText('CBL-07 · Тэжээлийн кабель')).toBeInTheDocument();
    expect(screen.getByText('Энэ төрлийг план дээр харуулдаггүй')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /CBL-07/ })).not.toBeInTheDocument();
  });

  /**
   * A layer switched off is not an answer to "take me to this object". Choosing the result
   * switches its layer back on, which the chip shows, and then travels to it.
   */
  it('switches a hidden layer back on to reach the chosen result', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();
    const centre = viewCentre();

    await user.click(layerChip('Камер'));
    expect(screen.queryByRole('button', { name: 'CAM-01 · Коридорын камер' })).not.toBeInTheDocument();

    await user.type(search(), 'CAM');
    await screen.findByText('CAM-01 · Коридорын камер');
    await user.click(searchResult(/CAM-01/));

    expect(layerChip('Камер')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'CAM-01 · Коридорын камер' })).toBeInTheDocument();
    await waitFor(() => expect(viewport().zoom).toBeCloseTo(PLAN_FOCUS_ZOOM, 5));
    await waitFor(() => expect(markerScreenPoint('c1').x).toBeCloseTo(centre.x, 1));
  });

  /** Reachable without a mouse: the arrow key walks into the results and Enter takes it. */
  it('walks the results and takes one with the keyboard alone', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.click(search());
    await user.keyboard('CAM');
    await screen.findByText('CAM-01 · Коридорын камер');

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(searchResult(/CAM-01/));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(viewport().zoom).toBeCloseTo(PLAN_FOCUS_ZOOM, 5));
  });

  /** Escape gives the drawing back without selecting anything. */
  it('drops the results on Escape', async () => {
    const user = userEvent.setup();

    renderPanel({ objects: [placedObject(), camera()] });
    await readyCanvas();

    await user.type(search(), 'CAM');
    await screen.findByText('CAM-01 · Коридорын камер');

    await user.keyboard('{Escape}');
    expect(screen.queryByText('CAM-01 · Коридорын камер')).not.toBeInTheDocument();
    expect(search()).toHaveValue('');
  });
});

/**
 * A type may carry an uploaded SVG, and then that is what its markers are drawn with.
 *
 * The row already inlines `objectType.iconUrl`, so the plan never fetches the registry to
 * answer "what do I draw" — the only request is for the picture itself, which is
 * authenticated like every other stored file and therefore cannot be a bare `img src`.
 */
describe('FloorPlanPanel custom type icons', () => {
  const ICON_PATH = '/api/v1/files/507f1f77bcf86cd799439199';
  const WITH_ICON = { ...PLACEABLE_INLINE, iconUrl: ICON_PATH };

  beforeEach(() => {
    layOutCanvas();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockImplementation(async (path: string) =>
      path === ICON_PATH ? 'blob:icon' : 'blob:plan',
    );
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  /** The marker's icon, whichever kind it turned out to be. */
  function markerImage(objectId: string): HTMLImageElement | null {
    return markerNode(objectId).querySelector('img');
  }

  function markerGlyph(objectId: string): SVGElement | null {
    return markerNode(objectId).querySelector('svg');
  }

  it('draws the uploaded icon in place of the built-in glyph', async () => {
    renderPanel({ objects: [placedObject({ objectType: WITH_ICON })] });
    await readyCanvas();

    await waitFor(() => expect(markerImage('o1')).not.toBeNull());
    expect(markerImage('o1')).toHaveAttribute('src', 'blob:icon');
    // The glyph is replaced, not drawn underneath it.
    expect(markerGlyph('o1')).toBeNull();
  });

  it('leaves a type with no uploaded icon on its built-in glyph', async () => {
    renderPanel({ objects: [placedObject()] });
    await readyCanvas();

    expect(markerGlyph('o1')).not.toBeNull();
    expect(markerImage('o1')).toBeNull();
    // Nothing but the plan image is fetched for a floor whose types carry no icon.
    expect(fileUrl.authorisedFileUrl).not.toHaveBeenCalledWith(ICON_PATH);
  });

  /**
   * A 404, a revoked blob, a file removed from disk: the marker falls back to the glyph
   * rather than leaving the browser's broken-image box in the middle of a plan.
   */
  it('falls back to the glyph when the icon fails to load', async () => {
    renderPanel({ objects: [placedObject({ objectType: WITH_ICON })] });
    await readyCanvas();

    await waitFor(() => expect(markerImage('o1')).not.toBeNull());
    fireEvent.error(markerImage('o1')!);

    await waitFor(() => expect(markerGlyph('o1')).not.toBeNull());
    expect(markerImage('o1')).toBeNull();
  });

  /** One file behind forty markers is one request, which is why the panel resolves them. */
  it('fetches one shared icon once for every marker using it', async () => {
    renderPanel({
      objects: [
        placedObject({ objectType: WITH_ICON }),
        placedObject({
          id: 'o2',
          code: 'EQ-02',
          objectType: WITH_ICON,
          planPosition: { x: 0.2, y: 0.6 },
        }),
      ],
    });
    await readyCanvas();

    await waitFor(() => expect(markerImage('o2')).not.toBeNull());
    const iconFetches = vi
      .mocked(fileUrl.authorisedFileUrl)
      .mock.calls.filter(([path]) => path === ICON_PATH);
    expect(iconFetches).toHaveLength(1);
  });

  it('shows the uploaded icon on the layer chip too', async () => {
    renderPanel({ objects: [placedObject({ objectType: WITH_ICON })] });
    await readyCanvas();

    await waitFor(() =>
      expect(layerChip('Автомат таслуур').querySelector('img')).not.toBeNull(),
    );
    expect(layerChip('Автомат таслуур').querySelector('img')).toHaveAttribute(
      'src',
      'blob:icon',
    );
  });

  /**
   * The counter-scale has to apply to a custom icon exactly as it does to a glyph, or a
   * plan zoomed in would be covered by enormous pictures.
   */
  it('keeps a custom icon the same size on screen as the plan is zoomed', async () => {
    renderPanel({ objects: [placedObject({ objectType: WITH_ICON })] });
    await readyCanvas();

    await waitFor(() => expect(markerImage('o1')).not.toBeNull());
    const fitted = viewport().zoom;
    expect(markerScreenScale('o1')).toBeCloseTo(1, 6);

    fireEvent.wheel(pane(), { deltaY: -500, clientX: 400, clientY: 300 });
    await waitFor(() => expect(viewport().zoom).toBeGreaterThan(fitted));
    expect(markerScreenScale('o1')).toBeCloseTo(1, 6);
  });
});
