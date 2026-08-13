import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MapPickerProps } from '../../components/ui/MapPicker';
import { projectService } from '../../services/project.service';
import { makeBuilding, makePage, makeProject } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ProjectDetailPage } from './ProjectDetailPage';

/**
 * Leaflet measures a real element, which jsdom does not lay out, so the picker itself is
 * replaced by a stub. The stub keeps the same props contract and the same two coordinate
 * inputs, so everything asserted here is the form's own wiring rather than the map's.
 */
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
      <button type="button" onClick={() => onChange({ latitude: 47.9175, longitude: 106.9172 })}>
        Газрын зураг дээр дарах
      </button>
    </div>
  ),
}));

const PROJECT_ID = '507f1f77bcf86cd799439101';

function renderProject() {
  return renderWithAuth(<ProjectDetailPage />, {
    permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
    route: `/projects/${PROJECT_ID}`,
    path: '/projects/:projectId',
  });
}

async function openBuildingDrawer(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Шинэ барилга' }));
  return screen.findByRole('dialog');
}

describe('ProjectDetailPage building create', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(makeProject());
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(makePage([]));
  });

  /**
   * `BLD-001` is drawn from a per-customer counter the server holds. The pattern keeps `^`
   * and drops `$` because `Field` appends a `*` to a required label, so a plain equality
   * query would pass even with the field still on screen.
   */
  it('asks for no code when creating a building', async () => {
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    expect(within(drawer).queryByLabelText(/^Код/)).toBeNull();
  });

  /** Absent, not empty: the create schema strips what it does not declare. */
  it('sends a create payload with no code key at all', async () => {
    const create = vi.spyOn(projectService, 'createBuilding').mockResolvedValue(makeBuilding());
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    await user.type(within(drawer).getByLabelText(/^Барилгын нэр/), 'Кодгүй барилга');
    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ code: expect.anything() }));
    });
    expect('code' in create.mock.calls[0]![0]).toBe(false);
  });

  it('sends the coordinates chosen on the map together with the rest of the form', async () => {
    const create = vi.spyOn(projectService, 'createBuilding').mockResolvedValue(makeBuilding());
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    await user.type(within(drawer).getByLabelText(/^Барилгын нэр/), 'Шинэ корпус');
    await user.type(within(drawer).getByLabelText('Хаяг'), 'Их сургуулийн гудамж 3');
    await user.click(within(drawer).getByRole('button', { name: 'Газрын зураг дээр дарах' }));
    await user.type(within(drawer).getByLabelText('Тайлбар'), 'Гурван орцтой');

    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        name: 'Шинэ корпус',
        address: 'Их сургуулийн гудамж 3',
        gpsLatitude: 47.9175,
        gpsLongitude: 106.9172,
        description: 'Гурван орцтой',
      });
    });
  });

  it('keeps the coordinates editable by hand next to the map', async () => {
    const create = vi.spyOn(projectService, 'createBuilding').mockResolvedValue(makeBuilding());
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    await user.type(within(drawer).getByLabelText(/^Барилгын нэр/), 'Агуулах');
    await user.type(within(drawer).getByLabelText('Өргөрөг'), '48');
    await user.type(within(drawer).getByLabelText('Уртраг'), '107');

    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ gpsLatitude: 48, gpsLongitude: 107 }),
      );
    });
  });

  /** The shared schema refuses half a coordinate; the message belongs under the map. */
  it('reports a half-filled coordinate pair instead of sending it', async () => {
    const create = vi.spyOn(projectService, 'createBuilding').mockResolvedValue(makeBuilding());
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    await user.type(within(drawer).getByLabelText(/^Барилгын нэр/), 'Зогсоол');
    await user.type(within(drawer).getByLabelText('Өргөрөг'), '48');

    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    expect(
      await within(drawer).findByText('Өргөрөг, уртрагийг хамт бөглөнө.'),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('omits the optional fields that were left empty', async () => {
    const create = vi.spyOn(projectService, 'createBuilding').mockResolvedValue(makeBuilding());
    const user = userEvent.setup();

    renderProject();
    const drawer = await openBuildingDrawer(user);

    await user.type(within(drawer).getByLabelText(/^Барилгын нэр/), 'Дэд станц');

    await user.click(within(drawer).getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          address: null,
          gpsLatitude: null,
          gpsLongitude: null,
          description: null,
        }),
      );
    });
  });
});

/**
 * The building table used to fetch one capped page of 100 and render no pager, so a
 * project with more buildings than that simply lost the rest. It now pages like every
 * other list, and filters on the server rather than in the browser.
 */
describe('ProjectDetailPage building table', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(makeProject());
  });

  it('asks the server for page two and numbers its rows from 21', async () => {
    const list = vi.spyOn(projectService, 'listBuildings').mockResolvedValue({
      ...makePage([makeBuilding()]),
      page: 2,
      total: 21,
      totalPages: 2,
    });

    renderWithAuth(<ProjectDetailPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
      route: `/projects/${PROJECT_ID}?page=2`,
      path: '/projects/:projectId',
    });

    const table = await screen.findByRole('table');
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT_ID, page: 2, limit: 20 }),
    );
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^21$/);
  });

  it('fetches the next page when the pager is used', async () => {
    const list = vi
      .spyOn(projectService, 'listBuildings')
      .mockImplementation(async (query) => ({
        ...makePage([makeBuilding()]),
        page: query?.page ?? 1,
        total: 40,
        totalPages: 2,
      }));
    const user = userEvent.setup();

    renderProject();

    await screen.findByRole('table');
    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() => {
      expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }));
    });
  });

  /** Server-side: a browser-side filter would only ever search the page on screen. */
  it('sends the search to the service and returns to the first page', async () => {
    const list = vi.spyOn(projectService, 'listBuildings').mockResolvedValue({
      ...makePage([makeBuilding()]),
      page: 2,
      total: 21,
      totalPages: 2,
    });
    const user = userEvent.setup();

    renderWithAuth(<ProjectDetailPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE],
      route: `/projects/${PROJECT_ID}?page=2`,
      path: '/projects/:projectId',
    });

    await screen.findByRole('table');
    await user.type(screen.getByLabelText('Хайлт'), 'Төв{Enter}');

    await waitFor(() => {
      expect(list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'Төв', page: 1, limit: 20 }),
      );
    });
  });
});

describe('ProjectDetailPage delete blockers', () => {
  beforeEach(() => {
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(makePage([]));
  });

  /** The reasons are read after the content they refer to, not before it. */
  it('reports why deletion is blocked in a box at the bottom of the page', async () => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(
      makeProject({ deleteBlockers: ['1 барилга бүртгэлтэй.'] }),
    );

    renderProject();

    const box = await screen.findByText('Устгах боломжгүй');
    expect(screen.getByText('1 барилга бүртгэлтэй.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();

    const buildings = screen.getByRole('heading', { name: 'Барилга' });
    expect(buildings.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('shows no blocker box to a caller who cannot manage the project', async () => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(
      makeProject({ deleteBlockers: ['1 барилга бүртгэлтэй.'] }),
    );

    renderWithAuth(<ProjectDetailPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW],
      route: `/projects/${PROJECT_ID}`,
      path: '/projects/:projectId',
    });

    await screen.findByRole('heading', { name: 'Барилга' });
    expect(screen.queryByText('Устгах боломжгүй')).not.toBeInTheDocument();
  });
});
