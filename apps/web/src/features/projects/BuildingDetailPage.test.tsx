import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MapPickerProps } from '../../components/ui/MapPicker';
import { projectService } from '../../services/project.service';
import { makeBuilding, makeFloor, makePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { BuildingDetailPage } from './BuildingDetailPage';

/** Leaflet needs a laid-out element; jsdom has none. See ProjectDetailPage.test.tsx. */
vi.mock('../../components/ui/MapPicker', () => ({
  MapPicker: ({ latitude, longitude, onChange, disabled }: MapPickerProps) => (
    <div>
      <label htmlFor="stub-latitude">Өргөрөг</label>
      <input
        id="stub-latitude"
        value={latitude === null ? '' : String(latitude)}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            latitude: event.target.value === '' ? null : Number(event.target.value),
            longitude,
          })
        }
      />
      <label htmlFor="stub-longitude">Уртраг</label>
      <input
        id="stub-longitude"
        value={longitude === null ? '' : String(longitude)}
        disabled={disabled}
        onChange={(event) =>
          onChange({
            latitude,
            longitude: event.target.value === '' ? null : Number(event.target.value),
          })
        }
      />
      <button type="button" onClick={() => onChange({ latitude: 47.92, longitude: 106.92 })}>
        Газрын зураг дээр дарах
      </button>
    </div>
  ),
}));

const BUILDING_ID = '507f1f77bcf86cd799439111';

function renderBuilding() {
  return renderWithAuth(<BuildingDetailPage />, {
    permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
    route: `/buildings/${BUILDING_ID}`,
    path: '/buildings/:buildingId',
  });
}

describe('BuildingDetailPage', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'getBuilding').mockResolvedValue(makeBuilding());
    vi.spyOn(projectService, 'listFloors').mockResolvedValue(makePage([makeFloor()]));
  });

  describe('building edit', () => {
    /**
     * A code that can be edited is not an identifier, and `updateBuildingSchema` is
     * `.strict()`, so one sent from here would be refused rather than ignored. The pattern
     * keeps `^` and drops `$` because `Field` appends a `*` to a required label.
     */
    it('asks for no code', async () => {
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Засах' }));
      const drawer = await screen.findByRole('dialog');

      expect(within(drawer).queryByLabelText(/^Код/)).toBeNull();
    });

    it('opens with the stored position on the map and saves a new one', async () => {
      const update = vi.spyOn(projectService, 'updateBuilding').mockResolvedValue(makeBuilding());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Засах' }));
      const drawer = await screen.findByRole('dialog');

      // The saved coordinates arrive as the picker's current value.
      expect(within(drawer).getByLabelText('Өргөрөг')).toHaveValue('47.9175');
      expect(within(drawer).getByLabelText('Уртраг')).toHaveValue('106.9172');

      await user.click(within(drawer).getByRole('button', { name: 'Газрын зураг дээр дарах' }));
      await user.type(within(drawer).getByLabelText('Тайлбар'), 'Гадна талын шинэчлэл');
      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          BUILDING_ID,
          expect.objectContaining({
            gpsLatitude: 47.92,
            gpsLongitude: 106.92,
            description: 'Гадна талын шинэчлэл',
          }),
        );
      });
    });

    it('clears the description back to null when it is emptied', async () => {
      vi.spyOn(projectService, 'getBuilding').mockResolvedValue(
        makeBuilding({ description: 'Хуучин тайлбар' }),
      );
      const update = vi.spyOn(projectService, 'updateBuilding').mockResolvedValue(makeBuilding());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Засах' }));
      const drawer = await screen.findByRole('dialog');

      await user.clear(within(drawer).getByLabelText('Тайлбар'));
      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(update).toHaveBeenCalledWith(
          BUILDING_ID,
          expect.objectContaining({ description: null }),
        );
      });
    });
  });

  describe('floor create', () => {
    /** `FLR-001` is numbered by the server; there is nothing here to type. */
    it('asks for no code', async () => {
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Давхар нэмэх' }));
      const drawer = await screen.findByRole('dialog');

      expect(within(drawer).queryByLabelText(/^Код/)).toBeNull();
    });

    /** Absent, not empty: the create schema strips what it does not declare. */
    it('sends a create payload with no code key at all', async () => {
      const create = vi.spyOn(projectService, 'createFloor').mockResolvedValue(makeFloor());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Давхар нэмэх' }));
      const drawer = await screen.findByRole('dialog');

      await user.type(within(drawer).getByLabelText(/^Давхрын нэр/), 'Кодгүй давхар');
      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.not.objectContaining({ code: expect.anything() }),
        );
      });
      expect('code' in create.mock.calls[0]![0]).toBe(false);
    });

    it('sends every general field the floor create form asks for', async () => {
      const create = vi.spyOn(projectService, 'createFloor').mockResolvedValue(makeFloor());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Давхар нэмэх' }));
      const drawer = await screen.findByRole('dialog');

      await user.type(within(drawer).getByLabelText(/^Давхрын нэр/), '3 давхар');
      await user.type(within(drawer).getByLabelText(/^Ашиглалтын талбай/), '980');
      await user.type(within(drawer).getByLabelText('Зориулалт'), 'Оффис');
      await user.type(within(drawer).getByLabelText('Тайлбар'), 'Тусдаа хэмжих хэрэгсэлтэй');

      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith({
          buildingId: BUILDING_ID,
          name: '3 давхар',
          areaSqm: 980,
          purpose: 'Оффис',
          description: 'Тусдаа хэмжих хэрэгсэлтэй',
        });
      });
    });

    /**
     * The floor number was dropped from the create form. It is optional on the backend
     * schema and defaults to null on the model, so creation still saves; the value stays
     * editable from the floor's own edit drawer.
     */
    it('does not ask for the floor number and sends none', async () => {
      const create = vi.spyOn(projectService, 'createFloor').mockResolvedValue(makeFloor());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Давхар нэмэх' }));
      const drawer = await screen.findByRole('dialog');

      expect(within(drawer).queryByLabelText(/^Давхрын дугаар/)).not.toBeInTheDocument();

      await user.type(within(drawer).getByLabelText(/^Давхрын нэр/), '4 давхар');
      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.not.objectContaining({ floorNumber: expect.anything() }),
        );
      });
    });
  });

  /**
   * The floor table used to fetch one capped page of 100 and render no pager, so a tower
   * with more floors than that simply lost the rest. It now pages like every other list,
   * and filters on the server rather than in the browser.
   */
  describe('floor table', () => {
    it('asks the server for page two and numbers its rows from 21', async () => {
      const list = vi.spyOn(projectService, 'listFloors').mockResolvedValue({
        ...makePage([makeFloor()]),
        page: 2,
        total: 21,
        totalPages: 2,
      });

      renderWithAuth(<BuildingDetailPage />, {
        permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
        route: `/buildings/${BUILDING_ID}?page=2`,
        path: '/buildings/:buildingId',
      });

      const table = await screen.findByRole('table');
      expect(list).toHaveBeenCalledWith(
        expect.objectContaining({ buildingId: BUILDING_ID, page: 2, limit: 20 }),
      );
      expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
      const firstRow = within(table).getAllByRole('row')[1]!;
      expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^21$/);
    });

    it('fetches the next page when the pager is used', async () => {
      const list = vi.spyOn(projectService, 'listFloors').mockImplementation(async (query) => ({
        ...makePage([makeFloor()]),
        page: query?.page ?? 1,
        total: 40,
        totalPages: 2,
      }));
      const user = userEvent.setup();

      renderBuilding();

      await screen.findByRole('table');
      await user.click(screen.getByRole('button', { name: 'Дараах' }));

      await waitFor(() => {
        expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
      });
    });

    /** Server-side: a browser-side filter would only ever search the page on screen. */
    it('sends the search to the service and returns to the first page', async () => {
      const list = vi.spyOn(projectService, 'listFloors').mockResolvedValue({
        ...makePage([makeFloor()]),
        page: 2,
        total: 21,
        totalPages: 2,
      });
      const user = userEvent.setup();

      renderWithAuth(<BuildingDetailPage />, {
        permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
        route: `/buildings/${BUILDING_ID}?page=2`,
        path: '/buildings/:buildingId',
      });

      await screen.findByRole('table');
      await user.type(screen.getByLabelText('Хайлт'), '2 дав{Enter}');

      await waitFor(() => {
        expect(list).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: '2 дав', page: 1, limit: 20 }),
        );
      });
    });
  });

  /** The reasons are read after the content they refer to, not before it. */
  it('reports why deletion is blocked in a box at the bottom of the page', async () => {
    vi.spyOn(projectService, 'getBuilding').mockResolvedValue(
      makeBuilding({ deleteBlockers: ['4 давхар бүртгэлтэй.'] }),
    );

    renderBuilding();

    const box = await screen.findByText('Устгах боломжгүй');
    expect(screen.getByText('4 давхар бүртгэлтэй.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();

    const floors = screen.getByRole('heading', { name: 'Давхар' });
    expect(floors.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows the building description on the general card', async () => {
    vi.spyOn(projectService, 'getBuilding').mockResolvedValue(
      makeBuilding({ description: 'Хоёр дэд станцтай' }),
    );

    renderBuilding();

    expect(await screen.findByText('Хоёр дэд станцтай')).toBeInTheDocument();
  });
});

/**
 * Floors under a building had the same `limit: 100` fetch as buildings under a project,
 * and the same silent truncation past it. See ProjectDetailPage.test.tsx.
 */
describe('BuildingDetailPage floor list paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(projectService, 'getBuilding').mockResolvedValue(makeBuilding());
  });

  function floorPage(page: number, count: number, total: number) {
    return {
      items: Array.from({ length: count }, (_, offset) =>
        makeFloor({
          id: `f-${page}-${offset}`,
          code: `FLR-${page}-${offset}`,
          name: `Давхар ${page}-${offset}`,
        }),
      ),
      page,
      limit: 20,
      total,
      totalPages: Math.ceil(total / 20),
    };
  }

  it('asks for one page of floors rather than a hundred', async () => {
    const list = vi.spyOn(projectService, 'listFloors').mockResolvedValue(floorPage(1, 20, 60));

    renderBuilding();
    await screen.findByRole('table');

    expect(list).toHaveBeenCalledWith({ buildingId: BUILDING_ID, page: 1, limit: 20 });
  });

  it('numbers the floors continuously across pages', async () => {
    vi.spyOn(projectService, 'listFloors').mockResolvedValue(floorPage(2, 20, 60));

    renderBuilding();

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    // Page 2 of 20 begins at 21, not at 1.
    expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('21');
  });

  it('asks the server for the next page when the pager is used', async () => {
    const user = userEvent.setup();
    const list = vi.spyOn(projectService, 'listFloors').mockResolvedValue(floorPage(1, 20, 60));

    renderBuilding();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ buildingId: BUILDING_ID, page: 2, limit: 20 }),
    );
  });
});
