import { PERMISSIONS } from '@monhorus/shared';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { projectService } from '../../services/project.service';
import { makeBuilding, makeProject } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { CustomerObjectsTab } from './CustomerObjectsTab';

const CUSTOMER_ID = 'c1';

function render() {
  return renderWithAuth(<CustomerObjectsTab customerId={CUSTOMER_ID} />, {
    permissions: [PERMISSIONS.CUSTOMER_VIEW, PERMISSIONS.OBJECT_VIEW],
  });
}

function page<T>(items: T[], total: number) {
  return { items, total, page: 1, limit: 100, totalPages: Math.ceil(total / 100) };
}

/**
 * Two capped reads with nothing paged on screen.
 *
 * The select is a picker and the chart is a roll-up, so neither offers a next page. A cap
 * that says nothing therefore does not hide a project or a building behind a control — it
 * removes it from the screen entirely, and the chart underneath reads as the customer's
 * whole estate while covering only the first hundred buildings.
 */
describe('CustomerObjectsTab list caps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('says how many projects the select is showing when more exist', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      page([makeProject({ id: 'p1', name: 'Төсөл 1' })], 137) as never,
    );
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(page([], 0) as never);

    render();

    expect(
      await screen.findByText('Нийт 137 төслөөс эхний 1 нь жагсав.'),
    ).toBeInTheDocument();
  });

  it('says how many buildings the chart is drawn from when more exist', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      page([makeProject({ id: 'p1', name: 'Төсөл 1' })], 1) as never,
    );
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(
      page([makeBuilding({ id: 'b1', name: 'Барилга 1' })], 412) as never,
    );

    render();

    expect(
      await screen.findByText('Нийт 412 барилгаас эхний 1 нь жагсав.'),
    ).toBeInTheDocument();
  });

  it('says nothing when a single page holds everything', async () => {
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(
      page([makeProject({ id: 'p1', name: 'Төсөл 1' })], 1) as never,
    );
    vi.spyOn(projectService, 'listBuildings').mockResolvedValue(
      page([makeBuilding({ id: 'b1', name: 'Барилга 1' })], 1) as never,
    );

    render();

    // The tab rendered its picker, so this is the notice being withheld, not a failed load.
    expect(await screen.findByRole('option', { name: 'Төсөл 1' })).toBeInTheDocument();
    expect(screen.queryByText(/нь жагсав/)).not.toBeInTheDocument();
  });
});
