import { PERMISSIONS, SETTING_KEYS, type SettingEntryDto, type SettingsDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invalidateRiskBands } from '../../hooks/use-risk-bands';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { inspectionService } from '../../services/report.service';
import { settingsService } from '../../services/settings.service';
import {
  makeInspection,
  makeInspectionSummary,
  makePage,
} from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { InspectionListPage } from './InspectionListPage';

function evalEntry(key: SettingEntryDto['key'], value: number): SettingEntryDto {
  return {
    key,
    group: 'evaluation',
    label: key,
    hint: '',
    type: 'integer',
    value,
    defaultValue: value,
    isOverridden: true,
    min: 1,
    max: 100,
    unit: 'оноо',
    updatedByName: null,
    updatedAt: null,
  };
}

/** Thresholds deliberately unlike the shipped 81/61/41/21, so a fallback would be visible. */
function evaluationSettings(): SettingsDto {
  return {
    canManage: true,
    groups: [
      {
        group: 'evaluation',
        label: 'Үнэлгээ',
        description: '',
        entries: [
          evalEntry(SETTING_KEYS.EVAL_NORMAL_MIN, 90),
          evalEntry(SETTING_KEYS.EVAL_ATTENTION_MIN, 70),
          evalEntry(SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN, 50),
          evalEntry(SETTING_KEYS.EVAL_CRITICAL_MIN, 30),
        ],
      },
    ],
  };
}

describe('InspectionListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateRiskBands();
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);
    vi.spyOn(projectService, 'listProjects').mockResolvedValue(makePage([]));
    vi.spyOn(inspectionService, 'summary').mockResolvedValue(makeInspectionSummary());
    vi.spyOn(settingsService, 'get').mockResolvedValue(evaluationSettings());
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
      .spyOn(settingsService, 'get')
      .mockRejectedValue(new ApiError('Энэ үйлдлийг хийх эрх байхгүй байна.', 'FORBIDDEN', 403));
    vi.spyOn(inspectionService, 'list').mockResolvedValue(makePage([makeInspection()]));

    renderWithAuth(<InspectionListPage />, { permissions: [PERMISSIONS.OBJECT_MASTER_VIEW] });

    await waitFor(() => expect(get).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/81-100%/)).not.toBeInTheDocument());
    expect(screen.queryByText(/%\s*Хэвийн/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0-20% Ашиглах боломжгүй/)).not.toBeInTheDocument();
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
