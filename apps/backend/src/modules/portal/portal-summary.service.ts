import {
  PERMISSIONS,
  RISK_LEVELS,
  SERVICE_REQUEST_STATUSES,
  type PortalMonthKey,
  type PortalMonthlyRiskDto,
  type PortalRiskCountDto,
  type PortalStatusCountDto,
  type PortalSummaryDto,
  type RiskLevel,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import {
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { monthEnd, monthWindow } from '../../common/utils/month-window.util';
import { env } from '../../config/env';
import { ObjectRecord } from '../object-master/object-master.models';
import { ServiceRequest } from '../service-request/service-request.model';

/** The span the risk history covers. */
const WINDOW_MONTHS = 6;

/**
 * Every request the organisation has, by status.
 *
 * The whole history rather than the six-month window: this is the "where does our work
 * stand" ring, and a request raised in January that is still open is exactly the thing a
 * customer wants counted. A status nobody is in is omitted, because a slice of zero is a
 * legend entry that teaches nothing.
 */
async function requestsByStatus(
  scope: ResolvedCustomerScope,
): Promise<PortalStatusCountDto[]> {
  const rows = await ServiceRequest.aggregate<{ _id: string; count: number }>([
    { $match: customerScopeFilter(scope) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  return rows
    .filter((row): row is { _id: ServiceRequestStatus; count: number } =>
      SERVICE_REQUEST_STATUSES.includes(row._id as ServiceRequestStatus),
    )
    .map((row) => ({ status: row._id, count: row.count }));
}

/**
 * How the equipment stood at the end of each month.
 *
 * One aggregation per month, each starting from the customer's OBJECTS rather than from
 * the assessments: `ObjectAssessment` carries no `customer` of its own — it is reached
 * through the object it belongs to — so a filter written against it would silently match
 * nothing, or worse, everything.
 *
 * The inner pipeline takes the single most recent assessment on or before the cut-off,
 * which the `{ object, assessedAt }` index serves directly. An object with no assessment
 * yet drops out (`$unwind` on an empty array), which is deliberate: unassessed is not a
 * band, and counting it as healthy is the one error this whole ladder exists to prevent.
 */
async function riskByMonth(
  scope: ResolvedCustomerScope,
  months: readonly PortalMonthKey[],
  timeZone: string,
): Promise<PortalMonthlyRiskDto[]> {
  const filter = customerScopeFilter(scope);
  // Cross-tenant history is not a thing this endpoint offers; a staff caller with no
  // customer asked for nothing in particular, so they get nothing rather than everything.
  if (!filter.customer) return months.map((month) => ({ month, counts: [] }));

  const perMonth = await Promise.all(
    months.map(async (month): Promise<PortalMonthlyRiskDto> => {
      const rows = await ObjectRecord.aggregate<{ _id: RiskLevel; count: number }>([
        { $match: { customer: filter.customer as Types.ObjectId } },
        {
          $lookup: {
            from: 'objectassessments',
            let: { objectId: '$_id' },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ['$object', '$$objectId'] },
                  assessedAt: { $lt: monthEnd(month, timeZone) },
                },
              },
              { $sort: { assessedAt: -1 } },
              { $limit: 1 },
              { $project: { riskLevel: 1 } },
            ],
            as: 'latest',
          },
        },
        { $unwind: '$latest' },
        { $group: { _id: '$latest.riskLevel', count: { $sum: 1 } } },
      ]);

      const found = new Map(rows.map((row) => [row._id, row.count]));
      const counts: PortalRiskCountDto[] = RISK_LEVELS.filter((level) => found.has(level)).map(
        (level) => ({ level, count: found.get(level) ?? 0 }),
      );
      return { month, counts };
    }),
  );

  return perMonth;
}

/**
 * The portal home's two history series.
 *
 * The risk block is OMITTED rather than emptied for a caller who may not read equipment,
 * so the screen renders no card at all instead of an honest-looking flat line at zero.
 */
export async function buildPortalSummary(
  scope: ResolvedCustomerScope,
  permissions: ReadonlySet<string>,
  now: Date = new Date(),
): Promise<PortalSummaryDto> {
  const timeZone = env.APP_TIMEZONE;
  const months = monthWindow(now, timeZone, WINDOW_MONTHS);
  const statuses = await requestsByStatus(scope);

  if (!permissions.has(PERMISSIONS.PORTAL_OBJECT_VIEW)) {
    return { months, requestsByStatus: statuses };
  }

  return {
    months,
    requestsByStatus: statuses,
    riskByMonth: await riskByMonth(scope, months, timeZone),
  };
}
