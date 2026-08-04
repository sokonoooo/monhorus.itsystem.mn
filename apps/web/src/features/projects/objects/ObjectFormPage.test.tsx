import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectMasterService, objectTypeService } from '../../../services/object-master.service';
import { objectService } from '../../../services/object.service';
import { projectService } from '../../../services/project.service';
import {
  makeFloor,
  makeObjectDetail,
  makeObjectListItem,
  makeObjectType,
  makePage,
} from '../../../test/fixtures';
import { renderWithAuth } from '../../../test/render';
import { ObjectFormPage } from './ObjectFormPage';

const FLOOR_ID = '507f1f77bcf86cd799439121';
const TYPE_ID = '507f1f77bcf86cd799439151';

function renderCreate() {
  return renderWithAuth(<ObjectFormPage />, {
    permissions: [
      PERMISSIONS.OBJECT_MASTER_VIEW,
      PERMISSIONS.OBJECT_MASTER_MANAGE,
      PERMISSIONS.OBJECT_MASTER_ASSESS,
    ],
    route: `/floors/${FLOOR_ID}/objects/new`,
    path: '/floors/:floorId/objects/new',
  });
}

/** No floor in the route: the customer is chosen and the floor is optional. */
function renderFloorlessCreate() {
  return renderWithAuth(<ObjectFormPage />, {
    permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
    route: '/objects/new',
    path: '/objects/new',
  });
}

describe('ObjectFormPage', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    vi.spyOn(projectService, 'listFloors').mockResolvedValue(makePage([makeFloor()]));
    vi.spyOn(objectTypeService, 'list').mockResolvedValue(makePage([makeObjectType()]));
    vi.spyOn(objectMasterService, 'list').mockResolvedValue(makePage([]));
    vi.spyOn(objectService, 'customers').mockResolvedValue([
      {
        id: '507f1f77bcf86cd799439011',
        code: 'CT',
        name: 'Central Tower ХХК',
      } as never,
    ]);
  });

  /** The free-text note is a stored column, so it has to be reachable on create. */
  it('sends the note along with the description', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-11');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Салхивчийн мотор');
    await user.type(screen.getByLabelText('Тайлбар'), 'Дээвэр дээр байрлана');
    await user.type(screen.getByLabelText('Тэмдэглэл'), 'Түлхүүр нь харуулын постонд');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'EQ-11',
          name: 'Салхивчийн мотор',
          description: 'Дээвэр дээр байрлана',
          notes: 'Түлхүүр нь харуулын постонд',
        }),
      );
    });
  });

  it('leaves the note null when it was not filled in', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-12');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Агаар сэлгэгч');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ notes: null }));
    });
  });

  /**
   * Section 10.1 requires the action taken alongside the conclusion and the recommendation
   * once the score falls in the red or black band, and the backend refuses the assessment
   * without it. The field did not exist at all, so a red score created the object and then
   * lost its assessment to a toast. The band is resolved from the configured thresholds,
   * never from a number written into the form.
   */
  it('requires the action taken before a red score can be saved', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-13');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Ноцтой тоноглол');

    // 20 sits in the red band under the shipped thresholds.
    await user.type(screen.getByLabelText(/^Үнэлгээ/), '20');
    expect(await screen.findByLabelText(/^Авах арга хэмжээ/)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^Дүгнэлт/), 'Тусгаарлагч эвдэрсэн');
    await user.type(screen.getByLabelText(/^Зөвлөмж/), 'Яаралтай солих');
    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    // Nothing is written: the object and the assessment are two calls, and letting the
    // first one through would leave an object on record whose score was thrown away.
    expect(await screen.findByText('Улаан/хар төлөвт авах арга хэмжээ заавал.')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('sends the action taken with a red assessment once it is filled in', async () => {
    vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'uploadAssessmentPhoto').mockResolvedValue({
      id: '507f1f77bcf86cd799439199',
    } as never);
    const assess = vi
      .spyOn(objectMasterService, 'recordAssessment')
      .mockResolvedValue({} as never);
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-14');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Ноцтой тоноглол');
    await user.type(screen.getByLabelText(/^Үнэлгээ/), '20');
    await user.type(screen.getByLabelText(/^Дүгнэлт/), 'Тусгаарлагч эвдэрсэн');
    await user.type(screen.getByLabelText(/^Зөвлөмж/), 'Яаралтай солих');
    await user.type(screen.getByLabelText(/^Авах арга хэмжээ/), 'Тэжээлийг тасаллаа');
    await user.upload(
      screen.getByLabelText('Нотлох зураг'),
      new File(['x'], 'evidence.png', { type: 'image/png' }),
    );

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(assess).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          newScore: 20,
          conclusion: 'Тусгаарлагч эвдэрсэн',
          recommendation: 'Яаралтай солих',
          actionTaken: 'Тэжээлийг тасаллаа',
        }),
      );
    });
  });

  /** A green score asks for none of the conditional fields. */
  it('leaves the action taken optional for a normal score', async () => {
    vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'uploadAssessmentPhoto').mockResolvedValue({
      id: '507f1f77bcf86cd799439199',
    } as never);
    const assess = vi
      .spyOn(objectMasterService, 'recordAssessment')
      .mockResolvedValue({} as never);
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-15');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Хэвийн тоноглол');
    await user.type(screen.getByLabelText(/^Үнэлгээ/), '95');
    await user.upload(
      screen.getByLabelText('Нотлох зураг'),
      new File(['x'], 'evidence.png', { type: 'image/png' }),
    );

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(assess).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ newScore: 95, actionTaken: null }),
      );
    });
  });

  /**
   * The API has always accepted a floorless object, so registration does not have to start
   * by walking down to a specific floor.
   */
  it('registers an object with no floor at all', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderFloorlessCreate();

    await user.selectOptions(
      await screen.findByLabelText(/^Харилцагч/),
      '507f1f77bcf86cd799439011',
    );
    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-16');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Агуулахын насос');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'EQ-16',
          customerId: '507f1f77bcf86cd799439011',
          floorId: null,
        }),
      );
    });
  });

  /** The floor is a choice here, not a read-only echo of the route. */
  it('offers the floor as an optional selection when there is none in the route', async () => {
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderFloorlessCreate();

    await user.selectOptions(
      await screen.findByLabelText(/^Харилцагч/),
      '507f1f77bcf86cd799439011',
    );

    const floorField = await screen.findByLabelText(/^Давхар/);
    expect(floorField).toBeEnabled();
    await user.selectOptions(floorField, FLOOR_ID);

    await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-17');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Давхарт холбогдсон');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.objectContaining({ floorId: FLOOR_ID }));
    });
  });

  /**
   * Registering a device into a panel enclosure.
   *
   * The route arrives carrying the panel, and the floor it is reached through supplies the
   * customer and the building. What is left is a type and a name.
   */
  describe('registering onto a panel', () => {
    const PANEL_ID = '507f1f77bcf86cd799439161';

    /** The form as the "register on this panel" action opens it. */
    function renderOnPanel() {
      return renderWithAuth(<ObjectFormPage />, {
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
        route: `/floors/${FLOOR_ID}/objects/new?category=EQUIPMENT&panelId=${PANEL_ID}`,
        path: '/floors/:floorId/objects/new',
      });
    }

    beforeEach(() => {
      vi.spyOn(objectMasterService, 'list').mockImplementation(async (query = {}) =>
        makePage(
          query.category === 'PANEL'
            ? [makeObjectListItem({ id: PANEL_ID, code: 'DB-2A', name: 'Түгээх самбар 2A' })]
            : [],
        ),
      );
    });

    it('pre-fills the panel and sends it with the new device', async () => {
      vi.spyOn(objectMasterService, 'codeSuggestion').mockResolvedValue({
        code: 'DB-2A-01',
        basedOn: 'DB-2A',
      });
      const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderOnPanel();

      const panelSelect = await screen.findByLabelText('Байрлах самбар');
      await waitFor(() => expect(panelSelect).toHaveValue(PANEL_ID));

      await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
      await user.type(screen.getByLabelText(/^Нэр\*/), 'Гүйдэл алдалтын хамгаалалт');
      await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            category: 'EQUIPMENT',
            floorId: FLOOR_ID,
            code: 'DB-2A-01',
            // The mount is sent; no circuit was chosen and none was invented from it.
            equipment: expect.objectContaining({ panelId: PANEL_ID, circuitId: null }),
          }),
        );
      });
    });

    /**
     * The code is a suggestion the server produced, and it stays a suggestion: typing over
     * it is what gets registered.
     */
    it('fills the code from the backend suggestion and leaves it editable', async () => {
      const suggest = vi.spyOn(objectMasterService, 'codeSuggestion').mockResolvedValue({
        code: 'DB-2A-03',
        basedOn: 'DB-2A',
      });
      const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderOnPanel();

      const codeField = await screen.findByLabelText(/^Код/);
      await waitFor(() => expect(codeField).toHaveValue('DB-2A-03'));
      expect(suggest).toHaveBeenCalledWith(PANEL_ID);
      // The field says where the value came from rather than presenting it as fixed.
      expect(screen.getByText(/DB-2A самбараас санал болгов/)).toBeInTheDocument();

      await user.clear(codeField);
      await user.type(codeField, 'MY-OWN-01');
      await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
      await user.type(screen.getByLabelText(/^Нэр\*/), 'Гараар нэрлэсэн');
      await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(expect.objectContaining({ code: 'MY-OWN-01' }));
      });
    });

    /** A suggestion that arrives late must not land on top of what the user has typed. */
    it('never overwrites a code the user has already begun typing', async () => {
      let release: (value: { code: string; basedOn: string }) => void = () => undefined;
      vi.spyOn(objectMasterService, 'codeSuggestion').mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );
      const user = userEvent.setup();

      renderOnPanel();

      const codeField = await screen.findByLabelText(/^Код/);
      await user.type(codeField, 'TYPED-FIRST');

      release({ code: 'DB-2A-01', basedOn: 'DB-2A' });

      await waitFor(() => {
        expect(screen.getByText(/DB-2A самбараас санал болгов/)).toBeInTheDocument();
      });
      expect(codeField).toHaveValue('TYPED-FIRST');
    });

    /** Nothing is asked for, and nothing is sent, when no panel is in play. */
    it('asks for no code suggestion when the form was not opened from a panel', async () => {
      const suggest = vi.spyOn(objectMasterService, 'codeSuggestion');

      renderWithAuth(<ObjectFormPage />, {
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
        route: `/floors/${FLOOR_ID}/objects/new`,
        path: '/floors/:floorId/objects/new',
      });

      const panelSelect = await screen.findByLabelText('Байрлах самбар');
      expect(panelSelect).toHaveValue('');
      expect(suggest).not.toHaveBeenCalled();
    });
  });

  /**
   * The backend refuses a connection whose two ends stand in different buildings, so a
   * dropdown listing the whole tenant was offering choices that could only come back as a
   * field error. These tests pin the query the form sends, because that query is the whole
   * mechanism: the list is narrowed at the source rather than filtered after the fact.
   */
  describe('building-scoped connection pickers', () => {
    const BUILDING_ID = '507f1f77bcf86cd799439111';
    const PANEL_HERE = '507f1f77bcf86cd799439161';
    const PANEL_ELSEWHERE = '507f1f77bcf86cd799439162';
    const CIRCUIT_HERE = '507f1f77bcf86cd799439171';
    const CIRCUIT_ELSEWHERE = '507f1f77bcf86cd799439172';

    /**
     * Stands in for the API's own building filter: a query carrying `buildingId` comes back
     * with the one asset in that building, and an unscoped query comes back with both.
     */
    function mockScopedList(): ReturnType<typeof vi.spyOn> {
      return vi
        .spyOn(objectMasterService, 'list')
        .mockImplementation(async (query = {}) => {
          const scoped = query.buildingId === BUILDING_ID;
          if (query.category === 'PANEL') {
            const here = makeObjectListItem({
              id: PANEL_HERE,
              code: 'DB-HERE',
              name: 'Энэ барилгын самбар',
            });
            const away = makeObjectListItem({
              id: PANEL_ELSEWHERE,
              code: 'DB-AWAY',
              name: 'Өөр барилгын самбар',
              buildingName: 'Хоёрдугаар барилга',
            });
            return makePage(scoped ? [here] : [here, away]);
          }
          if (query.category === 'CIRCUIT') {
            const here = makeObjectListItem({
              id: CIRCUIT_HERE,
              code: 'HL-HERE',
              name: 'Энэ барилгын хэлхээ',
              category: 'CIRCUIT',
            });
            const away = makeObjectListItem({
              id: CIRCUIT_ELSEWHERE,
              code: 'HL-AWAY',
              name: 'Өөр барилгын хэлхээ',
              category: 'CIRCUIT',
              buildingName: 'Хоёрдугаар барилга',
            });
            return makePage(scoped ? [here] : [here, away]);
          }
          return makePage([]);
        }) as ReturnType<typeof vi.spyOn>;
    }

    it('asks for panels in the anchor floor’s building only, and offers no others', async () => {
      const list = mockScopedList();
      const user = userEvent.setup();

      renderCreate();

      await user.selectOptions(await screen.findByLabelText(/^Ангилал/), 'CIRCUIT');

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'PANEL', buildingId: BUILDING_ID }),
        );
      });

      const panelSelect = await screen.findByLabelText('Харьяалагдах самбар');
      await waitFor(() => {
        expect(within(panelSelect).queryByText(/Энэ барилгын самбар/)).not.toBeNull();
      });
      expect(within(panelSelect).queryByText(/Өөр барилгын самбар/)).toBeNull();
    });

    it('asks for circuits in the anchor floor’s building only', async () => {
      const list = mockScopedList();

      renderCreate();

      // EQUIPMENT is the default category, so the circuit picker is on screen already.
      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'CIRCUIT', buildingId: BUILDING_ID }),
        );
      });

      const circuitSelect = await screen.findByLabelText('Тэжээх хэлхээ');
      await waitFor(() => {
        expect(within(circuitSelect).queryByText(/Энэ барилгын хэлхээ/)).not.toBeNull();
      });
      expect(within(circuitSelect).queryByText(/Өөр барилгын хэлхээ/)).toBeNull();
    });

    /**
     * A floorless object has no building, and the backend leaves its connections
     * unconstrained. Narrowing the list here would hide valid choices, so the picker stays
     * tenant-wide until a floor is chosen — and narrows the moment one is.
     */
    it('stays tenant-wide while the object has no floor, and narrows once one is picked', async () => {
      const list = mockScopedList();
      const user = userEvent.setup();

      renderFloorlessCreate();

      await user.selectOptions(
        await screen.findByLabelText(/^Харилцагч/),
        '507f1f77bcf86cd799439011',
      );

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith({
          customerId: '507f1f77bcf86cd799439011',
          limit: 100,
          category: 'CIRCUIT',
        });
      });

      const circuitSelect = await screen.findByLabelText('Тэжээх хэлхээ');
      await waitFor(() => {
        expect(within(circuitSelect).queryByText(/Өөр барилгын хэлхээ/)).not.toBeNull();
      });

      await user.selectOptions(await screen.findByLabelText(/^Давхар/), FLOOR_ID);

      await waitFor(() => {
        expect(list).toHaveBeenCalledWith(
          expect.objectContaining({ category: 'CIRCUIT', buildingId: BUILDING_ID }),
        );
      });
      await waitFor(() => {
        expect(within(circuitSelect).queryByText(/Өөр барилгын хэлхээ/)).toBeNull();
      });
    });

    /** A pick that the new building cannot honour must not survive the move. */
    it('drops a selected circuit that the chosen floor’s building does not offer', async () => {
      mockScopedList();
      const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderFloorlessCreate();

      await user.selectOptions(
        await screen.findByLabelText(/^Харилцагч/),
        '507f1f77bcf86cd799439011',
      );

      const circuitSelect = await screen.findByLabelText('Тэжээх хэлхээ');
      await waitFor(() => {
        expect(within(circuitSelect).queryByText(/Өөр барилгын хэлхээ/)).not.toBeNull();
      });
      await user.selectOptions(circuitSelect, CIRCUIT_ELSEWHERE);

      await user.selectOptions(await screen.findByLabelText(/^Давхар/), FLOOR_ID);

      await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
      await user.type(screen.getByLabelText(/^Код/), 'EQ-18');
      await user.type(screen.getByLabelText(/^Нэр\*/), 'Барилга солигдсон');

      await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            equipment: expect.objectContaining({ circuitId: null }),
          }),
        );
      });
    });
  });
});
