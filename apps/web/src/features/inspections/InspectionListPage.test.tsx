import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { inspectionService } from '../../services/report.service';
import {
  makeInspection,
  makeInspectionSummary,
  makePage,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { InspectionListPage } from './InspectionListPage';

describe('InspectionListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(makePage([]));
    vi.spyOn(inspectionService, 'summary').mockResolvedValue(makeInspectionSummary());
  });

  it('lists device conclusions with their location and conclusion text', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('RPT-202607-0001')).toBeInTheDocument();
    expect(within(table).getByText('Main Tower · 2-р давхар')).toBeInTheDocument();
    expect(within(table).getByText('Кабелийн тусгаарлагчид хэт халалт илэрсэн.')).toBeInTheDocument();
  });

  /** Section 10.1: the score is a 0-100 figure, so it reads as a percent. */
  it('shows the score as a percent', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByLabelText('Ноцтой эрсдэлтэй 38%')).toBeInTheDocument();
  });

  /**
   * Repair and revisit are findings about one piece of equipment, so they moved onto the
   * report item. The row now carries what belongs to the report as a whole: its review
   * state and the band of its worst finding.
   */
  it('shows the review state and the worst band on the row', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(
      makePage([makeInspection({ status: 'APPROVED', riskLevel: 'CRITICAL', score: 38 })]),
    );

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Батлагдсан')).toBeInTheDocument();
    expect(within(table).getAllByText('Ноцтой эрсдэлтэй').length).toBeGreaterThan(0);
  });

  it('says so when a report recorded a visit without scoring', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(
      makePage([makeInspection({ score: null, riskLevel: null })]),
    );

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    const table = await screen.findByRole('table');
    // The score cell and the status cell both say it, which is the point: an unscored
    // report reads as unscored wherever a band would otherwise appear.
    expect(within(table).getAllByText('Үнэлгээгүй').length).toBeGreaterThan(0);
  });

  it('shows the band counters in the header', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    // Scoped to the counter strip: the band names also appear as options in the risk filter.
    const counters = await screen.findByRole('group', { name: 'Үнэлгээний тоо' });
    expect(within(counters).getByText('Нийт төхөөрөмж')).toBeInTheDocument();
    expect(within(counters).getByText('Хэвийн')).toBeInTheDocument();
    expect(within(counters).getByText('Засвар шаардлагатай')).toBeInTheDocument();
    expect(within(counters).getByText('10')).toBeInTheDocument();
  });

  /** Section 19.2 leaves the aggregation method unapproved. */
  it('states that no aggregate score is produced', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    expect(await screen.findByText(/нэгдсэн оноо гаргахгүй/)).toBeInTheDocument();
  });

  it('offers the prototype filter set', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    expect(await screen.findByLabelText('Хайлт')).toBeInTheDocument();
    expect(screen.getByLabelText('Төсөл')).toBeInTheDocument();
    expect(screen.getByLabelText('Эрсдэл')).toBeInTheDocument();
    expect(screen.getByLabelText('Эхлэх огноо')).toBeInTheDocument();
  });
});
