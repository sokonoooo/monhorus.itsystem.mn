import { SETTING_KEYS } from '@monhorus/shared';
import { Types } from 'mongoose';

import { Customer } from '../objects/object.models';
import { getSettings } from '../settings/settings.service';
import { loadLogo, type ReportImage } from './report-images';

/**
 * The masthead of a printed report, read from Тохиргоо rather than compiled in.
 *
 * Everything here used to be a literal: the company name was read from settings but the
 * letterhead was a JPEG committed beside the source, and "who performed the inspection"
 * did not exist as a concept at all — the cover simply printed the company name twice.
 * An operator could not change any of it without a release.
 *
 * EVERY FIELD DEGRADES ON ITS OWN. A report is a document about work that was done, and
 * it must still print when the configuration is half-filled: an unset logo prints no
 * letterhead rather than a broken image, an unset inspection company falls back to the
 * company name, and an unset company name prints an empty line. None of them is a reason
 * to refuse somebody their report.
 */
export interface ReportBranding {
  /** The letterhead, already re-encoded for embedding, or null when none is configured. */
  logo: ReportImage | null;
  /**
   * The customer's own letterhead, drawn opposite [logo] at the top right.
   *
   * Null for a customer nobody has given a logo, and for a logo whose file has since gone
   * missing — two different situations that print the same way, because a report is about
   * work rather than about branding.
   */
  customerLogo: ReportImage | null;
  /** "Ерөнхий гүйцэтгэгчийн нэр" — the organisation issuing the report. */
  companyName: string;
  /** "Үзлэг хийсэн" — who carried the work out. Falls back to [companyName]. */
  inspectionCompany: string;
}

/**
 * Loads the branding a report prints under.
 *
 * [customerId] is the organisation the work was done for. It is a parameter rather than a
 * lookup inside this function because the callers already hold the planned work and
 * therefore already know it. It defaults to null so a caller with no work in hand — a
 * document about the operator rather than about a job — still gets the operator's own
 * masthead.
 */
export async function loadReportBranding(
  customerId: Types.ObjectId | string | null = null,
): Promise<ReportBranding> {
  const settings = await getSettings();

  const companyName = String(settings[SETTING_KEYS.COMPANY_NAME] ?? '').trim();
  const inspection = String(settings[SETTING_KEYS.INSPECTION_COMPANY] ?? '').trim();
  const logoFileId = String(settings[SETTING_KEYS.COMPANY_LOGO] ?? '').trim();

  const [logo, customerLogo] = await Promise.all([
    // Loaded per export rather than cached for the process: a logo changed in Тохиргоо
    // should appear on the next report, not after a restart. It is one small file read
    // against a request that is already rendering a document.
    logoFileId === '' ? null : loadLogo(logoFileId),
    loadCustomerLogo(customerId),
  ]);

  return {
    logo,
    customerLogo,
    companyName,
    // The fallback is the whole reason this field may be left blank: an operator who has
    // not distinguished the two organisations gets what the reports printed before the
    // setting existed.
    inspectionCompany: inspection === '' ? companyName : inspection,
  };
}

/**
 * The letterhead chosen on a customer, or null at every step that cannot produce one.
 *
 * Read fresh from the record rather than taken off a DTO so that a caller holding only an
 * id — which is all the PDF routes have — does not have to assemble a customer first.
 */
async function loadCustomerLogo(
  customerId: Types.ObjectId | string | null,
): Promise<ReportImage | null> {
  if (customerId === null) return null;

  const customer = await Customer.findById(customerId).select('logo').lean();
  if (!customer?.logo) return null;

  return loadLogo(String(customer.logo));
}
