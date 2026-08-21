import type { RiskLevel, ServiceRequestStatus } from '../constants/service-request';

/**
 * The customer portal's history block.
 *
 * WHY AN ENDPOINT AT ALL. Everything else the portal home draws is current state, which it
 * already reads from the list endpoints it uses anyway. History is the one thing it cannot
 * derive: a page of requests is a page, and counting it would understate every month the
 * moment a customer has more work than fits — the same trap the planned-work totals avoid
 * by asking for `total` rather than counting rows. So the months are computed where the
 * data is, once, and scoped to the caller's own organisation and nothing else.
 *
 * Six months because that is the span the portal draws, and the window is closed at the
 * server so nothing on the screen can disagree about where "now" is.
 *
 * The request-count line that used to live here is now a dashboard widget — see
 * `DashboardMonthPoint`. It was moved rather than copied: two endpoints publishing the
 * same series is two places for it to drift.
 */

/** `YYYY-MM` in the deployment timezone. Oldest first everywhere in this file. */
export type PortalMonthKey = string;

export interface PortalRiskCountDto {
  level: RiskLevel;
  count: number;
}

export interface PortalMonthlyRiskDto {
  month: PortalMonthKey;
  /**
   * How the customer's equipment STOOD at the end of the month — each object counted under
   * the band its most recent assessment on or before that date put it in.
   *
   * Deliberately not "assessments recorded in the month", which is a different question
   * with a different shape: an object assessed twice would be counted twice and one
   * assessed last year not at all, so a falling line would mean "we inspected less" rather
   * than "less is wrong". Objects never assessed are absent from every month rather than
   * counted as healthy.
   */
  counts: readonly PortalRiskCountDto[];
}

export interface PortalStatusCountDto {
  /**
   * A RAW status, not a stage.
   *
   * The grouping into stages is a display decision an administrator owns in Тохиргоо, and
   * it can be re-cut without touching stored data. Publishing the statuses and letting the
   * screen fold them means a re-cut ladder is a settings change rather than a deployment,
   * and that the portal and the dispatch board can never disagree about which stage a
   * status belongs to.
   */
  status: ServiceRequestStatus;
  count: number;
}

export interface PortalSummaryDto {
  /** The window the two series share, oldest first. Always six entries. */
  months: readonly PortalMonthKey[];
  /** Every request the organisation has, by status. Bands with none are omitted. */
  requestsByStatus: readonly PortalStatusCountDto[];
  /**
   * Omitted entirely — not zeroed — for a caller without `portal.object.view`, so the
   * screen can tell "you may not see this" from "there is nothing to see".
   */
  riskByMonth?: readonly PortalMonthlyRiskDto[];
}
