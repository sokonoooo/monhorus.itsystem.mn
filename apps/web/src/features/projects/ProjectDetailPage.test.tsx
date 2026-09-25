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

  /**
   * The blue box that used to list the reasons is gone; what remains is the missing button.
   * Why a project with dependants cannot be deleted is now read in the help panel, so the
   * page must not grow the notice back.
   */
  it('withholds delete while blockers exist, without a notice on the page', async () => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(
      makeProject({ deleteBlockers: ['1 барилга бүртгэлтэй.'] }),
    );

    renderProject();

    await screen.findByRole('heading', { name: 'Барилга' });
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();
    expect(screen.queryByText('Устгах боломжгүй')).not.toBeInTheDocument();
    expect(screen.queryByText('1 барилга бүртгэлтэй.')).not.toBeInTheDocument();
  });

  it('offers no delete or edit to a caller who cannot manage the project', async () => {
    vi.spyOn(projectService, 'getProject').mockResolvedValue(
      makeProject({ deleteBlockers: ['1 барилга бүртгэлтэй.'] }),
    );

    renderWithAuth(<ProjectDetailPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW],
      route: `/projects/${PROJECT_ID}`,
      path: '/projects/:projectId',
    });

    await screen.findByRole('heading', { name: 'Барилга' });
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Засах' })).not.toBeInTheDocument();
    expect(screen.queryByText('1 барилга бүртгэлтэй.')).not.toBeInTheDocument();
  });
});

/**
 * Buildings under a project used to arrive as one `limit: 100` fetch rendered whole, so a
 * large project's hundred-and-first building was absent from the page with nothing saying
 * so. These pin the window, the numbering across it, and the pager that moves it.
 */
describe('ProjectDetailPage building list paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(projectService, 'getProject').mockResolvedValue(makeProject());
  });

  function buildingPage(page: number, count: number, total: number) {
    return {
      items: Array.from({ length: count }, (_, offset) =>
        makeBuilding({
          id: `b-${page}-${offset}`,
          code: `BLD-${page}-${offset}`,
          name: `Барилга ${page}-${offset}`,
        }),
      ),
      page,
      limit: 20,
      total,
      totalPages: Math.ceil(total / 20),
    };
  }

  it('asks for one page of buildings rather than a hundred', async () => {
    const list = vi
      .spyOn(projectService, 'listBuildings')
      .mockResolvedValue(buildingPage(1, 20, 120));

    renderProject();
    await screen.findByRole('table');

    expect(list).toHaveBeenCalledWith({ projectId: PROJECT_ID, page: 1, limit: 20 });
  });

  it('numbers the buildings continuously across pages', async () => {
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(buildingPage(3, 20, 120));

    renderProject();

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    // Page 3 of 20 begins at 41. Restarting at 1 is the failure this exists to catch.
    expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('41');
  });

  it('states the project total rather than the rows on screen', async () => {
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(buildingPage(1, 20, 120));

    renderProject();
    await screen.findByRole('table');

    expect(screen.getByText(/Нийт 120/)).toBeInTheDocument();
  });

  it('asks the server for the next page when the pager is used', async () => {
    const user = userEvent.setup();
    const list = vi
      .spyOn(projectService, 'listBuildings')
      .mockResolvedValue(buildingPage(1, 20, 120));

    renderProject();
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    await waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ projectId: PROJECT_ID, page: 2, limit: 20 }),
    );
  });

  /** One page is one screen: the pager has nothing to offer and must not appear. */
  it('offers no pager when every building fits on one page', async () => {
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(buildingPage(1, 3, 3));

    renderProject();
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Дараах' })).not.toBeInTheDocument();
  });
});
