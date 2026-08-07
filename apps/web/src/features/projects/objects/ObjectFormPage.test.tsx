import {
  PERMISSIONS,
  SETTING_KEYS,
  type SettingEntryDto,
  type SettingsDto,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRiskBands } from '../../../hooks/use-risk-bands';
import { objectMasterService, objectTypeService } from '../../../services/object-master.service';
import { objectService } from '../../../services/object.service';
import { projectService } from '../../../services/project.service';
import { settingsService } from '../../../services/settings.service';
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

function evalEntry(key: SettingEntryDto['key'], value: number): SettingEntryDto {
  return {
    key,
    group: 'evaluation',
    label: key,
    hint: '',
    type: 'integer',
    value,
    defaultValue: value,
    isOverridden: false,
    min: 1,
    max: 100,
    unit: 'оноо',
    updatedByName: null,
    updatedAt: null,
  };
}

/**
 * The thresholds this installation runs, as the form would read them from Тохиргоо.
 *
 * The form resolves the red/black band from these and from nothing else, so a test of the
 * conditional fields has to state which thresholds are in force. These are the shipped
 * figures, which is what the band comments in this file refer to.
 */
function evaluationSettings(): SettingsDto {
  return {
    canManage: true,
    groups: [
      {
        group: 'evaluation',
        label: 'Үнэлгээ',
        description: '',
        entries: [
          evalEntry(SETTING_KEYS.EVAL_NORMAL_MIN, 81),
          evalEntry(SETTING_KEYS.EVAL_ATTENTION_MIN, 61),
          evalEntry(SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN, 41),
          evalEntry(SETTING_KEYS.EVAL_CRITICAL_MIN, 21),
        ],
      },
    ],
  };
}

describe('ObjectFormPage', () => {
  beforeEach(() => {
    invalidateRiskBands();
    vi.spyOn(settingsService, 'get').mockResolvedValue(evaluationSettings());
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
   * `useRiskBands` returns null when the thresholds cannot be read, rather than passing off
   * the shipped constants as the ones in force. This form then cannot tell which side of
   * the line a score falls on, so it asks for all three findings and states no threshold —
   * the alternative is writing the object and losing the assessment to a backend refusal.
   */
  it('demands all three findings, without naming a band, when the thresholds cannot be read', async () => {
    invalidateRiskBands();
    vi.spyOn(settingsService, 'get').mockRejectedValue(new Error('offline'));
    const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderCreate();

    await user.selectOptions(await screen.findByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
    await user.type(screen.getByLabelText(/^Код/), 'EQ-16');
    await user.type(screen.getByLabelText(/^Нэр\*/), 'Хэвийн тоноглол');
    // 95 would be green under the shipped thresholds, but no thresholds are known.
    await user.type(screen.getByLabelText(/^Үнэлгээ/), '95');

    expect(await screen.findByText(/тохиргоог уншиж чадсангүй/)).toBeInTheDocument();
    // No band is stated in either direction.
    expect(screen.queryByText(/улаан\/хар түвшинд байна/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    expect(
      await screen.findByText('Үнэлгээний түвшин тодорхойгүй тул дүгнэлт заавал.'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
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

  /**
   * The category's electrical fields are two dozen optional figures, every one of them
   * nullish at the API. They are folded into a section rather than laid out in front of
   * somebody registering a socket — but never over something that matters, which is what
   * these tests are about: values already entered and errors already raised open it.
   */
  describe('the electrical section', () => {
    const OBJECT_ID = '507f1f77bcf86cd799439181';

    function electricalToggle(): HTMLElement {
      return screen.getByRole('button', { name: /Цахилгааны мэдээлэл/ });
    }

    /** The form as the edit action opens it, over the object the API hands back. */
    function renderEdit() {
      return renderWithAuth(<ObjectFormPage />, {
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
        route: `/floors/${FLOOR_ID}/objects/${OBJECT_ID}/edit`,
        path: '/floors/:floorId/objects/:objectId/edit',
      });
    }

    it('starts folded away on a new object, with its fields out of sight', async () => {
      renderCreate();

      await waitFor(() => expect(electricalToggle()).toHaveAttribute('aria-expanded', 'false'));
      // Present, so nothing about the form's state depends on the fold — and not shown.
      expect(screen.getByLabelText('Нэрлэсэн чадал (kW)')).not.toBeVisible();
      expect(screen.getByLabelText('Тоо ширхэг')).not.toBeVisible();
      expect(screen.getByLabelText('Тэжээх хэлхээ')).not.toBeVisible();
      // What the form does open with: the identity fields, the description and the note.
      expect(screen.getByLabelText(/^Нэр\*/)).toBeVisible();
      expect(screen.getByLabelText('Тэмдэглэл')).toBeVisible();
    });

    it('reveals the fields when opened and sends what was typed into them', async () => {
      const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderCreate();

      await user.click(await screen.findByRole('button', { name: /Цахилгааны мэдээлэл/ }));
      expect(electricalToggle()).toHaveAttribute('aria-expanded', 'true');

      const ratedPower = screen.getByLabelText('Нэрлэсэн чадал (kW)');
      expect(ratedPower).toBeVisible();

      await user.type(ratedPower, '3.5');
      await user.type(screen.getByLabelText('Тоо ширхэг'), '2');
      await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
      await user.type(screen.getByLabelText(/^Код/), 'EQ-21');
      await user.type(screen.getByLabelText(/^Нэр\*/), 'Нээгээд бөглөсөн');

      await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

      await waitFor(() => {
        expect(create).toHaveBeenCalledWith(
          expect.objectContaining({
            equipment: expect.objectContaining({ ratedPowerKw: 3.5, quantity: 2 }),
          }),
        );
      });
    });

    /** A capacity already on record must not be hidden behind a fold nobody knew to open. */
    it('opens itself on an object that already carries electrical values', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
        makeObjectDetail({
          category: 'PANEL',
          panel: { capacityKw: 25, location: 'Баруун жигүүр', protection: 'IP54' },
        }),
      );

      renderEdit();

      const capacity = await screen.findByLabelText('Хүчин чадал (kW)');
      expect(capacity).toHaveValue(25);
      expect(capacity).toBeVisible();
      expect(electricalToggle()).toHaveAttribute('aria-expanded', 'true');
    });

    it('stays folded away on an object that carries none', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
        makeObjectDetail({
          category: 'PANEL',
          panel: { capacityKw: null, location: null, protection: null },
        }),
      );

      renderEdit();

      await waitFor(() => expect(electricalToggle()).toHaveAttribute('aria-expanded', 'false'));
      expect(screen.getByLabelText('Хүчин чадал (kW)')).not.toBeVisible();
    });

    /**
     * The case that would otherwise be a dead end: a save refused over a message folded out
     * of sight, with nothing on screen to say why. The error opens the section itself, and
     * it does so over the user's own decision to close it.
     */
    it('opens itself, over a fold the user chose, when an error lands inside it', async () => {
      const create = vi.spyOn(objectMasterService, 'create').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderCreate();

      await user.click(await screen.findByRole('button', { name: /Цахилгааны мэдээлэл/ }));
      // Zero fails `quantity`: the schema asks for a whole number above nothing.
      await user.type(screen.getByLabelText('Тоо ширхэг'), '0');

      await user.click(electricalToggle());
      expect(screen.getByLabelText('Тоо ширхэг')).not.toBeVisible();

      await user.selectOptions(screen.getByLabelText(/^Тоноглолын төрөл/), TYPE_ID);
      await user.type(screen.getByLabelText(/^Код/), 'EQ-22');
      await user.type(screen.getByLabelText(/^Нэр\*/), 'Далдалсан алдаа');
      await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

      const quantity = await screen.findByLabelText('Тоо ширхэг');
      await waitFor(() => expect(quantity).toBeVisible());
      expect(electricalToggle()).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByText('Тоо ширхэг 0-ээс их байна.')).toBeVisible();
      expect(create).not.toHaveBeenCalled();
    });

    /**
     * The register-on-this-panel route arrives with the mount already chosen, and the code
     * suggestion is asked for off the back of it. Both are values the form was opened
     * carrying, so the section is open on arrival rather than hiding where the code came
     * from.
     */
    it('is open on arrival when the route pre-filled the mounting panel', async () => {
      const PANEL_ID = '507f1f77bcf86cd799439161';
      vi.spyOn(objectMasterService, 'list').mockImplementation(async (query = {}) =>
        makePage(
          query.category === 'PANEL'
            ? [makeObjectListItem({ id: PANEL_ID, code: 'DB-2A', name: 'Түгээх самбар 2A' })]
            : [],
        ),
      );
      vi.spyOn(objectMasterService, 'codeSuggestion').mockResolvedValue({
        code: 'DB-2A-01',
        basedOn: 'DB-2A',
      });

      renderWithAuth(<ObjectFormPage />, {
        permissions: [PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE],
        route: `/floors/${FLOOR_ID}/objects/new?category=EQUIPMENT&panelId=${PANEL_ID}`,
        path: '/floors/:floorId/objects/new',
      });

      const mount = await screen.findByLabelText('Байрлах самбар');
      await waitFor(() => expect(mount).toHaveValue(PANEL_ID));
      expect(mount).toBeVisible();
      expect(electricalToggle()).toHaveAttribute('aria-expanded', 'true');
      await waitFor(() => expect(screen.getByLabelText(/^Код/)).toHaveValue('DB-2A-01'));
    });
  });
});
