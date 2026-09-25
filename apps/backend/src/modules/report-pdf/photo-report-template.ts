import type { Content, ContentTable, TableCell } from 'pdfmake/interfaces';

import {
  CONTENT_WIDTH,
  FONT_SIZE,
  PAGE_MARGINS,
  PARAGRAPH_GAP,
  TABLE_LAYOUT,
  type BrandingImage,
} from './pdf-template';

/**
 * The photographic report template, measured off «ТКС-2, ТКС-4 самбар гэрээт ажил.pdf».
 *
 * A SECOND house template, not a revision of the first. `pdf-template.ts` reproduces
 * «Үзлэгийн тайлан.docx», and the two documents genuinely differ: that one is a report of
 * findings whose pictures illustrate a table, this one is a report OF pictures, where the
 * photograph is the content and the words underneath it are the caption. Folding the
 * measurements together would mean one file claiming to be measured off two sources and
 * silently splitting the difference wherever they disagree.
 *
 * WHAT IT SHARES with the first template is everything about the page rather than the
 * block: A4 portrait, the same margins, the same Tinos standing in for Times New Roman,
 * the same 0.5pt rules, the same two-column organisation table. Those are imported rather
 * than restated, so a change to the page geometry still moves both documents together.
 *
 * WHAT IT DOES DIFFERENTLY, and each is the source document's own choice:
 *
 *   * The cover carries a title and a subtitle in slashes and NOTHING else — no object,
 *     no work number, no date. The city and the year sit at the foot of the sheet.
 *   * Every body page repeats the organisation table. The source does this on both of its
 *     body pages, and it is what makes a page that has been printed and handed over
 *     readable on its own.
 *   * Every photograph carries its own three-line caption. The first template captions a
 *     BLOCK of up to four pictures with one shared note; this one captions each picture.
 *   * The sign-off is two groups — who issued it and who received it — rather than one
 *     flat list, and only the receiving side signs on a dotted rule.
 *
 * The measurements below were read out of the source PDF's own text and image geometry
 * with `pdftotext -bbox` and `pdfimages -list`, at its 220ppi placement.
 */

/**
 * Where the cover title sits, as a gap below the top margin.
 *
 * The source puts its baseline at y=352 on an 841.92pt sheet, and the text block starts
 * at the 72pt top margin. Expressed as the gap rather than the absolute y so that moving
 * the page margins moves the cover with them.
 */
const COVER_TITLE_GAP = 352 - PAGE_MARGINS[1];

/** The cover title: 14pt bold, from a measured 9.25pt per capital across 24 characters. */
const COVER_TITLE_SIZE = 14;

/** The subtitle in slashes, italic at 12pt, measured the same way. */
const COVER_SUBTITLE_SIZE = 12;

/** A4's height, the one page dimension `pdf-template` has no reason to name. */
const PAGE_HEIGHT = 841.92;

/** How tall pdfmake draws a line of a given size, near enough to lay a cover out with. */
const LINE = 1.2;

/** The gap under the city, which the source sets at 23pt between its two foot lines. */
const COVER_FOOT_LEAD = 6;

/**
 * The gap under the subtitle that drops the city and year to the foot of the sheet.
 *
 * DERIVED rather than measured, and that is the one place this file departs from its
 * source on purpose. The source has the city at y=765 and the year at y=788, which sits
 * the year's descender below where this template's bottom margin falls — reproducing the
 * number verbatim pushed the year onto a second page and left the cover with a blank
 * sheet stapled to it. So the foot is placed at the bottom of the text block instead: the
 * same position to within a few points, and one that cannot overflow when the page
 * margins are changed.
 */
const COVER_FOOT_GAP =
  PAGE_HEIGHT -
  PAGE_MARGINS[1] -
  PAGE_MARGINS[3] -
  COVER_TITLE_GAP -
  COVER_TITLE_SIZE * LINE -
  2 -
  COVER_SUBTITLE_SIZE * LINE -
  FONT_SIZE.body * LINE -
  COVER_FOOT_LEAD -
  FONT_SIZE.body * LINE;

/** The bold heading over the first body page, from its 15.4pt line box. */
const BODY_HEADING_SIZE = 13;

/**
 * How many photographs one body page holds: two columns by two rows.
 *
 * The source's own grid, and it is a maximum rather than a target — a report with three
 * photographs prints three, and the fourth cell is simply not drawn.
 */
export const PHOTOS_PER_PAGE = 4;

/** `TableNormal` cell padding, added by the layout OUTSIDE the widths a table declares. */
const CELL_PAD_X = 108 / 20;

/**
 * The space one grid cell occupies, and the width its table declares — two numbers.
 *
 * pdfmake's `widths` are CONTENT widths: the layout's padding is added on top of them, so
 * a two-column table declaring `CONTENT_WIDTH / 2` actually draws 21.6pt wider than that.
 * Two of those side by side overflow the text block and the right-hand cell lands on top
 * of the left-hand one's rule.
 *
 * `CELL_OUTER` is therefore half of what `organisationTable` above these cells actually
 * draws — its declared `CONTENT_WIDTH` plus its own four paddings — so the grid lines up
 * with the table it sits under, and `CELL_INNER` is what is left for the columns once this
 * table's four paddings are taken back out.
 */
const CELL_OUTER = CONTENT_WIDTH / 2 + CELL_PAD_X * 2;
const CELL_INNER = CELL_OUTER - CELL_PAD_X * 4;

/**
 * The drawing box for one photograph.
 *
 * The source places its pictures at 220ppi, which lands them at about 133 to 235pt wide
 * and a consistent 177pt tall — the height is what its grid actually holds constant. The
 * width here is what the cell leaves once its columns are accounted for.
 */
const PHOTO_BOX_WIDTH = CELL_INNER;
const PHOTO_BOX_HEIGHT = 177;

/**
 * The caption's label column, from the source's own 80.7pt against a 247pt cell.
 *
 * A ratio rather than the measurement itself because this template's text block is
 * narrower than the source's — the source lets its tables overhang the right margin by
 * half a centimetre, which Word permits and pdfmake does not.
 */
const CAPTION_LABEL_RATIO = 80.7 / 247;

/** The indent on a sign-off line that belongs under a group, measured at 66.3pt. */
const SIGNATURE_INDENT = 66.3;

/**
 * One photograph fitted into its box WITHOUT distorting it.
 *
 * The same rule the first template applies, and for the same reason: the source crops
 * pictures that do not suit its cells, and cropping somebody's evidence photograph
 * automatically is not a decision this code should make. The longer side meets the box
 * and the shorter side is whatever the picture's proportions make it, so a portrait photo
 * prints narrow and tall.
 */
function fittedPhoto(image: BrandingImage): Content {
  const ratio = image.height > 0 ? image.width / image.height : 1;
  const boxRatio = PHOTO_BOX_WIDTH / PHOTO_BOX_HEIGHT;
  const width = ratio >= boxRatio ? PHOTO_BOX_WIDTH : PHOTO_BOX_HEIGHT * ratio;

  return { image: image.dataUrl, width, alignment: 'center' };
}

/** What one cell of the grid says about its picture. */
export interface PhotoCaption {
  /** «Ажлын нэр» — the sub-task the photograph documents. */
  workName: string;
  /** «Байршил» — where it was taken, floor and building. */
  location: string;
  /** «Тайлбар» — the sub-task's note, or null when it carries none. */
  note: string | null;
  image: BrandingImage;
}

/**
 * One cell of the photo grid: the picture, then its three-line caption beneath it.
 *
 * A table of its own rather than four rows of the page's table, so that a caption can
 * never drift away from the picture it describes when the grid is assembled. The whole
 * cell is `unbreakable` for the same reason — a photograph at the foot of one page with
 * its caption at the head of the next is worse than a page that ends early.
 */
export function photoCell(caption: PhotoCaption): ContentTable {
  const labelWidth = CELL_INNER * CAPTION_LABEL_RATIO;
  const valueWidth = CELL_INNER - labelWidth;

  const captionRow = (label: string, value: string): TableCell[] => [
    { text: label, bold: true, fontSize: FONT_SIZE.tableLabel },
    { text: value, fontSize: FONT_SIZE.table },
  ];

  return {
    unbreakable: true,
    table: {
      widths: [labelWidth, valueWidth],
      // The picture row is held at the box height whatever shape the photograph is.
      // Without it a landscape picture makes a shorter row than a portrait one, and the
      // two cells of a grid row then carry their captions at different heights — which
      // reads as a broken table rather than as two pictures of different shapes.
      heights: [PHOTO_BOX_HEIGHT],
      body: [
        [{ ...(fittedPhoto(caption.image) as object), colSpan: 2 } as TableCell, {}],
        captionRow('Ажлын нэр:', caption.workName),
        captionRow('Байршил:', caption.location),
        captionRow('Тайлбар:', caption.note ?? ''),
      ],
    },
    layout: TABLE_LAYOUT,
  };
}

/**
 * One row of the grid: two cells side by side, sharing the rule between them.
 *
 * An odd photograph leaves the right-hand half EMPTY rather than centred or stretched.
 * The source's grid is what makes a reader able to compare two pictures at a glance, and
 * a lone picture drawn at double width would break that for the sake of tidiness.
 */
export function photoRow(captions: readonly PhotoCaption[]): Content {
  return {
    columns: captions.map((caption) => ({
      width: CELL_OUTER,
      ...(photoCell(caption) as object),
    })),
    columnGap: 0,
    // No gap beneath. The source's grid is continuous — the second row's top rule IS the
    // first row's bottom rule — and a few points of air between them would turn one table
    // into two that happen to be stacked.
    margin: [0, 0, 0, 0],
  } as Content;
}

/** The cover title: centred, bold, and at the source's own 14pt. */
export function photoCoverTitle(text: string): Content {
  return {
    text,
    fontSize: COVER_TITLE_SIZE,
    bold: true,
    alignment: 'center',
    margin: [0, COVER_TITLE_GAP, 0, 2],
  };
}

/**
 * The cover subtitle, wrapped in the slashes the source writes it in.
 *
 * The slashes are punctuation the document itself uses to mark a subtitle, not decoration
 * added here, which is why they are applied rather than expected in the caller's string.
 */
export function photoCoverSubtitle(text: string): Content {
  return {
    text: `/${text}/`,
    fontSize: COVER_SUBTITLE_SIZE,
    italics: true,
    alignment: 'center',
    margin: [0, 0, 0, COVER_FOOT_GAP],
  };
}

/** The city and year at the foot of the cover, centred, one under the other. */
export function photoCoverFoot(city: string, year: string): Content[] {
  return [
    {
      text: city,
      fontSize: FONT_SIZE.body,
      alignment: 'center',
      margin: [0, 0, 0, COVER_FOOT_LEAD],
    },
    { text: year, fontSize: FONT_SIZE.body, alignment: 'center' },
  ];
}

/** The bold, centred heading over the first body page. */
export function photoBodyHeading(text: string): Content {
  return {
    text,
    fontSize: BODY_HEADING_SIZE,
    bold: true,
    alignment: 'center',
    margin: [0, 0, 0, PARAGRAPH_GAP * 2],
    pageBreak: 'before',
  };
}

/** One line of the sign-off: a label, what it says, and whether it sits under a group. */
export interface SignatureLine {
  label: string;
  value: string;
  /** True for a line belonging to the group above it, which the source indents. */
  indented?: boolean;
}

/**
 * The two-group sign-off, on a page of its own.
 *
 * Groups rather than a flat list because the source distinguishes them: «Тайлан гаргасан»
 * names the organisation that issued the report and the people inside it who wrote and
 * checked it, and «Хүлээн авсан» names the organisation receiving it and the people who
 * will sign for it. The issuing side is already named — the report records who created
 * and approved it — so it prints names; the receiving side signs by hand and therefore
 * prints a dotted rule.
 *
 * A borderless table rather than tabbed paragraphs, for the reason the first template
 * gives: the source aligns its columns by padding labels with spaces, which only holds
 * for the exact labels it happens to use.
 */
export function photoSignatureBlock(lines: readonly SignatureLine[]): Content {
  return {
    pageBreak: 'before',
    table: {
      widths: [CONTENT_WIDTH * 0.4, CONTENT_WIDTH * 0.6],
      body: lines.map((line) => [
        {
          text: line.label,
          fontSize: FONT_SIZE.body,
          margin: [line.indented === true ? SIGNATURE_INDENT : 0, 0, 0, 0],
          border: [false, false, false, false],
        },
        {
          text: line.value,
          fontSize: FONT_SIZE.body,
          border: [false, false, false, false],
        },
      ]),
    },
    layout: {
      hLineWidth: () => 0,
      vLineWidth: () => 0,
      paddingLeft: () => 0,
      paddingRight: () => 0,
      paddingTop: () => 5,
      paddingBottom: () => 5,
    },
    margin: [0, PARAGRAPH_GAP * 4, 0, 0],
  } as Content;
}

/**
 * A name in the slashes the source signs in, or an empty slot to write into by hand.
 *
 * `/          /` rather than `//` for a blank, as the first template also does: a pair of
 * touching slashes reads as an error where a gap reads as a box somebody fills in.
 */
export function nameSlot(name: string | null, role: string | null = null): string {
  const who = [role, name]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(', ');
  return `/${who === '' ? '                    ' : who}/`;
}
