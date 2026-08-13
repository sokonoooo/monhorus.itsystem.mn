import { RISK_LEVEL_LABELS, type InspectionReportDto } from '@monhorus/shared';
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
  signatureLeader,
  type BrandingImage,
} from './pdf-template';
import {
  formatDate,
  formatLongDate,
  formatQuantity,
  formatScore,
  formatYear,
  joinParts,
} from './report-pdf.format';
import type { ReportBranding } from './report-branding';

/**
 * The title the source document carries, verbatim.
 *
 * This report IS the one «Үзлэгийн тайлан.docx» was written for, so it takes the
 * template's own heading rather than a paraphrase of it.
 */
const TITLE = 'ЦАХИЛГААНЫ ҮЗЛЭГИЙН ТАЙЛАН';

/** The bold heading the template puts at the top of its first body page. */
const BODY_HEADING = 'Цахилгааны үзлэгийн тайлан';

export function inspectionReportDocument(
  report: InspectionReportDto,
  branding: ReportBranding,
  photos: ReadonlyMap<string, readonly BrandingImage[]> = new Map(),
): TDocumentDefinitions {
  // The report's own contractor still wins where it has one — it was resolved when the
  // report was written and is a fact about that inspection — and the configured company
  // is what stands in when it does not.
  const contractor = report.contractorName ?? branding.companyName;

  return {
    pageSize: PAGE_SIZE,
    pageOrientation: PAGE_ORIENTATION,
    pageMargins: PAGE_MARGINS,
    header: () => headerBlock(branding.logo),
    defaultStyle: { font: 'Tinos', fontSize: FONT_SIZE.table },
    info: {
      title: `${TITLE} ${report.workNumber}`,
      author: contractor,
    },
    content: [...cover(report, branding), ...body(report, contractor, photos)],
  };
}

function cover(report: InspectionReportDto, branding: ReportBranding): Content[] {
  const spacers: Content[] = Array.from({ length: 8 }, () => ({
    text: ' ',
    fontSize: FONT_SIZE.coverSpacer,
  }));

  return [
    ...spacers,
    coverTitle(TITLE),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    // The template's own three cover fields, in its order and with its labels.
    coverField('Объект:', joinParts([report.buildingName, report.locationLabel])),
    // Who performed the inspection, which is its own setting: an operator may issue a
    // report under one name and have the work carried out under another.
    coverField('Үзлэг хийсэн:', branding.inspectionCompany),
    coverField('Огноо:', formatLongDate(report.inspectionEnd ?? report.createdAt)),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    {
      text: 'Улаанбаатар',
      fontSize: FONT_SIZE.body,
      alignment: 'center',
      margin: [0, 0, 0, 2],
    },
    {
      text: formatYear(report.inspectionEnd ?? report.createdAt),
      fontSize: FONT_SIZE.body,
      alignment: 'center',
    },
  ];
}

function body(
  report: InspectionReportDto,
  contractor: string,
  photos: ReadonlyMap<string, readonly BrandingImage[]>,
): Content[] {
  const content: Content[] = [
    sectionHeading(BODY_HEADING, true),
    // The template's own organisation table, with its exact three labels, plus the
    // fields this report holds that the blank template left for a pen.
    organisationTable([
      ['Төслийн нэр / Project name', report.projectName ?? ''],
      ['Ерөнхий гүйцэтгэгчийн нэр / Company name', contractor],
      ['Ил ба далд ажлын актны нэр / ', report.actName ?? 'Цахилгааны үзлэг'],
      ['Захиалагч / Customer', report.customerName ?? ''],
      ['Байршил / Location', joinParts([report.buildingName, report.locationLabel])],
      ['Ажлын дугаар / Work number', report.workNumber],
      [
        'Үзлэгийн хугацаа / Period',
        [formatDate(report.inspectionStart), formatDate(report.inspectionEnd)]
          .filter((part) => part !== '')
          .join(' — '),
      ],
      [
        'Хариуцсан / Responsible',
        joinParts([
          report.responsibleEmployeeNames.join(', ') || null,
          report.responsibleTeamNames.join(', ') || null,
        ]),
      ],
      ['Үзлэгээр шалгасан / Scope', report.inspectedScope ?? ''],
    ]),
  ];

  // Requirement 8's body: the sub-tasks, grouped by the floor they were done on. Each
  // floor gets its own heading and table, which is how the source separates its sections.
  for (const group of report.groups) {
    if (group.tasks.length === 0) continue;
    content.push(
      sectionRule(`Байршил: ${group.floorName}`),
      dataTable(
        ['Ажлын нэр', 'Гүйцэтгэл', 'Төлөв', 'Үнэлгээ', 'Тайлбар'],
        group.tasks.map((task) => [
          task.title,
          `${formatQuantity(task.completedQuantity)}/${formatQuantity(task.totalQuantity)} ${task.unit}`,
          task.skipped ? `${task.statusLabel} (алгассан)` : task.statusLabel,
          [
            formatScore(task.score),
            task.riskLevel === null ? '' : RISK_LEVEL_LABELS[task.riskLevel],
          ]
            .filter((part) => part !== '')
            .join(' · '),
          task.note ?? '',
        ]),
        [
          CONTENT_WIDTH * 0.28,
          CONTENT_WIDTH * 0.15,
          CONTENT_WIDTH * 0.16,
          CONTENT_WIDTH * 0.18,
          CONTENT_WIDTH * 0.23,
        ],
      ),
    );
  }

  // The photographic record, in the template's own detail-block shape.
  //
  // Its own section rather than pictures wedged into the table above, because that is
  // how the source is built: a table of findings to read, and blocks of photographs with
  // the note beside each one. Only tasks that actually carry a photo appear — a block
  // with an empty picture area would be a row of borders saying nothing.
  const documented = report.groups
    .flatMap((group) =>
      group.tasks.map((task) => ({ task, floorName: group.floorName })),
    )
    .filter((entry) => (photos.get(entry.task.taskId)?.length ?? 0) > 0);

  if (documented.length > 0) {
    content.push(sectionRule('Гүйцэтгэлийн зураг'));
    for (const entry of documented) {
      content.push(
        detailBlock({
          workName: entry.task.title,
          location: joinParts([entry.floorName, report.buildingName]),
          note: entry.task.note,
          photos: photos.get(entry.task.taskId) ?? [],
        }),
      );
    }
  }

  // "Илэрсэн зөрчил" — the findings list, which is the part of this document a reader
  // turns to first. Kept as its own table so it is not buried inside a floor section.
  if (report.issues.length > 0) {
    content.push(
      sectionRule('Илэрсэн зөрчил'),
      dataTable(
        ['№', 'Ажлын нэр', 'Байршил', 'Түвшин', 'Нөхцөл', 'Зөвлөмж'],
        report.issues.map((issue, index) => [
          index + 1,
          issue.title,
          issue.locationLabel ?? '',
          RISK_LEVEL_LABELS[issue.riskLevel],
          issue.condition ?? '',
          issue.advice ?? '',
        ]),
        [
          CONTENT_WIDTH * 0.05,
          CONTENT_WIDTH * 0.2,
          CONTENT_WIDTH * 0.15,
          CONTENT_WIDTH * 0.14,
          CONTENT_WIDTH * 0.23,
          CONTENT_WIDTH * 0.23,
        ],
      ),
    );
  }

  // Requirement 9: the conclusion block, in the template's summary-table shape — an
  // index column, a label, a value — which is how its final page reads.
  const summaryRows: Array<readonly (string | number)[]> = [
    ['', 'Цахилгаан үзлэг хийсэн огноо:', formatLongDate(report.inspectionEnd ?? report.createdAt)],
    [1, 'Байршил:', joinParts([report.buildingName, report.locationLabel])],
    [2, 'Үзлэгээр шалгасан:', report.inspectedScope ?? ''],
    [3, 'Ерөнхий түвшин:', report.overallLabel ?? 'Үнэлгээгүй'],
  ];
  if (report.issueSummary !== null && report.issueSummary !== '') {
    summaryRows.push([4, 'Товч дүгнэлт:', report.issueSummary]);
  }

  content.push(
    sectionRule('Дүгнэлт'),
    dataTable(
      ['№', 'Үзүүлэлт', 'Утга'],
      summaryRows,
      [CONTENT_WIDTH * 0.06, CONTENT_WIDTH * 0.32, CONTENT_WIDTH * 0.62],
    ),
    ...prose('Дүгнэлт:', report.conclusion),
    ...prose('Зөвлөмж:', report.recommendation),
  );

  if (report.replacementPanels.length > 0) {
    content.push(...list('Шинэчлэх шаардлагатай самбарууд:', report.replacementPanels));
  }
  if (report.replacementConnections.length > 0) {
    content.push(...list('Шинэчлэх шаардлагатай холболт:', report.replacementConnections));
  }

  // Requirement 11, and the template's own sign-off wording.
  content.push(
    ...signatureBlock([
      { label: 'Тайлан гаргасан:', value: contractor },
      {
        label: 'Тайлан гүйцэтгэсэн:',
        value: signatureLeader(report.createdByName, report.createdByPosition),
      },
      {
        label: 'Хянасан:',
        value: signatureLeader(report.approvedByName, report.approvedByPosition),
      },
      { label: 'Хүлээн авсан:', value: signatureLeader(null, null) },
      { label: 'Шалгаж хянасан:', value: signatureLeader(null, null) },
    ]),
  );

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
