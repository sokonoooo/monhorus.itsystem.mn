import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
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
});
