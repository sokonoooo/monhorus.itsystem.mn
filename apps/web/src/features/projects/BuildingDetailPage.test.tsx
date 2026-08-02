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
    it('sends every general field the floor create form asks for', async () => {
      const create = vi.spyOn(projectService, 'createFloor').mockResolvedValue(makeFloor());
      const user = userEvent.setup();

      renderBuilding();
      await user.click(await screen.findByRole('button', { name: 'Давхар нэмэх' }));
      const drawer = await screen.findByRole('dialog');

      await user.type(within(drawer).getByLabelText(/^Код/), 'FL-3');
      await user.type(within(drawer).getByLabelText(/^Давхрын нэр/), '3 давхар');
      await user.type(within(drawer).getByLabelText(/^Ашиглалтын талбай/), '980');
      await user.type(within(drawer).getByLabelText('Зориулалт'), 'Оффис');
      await user.type(within(drawer).getByLabelText('Тайлбар'), 'Тусдаа хэмжих хэрэгсэлтэй');

      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith({
          buildingId: BUILDING_ID,
          code: 'FL-3',
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

      await user.type(within(drawer).getByLabelText(/^Код/), 'FL-4');
      await user.type(within(drawer).getByLabelText(/^Давхрын нэр/), '4 давхар');
      await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.not.objectContaining({ floorNumber: expect.anything() }),
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
