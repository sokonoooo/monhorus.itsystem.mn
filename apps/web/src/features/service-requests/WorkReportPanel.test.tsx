import { PERMISSIONS, type WorkReportDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { workReportService } from '../../services/service-request.service';
import { renderWithAuth } from '../../test/render';
import { WorkReportPanel } from './WorkReportPanel';

const REQUEST_ID = '507f1f77bcf86cd799439401';

function makeReport(overrides: Partial<WorkReportDto> = {}): WorkReportDto {
  return {
    id: '507f1f77bcf86cd799439501',
    serviceRequestId: REQUEST_ID,
    status: 'DRAFT',
    score: 78,
    riskLevel: 'ATTENTION',
    conclusion: 'Холболт сул байсныг чангаллаа.',
    recommendation: '7 хоногийн дараа дахин шалгах.',
    actionTaken: null,
    repairRequired: false,
    revisitRequired: false,
    revisitDate: null,
    beforePhotos: [
      {
        id: 'p1',
        name: 'before.png',
        downloadUrl: '/files/p1',
        mimeType: 'image/png',
        sizeBytes: 1024,
        uploadedByName: 'Б. Энхтөр',
        uploadedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    afterPhotos: [
      {
        id: 'p2',
        name: 'after.png',
        downloadUrl: '/files/p2',
        mimeType: 'image/png',
        sizeBytes: 1024,
        uploadedByName: 'Б. Энхтөр',
        uploadedAt: '2026-07-29T00:00:00.000Z',
      },
    ],
    materials: [],
    objects: [],
    objectAssessments: [],
    missing: [],
    isComplete: true,
    createdByName: 'Б. Энхтөр',
    submittedByName: null,
    submittedAt: null,
    approvedByName: null,
    approvedAt: null,
    returnedByName: null,
    returnedAt: null,
    returnReason: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    updatedAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}

function render(permissions: string[]) {
  return renderWithAuth(<WorkReportPanel requestId={REQUEST_ID} />, {
    permissions: permissions as never,
  });
}

/**
 * Opens the report and returns the drawer to scope assertions to.
 *
 * Scoping matters: the trigger button and the drawer heading carry the same words, so a
 * bare `getByText('Ажлын дүгнэлт')` matches twice once the drawer is open.
 */
async function openReport(): Promise<HTMLElement> {
  await userEvent.click(await screen.findByRole('button', { name: 'Ажлын дүгнэлт' }));
  return screen.getByRole('dialog');
}

describe('WorkReportPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -- The trigger ------------------------------------------------------------
  //
  // The body is the tallest thing on the request detail page and is read far less often
  // than the status and history around it, so the page carries the trigger alone.

  it('keeps the page to a button until the report is opened', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);

    expect(await screen.findByRole('button', { name: 'Ажлын дүгнэлт' })).toBeInTheDocument();
    expect(screen.queryByText('Холболт сул байсныг чангаллаа.')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the status on the trigger, without opening anything', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport({ status: 'SUBMITTED' }));

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);

    expect(await screen.findByText('Админ хянах')).toBeInTheDocument();
  });

  /** Rule 17.6: an unfinishable request must be obvious without hunting for it. */
  it('marks an incomplete conclusion on the trigger row', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({ isComplete: false, missing: ['SCORE'] }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);

    expect(await screen.findByText('Дутуу мэдээлэлтэй')).toBeInTheDocument();
  });

  // -- The report itself ------------------------------------------------------

  it('shows the conclusion with its score and band', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);
    const drawer = await openReport();

    expect(within(drawer).getByText('Холболт сул байсныг чангаллаа.')).toBeInTheDocument();
    expect(within(drawer).getAllByLabelText('Анхаарах шаардлагатай 78%').length).toBeGreaterThan(0);
  });

  /** Rules 17.6 and 17.7: the technician must see every outstanding field at once. */
  it('names every missing mandatory field', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({
        isComplete: false,
        missing: ['SCORE', 'RECOMMENDATION', 'AFTER_PHOTO'],
        score: null,
        riskLevel: null,
      }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    // Scoped to the alert: "Зөвлөмж" also labels the field below it.
    const alert = within(drawer).getByText('Дараах мэдээлэл дутуу байна').closest('div');
    expect(alert).not.toBeNull();
    const missing = within(alert as HTMLElement)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(missing).toEqual(['Үнэлгээ (0-100)', 'Зөвлөмж', 'Ажлын дараах зураг']);
  });

  it('will not let an incomplete conclusion be submitted', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({ isComplete: false, missing: ['SCORE'] }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    expect(within(drawer).getByRole('button', { name: 'Хянуулахаар илгээх' })).toBeDisabled();
  });

  it('submits a complete conclusion', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());
    const submit = vi
      .spyOn(workReportService, 'submit')
      .mockResolvedValue(makeReport({ status: 'SUBMITTED' }));

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Хянуулахаар илгээх' }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith(REQUEST_ID);
    });
  });

  /** Reviewing is a different duty from recording, so the actions are separately gated. */
  it('offers approve and return only to a reviewer, and only once submitted', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport({ status: 'SUBMITTED' }));

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS]);
    const drawer = await openReport();

    expect(within(drawer).getByRole('button', { name: 'Батлах' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Буцаах' })).toBeInTheDocument();
  });

  it('hides the review actions from someone who may only record', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport({ status: 'SUBMITTED' }));

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    expect(within(drawer).queryByRole('button', { name: 'Батлах' })).not.toBeInTheDocument();
  });

  it('shows why a conclusion came back', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({ status: 'RETURNED', returnReason: 'Зураг тодорхойгүй.' }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);
    const drawer = await openReport();

    expect(within(drawer).getByText('Засварлуулахаар буцаасан')).toBeInTheDocument();
    expect(within(drawer).getByText('Зураг тодорхойгүй.')).toBeInTheDocument();
  });

  it('offers no editing once the conclusion is approved', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({ status: 'APPROVED', approvedByName: 'Д. Мөнхбат' }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    expect(within(drawer).queryByRole('button', { name: 'Засах' })).not.toBeInTheDocument();
  });

  /** Section 9.2 does not make materials mandatory, so their absence is explained. */
  it('says materials are optional when none were recorded', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);
    const drawer = await openReport();

    expect(
      within(drawer).getByText(/Материал зарцуулаагүй ажлыг ч дуусгана/),
    ).toBeInTheDocument();
  });

  /** Requirement 11: who wrote it and when, at the end of the conclusion. */
  it('prints the author and the time it was written', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW]);
    const drawer = await openReport();

    expect(within(drawer).getByText(/Бичсэн: Б. Энхтөр/)).toBeInTheDocument();
  });

  // -- One drawer at a time ---------------------------------------------------
  //
  // Drawer is a plain fixed overlay with no stacking order of its own, so two open at
  // once would share a body scroll lock and both close on one Escape. Editing therefore
  // replaces the report view, and closing the editor hands the reader back to it.

  it('replaces the report with the editor rather than stacking them', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();

    await userEvent.click(within(drawer).getByRole('button', { name: 'Засах' }));

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const editor = screen.getByRole('dialog');
    expect(editor).toHaveAttribute('aria-label', 'Дүгнэлт тайлан гаргах');

    // Backing out of the editor returns to the report, not to the page.
    await userEvent.click(within(editor).getByRole('button', { name: 'Цуцлах' }));
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Ажлын дүгнэлт');
  });
});

// -- Equipment assessment ----------------------------------------------------
//
// The request records only where the call was; WHAT was inspected is discovered on site,
// so the equipment is chosen here and each piece gets its own finding.

describe('WorkReportPanel equipment assessment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rehydrates existing per-equipment findings into the editor', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({
        objects: [{ id: 'o1', code: 'DB-01', name: 'Самбар 1' }],
        objectAssessments: [
          {
            objectId: 'o1',
            code: 'DB-01',
            name: 'Самбар 1',
            score: 42,
            observation: 'Хэт халалт',
            conclusion: 'Засвар',
            recommendation: 'Ачаалал тэнцвэржүүлэх',
            photoIds: [],
          },
        ],
      }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Засах' }));

    const editor = screen.getByRole('dialog');
    expect(within(editor).getByText('Үзлэг хийсэн тоноглол (1)')).toBeInTheDocument();
    expect(within(editor).getByDisplayValue('42')).toBeInTheDocument();
    expect(within(editor).getByDisplayValue('Хэт халалт')).toBeInTheDocument();
  });

  /** An object named but not yet written up is a real draft state, not an error. */
  it('lists an object named without a finding, ready to fill in', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({
        objects: [{ id: 'o2', code: 'DB-02', name: 'Самбар 2' }],
        objectAssessments: [],
      }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Засах' }));

    const editor = screen.getByRole('dialog');
    expect(within(editor).getByText('Үзлэг хийсэн тоноглол (1)')).toBeInTheDocument();
    expect(within(editor).getByText('Самбар 2')).toBeInTheDocument();
  });

  /** The exclusion rule, said where the technician can still act on it. */
  it('warns that a conclusion with no equipment stays out of the inspection feed', async () => {
    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({ objects: [], objectAssessments: [] }),
    );

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Засах' }));

    expect(
      within(screen.getByRole('dialog')).getByText(/Үзлэг ба дүгнэлт хэсэгт харагдахгүй/),
    ).toBeInTheDocument();
  });

  it('sends the selected equipment and its findings on save', async () => {
    // Real ObjectId shapes: `saveWorkReportSchema` validates every id, so the fixture's
    // short 'p1'/'o3' placeholders would fail the parse and the save would never fire.
    const objectId = '507f1f77bcf86cd799439701';
    const beforeId = '507f1f77bcf86cd799439801';
    const afterId = '507f1f77bcf86cd799439802';

    vi.spyOn(workReportService, 'get').mockResolvedValue(
      makeReport({
        beforePhotos: [
          {
            id: beforeId,
            name: 'before.png',
            downloadUrl: `/files/${beforeId}`,
            mimeType: 'image/png',
            sizeBytes: 1,
            uploadedByName: null,
            uploadedAt: '2026-07-29T00:00:00.000Z',
          },
        ],
        afterPhotos: [
          {
            id: afterId,
            name: 'after.png',
            downloadUrl: `/files/${afterId}`,
            mimeType: 'image/png',
            sizeBytes: 1,
            uploadedByName: null,
            uploadedAt: '2026-07-29T00:00:00.000Z',
          },
        ],
        objects: [{ id: objectId, code: 'DB-03', name: 'Самбар 3' }],
        objectAssessments: [
          {
            objectId,
            code: 'DB-03',
            name: 'Самбар 3',
            score: 55,
            observation: null,
            conclusion: null,
            recommendation: null,
            photoIds: [],
          },
        ],
      }),
    );
    const save = vi.spyOn(workReportService, 'save').mockResolvedValue(makeReport());

    render([PERMISSIONS.SERVICE_REQUEST_VIEW, PERMISSIONS.SERVICE_REQUEST_UPDATE]);
    const drawer = await openReport();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Засах' }));
    await userEvent.click(screen.getByRole('button', { name: 'Хадгалах' }));

    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });
    const payload = save.mock.calls[0]?.[1] as {
      objectIds: string[];
      objectAssessments: { objectId: string; score: number | null }[];
    };
    // Both lists carry the object: `objectIds` is membership, `objectAssessments` the finding.
    expect(payload.objectIds).toEqual([objectId]);
    expect(payload.objectAssessments).toEqual([
      expect.objectContaining({ objectId, score: 55 }),
    ]);
  });
});
