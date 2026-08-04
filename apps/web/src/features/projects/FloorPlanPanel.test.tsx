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

const FLOOR_ID = '507f1f77bcf86cd799439121';
const CUSTOMER_ID = '507f1f77bcf86cd799439011';
const TYPE_ID = '507f1f77bcf86cd799439151';

/** A type flagged as placeable. `showOnPlan` is what decides, so it is set explicitly. */
const PLACEABLE = makeObjectType({ id: TYPE_ID, showOnPlan: true, category: 'EQUIPMENT' });

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof FloorPlanPanel>> = {},
) {
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

/**
 * The plan image laid out at a known size.
 *
 * The whole coordinate model is "a fraction of the rendered box", and jsdom lays nothing
 * out, so the box is stated here and the assertions are about the fraction that comes back.
 */
function layOutImage(image: HTMLElement, width = 400, height = 200): void {
  vi.spyOn(image, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

async function planImage(): Promise<HTMLElement> {
  return screen.findByAltText('2 давхарын төлөвлөгөө');
}

describe('FloorPlanPanel placement', () => {
  beforeEach(() => {
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:plan');
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([PLACEABLE]));
  });

  it('registers an object at the clicked spot with normalised coordinates', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    const { props } = renderPanel();

    const image = await planImage();
    layOutImage(image);

    // A quarter across and halfway down the drawing.
    fireEvent.pointerUp(image, { clientX: 100, clientY: 100 });

    // A compact drawer, not a route to the full object form.
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
          planPosition: { x: 0.25, y: 0.5 },
        }),
      );
    });

    // The markers are redrawn from the refreshed floor, not patched in locally.
    await waitFor(() => expect(props.onChanged).toHaveBeenCalled());
  });

  /** The same fraction whatever the image is laid out at: that is the point of normalising. */
  it('reports the same fraction at a different rendered size', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderPanel();

    const image = await planImage();
    layOutImage(image, 800, 400);
    fireEvent.pointerUp(image, { clientX: 200, clientY: 200 });

    const drawer = await screen.findByRole('dialog');
    await user.selectOptions(within(drawer).getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(within(drawer).getByLabelText(/^Код/), 'EQ-78');
    await user.type(within(drawer).getByLabelText(/^Нэр/), 'Хоёр дахь');
    await user.click(within(drawer).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ planPosition: { x: 0.25, y: 0.5 } }),
      );
    });
  });

  it('draws a marker for every placed object of a placeable type', async () => {
    renderPanel({
      objects: [
        makeObjectListItem({
          id: 'o1',
          code: 'EQ-01',
          name: 'Гэрэл',
          objectType: { id: TYPE_ID, code: 'MCB', name: 'Автомат таслуур', icon: 'BREAKER', showOnPlan: true },
          planPosition: { x: 0.5, y: 0.25 },
        }),
      ],
    });

    const marker = await screen.findByRole('button', { name: 'EQ-01 · Гэрэл' });
    expect(marker).toHaveStyle({ left: '50%', top: '25%' });
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
      objects: [
        makeObjectListItem({
          id: 'o1',
          code: 'EQ-01',
          name: 'Гэрэл',
          objectType: { id: TYPE_ID, code: 'MCB', name: 'Автомат таслуур', icon: 'BREAKER', showOnPlan: false },
          planPosition: { x: 0.5, y: 0.25 },
        }),
      ],
    });

    expect(
      await screen.findByText(/План дээр байрлуулах тоноглолын төрөл тохируулагдаагүй/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'EQ-01 · Гэрэл' })).not.toBeInTheDocument();
  });

  it('repositions a marker on drag and sends only the new coordinates', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockResolvedValue(makeObjectDetail());

    renderPanel({
      objects: [
        makeObjectListItem({
          id: 'o1',
          code: 'EQ-01',
          name: 'Гэрэл',
          objectType: { id: TYPE_ID, code: 'MCB', name: 'Автомат таслуур', icon: 'BREAKER', showOnPlan: true },
          planPosition: { x: 0.5, y: 0.25 },
        }),
      ],
    });

    const image = await planImage();
    layOutImage(image);

    const marker = screen.getByRole('button', { name: 'EQ-01 · Гэрэл' });
    fireEvent.pointerDown(marker, { clientX: 200, clientY: 50 });
    fireEvent.pointerUp(marker, { clientX: 300, clientY: 150 });

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('o1', { planPosition: { x: 0.75, y: 0.75 } });
    });
  });

  it('clears a position from the selected marker', async () => {
    const update = vi
      .spyOn(objectMasterService, 'updatePosition')
      .mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderPanel({
      objects: [
        makeObjectListItem({
          id: 'o1',
          code: 'EQ-01',
          name: 'Гэрэл',
          objectType: { id: TYPE_ID, code: 'MCB', name: 'Автомат таслуур', icon: 'BREAKER', showOnPlan: true },
          planPosition: { x: 0.5, y: 0.25 },
        }),
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'EQ-01 · Гэрэл' }));
    await user.click(await screen.findByRole('button', { name: 'Байрлал арилгах' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith('o1', { planPosition: null });
    });
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
    renderPanel({ canPlace: false });

    const image = await planImage();
    layOutImage(image);
    fireEvent.pointerUp(image, { clientX: 100, clientY: 100 });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
