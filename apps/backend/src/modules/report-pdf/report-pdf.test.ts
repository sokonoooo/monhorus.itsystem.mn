import { describe, expect, it } from 'vitest';

import { inspectionReportDocument } from './inspection-report.pdf';
import type { ReportBranding } from './report-branding';
import type { BrandingImage } from './pdf-template';
import { plannedWorkReportDocument } from './planned-work-report.pdf';
import { renderPdf } from './pdf.renderer';
import { CONTENT_WIDTH, FONT_SIZE, PAGE_MARGINS } from './pdf-template';
import { formatDate, formatLongDate, formatMinutes, formatQuantity } from './report-pdf.format';

/**
 * The exported reports, asserted as bytes rather than as a document definition.
 *
 * A test that only checked the definition object would pass against a document pdfmake
 * cannot render — a missing font, an unresolvable image, a table whose columns overflow
 * the page — which is exactly the class of failure that reaches a user as a broken
 * download. So every case here renders a real PDF and reads it back.
 */

const CONTRACTOR = '"Монхорус Электрик" ХХК';

/**
 * Branding as a fully-configured operator has it. Individual tests override one field to
 * prove each degrades on its own.
 */
const BRANDING: ReportBranding = {
  logo: null,
  companyName: CONTRACTOR,
  inspectionCompany: CONTRACTOR,
};

function previewFixture(
  overrides: Partial<Record<string, unknown>> = {},
): Parameters<typeof plannedWorkReportDocument>[0] {
  return {
    plannedWorkId: 'w1',
    workNumber: 'PW-202608-0007',
    title: 'Цахилгааны сарын үзлэг',
    customerName: 'Central Tower ХХК',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    buildingName: 'Төв байр',
    status: 'APPROVED',
    plannedStartDate: '2026-08-01T00:00:00.000Z',
    plannedEndDate: '2026-08-10T00:00:00.000Z',
    originalPlannedEndDate: '2026-08-10T00:00:00.000Z',
    actualStartDate: '2026-08-01T02:00:00.000Z',
    actualEndDate: '2026-08-11T09:30:00.000Z',
    completedLate: false,
    delayMinutes: null,
    totalPausedMinutes: 0,
    totalQuantity: 10,
    completedQuantity: 10,
    remainingQuantity: 0,
    progressPercent: 100,
    floorProgress: [],
    tasks: [],
    materials: [],
    conclusion: 'Ерөнхий дүгнэлт.',
    recommendation: 'Зөвлөмж.',
    generatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  } as never;
}

function inspectionFixture(
  overrides: Partial<Record<string, unknown>> = {},
): Parameters<typeof inspectionReportDocument>[0] {
  return {
    id: 'i1',
    plannedWorkId: 'w1',
    status: 'FINALISED',
    version: 1,
    workNumber: 'PW-202608-0007',
    workTitle: 'Цахилгааны сарын үзлэг',
    customerName: 'Central Tower ХХК',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    buildingName: 'Төв байр',
    locationLabel: 'Сүхбаатар дүүрэг',
    inspectionStart: '2026-08-01T02:00:00.000Z',
    inspectionEnd: '2026-08-11T09:30:00.000Z',
    responsibleEmployeeNames: ['Д.Ганболд'],
    responsibleTeamNames: [],
    contractorName: CONTRACTOR,
    actName: 'Цахилгааны үзлэг',
    inspectedScope: 'Цахилгаан самбарын ерөнхий үзлэг',
    groups: [],
    issues: [],
    overallLevel: null,
    overallLabel: null,
    issueSummary: null,
    conclusion: 'Дүгнэлт.',
    recommendation: 'Зөвлөмж.',
    replacementPanels: [],
    replacementConnections: [],
    isAutoDraft: false,
    createdByName: 'Б.Мөнхтуяа',
    createdByPosition: 'Зургийн техникч',
    createdAt: '2026-08-11T10:00:00.000Z',
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
    updatedAt: '2026-08-11T10:00:00.000Z',
    ...overrides,
  } as never;
}

/** How many pages the rendered document has. */
function pageCount(pdf: Buffer): number {
  return pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g)?.length ?? 0;
}

/** The PostScript names of every font the document embedded. */
function embeddedFonts(pdf: Buffer): string[] {
  return [...pdf.toString('latin1').matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-]+)/g)].map(
    (match) => match[1] as string,
  );
}

describe('report PDF export', () => {
  it('renders a planned work report as a real, multi-page PDF', async () => {
    const pdf = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, BRANDING),
    );

    // A PDF, not an empty buffer or an HTML error page.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(5_000);
    // The cover is page one and the body is broken onto its own page, as the template
    // does with an explicit break.
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('renders the inspection report as a real PDF', async () => {
    const pdf = await renderPdf(inspectionReportDocument(inspectionFixture(), BRANDING));

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  /**
   * THE FAILURE THIS WHOLE FONT DECISION EXISTS TO PREVENT.
   *
   * The base-14 PDF fonts carry no Cyrillic at all, so a document that fell back to one
   * would render every heading as blanks while still being a structurally valid PDF that
   * opens without complaint. Asserting the embedded font is the only cheap way to catch
   * that from a test.
   */
  it('embeds the Cyrillic-capable typeface rather than a base-14 font', async () => {
    const pdf = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, BRANDING),
    );
    const fonts = embeddedFonts(pdf);

    expect(fonts.length).toBeGreaterThan(0);
    expect(fonts.every((font) => font.includes('Tinos'))).toBe(true);
    expect(fonts.some((font) => /Helvetica|Times-Roman|Courier/.test(font))).toBe(false);
  });

  /** A long sub-task list must paginate rather than overflow off the page. */
  it('paginates a long sub-task table', async () => {
    const short = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, BRANDING),
    );
    const long = await renderPdf(
      plannedWorkReportDocument(
        previewFixture({
          tasks: Array.from({ length: 90 }, (_unused, index) => ({
            id: `t${index}`,
            title: `Гэрэлтүүлгийн самбар ${index + 1} үзлэг, холболт шалгах`,
            floorName: '1-р давхар',
            unit: 'PIECE',
            totalQuantity: 5,
            completedQuantity: 5,
            progressPercent: 100,
            status: 'DONE',
            note: 'Холболтын боолт сулралттай, дахин чангалсан.',
            score: 82,
            riskLevel: 'NORMAL',
            recommendation: null,
            beforePhotoCount: 0,
            afterPhotoCount: 0,
          })),
        }),
        null,
        BRANDING,
      ),
    );

    expect(pageCount(long)).toBeGreaterThan(pageCount(short));
  });

  /**
   * Every field absent. A report is exportable long before it is complete, and a
   * generator that throws on a null is one a user meets as a failed download.
   */
  it('renders when every optional field is empty', async () => {
    const pdf = await renderPdf(
      plannedWorkReportDocument(
        previewFixture({
          projectName: null,
          actualStartDate: null,
          actualEndDate: null,
          delayMinutes: null,
          conclusion: null,
          recommendation: null,
          floorProgress: [],
          tasks: [],
          materials: [],
        }),
        null,
        { logo: null, companyName: '', inspectionCompany: '' },
      ),
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('renders an inspection report with findings and replacement lists', async () => {
    const pdf = await renderPdf(
      inspectionReportDocument(
        inspectionFixture({
          groups: [
            {
              floorId: 'f1',
              floorName: '1-р давхар',
              tasks: [
                {
                  taskId: 't1',
                  title: 'Ерөнхий оруулгын самбар',
                  floorName: '1-р давхар',
                  status: 'DONE',
                  statusLabel: 'Дууссан',
                  skipped: false,
                  score: 38,
                  riskLevel: 'CRITICAL',
                  note: 'Газардуулга холбогдоогүй.',
                  recommendation: null,
                  totalQuantity: 1,
                  completedQuantity: 1,
                  unit: 'ш',
                  attachments: [],
                  completedAt: '2026-08-02T02:00:00.000Z',
                  assignedEmployeeName: 'Д.Ганболд',
                },
              ],
            },
          ],
          issues: [
            {
              taskId: 't1',
              title: 'Ерөнхий оруулгын самбар',
              locationLabel: '1-р давхар',
              riskLevel: 'OUT_OF_SERVICE',
              score: 20,
              condition: 'Газардуулга холбогдоогүй.',
              advice: 'Яаралтай холбох.',
            },
          ],
          overallLevel: 'OUT_OF_SERVICE',
          overallLabel: 'Ашиглах боломжгүй',
          issueSummary: 'Нэг зөрчил илэрсэн.',
          replacementPanels: ['А агуулах коридорын самбар'],
          replacementConnections: ['ЕС-1 оруулгын холболт'],
        }),
        BRANDING,
      ),
    );

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });
});

/**
 * The measurements taken off «Үзлэгийн тайлан.docx».
 *
 * Pinned as numbers because they are the whole claim of this feature: an export that
 * quietly drifts to Letter paper or 11pt body text still produces a perfectly valid PDF
 * that no other test would notice, and it would stop looking like the document it is
 * meant to reproduce.
 */
describe('template measurements', () => {
  it('keeps the source document page geometry', () => {
    // w:pgMar left/top = 1440 twips = 72pt; right = 1376 = 68.8; bottom = 990 = 49.5.
    expect(PAGE_MARGINS).toEqual([72, 72, 68.8, 49.5]);
    // A4 width less the two side margins.
    expect(CONTENT_WIDTH).toBeCloseTo(454.48, 1);
  });

  it('keeps the source document type sizes', () => {
    // w:sz is half-points: 26 -> 13, 24 -> 12, 18 -> 9, 16 -> 8.
    expect(FONT_SIZE.title).toBe(13);
    expect(FONT_SIZE.body).toBe(12);
    expect(FONT_SIZE.table).toBe(9);
    expect(FONT_SIZE.tableLabel).toBe(8);
  });
});

describe('report formatting', () => {
  it('writes table dates numerically and prose dates in words', () => {
    expect(formatDate('2026-08-11T09:30:00.000Z')).toBe('2026.08.11');
    // Unpadded in the spoken form, matching the template's "2026 он" register.
    expect(formatLongDate('2026-08-11T09:30:00.000Z')).toBe('2026 оны 8 сарын 11');
  });

  it('formats in Ulaanbaatar time, not the server zone', () => {
    // 23:30 UTC is already the next morning in Ulaanbaatar (UTC+8).
    expect(formatDate('2026-08-10T23:30:00.000Z')).toBe('2026.08.11');
  });

  it('leaves an absent date empty rather than printing an epoch', () => {
    expect(formatDate(null)).toBe('');
    expect(formatLongDate(undefined)).toBe('');
    expect(formatDate('not a date')).toBe('');
  });

  it('prints whole quantities without decimals, and keeps real ones', () => {
    expect(formatQuantity(12)).toBe('12');
    expect(formatQuantity(1.5)).toBe('1.5');
    // Zero is a quantity; absent is not.
    expect(formatQuantity(0)).toBe('0');
    expect(formatQuantity(null)).toBe('');
  });

  it('writes durations in hours and minutes', () => {
    expect(formatMinutes(95)).toBe('1 ц 35 мин');
    expect(formatMinutes(120)).toBe('2 ц');
    expect(formatMinutes(45)).toBe('45 мин');
    expect(formatMinutes(0)).toBe('');
  });
});


/**
 * The masthead and the photographs — everything that used to be compiled in.
 *
 * These assert the DEGRADATION as much as the happy path: a report is a document about
 * work that was done, and a half-configured installation must still be able to issue one.
 */
describe('branding and photographs', () => {
  /** A tiny real JPEG, so pdfmake genuinely decodes something. */
  function pixel(width: number, height: number): BrandingImage {
    // 1x1 JPEG, scaled by the declared dimensions rather than by re-encoding: this suite
    // is about layout, and sharp is exercised by its own tests.
    const jpeg =
      '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
      'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
      'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
    return { dataUrl: `data:image/jpeg;base64,${jpeg}`, width, height };
  }

  const photoBranding: ReportBranding = { ...BRANDING, logo: pixel(480, 110) };

  it('draws a configured logo and grows the document by doing so', async () => {
    const without = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, BRANDING),
    );
    const with_ = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, photoBranding),
    );

    // A logo appears on every page, so the document carrying one is larger. Without this
    // the header could silently render nothing and every other assertion would pass.
    expect(with_.byteLength).toBeGreaterThan(without.byteLength);
  });

  it('renders with no logo, no company and no inspection company configured', async () => {
    const pdf = await renderPdf(
      plannedWorkReportDocument(previewFixture(), null, {
        logo: null,
        companyName: '',
        inspectionCompany: '',
      }),
    );

    // The whole point: an operator who has configured nothing still gets their report.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(2);
  });

  it('adds a photo block for a task that has photographs, and none for one that has not', async () => {
    const preview = previewFixture({
      tasks: [
        {
          id: 't1',
          title: 'Зурагтай ажил',
          floorName: '1-р давхар',
          unit: 'PIECE',
          totalQuantity: 1,
          completedQuantity: 1,
          progressPercent: 100,
          status: 'DONE',
          note: 'Тайлбар.',
          score: 80,
          riskLevel: 'NORMAL',
          recommendation: null,
          beforePhotoCount: 1,
          afterPhotoCount: 0,
        },
        {
          id: 't2',
          title: 'Зураггүй ажил',
          floorName: '1-р давхар',
          unit: 'PIECE',
          totalQuantity: 1,
          completedQuantity: 1,
          progressPercent: 100,
          status: 'DONE',
          note: null,
          score: 80,
          riskLevel: 'NORMAL',
          recommendation: null,
          beforePhotoCount: 0,
          afterPhotoCount: 0,
        },
      ],
    });

    const bare = await renderPdf(plannedWorkReportDocument(preview, null, BRANDING));
    const withPhotos = await renderPdf(
      plannedWorkReportDocument(
        preview,
        null,
        BRANDING,
        new Map([['t1', [pixel(1600, 1200)]]]),
      ),
    );

    expect(withPhotos.byteLength).toBeGreaterThan(bare.byteLength);
  });

  it('lays four photographs out without dropping any', async () => {
    const four = new Map([
      [
        'task-1',
        [pixel(1600, 1200), pixel(1200, 1600), pixel(1600, 1200), pixel(1600, 900)],
      ],
    ]);
    const one = new Map([['task-1', [pixel(1600, 1200)]]]);

    const preview = previewFixture({
      tasks: [
        {
          id: 'task-1',
          title: 'Олон зурагтай ажил',
          floorName: '1-р давхар',
          unit: 'PIECE',
          totalQuantity: 1,
          completedQuantity: 1,
          progressPercent: 100,
          status: 'DONE',
          note: 'Тайлбар.',
          score: 80,
          riskLevel: 'NORMAL',
          recommendation: null,
          beforePhotoCount: 2,
          afterPhotoCount: 2,
        },
      ],
    });

    const a = await renderPdf(plannedWorkReportDocument(preview, null, BRANDING, one));
    const b = await renderPdf(plannedWorkReportDocument(preview, null, BRANDING, four));

    // Four pictures occupy more of the document than one. A grid that silently drew only
    // the first would produce identical output.
    expect(b.byteLength).toBeGreaterThan(a.byteLength);
  });

  it('puts photographs on the inspection report too', async () => {
    const report = inspectionFixture({
      groups: [
        {
          floorId: 'f1',
          floorName: '1-р давхар',
          tasks: [
            {
              taskId: 'it1',
              title: 'Ерөнхий оруулгын самбар',
              floorName: '1-р давхар',
              status: 'DONE',
              statusLabel: 'Дууссан',
              skipped: false,
              score: 38,
              riskLevel: 'CRITICAL',
              note: 'Газардуулга холбогдоогүй.',
              recommendation: null,
              totalQuantity: 1,
              completedQuantity: 1,
              unit: 'ш',
              attachments: [],
              completedAt: '2026-08-02T02:00:00.000Z',
              assignedEmployeeName: 'Д.Ганболд',
            },
          ],
        },
      ],
    });

    const bare = await renderPdf(inspectionReportDocument(report, BRANDING));
    const withPhotos = await renderPdf(
      inspectionReportDocument(report, BRANDING, new Map([['it1', [pixel(1600, 1200)]]])),
    );

    expect(withPhotos.byteLength).toBeGreaterThan(bare.byteLength);
  });
});
