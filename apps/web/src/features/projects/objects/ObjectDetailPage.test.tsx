import { PERMISSIONS, type ObjectAssessmentDto, type ObjectPhotoDto } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/api-client';
import * as fileUrl from '../../../lib/file-url';
import { objectMasterService } from '../../../services/object-master.service';
import { projectService } from '../../../services/project.service';
import { dispatchService } from '../../../services/service-request.service';
import {
  makeFloor,
  makeObjectDetail,
  makeObjectHistory,
  makeObjectListItem,
} from '../../../test/fixtures';
import { renderWithAuth } from '../../../test/render';
import { ObjectDetailPage } from './ObjectDetailPage';

/**
 * Where a header action leads.
 *
 * Only one route is mounted in a page test, so a navigation cannot be observed by what
 * renders next. `useNavigate` is stubbed instead — everything else in the router is the
 * real thing — because the destination, query string and all, is the assertion: it is what
 * carries the panel, the floor and the category into the form.
 */
const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const OBJECT_ID = '507f1f77bcf86cd799439161';
const FLOOR_ID = '507f1f77bcf86cd799439121';
const PHOTO_ID = '507f1f77bcf86cd799439171';

/** Evidence attached to an assessment, in the object photo shape. */
function makeEvidence(overrides: Partial<ObjectPhotoDto> = {}): ObjectPhotoDto {
  return {
    id: PHOTO_ID,
    name: 'evidence.png',
    downloadUrl: `/api/v1/files/${PHOTO_ID}`,
    mimeType: 'image/png',
    sizeBytes: 2048,
    uploadedByName: 'Бат Дорж',
    uploadedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

/** A stored assessment, with only the field under test spelled out at the call site. */
function makeAssessment(overrides: Partial<ObjectAssessmentDto> = {}): ObjectAssessmentDto {
  return {
    id: 'a1',
    objectId: OBJECT_ID,
    previousScore: null,
    newScore: 95,
    riskLevel: 'NORMAL',
    assessedById: 'u1',
    assessedByName: 'Бат Дорж',
    judgedById: null,
    judgedByName: null,
    assessedAt: '2026-07-01T00:00:00.000Z',
    photos: [],
    conclusion: null,
    recommendation: null,
    actionTaken: null,
    measuredLoadKw: null,
    measurements: [],
    repairRequired: false,
    revisitRequired: false,
    revisitDate: null,
    revisitOwnerName: null,
    sourceLabel: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The page lives under the floor, so the route always carries a floor id. */
function renderDetail(permissions: readonly string[]) {
  return renderWithAuth(<ObjectDetailPage />, {
    permissions: permissions as never,
    route: `/floors/${FLOOR_ID}/objects/${OBJECT_ID}`,
    path: '/floors/:floorId/objects/:objectId',
  });
}

describe('ObjectDetailPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    navigate.mockClear();
    vi.spyOn(dispatchService, 'employeeCandidates').mockResolvedValue([]);
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(makeObjectHistory());
    vi.spyOn(projectService, 'getFloor').mockResolvedValue(makeFloor());
    // The download route is authenticated, so every attachment is fetched into an object
    // URL rather than used as a bare src.
    vi.spyOn(fileUrl, 'authorisedFileUrl').mockResolvedValue('blob:assessment-photo');
    vi.spyOn(objectMasterService, 'uploadAssessmentPhoto').mockResolvedValue(makeEvidence());
  });

  /** Every assessment now carries evidence, so the drawer attaches one before saving. */
  async function attachEvidence(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    const file = new File(['evidence'], 'evidence.png', { type: 'image/png' });
    await user.upload(within(dialog).getByLabelText('Нотлох зураг сонгох'), file);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Бүртгэх' })).toBeEnabled();
    });
  }

  it('shows the panel technical fields and its load figures', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText('Түгээх самбар 2A')).toBeInTheDocument();
    expect(screen.getByText('25 kW')).toBeInTheDocument();
    expect(screen.getByText('Баруун жигүүр')).toBeInTheDocument();
    expect(screen.getByText('18.4 kW')).toBeInTheDocument();
  });

  /** Section 4.2 keeps the field sets apart; a panel has no rated power or quantity. */
  it('shows no equipment fields on a panel', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    await screen.findByText('Түгээх самбар 2A');
    expect(screen.queryByText('Нэрлэсэн чадал')).not.toBeInTheDocument();
    expect(screen.queryByText('Тоо ширхэг')).not.toBeInTheDocument();
  });

  it('shows equipment fields on an equipment object', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
      makeObjectDetail({
        category: 'EQUIPMENT',
        panel: null,
        equipment: {
          circuit: { id: 'c1', code: 'HL-01', name: 'Коридор', category: 'CIRCUIT' },
          panel: null,
          ratedPowerKw: 1.5,
          quantity: 4,
          usageCoefficient: 0.8,
          installedAt: null,
          warrantyUntil: null,
        },
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText('Нэрлэсэн чадал')).toBeInTheDocument();
    expect(screen.getByText('1.5 kW')).toBeInTheDocument();
    expect(screen.getByText('Коридор')).toBeInTheDocument();
    expect(screen.queryByText('Хамгаалалт')).not.toBeInTheDocument();
  });

  it('reports Бүрэн бус when the calculation is incomplete', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
      makeObjectDetail({
        calculatedLoad: { valueKw: null, complete: false, reasons: ['MISSING_RATED_POWER'] },
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findAllByText('Бүрэн бус')).not.toHaveLength(0);
  });

  it('offers the assessment action only when the type generates conclusions', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
      makeObjectDetail({ canAssess: false }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    expect(await screen.findByText(/дүгнэлт үүсгэхээр тохируулагдаагүй/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Үнэлгээ бүртгэх' })).not.toBeInTheDocument();
  });

  it('offers the assessment action to a permitted caller on an assessable type', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    expect(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' })).toBeInTheDocument();
  });

  it('hides the assessment action without object_master.assess', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    await screen.findByText('Түгээх самбар 2A');
    expect(screen.queryByRole('button', { name: 'Үнэлгээ бүртгэх' })).not.toBeInTheDocument();
  });

  it('hides delete while dependent records block it, and explains why', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
      makeObjectDetail({ deleteBlockers: ['3 үнэлгээний бүртгэлтэй. Архивлана уу.'] }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE]);

    const box = await screen.findByText('Устгах боломжгүй');
    expect(screen.getByText('3 үнэлгээний бүртгэлтэй. Архивлана уу.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Устгах' })).not.toBeInTheDocument();

    // The reasons are read after the content they refer to, not before it.
    const history = screen.getByRole('heading', { name: 'Үнэлгээний түүх' });
    expect(history.compareDocumentPosition(box)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('renders the append-only assessment history with previous and new scores', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          {
            id: 'a2',
            objectId: OBJECT_ID,
            previousScore: 90,
            newScore: 70,
            riskLevel: 'ATTENTION',
            assessedById: 'u1',
            assessedByName: 'Бат Дорж',
            judgedById: null,
            judgedByName: null,
            assessedAt: '2026-07-10T00:00:00.000Z',
            photos: [],
            conclusion: 'Холболт сулласан',
            recommendation: 'Чангалах',
            actionTaken: null,
            measuredLoadKw: 5.2,
            measurements: [],
            repairRequired: true,
            revisitRequired: false,
            revisitDate: null,
            revisitOwnerName: null,
            sourceLabel: null,
            createdAt: '2026-07-10T00:00:00.000Z',
          },
        ],
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    // The history is a table now, so every recorded value is asserted in a cell of its own:
    // no cell stacks two data together.
    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    for (const header of [
      'Үнэлгээ',
      'Нотлох зураг',
      'Өмнөх оноо',
      'Тайлбар',
      'Зөвлөмж',
      // Two actor columns, not one: who wrote the verdict and who signed it off are
      // different questions and the table answers both rather than blending them.
      'Дүгнэлт бичсэн',
      'Баталгаажуулсан',
      'Огноо',
    ]) {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByLabelText('Анхаарах шаардлагатай 70%')).toBeInTheDocument();
    for (const value of ['90', 'Холболт сулласан', 'Чангалах', '5.2 kW', 'Бат Дорж']) {
      expect(within(row).getByText(value).closest('td')).toHaveTextContent(
        new RegExp(`^${value}$`),
      );
    }
  });

  /**
   * The defect this pair of columns exists for: a Дүгнэлт written by a technician and
   * approved by their manager used to show only the manager, because the history had one
   * actor field and the report path filled it from the approval.
   */
  it('names the technician who wrote the verdict beside the person who signed it off', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          makeAssessment({
            id: 'a-judged',
            assessedById: 'u-manager',
            assessedByName: 'Менежер Болд',
            judgedById: 'u-tech',
            judgedByName: 'Техникч Ганаа',
          }),
        ],
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    const row = within(table).getAllByRole('row')[1]!;
    // Each name in a cell of its own: neither is presented as the other.
    expect(within(row).getByText('Техникч Ганаа').closest('td')).toHaveTextContent(
      /^Техникч Ганаа$/,
    );
    expect(within(row).getByText('Менежер Болд').closest('td')).toHaveTextContent(
      /^Менежер Болд$/,
    );
  });

  it('offers no way to edit or delete a stored assessment', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          {
            id: 'a1',
            objectId: OBJECT_ID,
            previousScore: null,
            newScore: 95,
            riskLevel: 'NORMAL',
            assessedById: 'u1',
            assessedByName: 'Бат Дорж',
            judgedById: null,
            judgedByName: null,
            assessedAt: '2026-07-01T00:00:00.000Z',
            photos: [makeEvidence()],
            conclusion: null,
            recommendation: null,
            actionTaken: null,
            measuredLoadKw: null,
            measurements: [],
            repairRequired: false,
            revisitRequired: false,
            revisitDate: null,
            revisitOwnerName: null,
            sourceLabel: null,
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    );

    renderDetail([
      PERMISSIONS.OBJECT_MASTER_VIEW,
      PERMISSIONS.OBJECT_MASTER_MANAGE,
      PERMISSIONS.OBJECT_MASTER_ASSESS,
    ]);

    // The immutability note has been removed from the UI, so the guarantee is asserted
    // where it actually lives: no control exists to change or remove a stored assessment,
    // even for a caller holding both manage and assess.
    await screen.findByText('Үнэлгээний түүх');
    expect(screen.queryByRole('button', { name: 'Үнэлгээ засах' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Үнэлгээ устгах' })).not.toBeInTheDocument();

    /**
     * Scoped to the history table: the object itself may still be deletable, but none of
     * its recorded assessments may be. The table carries no action column and no mutating
     * control at all.
     *
     * With the evidence thumbnail moved into the detail panel, the row holds no control of
     * any kind: opening a row reads an assessment, and nothing in the table writes one.
     */
    const historyTable = screen.getByRole('table', { name: 'Үнэлгээний түүх' });
    expect(
      within(historyTable).queryByRole('columnheader', { name: 'Үйлдэл' }),
    ).not.toBeInTheDocument();
    expect(within(historyTable).queryByRole('link')).not.toBeInTheDocument();
    expect(within(historyTable).queryAllByRole('button')).toHaveLength(0);
  });

  /**
   * Section 10.1 keeps the photos with the assessment. They are read in the detail panel
   * rather than squeezed into a table cell, along with who recorded the assessment and when
   * - the first question anyone asks of a judgement.
   */
  it('opens the assessment detail from its row, naming the assessor and the evidence', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          makeAssessment({
            photos: [makeEvidence()],
            conclusion: 'Холболт сулласан',
            revisitOwnerName: 'Дорж Бат',
            sourceLabel: 'PW-202607-0001',
          }),
        ],
      }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    // The row says evidence exists; the panel is where it is looked at.
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('1 зураг')).toBeInTheDocument();

    await user.click(row);

    const detail = await screen.findByRole('dialog', { name: 'Үнэлгээний дэлгэрэнгүй' });
    // Named against its own label: the same person also uploaded the evidence, so the
    // assertion has to say which of the two mentions it means.
    expect(within(detail).getByText('Баталгаажуулсан').closest('div')).toHaveTextContent(
      'Бат Дорж',
    );
    // This fixture carries no per-equipment author, and the drawer says so rather than
    // repeating the approver's name under a label that would then be a lie.
    expect(within(detail).getByText('Дүгнэлт бичсэн').closest('div')).toHaveTextContent(
      'Бүртгэгдээгүй',
    );
    // The exact rendering of the stamp is the locale's business; that it is the recorded
    // day is this test's.
    expect(within(detail).getByText('Үнэлсэн огноо').closest('div')).toHaveTextContent(/2026/);
    expect(within(detail).getByText('Холболт сулласан')).toBeInTheDocument();
    // Fields the table never had room for are read here.
    expect(within(detail).getByText('Дорж Бат')).toBeInTheDocument();
    expect(within(detail).getByText('PW-202607-0001')).toBeInTheDocument();

    const thumbnail = within(detail).getByRole('button', { name: 'evidence.png томруулж харах' });
    expect(within(thumbnail).getByRole('img')).toHaveAttribute('src', 'blob:assessment-photo');

    await user.click(thumbnail);
    const previewModal = await screen.findByRole('dialog', { name: 'evidence.png' });
    expect(within(previewModal).getByRole('img')).toHaveAttribute('src', 'blob:assessment-photo');
  });

  /** A row that only answers a mouse is a row half the users cannot open. */
  it('opens the assessment detail from the keyboard', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({ assessments: [makeAssessment()] }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    const row = within(table).getAllByRole('row')[1]!;
    row.focus();
    expect(row).toHaveFocus();

    await user.keyboard('{Enter}');

    expect(
      await screen.findByRole('dialog', { name: 'Үнэлгээний дэлгэрэнгүй' }),
    ).toBeInTheDocument();
  });

  /**
   * Grandfathering: assessments recorded before evidence was required have no photo, and
   * the assessor snapshot of an old row can be missing entirely. Both must still read.
   */
  it('still renders an assessment stored before evidence and the assessor were captured', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          makeAssessment({
            id: 'a-old',
            assessedById: null,
            assessedByName: null,
            assessedAt: '2026-01-01T00:00:00.000Z',
            createdAt: '2026-01-01T00:00:00.000Z',
            photos: [],
            conclusion: 'Зурaггүй хуучин үнэлгээ',
          }),
        ],
      }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('Зурaггүй хуучин үнэлгээ')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();

    await user.click(row);

    // A missing name says so; a dash there would read as a broken field rather than an
    // unrecorded one.
    const detail = await screen.findByRole('dialog', { name: 'Үнэлгээний дэлгэрэнгүй' });
    expect(within(detail).getByText('Тодорхойгүй')).toBeInTheDocument();
    expect(within(detail).getByText('Зураг хавсаргаагүй.')).toBeInTheDocument();
  });

  /**
   * The consolidated timeline duplicated what the modules it drew from already show, and
   * buried the assessment history under it. The assessment history is the object's log now.
   */
  it('no longer renders the consolidated history timeline', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        timeline: [
          {
            id: 'REQUEST:r1',
            kind: 'SERVICE_REQUEST',
            occurredAt: '2026-07-05T00:00:00.000Z',
            title: 'SR-202607-0001',
            detail: 'Кабель солих',
            actorName: null,
            linkPath: '/service-requests/r1',
          },
        ],
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    await screen.findByText('Үнэлгээний түүх');
    expect(screen.queryByText('Объектын түүх')).not.toBeInTheDocument();
    expect(screen.queryByText('SR-202607-0001')).not.toBeInTheDocument();
  });

  it('records an assessment through the drawer', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const record = vi.spyOn(objectMasterService, 'recordAssessment').mockResolvedValue({
      id: 'a1',
      objectId: OBJECT_ID,
      previousScore: null,
      newScore: 95,
      riskLevel: 'NORMAL',
      assessedById: 'u1',
      assessedByName: 'Тест',
      judgedById: null,
      judgedByName: null,
      assessedAt: '2026-07-01T00:00:00.000Z',
      photos: [],
      conclusion: null,
      recommendation: null,
      actionTaken: null,
      measuredLoadKw: null,
      measurements: [],
      repairRequired: false,
      revisitRequired: false,
      revisitDate: null,
      revisitOwnerName: null,
      sourceLabel: null,
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Шинэ оноо/), '95');
    await attachEvidence(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(record).toHaveBeenCalledWith(
        OBJECT_ID,
        expect.objectContaining({ newScore: 95, photoIds: [PHOTO_ID] }),
      );
    });
  });

  /**
   * Multiple load units: a repeatable row editor beside the kW box.
   *
   * Two rows added, one taken off again, and what reaches the service is checked in full —
   * the unit has to be resolved from the kind, and the amps must not have leaked into
   * `measuredLoadKw`, which is the field the floor totals add up.
   */
  it('adds and removes load measurement rows and sends them with the assessment', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const record = vi
      .spyOn(objectMasterService, 'recordAssessment')
      .mockResolvedValue(makeAssessment());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Шинэ оноо/), '95');
    await user.type(within(dialog).getByLabelText(/Хэмжсэн ачаалал/), '8.4');
    await attachEvidence(user, dialog);

    const add = within(dialog).getByRole('button', { name: 'Хэмжилт нэмэх' });
    await user.click(add);
    await user.click(add);
    await user.click(add);

    // A fresh row never collides with one already on the form, so the three defaults are
    // "no phase", L1, L2 — and the third is the one taken off again below.
    await user.type(within(dialog).getByLabelText('1-р хэмжилтийн утга'), '41.2');
    await user.selectOptions(within(dialog).getByLabelText('2-р хэмжилтийн фаз'), 'L2');
    await user.type(within(dialog).getByLabelText('2-р хэмжилтийн утга'), '38.9');
    await user.selectOptions(within(dialog).getByLabelText('3-р хэмжилтийн төрөл'), 'VOLTAGE');
    await user.type(within(dialog).getByLabelText('3-р хэмжилтийн утга'), '231');

    await user.click(within(dialog).getByRole('button', { name: '3-р хэмжилт хасах' }));
    expect(within(dialog).queryByLabelText('3-р хэмжилтийн утга')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => {
      expect(record).toHaveBeenCalledWith(OBJECT_ID, {
        newScore: 95,
        conclusion: null,
        recommendation: null,
        actionTaken: null,
        // The amps are their own readings; the kW box is untouched by them.
        measuredLoadKw: 8.4,
        measurements: [
          { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: null },
          { kind: 'CURRENT', value: 38.9, unit: 'AMPERE', phase: 'L2' },
        ],
        repairRequired: false,
        revisitRequired: false,
        revisitDate: null,
        revisitOwnerEmployeeId: null,
        photoIds: [PHOTO_ID],
      });
    });
  });

  /** An untouched editor sends exactly what the form sent before the field existed. */
  it('omits measurements entirely when no row was added', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const record = vi
      .spyOn(objectMasterService, 'recordAssessment')
      .mockResolvedValue(makeAssessment());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Шинэ оноо/), '95');
    await attachEvidence(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    await waitFor(() => expect(record).toHaveBeenCalled());
    expect(record.mock.calls[0]?.[1]).not.toHaveProperty('measurements');
  });

  /** The stored readings are read beside the assessment they were taken during. */
  it('shows the recorded readings on the assessment detail panel', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'history').mockResolvedValue(
      makeObjectHistory({
        assessments: [
          makeAssessment({
            measuredLoadKw: 8.4,
            measurements: [
              { kind: 'CURRENT', value: 41.2, unit: 'AMPERE', phase: 'L1' },
              { kind: 'VOLTAGE', value: 231, unit: 'VOLT', phase: null },
            ],
          }),
        ],
      }),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const table = await screen.findByRole('table', { name: 'Үнэлгээний түүх' });
    await user.click(within(table).getAllByRole('row')[1]!);
    const dialog = await screen.findByRole('dialog', { name: 'Үнэлгээний дэлгэрэнгүй' });

    expect(within(dialog).getByText('41.2 А (L1)')).toBeInTheDocument();
    expect(within(dialog).getByText('231 В')).toBeInTheDocument();
    // The kW head is still shown as itself, not folded into the list.
    expect(within(dialog).getByText('8.4 kW')).toBeInTheDocument();
  });

  /**
   * A score with no picture behind it is not an assessment, so the action is unavailable
   * until evidence is attached and says so rather than failing on save.
   */
  it('keeps the save action disabled until an evidence photo is attached', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const record = vi.spyOn(objectMasterService, 'recordAssessment');
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Шинэ оноо/), '95');

    const save = within(dialog).getByRole('button', { name: 'Бүртгэх' });
    expect(save).toBeDisabled();
    // The reason is stated, not left to be guessed at.
    expect(
      within(dialog).getAllByText('Нотлох зураг хавсаргах хүртэл үнэлгээ бүртгэх боломжгүй.').length,
    ).toBeGreaterThan(0);

    await user.click(save);
    expect(record).not.toHaveBeenCalled();

    await attachEvidence(user, dialog);
    expect(within(dialog).getByRole('button', { name: 'Бүртгэх' })).toBeEnabled();
  });

  /**
   * Evidence is mandatory, which makes a wrongly chosen photo a trap unless it can be taken
   * off again before saving. Removing one that has not been recorded yet is not a breach of
   * the append-only rule: nothing has been written.
   */
  it('lets a wrongly chosen photo be removed before the assessment is saved', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await attachEvidence(user, dialog);

    await user.click(within(dialog).getByRole('button', { name: 'evidence.png хасах' }));

    expect(
      within(dialog).queryByRole('button', { name: 'evidence.png томруулж харах' }),
    ).not.toBeInTheDocument();
    // Back to having no evidence, so saving is refused again.
    expect(within(dialog).getByRole('button', { name: 'Бүртгэх' })).toBeDisabled();
  });

  it('shows the attached evidence as a thumbnail that opens the enlarged preview', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await attachEvidence(user, dialog);

    const thumbnail = await within(dialog).findByRole('button', {
      name: 'evidence.png томруулж харах',
    });
    // One fetch per attachment: the thumbnail and the preview share the same object URL.
    expect(within(thumbnail).getByRole('img')).toHaveAttribute('src', 'blob:assessment-photo');

    await user.click(thumbnail);
    // The preview modal is named after the file, so it is addressed by that name rather
    // than by picking one of two identically described images.
    const previewModal = await screen.findByRole('dialog', { name: 'evidence.png' });
    expect(within(previewModal).getByRole('img')).toHaveAttribute('src', 'blob:assessment-photo');
  });

  it('surfaces a band-conditional rejection against its fields', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
    vi.spyOn(objectMasterService, 'recordAssessment').mockRejectedValue(
      new ApiError('Үнэлгээний түвшинд шаардагдах мэдээлэл дутуу байна.', 'VALIDATION_ERROR', 400, [
        { field: 'recommendation', message: 'Улаан/хар төлөвт зөвлөмж заавал.' },
      ]),
    );
    const user = userEvent.setup();

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_ASSESS]);

    await user.click(await screen.findByRole('button', { name: 'Үнэлгээ бүртгэх' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Шинэ оноо/), '30');
    await attachEvidence(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Бүртгэх' }));

    expect(
      await within(dialog).findByText('Улаан/хар төлөвт зөвлөмж заавал.'),
    ).toBeInTheDocument();
  });

  /** The object stays inside the project module: the only way out leads back to the floor. */
  it('offers a back link to the floor it sits on', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    const back = await screen.findByRole('link', { name: 'Давхар руу буцах' });
    expect(back).toHaveAttribute('href', `/floors/${FLOOR_ID}`);
  });

  /**
   * Section 10.1: the score is a 0-100 figure. It is drawn as the number, a proportional
   * bar and the band pill, so the level is visible without reading the number.
   */
  it('shows the score with its band as colour, bar and accessible name', async () => {
    vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
      makeObjectDetail({
        latestAssessment: {
          id: 'a1',
          score: 92,
          riskLevel: 'NORMAL',
          assessedAt: '2026-07-01T00:00:00.000Z',
          assessedByName: 'Бат Дорж',
          conclusion: null,
          recommendation: null,
          repairRequired: false,
          revisitRequired: false,
          revisitDate: null,
        },
      }),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    // The percent carries the band as its fill colour, and the header names the band beside
    // it because there is no legend on this page to read the colour against.
    const score = await screen.findByLabelText('Хэвийн 92%');
    expect(score).toHaveTextContent('92%');
    expect(score.className).toContain('bg-green-600');
    expect(screen.getByText('Хэвийн')).toBeInTheDocument();
    // The old "band (score)" label form is gone.
    expect(screen.queryByText('Хэвийн (92)')).not.toBeInTheDocument();
  });

  /**
   * A panel is an enclosure as well as a source of circuits, and until this list existed
   * the things bolted inside it were invisible from it.
   */
  describe('devices mounted in the panel', () => {
    const RCD = makeObjectListItem({
      id: '507f1f77bcf86cd799439199',
      code: 'DB-2A-01',
      name: 'Гүйдэл алдалтын хамгаалалт',
      category: 'EQUIPMENT',
    });

    it('lists them under their own heading, apart from the panel circuits', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
        makeObjectDetail({
          mountedEquipment: [RCD],
          childCircuits: [
            makeObjectListItem({ id: 'c1', code: 'HL-01', name: 'Коридор', category: 'CIRCUIT' }),
          ],
        }),
      );

      renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

      const mounted = await screen.findByRole('table', { name: 'Самбарт байрлах тоноглол' });
      expect(within(mounted).getByText('Гүйдэл алдалтын хамгаалалт')).toBeInTheDocument();
      expect(within(mounted).getByText('DB-2A-01')).toBeInTheDocument();
      // The circuits fed out of the panel keep their own table: what is housed and what is
      // supplied are two different questions.
      expect(within(mounted).queryByText('Коридор')).not.toBeInTheDocument();
      expect(screen.getByText('Энэ самбарын хэлхээнүүд')).toBeInTheDocument();
    });

    it('shows no such list on a panel with nothing mounted in it', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

      renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

      await screen.findByText('Түгээх самбар 2A');
      expect(screen.queryByText('Самбарт байрлах тоноглол')).not.toBeInTheDocument();
    });

    /**
     * The whole point of the action: the form opens knowing the panel, the floor (and so
     * the customer) and the category, leaving a type and a name to supply.
     */
    it('opens the create form pre-filled with the panel, its floor and the category', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());
      const user = userEvent.setup();

      renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE]);

      await user.click(await screen.findByRole('button', { name: 'Самбарт тоноглол бүртгэх' }));

      expect(navigate).toHaveBeenCalledWith(
        `/floors/${FLOOR_ID}/objects/new?category=EQUIPMENT&panelId=${OBJECT_ID}`,
      );
    });

    it('offers the action only on a panel, and only to a caller who may manage objects', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(makeObjectDetail());

      const readOnly = renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);
      await screen.findByText('Түгээх самбар 2A');
      expect(
        screen.queryByRole('button', { name: 'Самбарт тоноглол бүртгэх' }),
      ).not.toBeInTheDocument();
      readOnly.unmount();

      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
        makeObjectDetail({
          category: 'CIRCUIT',
          panel: null,
          circuit: {
            panel: null,
            startPoint: null,
            endPoint: null,
            breakerRating: null,
            cableType: null,
            cableSectionMm2: null,
            cableLengthM: null,
            permittedCapacityKw: null,
          },
        }),
      );
      renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW, PERMISSIONS.OBJECT_MASTER_MANAGE]);
      await screen.findByText('Түгээх самбар 2A');
      expect(
        screen.queryByRole('button', { name: 'Самбарт тоноглол бүртгэх' }),
      ).not.toBeInTheDocument();
    });

    /** Read on the device itself: where it sits, beside what feeds it. */
    it('names the enclosure on the mounted device page', async () => {
      vi.spyOn(objectMasterService, 'getById').mockResolvedValue(
        makeObjectDetail({
          category: 'EQUIPMENT',
          panel: null,
          equipment: {
            circuit: null,
            panel: { id: OBJECT_ID, code: 'DB-2A', name: 'Түгээх самбар 2A', category: 'PANEL' },
            ratedPowerKw: null,
            quantity: null,
            usageCoefficient: null,
            installedAt: null,
            warrantyUntil: null,
          },
        }),
      );

      renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

      expect(await screen.findByText('Байрлах самбар')).toBeInTheDocument();
      // It has no circuit, and the page says so rather than implying the panel is one.
      expect(screen.getByText('Холбогдоогүй')).toBeInTheDocument();
    });
  });

  it('shows an error state when the object cannot be loaded', async () => {
    vi.spyOn(objectMasterService, 'getById').mockRejectedValue(
      new ApiError('Объект олдсонгүй.', 'NOT_FOUND', 404),
    );

    renderDetail([PERMISSIONS.OBJECT_MASTER_VIEW]);

    expect(await screen.findByText('Объект олдсонгүй.')).toBeInTheDocument();
  });
});
