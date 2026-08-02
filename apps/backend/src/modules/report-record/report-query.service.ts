import {
  REPORT_CUSTOMER_VISIBLE_STATUSES,
  type PaginatedData,
  type ReportDto,
  type ReportListItemDto,
  type ReportListQueryInput,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  assertInCustomerScope,
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { ObjectRecord } from '../object-master/object-master.models';
import { Report, ReportItem, type IReport, type IReportItem } from './report-record.model';
import { toReportDto, toReportListItemDto } from './report-record.service';

/**
 * The read side of the unified report store.
 *
 * Nothing here writes: every row was produced by `writeReport` and settled by whichever
 * module raised it. What this file adds is the tenant boundary — a customer-tier caller
 * is scoped to their own organisation and, per REPORT_CUSTOMER_VISIBLE_STATUSES, to
 * published reports only, because approval settles a finding internally and publication
 * is what releases it.
 */

type Doc<T> = T & { _id: Types.ObjectId };

const REPORT_POPULATE = [
  { path: 'customer', select: 'name' },
  { path: 'project', select: 'name' },
  { path: 'building', select: 'name' },
];

const ITEM_POPULATE = [
  { path: 'object', select: 'code name' },
  { path: 'floor', select: 'name' },
  { path: 'evidenceAttachments', select: 'originalName mimeType sizeBytes createdAt' },
];

/**
 * The statuses a scope may see. Staff see everything; a customer sees only what has been
 * released to them, and a status filter they send is intersected with that rather than
 * trusted — asking for DRAFT must return nothing, not leak it.
 */
function visibleStatuses(
  scope: ResolvedCustomerScope,
  requested: string | undefined,
): FilterQuery<IReport>['status'] {
  if (scope.mode !== 'CUSTOMER') return requested ?? undefined;
  const visible = REPORT_CUSTOMER_VISIBLE_STATUSES.filter(
    (status) => !requested || status === requested,
  );
  return { $in: visible };
}

async function reportFilter(
  query: ReportListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<FilterQuery<IReport>> {
  const filter: FilterQuery<IReport> = { ...customerScopeFilter(scope) };

  if (query.type) filter.type = query.type;
  const status = visibleStatuses(scope, query.status);
  if (status) filter.status = status;
  if (query.riskLevel) filter.riskLevel = query.riskLevel;
  if (query.projectId) filter.project = new Types.ObjectId(query.projectId);
  if (query.buildingId) filter.building = new Types.ObjectId(query.buildingId);

  // Floor and equipment live on the items, not the report, so both narrow through one
  // distinct rather than a lookup per row.
  if (query.floorId || query.objectId) {
    const itemFilter: FilterQuery<IReportItem> = {};
    if (query.floorId) itemFilter.floor = new Types.ObjectId(query.floorId);
    if (query.objectId) itemFilter.object = new Types.ObjectId(query.objectId);
    filter._id = { $in: await ReportItem.distinct('report', itemFilter) };
  }

  if (query.from || query.to) {
    filter.occurredAt = {
      ...(query.from ? { $gte: new Date(query.from) } : {}),
      ...(query.to ? { $lte: new Date(query.to) } : {}),
    };
  }

  if (query.search) {
    const pattern = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { title: pattern },
      { reportNumber: pattern },
      { conclusion: pattern },
      { recommendation: pattern },
    ];
  }

  return filter;
}

/** Item counts for a page of reports, grouped rather than counted per row. */
async function itemCountsFor(ids: readonly Types.ObjectId[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const grouped = await ReportItem.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { report: { $in: [...ids] } } },
    { $group: { _id: '$report', count: { $sum: 1 } } },
  ]);
  return new Map(grouped.map((row) => [String(row._id), row.count]));
}

export async function listReports(
  query: ReportListQueryInput,
  scope: ResolvedCustomerScope,
): Promise<PaginatedData<ReportListItemDto>> {
  const filter = await reportFilter(query, scope);
  const skip = (query.page - 1) * query.limit;

  const [rows, total] = await Promise.all([
    Report.find(filter)
      .populate(REPORT_POPULATE)
      .sort({ [query.sortBy]: query.sortDir === 'asc' ? 1 : -1, _id: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean<Doc<IReport>[]>(),
    Report.countDocuments(filter),
  ]);

  const counts = await itemCountsFor(rows.map((row) => row._id));

  return {
    items: rows.map((row) => toReportListItemDto(row, counts.get(String(row._id)) ?? 0)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getReportById(
  reportId: string,
  scope: ResolvedCustomerScope,
): Promise<ReportDto> {
  const report = await Report.findById(reportId)
    .populate(REPORT_POPULATE)
    .lean<Doc<IReport>>();
  if (!report) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тайлан олдсонгүй.');

  // The reference, not the populated document: `REPORT_POPULATE` replaces `customer` with
  // the Customer row, and comparing that against the scope's id never matches — which
  // silently hid a customer's own reports from them rather than leaking anyone else's.
  const ownerId = ((): Types.ObjectId | null => {
    const value = report.customer as unknown;
    if (!value) return null;
    if (typeof value === 'object' && '_id' in (value as object)) {
      return (value as { _id: Types.ObjectId })._id;
    }
    return value as Types.ObjectId;
  })();

  // Both reported as not-found: confirming that a hidden report exists would turn this
  // endpoint into an oracle for probing other tenants' identifiers or unreleased drafts.
  assertInCustomerScope(scope, ownerId, 'Тайлан олдсонгүй.');
  if (
    scope.mode === 'CUSTOMER' &&
    !REPORT_CUSTOMER_VISIBLE_STATUSES.includes(report.status)
  ) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Тайлан олдсонгүй.');
  }

  const items = await ReportItem.find({ report: report._id })
    .populate(ITEM_POPULATE)
    .sort({ createdAt: 1 })
    .lean<Doc<IReportItem>[]>();

  return toReportDto(report, items);
}

/**
 * Every report that recorded a finding on one piece of equipment, all four types.
 *
 * The object is looked up inside the caller's scope first, so a customer probing another
 * tenant's equipment id gets not-found before any report is read at all.
 */
export async function listObjectReports(
  objectId: string,
  scope: ResolvedCustomerScope,
): Promise<ReportListItemDto[]> {
  const object = await ObjectRecord.findOne({
    _id: objectId,
    ...customerScopeFilter(scope),
  }).select('_id');
  if (!object) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');

  const filter: FilterQuery<IReport> = {
    _id: { $in: await ReportItem.distinct('report', { object: object._id }) },
  };
  const status = visibleStatuses(scope, undefined);
  if (status) filter.status = status;

  const reports = await Report.find(filter)
    .populate(REPORT_POPULATE)
    .sort({ occurredAt: -1 })
    .lean<Doc<IReport>[]>();

  const counts = await itemCountsFor(reports.map((row) => row._id));
  return reports.map((row) => toReportListItemDto(row, counts.get(String(row._id)) ?? 0));
}
