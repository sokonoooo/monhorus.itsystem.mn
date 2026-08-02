import {
  INSPECTION_REPORT_BLOCKER_LABELS,
  OVERALL_SAFETY_LABELS,
  PERMISSIONS,
  type InspectionReportAttachmentDto,
  type InspectionReportDto,
  type InspectionReportGroupDto,
  type InspectionReportIssueDto,
  type InspectionReportReadinessDto,
  type InspectionReportTaskDto,
  type PermissionKey,
} from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as fileUrl from '../../lib/file-url';
import { inspectionReportService } from '../../services/inspection-report.service';
import { renderWithAuth } from '../../test/render';
import { InspectionReportPage } from './InspectionReportPage';

const WORK_ID = '507f1f77bcf86cd799439061';

// -- Local fixtures -----------------------------------------------------------
// Kept in this file rather than in the shared factory module because the report is the
// only screen that consumes them, and the shared module is being edited concurrently.

function makeAttachment(
  overrides: Partial<InspectionReportAttachmentDto> = {},
): InspectionReportAttachmentDto {
  return {
    id: 'file-1',
    name: 'panel-before.png',
    downloadUrl: '/api/v1/files/file-1',
    mimeType: 'image/png',
    sizeBytes: 2048,
    stage: 'BEFORE',
    ...overrides,
  };
}

function makeReportTask(
  overrides: Partial<InspectionReportTaskDto> = {},
): InspectionReportTaskDto {
  return {
    taskId: 'task-1',
    title: 'Самбарын үзлэг',
    floorName: '1 давхар',
    status: 'DONE',
    statusLabel: 'Дууссан',
    skipped: false,
    score: 88,
    riskLevel: 'NORMAL',
    note: 'Гурван самбар шалгасан',
    recommendation: 'Холболтыг чангална',
    totalQuantity: 10,
    completedQuantity: 10,
    unit: 'PIECE',
    attachments: [],
    completedAt: '2026-07-20T02:00:00.000Z',
    assignedEmployeeName: 'Бат Дорж',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<InspectionReportGroupDto> = {}): InspectionReportGroupDto {
  return {
    floorId: 'floor-1',
    floorName: '1 давхар',
    tasks: [makeReportTask()],
    ...overrides,
  };
}

function makeIssue(overrides: Partial<InspectionReportIssueDto> = {}): InspectionReportIssueDto {
  return {
    taskId: 'task-2',
    title: 'Кабелийн шугам',
    locationLabel: '2 давхар, коридор',
    riskLevel: 'CRITICAL',
    score: 35,
    condition: 'Тусгаарлагч эвдэрсэн',
    advice: 'Кабелийг яаралтай солино',
    ...overrides,
  };
}

function makeReport(overrides: Partial<InspectionReportDto> = {}): InspectionReportDto {
  return {
    id: 'report-1',
    plannedWorkId: WORK_ID,
    status: 'DRAFT',
    version: 1,

    workNumber: 'PW-2026-0001',
    workTitle: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    customerName: 'Монгол Барилга ХХК',
    projectName: 'Төв оффисын цахилгаан хангамж',
    buildingName: 'А блок',
    locationLabel: 'Улаанбаатар, Сүхбаатар дүүрэг',
    inspectionStart: '2026-07-18T02:00:00.000Z',
    inspectionEnd: '2026-07-20T02:00:00.000Z',
    responsibleEmployeeNames: ['Бат Дорж'],
    responsibleTeamNames: ['Цахилгааны баг'],
    contractorName: 'Монхорус ХХК',
    actName: 'Ил ба далд ажлын акт №12',
    inspectedScope: 'Самбар болон холболтыг шалгасан',

    groups: [makeGroup()],
    issues: [makeIssue()],

    overallLevel: 'CRITICAL',
    overallLabel: OVERALL_SAFETY_LABELS.CRITICAL,
    issueSummary: 'Нэг кабелийн тусгаарлагч эвдэрсэн',
    conclusion: 'Ерөнхийдөө ажиллагаатай боловч эрсдэлтэй',
    recommendation: 'Кабелийг солих',
    replacementPanels: ['Самбар А1'],
    replacementConnections: ['Холболт К3'],
    isAutoDraft: false,

    createdByName: 'Бат Дорж',
    createdByPosition: 'Цахилгаанчин',
    createdAt: '2026-07-21T02:00:00.000Z',
    submittedByName: null,
    submittedAt: null,
    approvedByName: null,
    approvedByPosition: null,
    approvedAt: null,
    returnedByName: null,
    returnedAt: null,
    returnReason: null,
    finalisedByName: null,
    finalisedAt: null,
    updatedAt: '2026-07-21T02:00:00.000Z',
    ...overrides,
  };
}

function makeReadiness(
  overrides: Partial<InspectionReportReadinessDto> = {},
): InspectionReportReadinessDto {
  return {
    canGenerate: true,
    blockers: [],
    outstandingTaskTitles: [],
    existingReportId: 'report-1',
    ...overrides,
  };
}

function renderPage(permissions: readonly PermissionKey[]) {
  return renderWithAuth(<InspectionReportPage />, {
    permissions,
    route: `/planned-work/${WORK_ID}/inspection-report`,
    path: '/planned-work/:plannedWorkId/inspection-report',
  });
}

/** Mounts the page with a report already present and waits for the heading block. */
async function renderWithReport(
  report: InspectionReportDto,
  permissions: readonly PermissionKey[],
) {
  vi.spyOn(inspectionReportService, 'readiness').mockResolvedValue(makeReadiness());
  vi.spyOn(inspectionReportService, 'get').mockResolvedValue(report);

  const result = renderPage(permissions);
  await screen.findByRole('region', { name: 'Тайлангийн толгой' });
  return result;
}

describe('InspectionReportPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:attachment');
  });

  it('names every blocker and the outstanding sub-tasks, and refuses to generate', async () => {
    vi.spyOn(inspectionReportService, 'readiness').mockResolvedValue(
      makeReadiness({
        canGenerate: false,
        blockers: ['TASKS_INCOMPLETE', 'SCORES_MISSING'],
        outstandingTaskTitles: ['Самбарын үзлэг', 'Гэрэлтүүлгийн үзлэг'],
        existingReportId: null,
      }),
    );
    const generate = vi.spyOn(inspectionReportService, 'generate');

    renderPage([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT]);

    const banner = await screen.findByRole('status');
    expect(
      within(banner).getByText(INSPECTION_REPORT_BLOCKER_LABELS.TASKS_INCOMPLETE),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText(INSPECTION_REPORT_BLOCKER_LABELS.SCORES_MISSING),
    ).toBeInTheDocument();
    expect(within(banner).getByText('Гэрэлтүүлгийн үзлэг')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: 'Тайлан үүсгэх' })).toBeDisabled();
    expect(generate).not.toHaveBeenCalled();
  });

  it('offers generation once the planned work is ready', async () => {
    vi.spyOn(inspectionReportService, 'readiness').mockResolvedValue(
      makeReadiness({ existingReportId: null }),
    );
    const generate = vi
      .spyOn(inspectionReportService, 'generate')
      .mockResolvedValue(makeReport());
    const user = userEvent.setup();

    renderPage([PERMISSIONS.PLANNED_WORK_VIEW, PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT]);

    const button = await screen.findByRole('button', { name: 'Тайлан үүсгэх' });
    expect(button).toBeEnabled();

    await user.click(button);
    await waitFor(() => {
      expect(generate).toHaveBeenCalledWith(WORK_ID);
    });
  });

  it('renders the printed heading block', async () => {
    await renderWithReport(makeReport(), [PERMISSIONS.PLANNED_WORK_VIEW]);

    const heading = screen.getByRole('region', { name: 'Тайлангийн толгой' });
    expect(within(heading).getByText('Төв оффисын цахилгаан хангамж')).toBeInTheDocument();
    expect(within(heading).getByText('Монхорус ХХК')).toBeInTheDocument();
    expect(within(heading).getByText('Ил ба далд ажлын акт №12')).toBeInTheDocument();
    expect(within(heading).getByText('Цахилгааны баг')).toBeInTheDocument();
  });

  it('groups the sub-tasks by floor and links into each one', async () => {
    await renderWithReport(
      makeReport({
        groups: [
          makeGroup({
            floorId: 'floor-1',
            floorName: '1 давхар',
            tasks: [makeReportTask({ taskId: 'task-1', title: 'Самбарын үзлэг' })],
          }),
          makeGroup({
            floorId: 'floor-2',
            floorName: '2 давхар',
            tasks: [
              makeReportTask({
                taskId: 'task-2',
                title: 'Гэрэлтүүлгийн үзлэг',
                floorName: '2 давхар',
                note: 'Гэрэлтүүлэг хэвийн',
              }),
            ],
          }),
        ],
      }),
      [PERMISSIONS.PLANNED_WORK_VIEW],
    );

    const section = screen.getByRole('region', { name: 'Дэд ажлын үзлэг' });
    expect(within(section).getByRole('heading', { name: '1 давхар' })).toBeInTheDocument();
    expect(within(section).getByRole('heading', { name: '2 давхар' })).toBeInTheDocument();
    expect(within(section).getByText('Самбарын үзлэг')).toBeInTheDocument();
    expect(within(section).getByText('Гурван самбар шалгасан')).toBeInTheDocument();
    expect(within(section).getByText('Гэрэлтүүлэг хэвийн')).toBeInTheDocument();

    expect(
      within(section).getByRole('link', { name: 'Гэрэлтүүлгийн үзлэг дэд ажил руу очих' }),
    ).toHaveAttribute('href', `/planned-work/${WORK_ID}?task=task-2`);
  });

  /**
   * A skipped check that looks like a completed one is the dangerous reading of a safety
   * report, so it must be marked in its own right and not left to the status label.
   */
  it('marks a skipped sub-task apart from an inspected one', async () => {
    await renderWithReport(
      makeReport({
        groups: [
          makeGroup({
            tasks: [
              makeReportTask({ taskId: 'task-1', title: 'Самбарын үзлэг' }),
              makeReportTask({
                taskId: 'task-2',
                title: 'Газардуулга хэмжилт',
                skipped: true,
                status: 'SKIPPED',
                statusLabel: 'Алгассан',
                score: null,
                riskLevel: null,
                note: null,
              }),
            ],
          }),
        ],
      }),
      [PERMISSIONS.PLANNED_WORK_VIEW],
    );

    const section = screen.getByRole('region', { name: 'Дэд ажлын үзлэг' });
    const skipped = within(section).getByText('Газардуулга хэмжилт').closest('li');
    const inspected = within(section).getByText('Самбарын үзлэг').closest('li');

    expect(skipped).not.toBeNull();
    expect(within(skipped as HTMLElement).getByText('Хийгдээгүй')).toBeInTheDocument();
    expect(within(inspected as HTMLElement).queryByText('Хийгдээгүй')).not.toBeInTheDocument();
  });

  it('opens a sub-task attachment as an enlarged preview', async () => {
    await renderWithReport(
      makeReport({
        groups: [
          makeGroup({
            tasks: [makeReportTask({ attachments: [makeAttachment()] })],
          }),
        ],
      }),
      [PERMISSIONS.PLANNED_WORK_VIEW],
    );
    const user = userEvent.setup();

    const download = await screen.findByRole('link', { name: 'Татах' });
    expect(download).toHaveAttribute('href', 'blob:attachment');

    await user.click(screen.getByRole('button', { name: 'panel-before.png томруулж харах' }));

    const preview = await screen.findByRole('dialog', { name: 'panel-before.png' });
    expect(within(preview).getByAltText('panel-before.png')).toHaveAttribute(
      'src',
      'blob:attachment',
    );
  });

  it('lists the findings with their band, condition and advice', async () => {
    await renderWithReport(makeReport(), [PERMISSIONS.PLANNED_WORK_VIEW]);

    const findings = screen.getByRole('region', { name: 'Илэрсэн зөрчил' });
    const row = within(findings).getByRole('row', { name: /Кабелийн шугам/ });
    expect(within(row).getByText('2 давхар, коридор')).toBeInTheDocument();
    expect(within(row).getByText(OVERALL_SAFETY_LABELS.CRITICAL)).toBeInTheDocument();
    expect(within(row).getByText('Тусгаарлагч эвдэрсэн')).toBeInTheDocument();
    expect(within(row).getByText('Кабелийг яаралтай солино')).toBeInTheDocument();
  });

  it('renders the overall safety verdict', async () => {
    await renderWithReport(makeReport(), [PERMISSIONS.PLANNED_WORK_VIEW]);

    const overall = screen.getByRole('region', { name: 'Ерөнхий аюулгүй байдлын түвшин' });
    expect(within(overall).getByText(OVERALL_SAFETY_LABELS.CRITICAL)).toBeInTheDocument();
  });

  it('shows an unscored report as Үнэлгээгүй and never as a safe band', async () => {
    await renderWithReport(
      makeReport({
        overallLevel: null,
        overallLabel: null,
        issues: [],
        groups: [makeGroup({ tasks: [makeReportTask({ score: null, riskLevel: null })] })],
      }),
      [PERMISSIONS.PLANNED_WORK_VIEW],
    );

    const overall = screen.getByRole('region', { name: 'Ерөнхий аюулгүй байдлын түвшин' });
    expect(within(overall).getByText('Үнэлгээгүй')).toBeInTheDocument();
    expect(within(overall).queryByText(OVERALL_SAFETY_LABELS.NORMAL)).not.toBeInTheDocument();
  });

  it('saves the narrative and both replacement lists through PATCH', async () => {
    await renderWithReport(makeReport(), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    ]);
    const update = vi.spyOn(inspectionReportService, 'update').mockResolvedValue(makeReport());
    const user = userEvent.setup();

    const narrative = screen.getByRole('region', { name: 'Тайлангийн бичвэр' });
    const conclusion = within(narrative).getByLabelText('Дүгнэлт');
    await user.clear(conclusion);
    await user.type(conclusion, 'Шинэ дүгнэлт');

    const panels = within(narrative).getByLabelText('Шинэчлэх шаардлагатай самбарууд');
    await user.clear(panels);
    await user.type(panels, 'Самбар А1{enter}Самбар Б2');

    await user.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(update).toHaveBeenCalled();
    });
    expect(update.mock.calls[0]![0]).toBe(WORK_ID);
    expect(update.mock.calls[0]![1]).toEqual({
      inspectedScope: 'Самбар болон холболтыг шалгасан',
      issueSummary: 'Нэг кабелийн тусгаарлагч эвдэрсэн',
      conclusion: 'Шинэ дүгнэлт',
      recommendation: 'Кабелийг солих',
      replacementPanels: ['Самбар А1', 'Самбар Б2'],
      replacementConnections: ['Холболт К3'],
    });
  });

  it('says plainly when the narrative is still the system draft', async () => {
    await renderWithReport(makeReport({ isAutoDraft: true }), [PERMISSIONS.PLANNED_WORK_VIEW]);

    expect(screen.getByText('Системийн боловсруулсан бичвэр')).toBeInTheDocument();
    expect(screen.getByText(/систем автоматаар боловсруулсан/)).toBeInTheDocument();
  });

  it('offers only the DRAFT transition to an author', async () => {
    await renderWithReport(makeReport({ status: 'DRAFT' }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    ]);

    expect(screen.getByRole('button', { name: 'Хянуулахаар илгээх' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Батлах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Буцаах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Эцэслэх' })).not.toBeInTheDocument();
  });

  it('gives a submitted report no author actions and a read-only narrative', async () => {
    await renderWithReport(makeReport({ status: 'SUBMITTED' }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    ]);

    expect(screen.queryByRole('button', { name: 'Хадгалах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Хянуулахаар илгээх' })).not.toBeInTheDocument();
    // The reviewer's actions need the approve permission, which this caller lacks.
    expect(screen.queryByRole('button', { name: 'Батлах' })).not.toBeInTheDocument();

    const narrative = screen.getByRole('region', { name: 'Тайлангийн бичвэр' });
    expect(within(narrative).getByLabelText('Дүгнэлт')).toBeDisabled();
  });

  it('offers approve and return to a reviewer of a submitted report', async () => {
    await renderWithReport(makeReport({ status: 'SUBMITTED' }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);

    expect(screen.getByRole('button', { name: 'Батлах' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Буцаах' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Эцэслэх' })).not.toBeInTheDocument();
  });

  it('offers finalise and return on an approved report', async () => {
    await renderWithReport(makeReport({ status: 'APPROVED' }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);

    expect(screen.getByRole('button', { name: 'Эцэслэх' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Буцаах' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Батлах' })).not.toBeInTheDocument();
  });

  it('refuses to return a report until a reason is given', async () => {
    await renderWithReport(makeReport({ status: 'SUBMITTED' }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);
    const returnReport = vi
      .spyOn(inspectionReportService, 'returnReport')
      .mockResolvedValue(makeReport({ status: 'RETURNED' }));
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Буцаах' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Буцаах' });
    expect(confirm).toBeDisabled();
    expect(returnReport).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Буцаах шалтгаан/), 'Дүгнэлт дутуу');
    await user.click(within(dialog).getByRole('button', { name: 'Буцаах' }));

    await waitFor(() => {
      expect(returnReport).toHaveBeenCalledWith(WORK_ID, { reason: 'Дүгнэлт дутуу' });
    });
  });

  it('keeps a finalised report read-only and names the version rule', async () => {
    await renderWithReport(makeReport({ status: 'FINALISED', version: 2 }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
      PERMISSIONS.PLANNED_WORK_APPROVE_REPORT,
    ]);

    expect(screen.queryByRole('button', { name: 'Хадгалах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Хянуулахаар илгээх' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Батлах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Эцэслэх' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Буцаах' })).not.toBeInTheDocument();

    const narrative = screen.getByRole('region', { name: 'Тайлангийн бичвэр' });
    expect(within(narrative).getByLabelText('Дүгнэлт')).toBeDisabled();

    expect(screen.getByText('Эцэслэгдсэн тайлан. Хувилбар 2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Шинэ хувилбар үүсгэх' })).toBeInTheDocument();
  });

  it('withholds the new version action from a caller without the approve permission', async () => {
    await renderWithReport(makeReport({ status: 'FINALISED', version: 2 }), [
      PERMISSIONS.PLANNED_WORK_VIEW,
      PERMISSIONS.PLANNED_WORK_SUBMIT_REPORT,
    ]);

    expect(
      screen.queryByRole('button', { name: 'Шинэ хувилбар үүсгэх' }),
    ).not.toBeInTheDocument();
  });

  it('prints the signature block at the end', async () => {
    await renderWithReport(
      makeReport({
        status: 'APPROVED',
        approvedByName: 'Дорж Сүх',
        approvedByPosition: 'Ерөнхий инженер',
        approvedAt: '2026-07-22T02:00:00.000Z',
      }),
      [PERMISSIONS.PLANNED_WORK_VIEW],
    );

    const signatures = screen.getByRole('region', { name: 'Гарын үсэг' });
    expect(within(signatures).getByText('Бат Дорж')).toBeInTheDocument();
    expect(within(signatures).getByText('Цахилгаанчин')).toBeInTheDocument();
    expect(within(signatures).getByText('Дорж Сүх')).toBeInTheDocument();
    expect(within(signatures).getByText('Ерөнхий инженер')).toBeInTheDocument();
  });
});
