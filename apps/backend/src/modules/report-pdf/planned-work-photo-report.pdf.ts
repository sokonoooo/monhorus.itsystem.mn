import type {
  PlannedWorkReportDto,
  PlannedWorkReportPreviewDto,
  PlannedWorkReportTaskLineDto,
} from '@monhorus/shared';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';

import {
  FONT_SIZE,
  PAGE_MARGINS,
  PAGE_ORIENTATION,
  PAGE_SIZE,
  headerBlock,
  organisationTable,
  type BrandingImage,
} from './pdf-template';
import {
  PHOTOS_PER_PAGE,
  nameSlot,
  photoBodyHeading,
  photoCoverFoot,
  photoCoverSubtitle,
  photoCoverTitle,
  photoRow,
  photoSignatureBlock,
  type PhotoCaption,
} from './photo-report-template';
import { formatYearNumber, joinParts } from './report-pdf.format';

/** The title the source document carries, verbatim. */
const TITLE = 'ГҮЙЦЭТГЭСЭН АЖЛЫН ТАЙЛАН';

/** The bold heading over the first body page, also the source's own. */
const BODY_HEADING = 'Цахилгаан хангамжийн ажил гүйцэтгэлийн тайлан /Фото/';

/** Where the office issues from. The source prints this on every cover. */
const CITY = 'Улаанбаатар';

/**
 * The photographic report for one planned work.
 *
 * A SECOND document for the same work, not a replacement for `plannedWorkReportDocument`.
 * That one is the consolidated report — schedule, progress, sub-tasks, materials — and it
 * is unchanged. This one is what the office hands a client when the question is "show me
 * what was done": a cover, pages of photographs with their captions, and a sheet to sign.
 * They are exported from the same screen by two different buttons.
 *
 * Assembled from exactly what that screen shows, and it fetches nothing: the caller hands
 * in the already-built preview and the already-encoded photographs, so this document
 * cannot say anything the consolidated one does not.
 */
export function plannedWorkPhotoReportDocument(
  preview: PlannedWorkReportPreviewDto,
  report: PlannedWorkReportDto | null,
  branding: {
    logo: BrandingImage | null;
    customerLogo: BrandingImage | null;
    companyName: string;
  },
  photos: ReadonlyMap<string, readonly BrandingImage[]> = new Map(),
): TDocumentDefinitions {
  return {
    pageSize: PAGE_SIZE,
    pageOrientation: PAGE_ORIENTATION,
    pageMargins: PAGE_MARGINS,
    // Both letterheads, the operator's at the left margin and the project's at the right,
    // which is the arrangement the source document uses throughout.
    header: () => headerBlock(branding.logo, branding.customerLogo),
    defaultStyle: { font: 'Tinos', fontSize: FONT_SIZE.table },
    info: {
      title: `${TITLE} ${preview.workNumber}`,
      author: branding.companyName,
    },
    content: [
      ...cover(preview),
      ...body(preview, branding.companyName, photos),
      signatures(preview, report, branding.companyName),
    ],
  };
}

/**
 * The cover: a title, a subtitle in slashes, and the city and year at the foot.
 *
 * Nothing else, which is the source's own restraint rather than an omission — the work
 * number, the object and the dates are all on the body pages that follow, and a cover
 * that repeats them is a cover nobody reads.
 */
function cover(preview: PlannedWorkReportPreviewDto): Content[] {
  return [
    photoCoverTitle(TITLE),
    // The source's subtitle names the site and the job. Ours is the project and the work,
    // and falls back to the work alone rather than printing a dangling separator when the
    // planned work belongs to no project.
    photoCoverSubtitle(joinParts([preview.projectName, preview.title], ' - ')),
    ...photoCoverFoot(CITY, formatYearNumber(preview.generatedAt)),
  ];
}

/**
 * The body: pages of four photographs, each page opening with the organisation table.
 *
 * The table is repeated on every page because the source repeats it, and because these
 * pages are handed over one at a time — a sheet of four photographs that does not say
 * which project it belongs to is a sheet of four photographs.
 */
function body(
  preview: PlannedWorkReportPreviewDto,
  companyName: string,
  photos: ReadonlyMap<string, readonly BrandingImage[]>,
): Content[] {
  const captions = captionsOf(preview, photos);

  const organisation = (): Content =>
    organisationTable([
      ['Төслийн нэр / Project name', preview.projectName ?? ''],
      ['Ерөнхий гүйцэтгэгчийн нэр / Company name', companyName],
      // The act this work was carried out under. The planned work's own title is what
      // names it here; there is no separate act register to read it from.
      ['Ил ба далд ажлын актны нэр /', preview.title],
    ]);

  // A report with no photographs still prints. It gets its cover, one body page carrying
  // the organisation table, and its signature sheet — which is a thin but honest document,
  // where refusing to render would leave the operator with nothing to hand over at all.
  if (captions.length === 0) {
    return [photoBodyHeading(BODY_HEADING), organisation()];
  }

  const content: Content[] = [];
  for (let start = 0; start < captions.length; start += PHOTOS_PER_PAGE) {
    const page = captions.slice(start, start + PHOTOS_PER_PAGE);

    if (start === 0) {
      // `photoBodyHeading` carries the break off the cover; every later page breaks on its
      // own table instead, so the heading appears once as the source has it.
      content.push(photoBodyHeading(BODY_HEADING));
      content.push(organisation());
    } else {
      content.push({ ...(organisation() as object), pageBreak: 'before' } as Content);
    }

    content.push(photoRow(page.slice(0, 2)));
    if (page.length > 2) content.push(photoRow(page.slice(2)));
  }

  return content;
}

/**
 * One caption per photograph, in sub-task order.
 *
 * The source captions every picture individually, so a sub-task with four photographs
 * contributes four cells that repeat its title, location and note. That repetition is the
 * point: each cell is meant to be readable on its own, next to whichever picture happens
 * to sit beside it on the page.
 */
function captionsOf(
  preview: PlannedWorkReportPreviewDto,
  photos: ReadonlyMap<string, readonly BrandingImage[]>,
): PhotoCaption[] {
  const captions: PhotoCaption[] = [];

  for (const task of preview.tasks) {
    for (const image of photos.get(task.id) ?? []) {
      captions.push({
        workName: task.title,
        location: locationOf(task, preview),
        note: task.note,
        image,
      });
    }
  }

  return captions;
}

/** «Байршил» — the floor and the building, skipping whichever is blank. */
function locationOf(
  task: PlannedWorkReportTaskLineDto,
  preview: PlannedWorkReportPreviewDto,
): string {
  // Comma-separated rather than the consolidated report's interpunct: this caption is a
  // place, written the way an address is, and « · » belongs to a table of metrics.
  return joinParts([task.floorName, preview.buildingName], ', ');
}

/**
 * The sign-off sheet: who issued the report, and who receives it.
 *
 * The issuing side prints the names the report already records — it knows who wrote and
 * who approved it — and the receiving side prints a dotted rule, because those signatures
 * happen on paper after this document is handed over.
 */
function signatures(
  preview: PlannedWorkReportPreviewDto,
  report: PlannedWorkReportDto | null,
  companyName: string,
): Content {
  const dotted = '.............................';

  return photoSignatureBlock([
    { label: 'Тайлан гаргасан:', value: companyName },
    {
      label: 'Гүйцэтгэсэн:',
      value: nameSlot(report?.createdBy?.name ?? null),
      indented: true,
    },
    {
      label: 'Хянасан:',
      value: nameSlot(report?.approvedBy?.name ?? null),
      indented: true,
    },
    { label: 'Хүлээн авсан:', value: preview.customerName },
    { label: 'Танилцсан:', value: `${dotted} ${nameSlot(null)}`, indented: true },
    { label: 'Шалгаж хянасан:', value: `${dotted} ${nameSlot(null)}`, indented: true },
  ]);
}
