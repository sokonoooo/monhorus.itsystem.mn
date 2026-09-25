import { type InspectionReportDto, type RiskBand } from '@monhorus/shared';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import {
  CONTENT_WIDTH,
  FONT_SIZE,
  PAGE_MARGINS,
  PAGE_ORIENTATION,
  PAGE_SIZE,
  PARAGRAPH_GAP,
  coverField,
  coverTitle,
  dataTable,
  detailBlock,
  headerBlock,
  organisationTable,
  prose,
  sectionHeading,
  signatureBlock,
  type BrandingImage,
} from './pdf-template';
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
import type { ReportBranding } from './report-branding';

/**
 * The consolidated inspection report as a pdfmake document.
 *
 * What it says comes from `inspection-report.content.ts`, which the Word export reads
 * too; this file owns only how it is laid out on the page.
 */
export function inspectionReportDocument(
  report: InspectionReportDto,
  branding: ReportBranding,
  photos: ReadonlyMap<string, readonly BrandingImage[]> = new Map(),
  /**
   * The configured risk ladder, for the band names in the tables below.
   *
   * Optional, and omitting it prints the shipped names — which is what every caller did
   * before, and keeps this renderer usable from a test with no database behind it.
   */
  bands: readonly RiskBand[] | null = null,
): TDocumentDefinitions {
  const contractor = contractorOf(report, branding);

  return {
    pageSize: PAGE_SIZE,
    pageOrientation: PAGE_ORIENTATION,
    pageMargins: PAGE_MARGINS,
    header: () => headerBlock(branding.logo, branding.customerLogo),
    defaultStyle: { font: 'Tinos', fontSize: FONT_SIZE.table },
    info: {
      title: `${TITLE} ${report.workNumber}`,
      author: contractor,
    },
    content: [...cover(report, branding), ...body(report, contractor, photos, bands)],
  };
}

function cover(report: InspectionReportDto, branding: ReportBranding): Content[] {
  const spacers: Content[] = Array.from({ length: 8 }, () => ({
    text: ' ',
    fontSize: FONT_SIZE.coverSpacer,
  }));
  const [city, year] = coverFooter(report);

  return [
    ...spacers,
    coverTitle(TITLE),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    ...coverFields(report, branding).map(([label, value]) => coverField(label, value)),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    {
      text: city,
      fontSize: FONT_SIZE.body,
      alignment: 'center',
      margin: [0, 0, 0, 2],
    },
    {
      text: year,
      fontSize: FONT_SIZE.body,
      alignment: 'center',
    },
  ];
}

function body(
  report: InspectionReportDto,
  contractor: string,
  photos: ReadonlyMap<string, readonly BrandingImage[]>,
  bands: readonly RiskBand[] | null,
): Content[] {
  const content: Content[] = [
    sectionHeading(BODY_HEADING, true),
    organisationTable(organisationRows(report, contractor)),
  ];

  // Each floor gets its own heading and table, which is how the source separates its
  // sections.
  for (const section of floorSections(report, bands)) {
    content.push(
      sectionRule(section.heading),
      dataTable(TASK_HEADERS, section.rows, [
        CONTENT_WIDTH * 0.28,
        CONTENT_WIDTH * 0.15,
        CONTENT_WIDTH * 0.16,
        CONTENT_WIDTH * 0.18,
        CONTENT_WIDTH * 0.23,
      ]),
    );
  }

  // The photographic record, in the template's own detail-block shape.
  //
  // Its own section rather than pictures wedged into the table above, because that is
  // how the source is built: a table of findings to read, and blocks of photographs with
  // the note beside each one.
  const documented = documentedTasks(
    report,
    (taskId) => (photos.get(taskId)?.length ?? 0) > 0,
  );

  if (documented.length > 0) {
    content.push(sectionRule('Гүйцэтгэлийн зураг'));
    for (const entry of documented) {
      content.push(
        detailBlock({
          workName: entry.workName,
          location: entry.location,
          note: entry.note,
          photos: photos.get(entry.taskId) ?? [],
        }),
      );
    }
  }

  // "Илэрсэн зөрчил" — the part of this document a reader turns to first. Kept as its
  // own table so it is not buried inside a floor section.
  if (report.issues.length > 0) {
    content.push(
      sectionRule('Илэрсэн зөрчил'),
      dataTable(ISSUE_HEADERS, issueRows(report, bands), [
        CONTENT_WIDTH * 0.05,
        CONTENT_WIDTH * 0.2,
        CONTENT_WIDTH * 0.15,
        CONTENT_WIDTH * 0.14,
        CONTENT_WIDTH * 0.23,
        CONTENT_WIDTH * 0.23,
      ]),
    );
  }

  content.push(
    sectionRule('Дүгнэлт'),
    dataTable(SUMMARY_HEADERS, summaryRows(report), [
      CONTENT_WIDTH * 0.06,
      CONTENT_WIDTH * 0.32,
      CONTENT_WIDTH * 0.62,
    ]),
    ...proseBlocks(report).flatMap(([label, text]) => prose(label, text)),
  );

  for (const [label, items] of replacementLists(report)) {
    content.push(...list(label, items));
  }

  content.push(...signatureBlock(signatureLines(report, contractor)));

  return content;
}

function sectionRule(text: string): Content {
  return {
    text,
    bold: true,
    fontSize: FONT_SIZE.body,
    margin: [0, PARAGRAPH_GAP, 0, PARAGRAPH_GAP],
  };
}

/** A labelled bullet list, for the two "шинэчлэх шаардлагатай" blocks. */
function list(label: string, items: readonly string[]): Content[] {
  return [
    {
      text: label,
      bold: true,
      fontSize: FONT_SIZE.body,
      margin: [0, PARAGRAPH_GAP, 0, 2],
    },
    {
      ul: [...items],
      fontSize: FONT_SIZE.table,
      margin: [0, 0, 0, PARAGRAPH_GAP],
    },
  ];
}
