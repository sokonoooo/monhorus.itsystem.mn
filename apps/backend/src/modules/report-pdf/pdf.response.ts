import type { Response } from 'express';

import { SETTING_KEYS } from '@monhorus/shared';

import { getSettings } from '../settings/settings.service';

/**
 * The operator's own company, as the printed reports name it.
 *
 * Read from Тохиргоо like every other place this appears, never a literal: the reports
 * carry it as "Ерөнхий гүйцэтгэгчийн нэр", and a hardcoded company name would be wrong
 * for anybody who ever deploys this for someone else.
 */
export async function contractorName(): Promise<string> {
  const settings = await getSettings();
  return String(settings[SETTING_KEYS.COMPANY_NAME] ?? '').trim();
}

/**
 * Sends generated PDF bytes as a download.
 *
 * The header shape follows the CSV exports this codebase already serves — an explicit
 * content type plus `Content-Disposition: attachment` — so a browser saves the file
 * rather than trying to render it in a tab.
 *
 * The filename is ASCII-only on purpose. A Mongolian filename would need RFC 5987
 * encoding to survive the header, and a report that downloads as `tailan-PW-202608-0007`
 * is more useful than one that downloads as a mojibake of its own title.
 */
export function sendPdf(res: Response, pdf: Buffer, filename: string): void {
  const safe = filename.replace(/[^A-Za-z0-9._-]/g, '-');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.byteLength));
  res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
  // Generated per request from live data; a cached copy would show yesterday's report.
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(200).end(pdf);
}
