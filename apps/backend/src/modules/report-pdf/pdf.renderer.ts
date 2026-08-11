import fs from 'node:fs';

import type { TDocumentDefinitions } from 'pdfmake/interfaces';

/**
 * Required rather than imported, and typed by hand.
 *
 * `@types/pdfmake` declares the package as a namespace describing the BROWSER build, so
 * `new PdfPrinter(...)` does not typecheck against it even though the Node entry point is
 * exactly that constructor. The surface actually used here is one constructor and one
 * method, so it is declared directly instead of fighting the ambient types.
 */
interface PdfKitDocument extends NodeJS.ReadableStream {
  end(): void;
}
type Printer = new (fonts: unknown) => {
  createPdfKitDocument(definition: TDocumentDefinitions): PdfKitDocument;
};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PdfPrinter = require('pdfmake') as Printer;

import { logger } from '../../config/logger';
import { LOGO_PATH, PDF_FONTS } from './pdf-template';

/**
 * Renders a pdfmake document definition to PDF bytes.
 *
 * One printer for the process rather than one per request: constructing it parses four
 * TrueType files, which is wasted work to repeat on every export and measurable once a
 * report is a few dozen pages.
 */
let printer: InstanceType<Printer> | null = null;

function printerInstance(): InstanceType<Printer> {
  printer ??= new PdfPrinter(PDF_FONTS);
  return printer;
}

/**
 * The letterhead, read once and held.
 *
 * Resolved to `null` when the file is missing rather than throwing: a server without the
 * logo asset should still issue reports, and the header simply comes out empty. The
 * failure is logged once, because a permanently unbranded report is worth noticing even
 * though it is not worth refusing a download over.
 */
let logo: string | null | undefined;

function logoDataUrl(): string | null {
  if (logo !== undefined) return logo;
  try {
    logo = `data:image/jpeg;base64,${fs.readFileSync(LOGO_PATH).toString('base64')}`;
  } catch (error) {
    logger.warn({ err: error }, 'report logo missing; exporting without letterhead');
    logo = null;
  }
  return logo;
}

export function reportLogo(): string | null {
  return logoDataUrl();
}

/**
 * Buffers the whole document before answering.
 *
 * Streaming the pdfkit output straight to the response would save memory, but it also
 * means a failure halfway through arrives after a 200 and a `Content-Type: application/pdf`
 * are already on the wire — the browser then saves a truncated file that opens to an
 * error. These reports are tens of kilobytes; buffering costs nothing and lets a failure
 * still be a clean 500.
 */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const document = printerInstance().createPdfKitDocument(definition);
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
      document.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
