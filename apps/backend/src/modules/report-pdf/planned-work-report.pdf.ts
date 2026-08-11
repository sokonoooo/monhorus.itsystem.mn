import {
  MATERIAL_UNIT_LABELS,
  PLANNED_WORK_REPORT_STATUS_LABELS,
  PLANNED_WORK_TASK_STATUS_LABELS,
  RISK_LEVEL_LABELS,
  type PlannedWorkReportDto,
  type PlannedWorkReportPreviewDto,
} from '@monhorus/shared';
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
  headerBlock,
  organisationTable,
  prose,
  sectionHeading,
  signatureBlock,
  signatureLeader,
} from './pdf-template';
import {
  formatDate,
  formatLongDate,
  formatMinutes,
  formatPercent,
  formatQuantity,
  formatScore,
  formatYear,
} from './report-pdf.format';
import { reportLogo } from './pdf.renderer';

/** The title the cover carries, in the template's own voice. */
const TITLE = 'ТӨЛӨВЛӨГӨӨТ АЖЛЫН НЭГДСЭН ТАЙЛАН';

/**
 * The consolidated report for one planned work, as the office issues it.
 *
 * Assembled from exactly what the screen shows — `buildReportPreview` is the same query
 * behind both — so the PDF cannot drift from the page it was exported off. Nothing here
 * fetches; the caller hands the already-built preview in.
 */
export function plannedWorkReportDocument(
  preview: PlannedWorkReportPreviewDto,
  report: PlannedWorkReportDto | null,
  contractorName: string,
): TDocumentDefinitions {
  const logo = reportLogo();

  return {
    pageSize: PAGE_SIZE,
    pageOrientation: PAGE_ORIENTATION,
    pageMargins: PAGE_MARGINS,
    header: () => headerBlock(logo),
    defaultStyle: { font: 'Tinos', fontSize: FONT_SIZE.table },
    info: {
      title: `${TITLE} ${preview.workNumber}`,
      author: contractorName,
    },
    content: [
      ...cover(preview, contractorName),
      ...body(preview, report, contractorName),
    ],
  };
}

/**
 * The cover, laid out as the template lays its own out: a stack of empty lines pushing
 * the title into the upper third, the title, three left-aligned fields, then the city
 * and the year centred at the foot.
 *
 * The spacer paragraphs are the template's mechanism verbatim. Centring the block
 * vertically would be tidier and would not match.
 */
function cover(preview: PlannedWorkReportPreviewDto, contractorName: string): Content[] {
  const spacers: Content[] = Array.from({ length: 8 }, () => ({
    text: ' ',
    fontSize: FONT_SIZE.coverSpacer,
  }));

  return [
    ...spacers,
    coverTitle(TITLE),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    coverField('Объект:', preview.buildingName),
    coverField('Ажлын дугаар:', preview.workNumber),
    coverField('Гүйцэтгэсэн:', contractorName),
    coverField('Огноо:', formatLongDate(preview.actualEndDate ?? preview.plannedEndDate)),
    { text: ' ', fontSize: FONT_SIZE.coverSpacer },
    {
      text: 'Улаанбаатар',
      fontSize: FONT_SIZE.body,
      alignment: 'center',
      margin: [0, 0, 0, 2],
    },
    {
      text: formatYear(preview.generatedAt),
      fontSize: FONT_SIZE.body,
      alignment: 'center',
    },
  ];
}

function body(
  preview: PlannedWorkReportPreviewDto,
  report: PlannedWorkReportDto | null,
  contractorName: string,
): Content[] {
  const status = PLANNED_WORK_REPORT_STATUS_LABELS[preview.status] ?? '';

  const content: Content[] = [
    sectionHeading(TITLE, true),
    organisationTable([
      ['Төслийн нэр / Project name', preview.projectName ?? ''],
      ['Ерөнхий гүйцэтгэгчийн нэр / Company name', contractorName],
      ['Захиалагчийн нэр / Customer', preview.customerName],
      ['Барилга / Building', preview.buildingName],
      ['Ажлын нэр / Work', preview.title],
      ['Ажлын дугаар / Work number', preview.workNumber],
      ['Тайлангийн төлөв / Status', status],
    ]),

    // The schedule, as its own table rather than prose: seven dates and durations read
    // as a table and argue with each other as a paragraph.
    sectionRule('Хугацаа'),
    dataTable(
      ['Үзүүлэлт', 'Утга'],
      [
        ['Төлөвлөсөн эхлэх', formatDate(preview.plannedStartDate)],
        ['Төлөвлөсөн дуусах', formatDate(preview.plannedEndDate)],
        ...(preview.originalPlannedEndDate !== preview.plannedEndDate
          ? [['Анхны төлөвлөсөн дуусах', formatDate(preview.originalPlannedEndDate)]]
          : []),
        ['Бодит эхэлсэн', formatDate(preview.actualStartDate)],
        ['Бодит дууссан', formatDate(preview.actualEndDate)],
        ['Хугацаа хэтрэлт', preview.completedLate ? formatMinutes(preview.delayMinutes) : '—'],
        ['Түр зогссон', formatMinutes(preview.totalPausedMinutes) || '—'],
      ],
      [CONTENT_WIDTH * 0.5, CONTENT_WIDTH * 0.5],
    ),

    sectionRule('Гүйцэтгэлийн нэгтгэл'),
    dataTable(
      ['Нийт', 'Гүйцэтгэсэн', 'Үлдсэн', 'Хувь'],
      [
        [
          formatQuantity(preview.totalQuantity),
          formatQuantity(preview.completedQuantity),
          formatQuantity(preview.remainingQuantity),
          formatPercent(preview.progressPercent),
        ],
      ],
      [
        CONTENT_WIDTH * 0.25,
        CONTENT_WIDTH * 0.25,
        CONTENT_WIDTH * 0.25,
        CONTENT_WIDTH * 0.25,
      ],
    ),
  ];

  if (preview.floorProgress.length > 0) {
    content.push(
      sectionRule('Давхарын гүйцэтгэл'),
      dataTable(
        ['Давхар', 'Нийт', 'Гүйцэтгэсэн', 'Хувь'],
        preview.floorProgress.map((floor) => [
          floor.floorName,
          formatQuantity(floor.totalQuantity),
          formatQuantity(floor.completedQuantity),
          formatPercent(floor.progressPercent),
        ]),
        [
          CONTENT_WIDTH * 0.4,
          CONTENT_WIDTH * 0.2,
          CONTENT_WIDTH * 0.2,
          CONTENT_WIDTH * 0.2,
        ],
      ),
    );
  }

  // The sub-task table is the one that genuinely runs long, and the only reason this
  // module repeats header rows at all.
  content.push(
    sectionRule('Дэд ажлын биелэлт'),
    dataTable(
      ['Дэд ажил', 'Давхар', 'Биелэлт', 'Төлөв', 'Үнэлгээ', 'Тайлбар'],
      preview.tasks.map((task) => [
        task.title,
        task.floorName,
        `${formatQuantity(task.completedQuantity)}/${formatQuantity(task.totalQuantity)} ${
          MATERIAL_UNIT_LABELS[task.unit] ?? ''
        } (${formatPercent(task.progressPercent)})`,
        PLANNED_WORK_TASK_STATUS_LABELS[task.status] ?? '',
        [formatScore(task.score), task.riskLevel === null ? '' : RISK_LEVEL_LABELS[task.riskLevel]]
          .filter((part) => part !== '')
          .join(' · '),
        task.note ?? '',
      ]),
      [
        CONTENT_WIDTH * 0.24,
        CONTENT_WIDTH * 0.12,
        CONTENT_WIDTH * 0.18,
        CONTENT_WIDTH * 0.13,
        CONTENT_WIDTH * 0.15,
        CONTENT_WIDTH * 0.18,
      ],
    ),
  );

  if (preview.materials.length > 0) {
    content.push(
      sectionRule('Материал'),
      dataTable(
        ['Нэр', 'Тоо', 'Нэгж'],
        preview.materials.map((material) => [
          material.name,
          formatQuantity(material.quantity),
          MATERIAL_UNIT_LABELS[material.unit] ?? '',
        ]),
        [CONTENT_WIDTH * 0.6, CONTENT_WIDTH * 0.2, CONTENT_WIDTH * 0.2],
      ),
    );
  }

  content.push(
    ...prose('Дүгнэлт:', preview.conclusion),
    ...prose('Зөвлөмж:', preview.recommendation),
  );

  content.push(
    ...signatureBlock([
      { label: 'Тайлан гаргасан:', value: contractorName },
      {
        label: 'Тайлан гүйцэтгэсэн:',
        value: signatureLeader(report?.createdBy?.name ?? null, null),
      },
      {
        label: 'Хянасан:',
        value: signatureLeader(report?.approvedBy?.name ?? null, null),
      },
      { label: 'Хүлээн авсан:', value: signatureLeader(null, null) },
      { label: 'Шалгаж хянасан:', value: signatureLeader(null, null) },
    ]),
  );

  return content;
}

/** A left-aligned bold rule above a table, at body size. */
function sectionRule(text: string): Content {
  return {
    text,
    bold: true,
    fontSize: FONT_SIZE.body,
    margin: [0, PARAGRAPH_GAP, 0, PARAGRAPH_GAP],
  };
}
