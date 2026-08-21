import fs from 'node:fs';
import path from 'node:path';

import type { Content, ContentTable, TableCell, TableLayout } from 'pdfmake/interfaces';

/**
 * The house report template, measured off «Үзлэгийн тайлан.docx».
 *
 * Every number here was read out of that file's XML rather than eyeballed, because the
 * point of this module is that an exported PDF looks like the document the office
 * already issues rather than like a printed table. The conversions are exact: Word
 * stores lengths in twentieths of a point, so 1440 twips is 72pt is 25.4mm, and the
 * values below are the ones the template actually carries.
 *
 * WHAT THE TEMPLATE DOES NOT HAVE is as load-bearing as what it does:
 *
 *   * No footer, and no page numbers anywhere. Word offers both and this document
 *     declines them, so adding "1 / 12" would be this file inventing a house style.
 *   * No cell shading at all — `w:shd` appears zero times. A header row is bold text on
 *     white, not the grey band a generated table usually gets.
 *   * No repeating table headers (`w:tblHeader` is absent). Long tables here DO repeat
 *     theirs, and that is the one deliberate divergence: the template's tables are four
 *     rows of photographs that never span a page, while a planned work's sub-task list
 *     genuinely can, and a continuation page of unlabelled columns is unreadable.
 */

/** Twentieths of a point to points, which is what pdfmake measures in. */
const twip = (value: number): number => value / 20;

/** A4 portrait, as `w:pgSz w:w="11906" w:h="16838" w:code="9"`. */
export const PAGE_SIZE = 'A4';
export const PAGE_ORIENTATION = 'portrait';

/**
 * `w:pgMar top=1440 right=1376 bottom=990 left=1440`, in pdfmake's [l, t, r, b] order.
 *
 * The asymmetry is the template's own — its right margin is a millimetre narrower than
 * its left — and it is reproduced rather than tidied up, because a page whose text block
 * sits where the original's does is the whole objective.
 */
export const PAGE_MARGINS: [number, number, number, number] = [
  twip(1440),
  twip(1440),
  twip(1376),
  twip(990),
];

/** `w:header=720` — where the logo strip sits, measured from the top of the sheet. */
export const HEADER_OFFSET = twip(720);

/** The printable width between the margins, which every table is sized against. */
export const CONTENT_WIDTH = 595.28 - PAGE_MARGINS[0] - PAGE_MARGINS[2];

/**
 * Font sizes, in points. `w:sz` is half-points, so the template's 26 is 13pt.
 *
 * Named for the role rather than the number so a caller cannot accidentally invent a
 * fourteenth size: the source document uses exactly these.
 */
export const FONT_SIZE = {
  /** Cover spacer paragraphs, `w:sz=28`. */
  coverSpacer: 14,
  /** The document title on the cover, `w:sz=26`, and NOT bold in the original. */
  title: 13,
  /** Body paragraphs and section headings, `w:sz=24`. */
  body: 12,
  /** Table body text, `w:sz=18`. The document is mostly this size. */
  table: 9,
  /** Bold labels inside tables, `w:sz=16`. */
  tableLabel: 8,
} as const;

/** `docDefaults`: 6pt after each paragraph, 1.1 line spacing. */
export const PARAGRAPH_GAP = twip(120);
export const LINE_HEIGHT = 264 / 240;

/** `w:tblBorders` — a single 0.5pt black rule on every edge, inside and out. */
const BORDER_WIDTH = 0.5;
const BORDER_COLOR = '#000000';

/** `TableNormal` cell margins: 108 twips left and right, nothing top or bottom. */
const CELL_PAD_X = twip(108);

/**
 * The template's table rules, as a pdfmake layout.
 *
 * A little vertical padding is added where the source has none: Word grows a row to its
 * `w:trHeight` and the text then floats inside it, which pdfmake has no equivalent for,
 * so without this every line would sit hard against the rule above it.
 */
export const TABLE_LAYOUT: TableLayout = {
  hLineWidth: () => BORDER_WIDTH,
  vLineWidth: () => BORDER_WIDTH,
  hLineColor: () => BORDER_COLOR,
  vLineColor: () => BORDER_COLOR,
  paddingLeft: () => CELL_PAD_X,
  paddingRight: () => CELL_PAD_X,
  paddingTop: () => 2.5,
  paddingBottom: () => 2.5,
};

/**
 * Where the committed assets live, resolved from this file rather than the cwd.
 *
 * Two candidates because the compiler does not carry them: `tsc` emits JavaScript into
 * `dist/` and leaves `.ttf` and `.jpg` where they were, so a build running from
 * `dist/modules/report-pdf` finds nothing one level up. Rather than add a copy step to
 * the build — which is deployment plumbing this change is deliberately staying out of —
 * the source tree is checked as a fallback, which is also where a `tsx` run finds them.
 */
function assetDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../assets'),
    path.resolve(__dirname, '../../../src/assets'),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) ?? candidates[0]!;
}

const FONT_DIR = path.join(assetDir(), 'fonts');

/**
 * Tinos, standing in for the template's Times New Roman.
 *
 * Times New Roman is not redistributable, so it cannot be committed to this repository
 * and cannot be assumed present on a server. Tinos is metrically identical to it — same
 * advance widths, same line breaks — and carries the Cyrillic the report is written in,
 * under the Apache licence. A reader comparing the two documents side by side is looking
 * at the same shapes in the same places.
 *
 * The base-14 PDF fonts are not an option at any price: none of them has a single
 * Cyrillic glyph, so the entire report would render as blanks.
 */
export const PDF_FONTS = {
  Tinos: {
    normal: path.join(FONT_DIR, 'Tinos-Regular.ttf'),
    bold: path.join(FONT_DIR, 'Tinos-Bold.ttf'),
    italics: path.join(FONT_DIR, 'Tinos-Italic.ttf'),
    bolditalics: path.join(FONT_DIR, 'Tinos-BoldItalic.ttf'),
  },
};

/**
 * How tall the letterhead is drawn, from `wp:extent cy=352425` EMU — 9.8mm.
 *
 * The HEIGHT is fixed and the width follows from the uploaded image's own proportions,
 * which is the opposite of what the template does. The source hardcodes both because it
 * contains one particular logo; an operator's logo may be square or a long wordmark, and
 * forcing it into 42.3 x 9.8mm would squash it. Fixing the height keeps every report's
 * masthead the same depth whatever picture is in it.
 */
const LOGO_HEIGHT = (352425 / 914400) * 72;

/** The template's own logo width, used when the image's proportions are unknown. */
const LOGO_FALLBACK_WIDTH = (1524000 / 914400) * 72;

/** What the header and the photo grid need to know about a picture. */
export interface BrandingImage {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The page header: the letterhead and nothing else, exactly as the template has it.
 *
 * Returned as a factory because pdfmake calls it per page. A null logo yields an empty
 * header rather than an error — an operator who has configured no letterhead still gets
 * their report, and a document must never fail over a picture.
 */
export function headerBlock(logo: BrandingImage | null): Content {
  if (logo === null) return { text: '' };
  const ratio = logo.height > 0 ? logo.width / logo.height : null;
  return {
    image: logo.dataUrl,
    height: LOGO_HEIGHT,
    width: ratio === null ? LOGO_FALLBACK_WIDTH : LOGO_HEIGHT * ratio,
    margin: [PAGE_MARGINS[0], HEADER_OFFSET, 0, 0],
  };
}

/**
 * The photo cell's drawing box, from the template's own 2x2 grid.
 *
 * `tblGrid` gives the photo columns 2436 twips each — 121.8pt — and the pictures inside
 * them are declared at `cx=1473307` EMU, which is 116pt, leaving the cell padding either
 * side. The height is the same block's `cy=1104900` EMU, 87pt.
 */
const PHOTO_BOX_WIDTH = 116;
const PHOTO_BOX_HEIGHT = 87;

/**
 * One photograph, scaled to fit its box WITHOUT distorting it.
 *
 * The template never squashes a picture — every image in it carries `noChangeAspect="1"`,
 * and where a photo's shape did not suit the box somebody had chosen, it was CROPPED
 * rather than stretched. Cropping somebody's evidence photograph automatically is not a
 * decision this code should make, so it fits inside the box instead: the longer side
 * meets the box and the shorter side is whatever the picture's proportions make it. A
 * portrait photo therefore prints narrow and tall, which is what it is.
 */
function photoCell(image: BrandingImage): TableCell {
  const ratio = image.height > 0 ? image.width / image.height : 1;
  const boxRatio = PHOTO_BOX_WIDTH / PHOTO_BOX_HEIGHT;
  const width = ratio >= boxRatio ? PHOTO_BOX_WIDTH : PHOTO_BOX_HEIGHT * ratio;

  return { image: image.dataUrl, width, alignment: 'center' };
}

/**
 * A detail block: what the work was, where, its photographs, and the note beside them.
 *
 * This is the template's own repeating unit, reproduced. Its blocks are a two-row header
 * — `Ажлын нэр:` and `Байршил:`, each a bold label against a value spanning the rest of
 * the width — then a photo area on the left with a single `Тайлбар:` cell merged down the
 * right-hand side beside it. The source never captions an individual photograph; the note
 * describes the whole block, which is why one cell spans every photo row.
 *
 * Photos go two to a row, as the template's densest block does. An odd photo leaves the
 * last cell empty rather than stretching a picture across the pair, because the column
 * widths are what keep the note cell in the same place on every block down the page.
 */
export function detailBlock(options: {
  workName: string;
  location: string;
  note: string | null;
  photos: readonly BrandingImage[];
}): ContentTable {
  const { workName, location, note, photos } = options;

  const labelWidth = CONTENT_WIDTH * 0.14;
  const photoWidth = (CONTENT_WIDTH * 0.56) / 2;
  const noteWidth = CONTENT_WIDTH - labelWidth - photoWidth * 2;

  const headerRow = (label: string, value: string): TableCell[] => [
    { text: label, bold: true, fontSize: FONT_SIZE.tableLabel },
    { text: value, fontSize: FONT_SIZE.table, colSpan: 3 },
    {},
    {},
  ];

  const body: TableCell[][] = [
    headerRow('Ажлын нэр:', workName),
    headerRow('Байршил:', location),
  ];

  // Rows of two. The note cell opens on the first photo row and is continued by empty
  // cells beneath it, which is pdfmake's spelling of the template's vertical merge.
  const rows = Math.max(1, Math.ceil(photos.length / 2));
  for (let row = 0; row < rows; row += 1) {
    const left = photos[row * 2];
    const right = photos[row * 2 + 1];
    body.push([
      (left === undefined ? {} : { ...(photoCell(left) as object), colSpan: 2 }) as TableCell,
      {},
      (right === undefined ? {} : photoCell(right)) as TableCell,
      row === 0
        ? {
            text: note === null || note === '' ? '' : `Тайлбар: ${note}`,
            fontSize: FONT_SIZE.table,
            rowSpan: rows,
          }
        : {},
    ]);
  }

  return {
    // BOTH flags, and they do different jobs. `dontBreakRows` stops a single row being
    // sliced through the middle; `unbreakable` stops the TABLE being split at all. Only
    // the second keeps "Ажлын нэр" on the same page as the photographs beneath it, which
    // is the whole point of a block — the first alone strands the two header rows at the
    // foot of one page and puts the pictures on the next.
    unbreakable: true,
    table: {
      widths: [labelWidth, photoWidth - labelWidth, photoWidth, noteWidth],
      body,
      dontBreakRows: true,
    },
    layout: TABLE_LAYOUT,
    margin: [0, 0, 0, PARAGRAPH_GAP],
  };
}

/** A centred cover title: 13pt, and deliberately NOT bold, as the original is not. */
export function coverTitle(text: string): Content {
  return {
    text,
    fontSize: FONT_SIZE.title,
    alignment: 'center',
    margin: [0, 0, 0, PARAGRAPH_GAP],
  };
}

/** The bold, centred heading that opens the body pages. */
export function sectionHeading(text: string, pageBreak = false): Content {
  return {
    text,
    fontSize: FONT_SIZE.body,
    bold: true,
    alignment: 'center',
    margin: [0, 0, 0, PARAGRAPH_GAP * 2],
    ...(pageBreak ? { pageBreak: 'before' as const } : {}),
  };
}

/** A left-aligned cover field — "Объект: …" — at the template's 12pt. */
export function coverField(label: string, value: string): Content {
  return {
    text: `${label} ${value}`,
    fontSize: FONT_SIZE.body,
    margin: [0, 0, 0, 2],
  };
}

/**
 * The two-column organisation table that opens every body page of the template.
 *
 * Column widths are its own: `tblGrid 4851, 4850` twips, which is 85.6mm and 85.5mm.
 * Labels bold at 8pt, values plain at 9pt, matching the source exactly.
 */
export function organisationTable(rows: ReadonlyArray<[string, string]>): ContentTable {
  return {
    table: {
      // The source splits this table exactly in half (4851 / 4850 twips) and lets it
      // overhang the right margin by half a centimetre, which Word permits and pdfmake
      // does not. Held to the text column instead so it lines up with every other table
      // on the page — an org block half a centimetre wider than the data below it reads
      // as a mistake, where in Word it reads as a table someone dragged.
      widths: [CONTENT_WIDTH / 2, CONTENT_WIDTH / 2],
      body: rows.map(([label, value]) => [
        { text: label, bold: true, fontSize: FONT_SIZE.tableLabel },
        { text: value, fontSize: FONT_SIZE.table },
      ]),
    },
    layout: TABLE_LAYOUT,
    margin: [0, 0, 0, PARAGRAPH_GAP * 2],
  };
}

/**
 * A data table in the template's styling: bold header row, no fill, 0.5pt rules.
 *
 * `headerRows` is what makes the labels repeat when a table runs past the foot of the
 * page — see the note at the top of this file for why that is the one place this
 * deliberately does more than the source document.
 */
export function dataTable(
  headers: readonly string[],
  rows: ReadonlyArray<readonly (string | number)[]>,
  widths: readonly (number | string)[],
): ContentTable {
  return {
    table: {
      headerRows: 1,
      widths: [...widths],
      body: [
        headers.map((text) => ({
          text,
          bold: true,
          fontSize: FONT_SIZE.tableLabel,
        })),
        ...rows.map((row) =>
          row.map((cell) => ({
            text: String(cell),
            fontSize: FONT_SIZE.table,
          })),
        ),
      ],
    },
    layout: TABLE_LAYOUT,
    margin: [0, 0, 0, PARAGRAPH_GAP * 2],
  };
}

/** A labelled block of prose — Дүгнэлт, Зөвлөмж — at body size. */
export function prose(label: string, text: string | null): Content[] {
  if (text === null || text.trim() === '') return [];
  return [
    {
      text: label,
      bold: true,
      fontSize: FONT_SIZE.body,
      margin: [0, PARAGRAPH_GAP, 0, 2],
    },
    {
      text,
      fontSize: FONT_SIZE.table,
      lineHeight: LINE_HEIGHT,
      margin: [0, 0, 0, PARAGRAPH_GAP],
    },
  ];
}

/**
 * The sign-off block, copied from the template's own wording and dotted rules.
 *
 * Plain paragraphs rather than a table, because that is what the source uses — the
 * dotted leader is literally a run of full stops, and reproducing it as a bordered cell
 * would look tidier than the document it is meant to match.
 */
export function signatureBlock(
  lines: ReadonlyArray<{ label: string; value: string }>,
): Content[] {
  return [
    {
      // A borderless two-column table rather than tab-separated paragraphs. The source
      // aligns its dotted leaders by padding each label with spaces until they line up,
      // which only holds for the exact labels it happens to use; a column does the same
      // job for any label and cannot fall out of alignment when a name gets longer.
      table: {
        widths: [CONTENT_WIDTH * 0.32, CONTENT_WIDTH * 0.68],
        body: lines.map((line) => [
          { text: line.label, fontSize: FONT_SIZE.body, border: [false, false, false, false] },
          { text: line.value, fontSize: FONT_SIZE.body, border: [false, false, false, false] },
        ]),
      },
      layout: {
        hLineWidth: () => 0,
        vLineWidth: () => 0,
        paddingLeft: () => 0,
        paddingRight: () => 0,
        paddingTop: () => 3,
        paddingBottom: () => 3,
      },
      margin: [0, PARAGRAPH_GAP * 3, 0, 0],
    },
  ];
}

/**
 * The dotted leader the template signs on, followed by a name and a role.
 *
 * An unsigned line keeps the empty slashes with space between them — `/          /` — as
 * the source does, because that is a box someone is expected to write into by hand. `//`
 * would read as an error rather than as a blank.
 */
export function signatureLeader(name: string | null, role: string | null): string {
  const who = [name, role]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  return `................................./${who === '' ? '                    ' : who}/`;
}
