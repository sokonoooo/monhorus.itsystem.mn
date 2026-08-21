import { DEFAULT_RISK_BANDS, PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRiskBands } from '../../hooks/use-risk-bands';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { inspectionService } from '../../services/report.service';
import { vocabularyService } from '../../services/vocabulary.service';
import {
  makeInspection,
  makeInspectionSummary,
  makePage,
  makeRiskBandsAt,
  makeVocabulary,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { InspectionListPage } from './InspectionListPage';

/**
 * Cut points deliberately unlike the shipped 81/61/41/21, so a fallback would be visible.
 *
 * The four thresholds are now one configured ladder published by `GET /vocabulary`, so it is
 * stated whole rather than as four scalar settings keys; the numbers are the same ones this
 * file has always run against.
 */
function evaluationSettings() {
  return makeVocabulary({ bands: makeRiskBandsAt([0, 30, 50, 70, 90]) });
}

describe('InspectionListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateRiskBands();
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(makePage([]));
    vi.spyOn(inspectionService, 'summary').mockResolvedValue(makeInspectionSummary());
    vi.spyOn(vocabularyService, 'get').mockResolvedValue(evaluationSettings());
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

  /**
   * Row numbers only mean something if they are continuous: asked to "check conclusion 26",
   * a reader must find it as row 26 on page two, not as row 1 all over again.
   */
  it('numbers page two from 26 rather than restarting at 1', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue({
      ...makePage([makeInspection()], 25),
      page: 2,
      total: 26,
      totalPages: 2,
    });

    renderWithAuth(<InspectionListPage />, {
      permissions: [PERMISSIONS.OBJECT_MASTER_VIEW],
      route: '/inspections?page=2',
    });

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    const firstRow = within(table).getAllByRole('row')[1]!;
    expect(within(firstRow).getAllByRole('cell')[0]).toHaveTextContent(/^26$/);
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

  it('draws the legend from the thresholds in force, not from the shipped constants', async () => {
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    expect(await screen.findByText('90-100% Хэвийн')).toBeInTheDocument();
    expect(screen.getByText('0-29% Ашиглах боломжгүй')).toBeInTheDocument();
    // The shipped defaults start the green band at 81; this installation starts it at 90.
    expect(screen.queryByText('81-100% Хэвийн')).not.toBeInTheDocument();
  });

  /**
   * The bug: `use-risk-bands` fell back to the bundled `RISK_BANDS` when the settings read
   * failed, so a refused `GET /settings` printed 81-100% as though that were the threshold
   * in force. Saying nothing is the only honest answer.
   */
  it('says nothing about the bands when the thresholds cannot be read', async () => {
    const get = vi
      .spyOn(vocabularyService, 'get')
      .mockRejectedValue(new ApiError('Энэ үйлдлийг хийх эрх байхгүй байна.', 'FORBIDDEN', 403));
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/81-100%/)).not.toBeInTheDocument());
    expect(screen.queryByText(/%\s*Хэвийн/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0-20% Ашиглах боломжгүй/)).not.toBeInTheDocument();
  });

  /**
   * A stored ladder with a hole in it must read as UNKNOWN, not as the shipped one.
   *
   * `riskBandsOf` substitutes `DEFAULT_RISK_BANDS` for a ladder that fails validation, which
   * is exactly the "bundled values presented as the rule" answer this screen refuses — so
   * the hook checks validity before that call and returns null instead.
   */
  it('says nothing about the bands when the stored ladder does not tile 0-100', async () => {
    vi.spyOn(vocabularyService, 'get').mockResolvedValue({
      requestStages: [],
      // Nothing starts at 0, so a score below 30 falls in no band at all.
      riskBands: [
        { level: 'NORMAL', label: 'Хэвийн', colour: 'green', min: 95, max: 100 },
        { level: 'OUT_OF_SERVICE', label: 'Ашиглах боломжгүй', colour: 'black', min: 30, max: 94 },
      ],
    });
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    expect(await screen.findByRole('table')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/%\s*Хэвийн/)).not.toBeInTheDocument());
    expect(screen.queryByText(/81-100%/)).not.toBeInTheDocument();
  });

  /**
   * The band NAME is the administrator's, not the bundle's — the point of a configurable
   * ladder. It reaches the row, the filter and the legend alike.
   */
  it('prints the configured band name rather than the shipped wording', async () => {
    vi.spyOn(vocabularyService, 'get').mockResolvedValue(
      makeVocabulary({
        bands: DEFAULT_RISK_BANDS.map((band) =>
          band.key === 'CRITICAL' ? { ...band, label: 'Яаралтай' } : band,
        ),
      }),
    );
    vi.spyOn(inspectionService, 'list').mockResolvedValue(
      makePage([makeInspection({ riskLevel: 'CRITICAL', score: 38 })]),
    );

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await waitFor(() => expect(screen.getAllByText('Яаралтай').length).toBeGreaterThan(0));
    expect(screen.queryByText('21-40% Ноцтой эрсдэлтэй')).not.toBeInTheDocument();
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
