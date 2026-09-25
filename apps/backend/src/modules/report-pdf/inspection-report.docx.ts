import { type InspectionReportDto, type RiskBand } from '@monhorus/shared';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IBorderOptions,
} from 'docx';

import {
  BODY_HEADING,
  ISSUE_HEADERS,
  SUMMARY_HEADERS,
  TASK_HEADERS,
  TITLE,
  contractorOf,
  coverFields,
  coverFooter,
  documentedTasks,
  floorSections,
  issueRows,
  organisationRows,
  proseBlocks,
  replacementLists,
  signatureLines,
  summaryRows,
} from './inspection-report.content';
import type { BrandingImage } from './pdf-template';
import type { ReportBranding } from './report-branding';

/**
 * The consolidated inspection report as an editable Word document.
 *
 * The same words as the PDF — both read `inspection-report.content.ts` — laid out on the
 * geometry of «Үзлэгийн тайлан.docx» itself. Word measures natively in the units that
 * template was read in, so the numbers below are its raw twips and half-points rather
 * than the point conversions `pdf-template.ts` has to make.
 *
 * Two deliberate differences from the PDF:
 *
 *   * The customer's name opens the document, as its title and as the first heading.
 *     A Word file gets filed, forwarded and edited under that name, where the PDF is a
 *     print of the template.
 *   * The font is Times New Roman itself, not Tinos. Tinos stood in only because a PDF
 *     must embed its font and Times New Roman cannot be redistributed; a Word document
 *     names its font and every Word install carries this one, Cyrillic included.
 */

const FONT = 'Times New Roman';

/** `w:pgSz` A4 and the template's own asymmetric `w:pgMar`, in twips. */
const PAGE = { width: 11906, height: 16838 };
const MARGIN = { top: 1440, right: 1376, bottom: 990, left: 1440, header: 720 };
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

/** Half-points, as `w:sz` stores them — the same ladder `FONT_SIZE` names in points. */
const SIZE = { heading: 32, coverSpacer: 28, title: 26, body: 24, table: 18, tableLabel: 16 };

/** `docDefaults`: 6pt after each paragraph, 1.1 line spacing. */
const PARAGRAPH_GAP = 120;
const LINE = 264;

/** A single 0.5pt black rule — `w:sz` is eighths of a point. */
const RULE: IBorderOptions = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
const NO_RULE: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const RULES = { top: RULE, bottom: RULE, left: RULE, right: RULE, insideHorizontal: RULE, insideVertical: RULE };
const NO_RULES = { top: NO_RULE, bottom: NO_RULE, left: NO_RULE, right: NO_RULE, insideHorizontal: NO_RULE, insideVertical: NO_RULE };

/** `TableNormal` cell margins: 108 twips left and right, a little air top and bottom. */
const CELL_MARGINS = { left: 108, right: 108, top: 50, bottom: 50 };

/** ImageRun measures in 96-dpi pixels; the template's boxes are in points. */
const px = (points: number): number => Math.round((points * 96) / 72);

/** Letterhead height and photo box, the same measurements `pdf-template.ts` uses. */
const LOGO_HEIGHT_PT = (352425 / 914400) * 72;
const LOGO_FALLBACK_WIDTH_PT = (1524000 / 914400) * 72;
const PHOTO_BOX = { width: 116, height: 87 };

export async function renderInspectionReportDocx(
  report: InspectionReportDto,
  branding: ReportBranding,
  photos: ReadonlyMap<string, readonly BrandingImage[]> = new Map(),
  bands: readonly RiskBand[] | null = null,
): Promise<Buffer> {
  return Packer.toBuffer(inspectionReportDocx(report, branding, photos, bands));
}

/** The document before packing, exported so a test can read what it says. */
export function inspectionReportDocx(
  report: InspectionReportDto,
  branding: ReportBranding,
  photos: ReadonlyMap<string, readonly BrandingImage[]> = new Map(),
  bands: readonly RiskBand[] | null = null,
): Document {
  const contractor = contractorOf(report, branding);
  const customer = documentTitle(report);

  return new Document({
    title: customer,
    subject: `${TITLE} ${report.workNumber}`,
    creator: contractor,
    styles: {
      default: {
        document: {
          run: { font: FONT, size: SIZE.table },
          paragraph: { spacing: { after: PARAGRAPH_GAP, line: LINE } },
        },
        title: {
          run: { font: FONT, size: SIZE.heading, bold: true, color: '000000' },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: PARAGRAPH_GAP * 2 } },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: PAGE,
            margin: { ...MARGIN, footer: 0, gutter: 0 },
          },
        },
        headers: { default: new Header({ children: [header(branding)] }) },
        children: [
          new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(customer)] }),
          ...cover(report, branding),
          ...body(report, contractor, photos, bands),
        ],
      },
    ],
  });
}

/**
 * The customer's name, which is what this file is titled. A report written before the
 * work had a customer still needs a title, and the template's own is the honest one.
 */
export function documentTitle(report: InspectionReportDto): string {
  const name = report.customerName?.trim() ?? '';
  return name === '' ? TITLE : name;
}

function text(
  value: string | number,
  options: { size?: number; bold?: boolean } = {},
): TextRun {
  return new TextRun({ text: String(value), size: options.size, bold: options.bold });
}

function paragraph(
  value: string | number,
  options: {
    size?: number;
    bold?: boolean;
    center?: boolean;
    before?: number;
    after?: number;
    keepNext?: boolean;
    pageBreakBefore?: boolean;
  } = {},
): Paragraph {
  return new Paragraph({
    children: [text(value, options)],
    alignment: options.center ? AlignmentType.CENTER : undefined,
    spacing: { before: options.before ?? 0, after: options.after ?? PARAGRAPH_GAP },
    keepNext: options.keepNext,
    pageBreakBefore: options.pageBreakBefore,
  });
}

/**
 * Both letterheads, one pinned to each margin, as the PDF header draws them.
 *
 * A borderless two-cell table rather than a right-aligned tab stop: every Word-reading
 * program honours a cell's alignment, where some ignore tab stops in a header.
 */
function header(branding: ReportBranding): Paragraph | Table {
  if (branding.logo === null && branding.customerLogo === null) {
    return new Paragraph({ children: [], spacing: { after: 0 } });
  }
  const half = Math.floor(CONTENT_WIDTH / 2);
  const side = (logo: BrandingImage | null, width: number, right: boolean): TableCell =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: { top: NO_RULE, bottom: NO_RULE, left: NO_RULE, right: NO_RULE },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      children: [
        new Paragraph({
          alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          spacing: { after: 0 },
          children: logo === null ? [] : [logoRun(logo)],
        }),
      ],
    });
  return fixedTable(
    [half, CONTENT_WIDTH - half],
    [
      new TableRow({
        children: [
          side(branding.logo, half, false),
          side(branding.customerLogo, CONTENT_WIDTH - half, true),
        ],
      }),
    ],
    NO_RULES,
  );
}

function logoRun(logo: BrandingImage): ImageRun {
  const ratio = logo.height > 0 ? logo.width / logo.height : null;
  const width = ratio === null ? LOGO_FALLBACK_WIDTH_PT : LOGO_HEIGHT_PT * ratio;
  return imageRun(logo, width, LOGO_HEIGHT_PT);
}

/** One photograph, fitted inside the template's box without being distorted. */
function photoRun(image: BrandingImage): ImageRun {
  const ratio = image.height > 0 ? image.width / image.height : 1;
  const boxRatio = PHOTO_BOX.width / PHOTO_BOX.height;
  return ratio >= boxRatio
    ? imageRun(image, PHOTO_BOX.width, PHOTO_BOX.width / ratio)
    : imageRun(image, PHOTO_BOX.height * ratio, PHOTO_BOX.height);
}

/** The loaders hand every picture over as a JPEG data url; Word wants the bytes. */
function imageRun(image: BrandingImage, widthPt: number, heightPt: number): ImageRun {
  const comma = image.dataUrl.indexOf(',');
  const isPng = image.dataUrl.startsWith('data:image/png');
  return new ImageRun({
    type: isPng ? 'png' : 'jpg',
    data: Buffer.from(image.dataUrl.slice(comma + 1), 'base64'),
    transformation: { width: px(widthPt), height: px(heightPt) },
  });
}

function cover(report: InspectionReportDto, branding: ReportBranding): Paragraph[] {
  // Two fewer spacers than the PDF, because the customer heading above takes their room
  // and the cover must still fit its page.
  const spacer = (): Paragraph => paragraph(' ', { size: SIZE.coverSpacer, after: 0 });
  const [city, year] = coverFooter(report);

  return [
    ...Array.from({ length: 6 }, spacer),
    // 13pt and deliberately NOT bold, as the original is not.
    paragraph(TITLE, { size: SIZE.title, center: true }),
    spacer(),
    ...coverFields(report, branding).map(
      ([label, value]) => paragraph(`${label} ${value}`, { size: SIZE.body, after: 40 }),
    ),
    spacer(),
    paragraph(city, { size: SIZE.body, center: true, after: 40 }),
    paragraph(year, { size: SIZE.body, center: true }),
  ];
}

function body(
  report: InspectionReportDto,
  contractor: string,
  photos: ReadonlyMap<string, readonly BrandingImage[]>,
  bands: readonly RiskBand[] | null,
): Array<Paragraph | Table> {
  const content: Array<Paragraph | Table> = [
    paragraph(BODY_HEADING, {
      size: SIZE.body,
      bold: true,
      center: true,
      after: PARAGRAPH_GAP * 2,
      pageBreakBefore: true,
    }),
    labelledTable(organisationRows(report, contractor)),
    gap(),
  ];

  for (const section of floorSections(report, bands)) {
    content.push(
      sectionRule(section.heading),
      dataTable(TASK_HEADERS, section.rows, [0.28, 0.15, 0.16, 0.18, 0.23]),
      gap(),
    );
  }

  const documented = documentedTasks(
    report,
    (taskId) => (photos.get(taskId)?.length ?? 0) > 0,
  );
  if (documented.length > 0) {
    content.push(sectionRule('Гүйцэтгэлийн зураг'));
    for (const entry of documented) {
      content.push(
        detailBlock(entry.workName, entry.location, entry.note, photos.get(entry.taskId) ?? []),
        gap(),
      );
    }
  }

  if (report.issues.length > 0) {
    content.push(
      sectionRule('Илэрсэн зөрчил'),
      dataTable(ISSUE_HEADERS, issueRows(report, bands), [0.05, 0.2, 0.15, 0.14, 0.23, 0.23]),
      gap(),
    );
  }

  content.push(
    sectionRule('Дүгнэлт'),
    dataTable(SUMMARY_HEADERS, summaryRows(report), [0.06, 0.32, 0.62]),
    gap(),
  );

  for (const [label, value] of proseBlocks(report)) {
    if (value === null || value.trim() === '') continue;
    content.push(
      paragraph(label, { size: SIZE.body, bold: true, before: PARAGRAPH_GAP, after: 40, keepNext: true }),
      // Line by line, so paragraphs the author typed stay paragraphs in Word.
      ...value.split(/\r?\n/).map((line) => paragraph(line, { size: SIZE.table })),
    );
  }

  for (const [label, items] of replacementLists(report)) {
    content.push(
      paragraph(label, { size: SIZE.body, bold: true, before: PARAGRAPH_GAP, after: 40, keepNext: true }),
      ...items.map(
        (item) =>
          new Paragraph({
            children: [text(item, { size: SIZE.table })],
            bullet: { level: 0 },
            spacing: { after: 0 },
          }),
      ),
    );
  }

  content.push(paragraph(' ', { before: PARAGRAPH_GAP * 2 }), signatureTable(signatureLines(report, contractor)));
  return content;
}

/** A small paragraph after a table, since Word butts the next block against its rule. */
function gap(): Paragraph {
  return new Paragraph({ children: [], spacing: { after: PARAGRAPH_GAP } });
}

function sectionRule(value: string): Paragraph {
  return paragraph(value, {
    size: SIZE.body,
    bold: true,
    before: PARAGRAPH_GAP,
    after: PARAGRAPH_GAP,
    keepNext: true,
  });
}

function cell(
  value: string | number,
  width: number,
  options: { bold?: boolean; size?: number; columnSpan?: number; rowSpan?: number } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan,
    rowSpan: options.rowSpan,
    margins: CELL_MARGINS,
    children: String(value)
      .split(/\r?\n/)
      .map(
        (line) =>
          new Paragraph({
            children: [text(line, { bold: options.bold, size: options.size ?? SIZE.table })],
            spacing: { after: 0 },
          }),
      ),
  });
}

function fixedTable(widths: number[], rows: TableRow[], borders = RULES): Table {
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    layout: TableLayoutType.FIXED,
    borders,
    rows,
  });
}

/** The two-column organisation table: bold 8pt labels, plain 9pt values. */
function labelledTable(rows: ReadonlyArray<[string, string]>): Table {
  const half = Math.floor(CONTENT_WIDTH / 2);
  const widths = [half, CONTENT_WIDTH - half];
  return fixedTable(
    widths,
    rows.map(
      ([label, value]) =>
        new TableRow({
          cantSplit: true,
          children: [
            cell(label, widths[0]!, { bold: true, size: SIZE.tableLabel }),
            cell(value, widths[1]!),
          ],
        }),
    ),
  );
}

/** A data table with a bold header row that repeats when the table runs onto a new page. */
function dataTable(
  headers: readonly string[],
  rows: ReadonlyArray<readonly (string | number)[]>,
  fractions: readonly number[],
): Table {
  const widths = fractions.map((fraction) => Math.round(CONTENT_WIDTH * fraction));
  return fixedTable(widths, [
    new TableRow({
      tableHeader: true,
      cantSplit: true,
      children: headers.map((label, index) =>
        cell(label, widths[index]!, { bold: true, size: SIZE.tableLabel }),
      ),
    }),
    ...rows.map(
      (row) =>
        new TableRow({
          cantSplit: true,
          children: row.map((value, index) => cell(value, widths[index]!)),
        }),
    ),
  ]);
}

/**
 * The template's detail block: work name and location across the top, the photographs
 * two to a row on the left, and one `Тайлбар:` cell merged down the right beside them.
 */
function detailBlock(
  workName: string,
  location: string,
  note: string | null,
  images: readonly BrandingImage[],
): Table {
  const label = Math.round(CONTENT_WIDTH * 0.14);
  const photo = Math.round((CONTENT_WIDTH * 0.56) / 2);
  const noteWidth = CONTENT_WIDTH - photo * 2;
  const widths = [label, photo - label, photo, noteWidth];

  const headerRow = (name: string, value: string): TableRow =>
    new TableRow({
      cantSplit: true,
      children: [
        cell(name, label, { bold: true, size: SIZE.tableLabel }),
        cell(value, CONTENT_WIDTH - label, { columnSpan: 3 }),
      ],
    });

  const photoCell = (image: BrandingImage | undefined, width: number, columnSpan?: number): TableCell =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      columnSpan,
      margins: CELL_MARGINS,
      verticalAlign: VerticalAlign.CENTER,
      children: [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 0 },
          keepNext: true,
          children: image === undefined ? [] : [photoRun(image)],
        }),
      ],
    });

  const rowCount = Math.max(1, Math.ceil(images.length / 2));
  const photoRows = Array.from({ length: rowCount }, (_, row) => {
    const children = [
      photoCell(images[row * 2], photo, 2),
      photoCell(images[row * 2 + 1], photo),
    ];
    if (row === 0) {
      children.push(
        cell(note === null || note === '' ? '' : `Тайлбар: ${note}`, noteWidth, { rowSpan: rowCount }),
      );
    }
    return new TableRow({ cantSplit: true, children });
  });

  return fixedTable(widths, [headerRow('Ажлын нэр:', workName), headerRow('Байршил:', location), ...photoRows]);
}

/** The sign-off lines, as the borderless two-column table the PDF uses. */
function signatureTable(lines: ReadonlyArray<{ label: string; value: string }>): Table {
  const widths = [Math.round(CONTENT_WIDTH * 0.32), CONTENT_WIDTH - Math.round(CONTENT_WIDTH * 0.32)];
  const plain = (value: string, width: number): TableCell =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      borders: { top: NO_RULE, bottom: NO_RULE, left: NO_RULE, right: NO_RULE },
      margins: { top: 60, bottom: 60, left: 0, right: 0 },
      children: [paragraph(value, { size: SIZE.body, after: 0 })],
    });
  return fixedTable(
    widths,
    lines.map(
      (line) =>
        new TableRow({ cantSplit: true, children: [plain(line.label, widths[0]!), plain(line.value, widths[1]!)] }),
    ),
    NO_RULES,
  );
}
