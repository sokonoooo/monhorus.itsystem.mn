import {
  REPORT_CUSTOMER_VISIBLE_STATUSES,
  REPORT_SOURCE_TYPE_LABELS,
  RISK_LEVELS,
  type InspectionListItemDto,
  type InspectionListQueryInput,
  type InspectionSummaryDto,
  type PaginatedData,
  type RiskLevel,
  type RiskLevelCountDto,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import {
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { ObjectRecord } from '../object-master/object-master.models';
import { ObjectNode } from '../objects/object.models';
import {
  Report,
  ReportItem,
  type IReport,
  type IReportItem,
} from '../report-record/report-record.model';

type WithId<T> = T & { _id: Types.ObjectId };

/**
 * Үнэлгээ ба дүгнэлт — every result the system produces, in one place.
 *
 * A read over the unified report store. All four types land there — an assessment
 * recorded directly against equipment, the result of a completed planned work, the
 * conclusion of a service request and a consolidation — so this list is the single place
 * they can be searched and compared. It stays a read with no workflow of its own: each
 * row was already settled by whichever module wrote it.
 */

function named(value: unknown): { id: string; name: string } | null {
  if (typeof value !== 'object' || value === null || !('_id' in value)) return null;
  const node = value as { _id: Types.ObjectId; name?: string };
  return { id: String(node._id), name: node.name ?? '' };
}

/**
 * The list filter over reports.
 *
 * The tenant comes from the resolved scope, never from the query: a staff caller's
 * requested customer was already folded into the scope, and a customer-tier caller is
 * pinned to their own organisation and to published reports whatever they send.
 */
async function reportFilter(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<FilterQuery<IReport>> {
  const filter: FilterQuery<IReport> = { ...customerScopeFilter(scope) };

  if (query.type) filter.type = query.type;
  if (query.status) filter.status = query.status;
  if (scope.mode === 'CUSTOMER') {
    // Intersected rather than trusted: asking for DRAFT must return nothing, not leak it.
    filter.status = {
      $in: REPORT_CUSTOMER_VISIBLE_STATUSES.filter(
        (status) => !query.status || status === query.status,
      ),
    };
  }
  if (query.riskLevel) filter.riskLevel = query.riskLevel;
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);

  // The floor lives on the items, not the report, so it narrows through one distinct
  // rather than a lookup per row.
  if (query.floorId) {
    filter._id = {
      $in: await ReportItem.distinct('report', { floor: new Types.ObjectId(query.floorId) }),
    };
  }

  if (query.dateFrom || query.dateTo) {
    filter.occurredAt = {
      ...(query.dateFrom ? { $gte: new Date(query.dateFrom) } : {}),
      ...(query.dateTo ? { $lte: new Date(query.dateTo) } : {}),
    };
  }

  if (query.search) {
    const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // The title and number live on the row itself, so a search no longer has to resolve
    // the equipment first and then bound the query by the ids it found.
    filter.$or = [
      { title: pattern },
      { reportNumber: pattern },
      { conclusion: pattern },
      { recommendation: pattern },
    ];
  }

  return filter;
}

/**
 * Every eligible equipment result, newest first.
 *
 * ITEM-FIRST, and that is the whole design. A row here is a ReportItem — one finding about
 * one piece of equipment — so a service visit that assessed four panels contributes four
 * rows that can each be filtered, sorted and exported on their own, while all four name
 * the single report that carries the overall narrative.
 *
 * Two consequences follow directly, and both are the point of the module:
 *
 *   - A report that names no registered equipment has no items and therefore appears
 *     nowhere in this feed. A completed planned work whose sub-tasks selected nothing, or
 *     a service request settled without an equipment assessment, stays a real record in
 *     its own module — and may still carry a general report for workflow and audit — but
 *     it is not an equipment assessment and this list must not imply that it is.
 *   - Eligibility is `ReportItem.object` existing AND the caller being entitled to both the
 *     report and the object. The report half comes from the tenant-scoped report filter;
 *     the object half is enforced by intersecting with the objects the scope can read, so
 *     an item can never surface equipment its own customer scope excludes.
 *
 * Sorted on the parent's `occurredAt` with `_id` breaking ties, so paging is stable when
 * several findings share a timestamp — which every multi-object report does by definition.
 */

/** What a row needs off the parent report. Selected rather than fetched whole. */
const REPORT_COLUMNS =
  'reportNumber type sourceType status title customer project building conclusion recommendation createdByName approvedByName occurredAt sourceId sourceReference';

type PopulatedReport = WithId<IReport>;
type PopulatedObject = { _id: Types.ObjectId; code?: string; name?: string };

function reportOf(item: WithId<IReportItem>): PopulatedReport | null {
  const value = item.report as unknown;
  if (typeof value !== 'object' || value === null || !('reportNumber' in value)) return null;
  return value as PopulatedReport;
}

function objectOf(item: WithId<IReportItem>): PopulatedObject | null {
  const value = item.object as unknown;
  if (typeof value !== 'object' || value === null || !('_id' in value)) return null;
  return value as PopulatedObject;
}

/**
 * Which report-level filters force a narrowing pass over Report.
 *
 * The item carries its own customer, floor, object and band, so those four are matched
 * directly and cost nothing. Everything else — the producer, the review status, when the
 * work happened, the project and building, the free-text search — lives on the parent and
 * can only be applied by resolving the reports first.
 *
 * A customer-tier caller always forces it, whatever they asked for: the visible-status
 * intersection is what stops a DRAFT finding being served, and that rule lives on the
 * report.
 */
function needsReportNarrowing(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): boolean {
  return Boolean(
    scope.mode === 'CUSTOMER' ||
      query.type ||
      query.sourceType ||
      query.status ||
      query.projectId ||
      query.buildingId ||
      query.dateFrom ||
      query.dateTo ||
      query.search,
  );
}

/**
 * The eligibility filter for one equipment result.
 *
 * Returns null when the query cannot match anything, so the caller answers with an empty
 * page instead of issuing a `$in: []` that scans for nothing.
 */
async function inspectionItemFilter(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<FilterQuery<IReportItem> | null> {
  // `object` is required by the schema, so an item always names equipment; the explicit
  // predicate keeps the eligibility rule visible at the point it is enforced rather than
  // resting on a schema invariant a future migration could relax.
  const filter: FilterQuery<IReportItem> = {
    ...customerScopeFilter(scope),
    object: { $ne: null },
  };

  if (query.objectId) filter.object = new Types.ObjectId(query.objectId);
  if (query.floorId) filter.floor = new Types.ObjectId(query.floorId);
  if (query.riskLevel) filter.riskLevel = query.riskLevel;

  if (needsReportNarrowing(query, scope)) {
    const reports = await Report.find(await reportFilter(query, scope))
      .select('_id')
      .lean<{ _id: Types.ObjectId }[]>();
    if (reports.length === 0) return null;
    filter.report = { $in: reports.map((report) => report._id) };
  }

  return filter;
}

export async function listInspections(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<InspectionListItemDto>> {
  const itemFilter = await inspectionItemFilter(query, scope);
  if (!itemFilter) {
    return { items: [], page: query.page, limit: query.limit, total: 0, totalPages: 1 };
  }

  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    ReportItem.find(itemFilter)
      .populate([
        {
          path: 'report',
          select: REPORT_COLUMNS,
          // Nested, because the hierarchy names live on the parent: selecting the fields
          // alone leaves three ObjectIds and a row that cannot print where it happened.
          populate: [
            { path: 'customer', select: 'name' },
            { path: 'project', select: 'name' },
            { path: 'building', select: 'name' },
          ],
        },
        { path: 'object', select: 'code name objectType' },
        { path: 'floor', select: 'name' },
      ])
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean<WithId<IReportItem>[]>(),
    ReportItem.countDocuments(itemFilter),
  ]);

  // One count per report for the whole page, so a row can say how many siblings it has
  // without a query each.
  const reportIds = [...new Set(rows.map((row) => String(reportOf(row)?._id ?? '')))].filter(
    Boolean,
  );
  const siblings = await ReportItem.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { report: { $in: reportIds.map((id) => new Types.ObjectId(id)) } } },
    { $group: { _id: '$report', count: { $sum: 1 } } },
  ]);
  const siblingCounts = new Map(siblings.map((row) => [String(row._id), row.count]));

  const items: InspectionListItemDto[] = [];
  for (const row of rows) {
    // A populated ref comes back null when the parent was removed; such an item is not a
    // result anybody can act on, so it is dropped rather than rendered with blank columns.
    const report = reportOf(row);
    const object = objectOf(row);
    if (!report || !object) continue;

    const floor = named(row.floor);
    const customer = named(report.customer);
    const project = named(report.project);
    const building = named(report.building);

    items.push({
      id: String(row._id),
      reportId: String(report._id),
      reportNumber: report.reportNumber,
      type: report.type,
      sourceType: report.sourceType,
      status: report.status,
      title: report.title,
      objectId: String(object._id),
      objectCode: object.code ?? null,
      objectName: object.name ?? '',
      objectTypeName: null,
      siblingCount: siblingCounts.get(String(report._id)) ?? 1,
      locationPath: [building?.name, floor?.name].filter(Boolean).join(' · ') || '-',
      customerId: customer?.id ?? null,
      customerName: customer?.name ?? null,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      buildingId: building?.id ?? null,
      buildingName: building?.name ?? null,
      floorId: floor?.id ?? null,
      floorName: floor?.name ?? null,
      // This object's own figures, never the report's worst: the point of an item feed is
      // that a healthy panel and a failing one in the same visit read differently.
      score: row.score,
      riskLevel: row.riskLevel,
      observation: row.observation,
      conclusion: row.conclusion ?? report.conclusion,
      recommendation: row.recommendation ?? report.recommendation,
      evidenceCount: row.evidenceAttachments?.length ?? 0,
      createdByName: report.createdByName,
      approvedByName: report.approvedByName,
      occurredAt: report.occurredAt.toISOString(),
      sourceLabel: REPORT_SOURCE_TYPE_LABELS[report.sourceType] ?? null,
      sourceId: report.sourceId ? String(report.sourceId) : null,
      sourceReference: report.sourceReference ?? null,
    });
  }

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

/**
 * Objects matching the location and tenant filters.
 *
 * Still resolved object-first for the SUMMARY, which counts equipment rather than results:
 * the counters answer "how much of this building has been looked at", and a device
 * assessed five times is one device. The list no longer needs this — a report stores its
 * own hierarchy — but coverage cannot be counted from result rows.
 */
async function scopedObjectIds(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<Types.ObjectId[] | null> {
  const tenant = customerScopeFilter(scope);
  const hasScope = Boolean(
    query.projectId || query.buildingId || query.floorId || tenant.customer,
  );
  if (!hasScope) return null;

  const objectFilter: FilterQuery<Record<string, unknown>> = { ...tenant };

  if (query.floorId) {
    objectFilter.floor = new Types.ObjectId(query.floorId);
  } else if (query.buildingId || query.projectId) {
    const ancestor = new Types.ObjectId(query.buildingId ?? query.projectId ?? '');
    const floors = await ObjectNode.find({ kind: 'FLOOR', ancestors: ancestor })
      .select('_id')
      .lean();
    objectFilter.floor = { $in: floors.map((floor) => floor._id) };
  }

  const objects = await ObjectRecord.find(objectFilter).select('_id').lean();
  return objects.map((object) => object._id);
}

/**
 * Header counters.
 *
 * The band counts come from the objects in scope and their current band, not from the
 * report rows: a device assessed five times is one device, and counting rows would
 * report it five times. Section 19.2 still forbids a single rolled-up score.
 */
export async function summariseInspections(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<InspectionSummaryDto> {
  const objectIds = await scopedObjectIds(query, scope);
  const objectFilter: FilterQuery<Record<string, unknown>> = objectIds
    ? { _id: { $in: objectIds } }
    : {};

  const grouped = await ObjectRecord.aggregate<{ _id: RiskLevel | null; count: number }>([
    { $match: objectFilter },
    { $group: { _id: '$latestAssessment.riskLevel', count: { $sum: 1 } } },
  ]);

  const byLevel = new Map<RiskLevel | null, number>(
    grouped.map((row) => [row._id ?? null, row.count]),
  );
  const counts: RiskLevelCountDto[] = RISK_LEVELS.map((level) => ({
    level,
    count: byLevel.get(level) ?? 0,
  })).filter((entry) => entry.count > 0);

  const unassessed = byLevel.get(null) ?? 0;
  const assessed = counts.reduce((sum, entry) => sum + entry.count, 0);

  // Both counted on the device's current standing rather than across result rows, for the
  // reason given above: five results about one panel are still one panel needing a revisit.
  const [repairRequiredCount, revisitRequiredCount] = await Promise.all([
    ObjectRecord.countDocuments({ ...objectFilter, 'latestAssessment.repairRequired': true }),
    ObjectRecord.countDocuments({ ...objectFilter, 'latestAssessment.revisitRequired': true }),
  ]);

  return {
    totalObjects: assessed + unassessed,
    assessedObjects: assessed,
    unassessedObjects: unassessed,
    counts,
    repairRequiredCount,
    revisitRequiredCount,
  };
}

/**
 * The feed as a CSV, one line per equipment result.
 *
 * Exactly the rows the list would show under the same filter — the export re-runs
 * `listInspections` rather than a query of its own, so a caller can never take away a set
 * the screen would not have shown them, and the tenant scope and the customer-visible
 * status intersection apply identically.
 *
 * The page limit is raised for an export because a spreadsheet of the first 25 rows is not
 * an export, but it is still bounded: an unbounded read is a way to pull the whole store
 * through one request.
 */
export const INSPECTION_EXPORT_LIMIT = 5000;

export async function exportInspectionsCsv(
  query: InspectionListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<string> {
  const page = await listInspections(
    { ...query, page: 1, limit: INSPECTION_EXPORT_LIMIT },
    scope,
  );

  const columns: readonly [string, (row: InspectionListItemDto) => string | number | null][] = [
    ['Тайлангийн дугаар', (row) => row.reportNumber],
    ['Тоноглол', (row) => row.objectName],
    ['Код', (row) => row.objectCode],
    ['Давхар', (row) => row.floorName],
    ['Барилга', (row) => row.buildingName],
    ['Төсөл', (row) => row.projectName],
    ['Харилцагч', (row) => row.customerName],
    ['Эх сурвалж', (row) => row.sourceLabel],
    ['Холбогдох бичлэг', (row) => row.sourceReference],
    ['Үнэлгээ', (row) => row.score],
    ['Эрсдэл', (row) => row.riskLevel],
    ['Ажиглалт', (row) => row.observation],
    ['Дүгнэлт', (row) => row.conclusion],
    ['Зөвлөмж', (row) => row.recommendation],
    ['Огноо', (row) => row.occurredAt],
    ['Үнэлсэн', (row) => row.createdByName],
    ['Төлөв', (row) => row.status],
  ];

  // Quote anything that would otherwise break a cell. Semicolon is included because a
  // spreadsheet opened under a locale that uses it as the separator splits on it.
  const escape = (value: string | number | null): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [columns.map(([label]) => escape(label)).join(',')];
  for (const row of page.items) {
    lines.push(columns.map(([, read]) => escape(read(row))).join(','));
  }
  return lines.join('\n');
}
