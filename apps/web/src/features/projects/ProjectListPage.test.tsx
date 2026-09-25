import { PERMISSIONS, type PaginatedData, type ProjectDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { makePage, makeProject, makeRiskSummary } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { ProjectListPage } from './ProjectListPage';

describe('ProjectListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);
  });

  /** Requirement 10.2: the risk picture has to be visible without opening every floor. */
  it('shows the risk band counts on each project row', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      makePage([
        makeProject({
          riskSummary: makeRiskSummary({
            counts: [
              { level: 'NORMAL', count: 30 },
              { level: 'CRITICAL', count: 2 },
            ],
            unassessedCount: 10,
            hasCritical: true,
            lastAssessedAt: '2026-07-01T00:00:00.000Z',
          }),
        }),
      ]),
    );

    renderWithAuth(<ProjectListPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Үнэлгээ' })).toBeInTheDocument();
    expect(within(table).getByLabelText('Хэвийн 30')).toBeInTheDocument();
    expect(within(table).getByLabelText('Ноцтой эрсдэлтэй 2')).toBeInTheDocument();
    expect(within(table).getByLabelText('Үнэлгээгүй 10')).toBeInTheDocument();
    expect(within(table).getByText('Анхаар')).toBeInTheDocument();
  });

  it('shows a dash for a project with nothing assessed', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(makePage([makeProject()]));

    renderWithAuth(<ProjectListPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).queryByText('Анхаар')).not.toBeInTheDocument();
  });

  /**
   * Row numbers only mean something if they are continuous: asked to "check project 21",
   * a reader must find it as row 21 on page two, not as row 1 all over again.
   */
  it('numbers page two from 21 rather than restarting at 1', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue({
      ...makePage([makeProject()]),
      page: 2,
      total: 21,
      totalPages: 2,
    });

    renderWithAuth(<ProjectListPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW],
      route: '/projects?page=2',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^21$/);
  });

  /**
   * A filter change drops the page, so the numbering has to follow the new first page.
   * Numbering off the response rather than off the query is what makes that automatic.
   */
  it('restarts the numbering at 1 when a filter clears the page', async () => {
    function page(number: number): PaginatedData<ProjectDto> {
      return { ...makePage([makeProject()]), page: number, total: 21, totalPages: 2 };
    }
    const list = vi
      .spyOn(projectService, 'listProjects')
      .mockImplementation(async (query) => page(query?.page ?? 1));
    const user = userEvent.setup();

    renderWithAuth(<ProjectListPage />, {
      permissions: [PERMISSIONS.OBJECT_VIEW],
      route: '/projects?page=2',
    });

    const table = await screen.findByRole('table');
    await waitFor(() =>
      expect(
        within(within(table).getAllByRole('row')[1]!).getAllByRole('cell')[0],
      ).toHaveTextContent(/^21$/),
    );

    await user.selectOptions(screen.getByLabelText('Төлөв'), 'true');

    expect(list).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1, isActive: true }));
    await waitFor(() =>
      expect(
        within(within(screen.getByRole('table')).getAllByRole('row')[1]!).getAllByRole('cell')[0],
      ).toHaveTextContent(/^1$/),
    );
  });
});

/**
 * The creator column.
 *
 * Projects had no creator field at all until now, so the interesting case is the second
 * test: every record that already existed has nothing to show, and must say so plainly
 * rather than rendering an empty cell that reads as a rendering fault.
 */
describe('ProjectListPage creator column', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('shows who created each project', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      makePage([makeProject({ createdByName: 'Б. Энхтөр' })]),
    );

    renderWithAuth(<ProjectListPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Үүсгэсэн' })).toBeInTheDocument();
    expect(within(table).getByText('Б. Энхтөр')).toBeInTheDocument();
  });

  it('renders a dash for a record created before the creator was recorded', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      makePage([makeProject({ createdByName: null })]),
    );

    renderWithAuth(<ProjectListPage />, { permissions: [PERMISSIONS.OBJECT_VIEW] });

    const table = await screen.findByRole('table');
    const cells = within(within(table).getAllByRole('row')[1]!).getAllByRole('cell');
    expect(cells.at(-1)).toHaveTextContent('-');
  });
});
