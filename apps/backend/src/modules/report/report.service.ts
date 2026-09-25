import {
  INVOICE_REVENUE_STATUSES,
  KPI_FORMULAS,
  KPI_KEYS,
  KPI_LABELS,
  KPI_PURPOSES,
  KPI_UNITS,
  PLANNED_WORK_STATUS_LABELS,
  progressPercentOf,
  PLANNED_WORK_DELIVERED_STATUSES,
  PLANNED_WORK_UNCOMMITTED_STATUSES,
  REPORT_DESCRIPTIONS,
  REPORT_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  SETTING_KEYS,
  type KpiSummaryDto,
  type KpiValueDto,
  type PlannedWorkLifecycleStatus,
  type ReportColumnDto,
  type ReportKey,
  type ReportQueryInput,
  type ReportResultDto,
  type ReportRowDto,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import { Invoice } from '../invoice/invoice.model';
import { effectiveInvoiceStatus } from '../invoice/invoice.service';
import { ObjectAssessment, ObjectRecord } from '../object-master/object-master.models';
import { Customer } from '../objects/object.models';
import { PlannedWork } from '../planned-work/planned-work.models';
import { effectiveStatusOf } from '../planned-work/planned-work.overdue.service';
import { Report, ReportItem } from '../report-record/report-record.model';
import { ServiceRequest } from '../service-request/service-request.model';
import { isTerminalServiceRequestStatus } from '../service-request/service-request.terminality';
import { isSlaBreached, slaBreachExpr, slaBreachFilter } from '../service-request/sla.service';
import { riskBandLabelOf } from '../settings/risk-band.label';
import { getSettings, getRiskBands } from '../settings/settings.service';

/**
 * Section 15.2 report catalogue.
 *
 * Every report is an aggregation over data another module already produced, so a report
 * can never show a figure nobody recorded. Columns travel with the rows, which is what
 * lets one screen and one CSV writer serve all nine.
 */

type Row = Record<string, string | number | null>;

function isoOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateRange(query: ReportQueryInput): { from: Date | null; to: Date | null } {
  return {
    from: query.dateFrom ? new Date(query.dateFrom) : null,
    to: query.dateTo ? new Date(query.dateTo) : null,
  };
}

function withinRange(
  field: string,
  query: ReportQueryInput,
): FilterQuery<Record<string, unknown>> {
  const { from, to } = dateRange(query);
  if (!from && !to) return {};
  return { [field]: { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) } };
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('name' in value)) return null;
  return String((value as { name: unknown }).name);
}

function labelOf(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null || !(field in value)) return null;
  const raw = (value as Record<string, unknown>)[field];
  return raw === null || raw === undefined ? null : String(raw);
}

/** Rows to skip to reach the requested window. */
function skipFor(query: ReportQueryInput): number {
  return (query.page - 1) * query.limit;
}

function envelope(
  key: ReportKey,
  query: ReportQueryInput,
  columns: readonly ReportColumnDto[],
  rows: readonly Row[],
  totals: ReportRowDto | null,
  total: number,
): ReportResultDto {
  return {
    key,
    label: REPORT_LABELS[key],
    description: REPORT_DESCRIPTIONS[key],
    generatedAt: new Date().toISOString(),
    dateFrom: query.dateFrom ?? null,
    dateTo: query.dateTo ?? null,
    columns,
    rows,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    totals,
    // A paged reader reaches every row through `totalPages`, so nothing is hidden from
    // them and there is nothing to warn about. The CSV export is the exception: it renders
    // one window and offers no way to ask for the next, so a capped export still says so
    // rather than passing itself off as the whole report. `reportToCsv` is what acts on
    // this — it swaps the whole-set footer for `truncationNotice`, so the fact travels
    // inside the file and not only in a JSON envelope the download never sees.
    truncatedAt: query.format === 'csv' && total > query.limit ? query.limit : null,
  };
}

// -- 15.2 Төлөвлөгөөт ажлын тайлан --------------------------------------------

async function plannedWorkReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('plannedStartDate', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
    ...(query.projectId ? { project: new Types.ObjectId(query.projectId) } : {}),
  };

  const now = new Date();
  /**
   * The window, the count and the footer's progress are asked for together. The progress is
   * aggregated over the whole filtered set rather than reduced over `rows`: a figure taken
   * from the twenty rows on screen is not the figure for the report.
   *
   * QUANTITY-WEIGHTED, not a mean of the per-work percentages. This was `$avg` over
   * `progressPercent`, which gave a one-task job the same say as a five-hundred-task one —
   * the reading `aggregateProgress` on the dashboard names as the wrong answer for exactly
   * this metric, and the one the codebase settled against. The stored `progressPercent` is
   * itself `completedQuantity / totalQuantity` for a single work, so the mean of those
   * ratios was never the ratio of the set; summing the two quantities and dividing once is.
   *
   * `completedQuantity` is clamped per work, as the progress service clamps it: a stored
   * overshoot on one work must not be allowed to pay for another work's shortfall.
   */
  const [works, total, summary] = await Promise.all([
    PlannedWork.find(filter)
      .populate([
        { path: 'project', select: 'name' },
        { path: 'building', select: 'name' },
        { path: 'customer', select: 'name' },
      ])
      .sort({ plannedStartDate: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    PlannedWork.countDocuments(filter),
    PlannedWork.aggregate<{ totalQuantity: number; completedQuantity: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalQuantity: { $sum: '$totalQuantity' },
          completedQuantity: {
            $sum: { $min: ['$completedQuantity', '$totalQuantity'] },
          },
        },
      },
    ]),
  ]);

  const rows: Row[] = works.map((work) => ({
    workNumber: work.workNumber,
    title: work.title,
    customer: nameOf(work.customer),
    project: nameOf(work.project),
    building: nameOf(work.building),
    plannedStart: isoOrNull(work.plannedStartDate),
    plannedEnd: isoOrNull(work.plannedEndDate),
    actualEnd: isoOrNull(work.actualEndDate),
    status: PLANNED_WORK_STATUS_LABELS[effectiveStatusOf(work, now)],
    taskCount: work.taskCount,
    progressPercent: work.progressPercent,
    completedLate: work.completedLate ? 'Тийм' : 'Үгүй',
  }));


  return envelope(
    'PLANNED_WORK',
    query,
    [
      { key: 'workNumber', label: 'Ажлын №', format: 'TEXT' },
      { key: 'title', label: 'Гарчиг', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'project', label: 'Төсөл', format: 'TEXT' },
      { key: 'building', label: 'Барилга', format: 'TEXT' },
      { key: 'plannedStart', label: 'Эхлэх', format: 'DATE' },
      { key: 'plannedEnd', label: 'Дуусах', format: 'DATE' },
      { key: 'actualEnd', label: 'Бодит дуусалт', format: 'DATE' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'taskCount', label: 'Дэд ажил', format: 'NUMBER', align: 'right' },
      { key: 'progressPercent', label: 'Гүйцэтгэл', format: 'PERCENT', align: 'right' },
      { key: 'completedLate', label: 'Хоцорсон', format: 'TEXT' },
    ],
    rows,
    total > 0
      ? {
          workNumber: `Нийт ${total}`,
          // Null, not zero, when there is nothing to weigh — no quantity recorded against
          // any of the matched works. Zero would read as "all of it is untouched".
          progressPercent:
            summary[0] && summary[0].totalQuantity > 0
              ? progressPercentOf(summary[0].totalQuantity, summary[0].completedQuantity)
              : null,
        }
      : null,
    total,
  );
}

// -- 15.2 Үзлэг, оношилгоо, засвар, дуудлага ----------------------------------

async function serviceWorkReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('createdAt', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
    ...(query.projectId ? { project: new Types.ObjectId(query.projectId) } : {}),
    ...(query.employeeId ? { assignedEmployees: new Types.ObjectId(query.employeeId) } : {}),
  };

  const [requests, total] = await Promise.all([
    ServiceRequest.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .sort({ createdAt: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    ServiceRequest.countDocuments(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'building', select: 'name' },
    ]),
  ]);

  const rows: Row[] = requests.map((request) => ({
    requestNumber: request.requestNumber,
    urgent: request.isUrgent ? 'Тийм' : 'Үгүй',
    customer: nameOf(request.customer),
    building: nameOf(request.building),
    status: SERVICE_REQUEST_STATUS_LABELS[request.status],
    createdAt: isoOrNull(request.createdAt),
    completedAt: isoOrNull(request.completedAt),
    // Null rather than zero while the job is open: an unfinished job has no duration.
    resolutionHours:
      request.completedAt
        ? Math.round(
            ((request.completedAt.getTime() - request.createdAt.getTime()) / 3_600_000) * 10,
          ) / 10
        : null,
  }));

  return envelope(
    'SERVICE_WORK',
    query,
    [
      { key: 'requestNumber', label: 'Хүсэлтийн №', format: 'TEXT' },
      { key: 'urgent', label: 'Яаралтай', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'building', label: 'Барилга', format: 'TEXT' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'createdAt', label: 'Үүссэн', format: 'DATETIME' },
      { key: 'completedAt', label: 'Дууссан', format: 'DATETIME' },
      { key: 'resolutionHours', label: 'Шийдвэрлэсэн цаг', format: 'NUMBER', align: 'right' },
    ],
    rows,
    total > 0 ? { requestNumber: `Нийт ${total}` } : null,
    total,
  );
}

// -- 15.2 Эрсдэл ба үнэлгээ ---------------------------------------------------

async function riskAssessmentReport(query: ReportQueryInput): Promise<ReportResultDto> {
  /**
   * THE CUSTOMER FILTER IS PART OF THE QUERY, NOT A PASS OVER THE PAGE.
   *
   * It used to be applied to the array `.skip().limit()` had already truncated, while both
   * the window and `countDocuments` ran unfiltered: a customer-scoped report showed however
   * many of one arbitrary page happened to belong to them under a footer counting every
   * customer's assessments, and the pager offered pages that arrived empty. Filtering has
   * to precede pagination, and the count has to be of the same set the rows come from.
   *
   * An assessment references its equipment and not the customer, so the scope is resolved
   * through the objects first. That is a projection of ObjectIds for one customer's
   * registry, not a page of assembled rows — the same trade the employee report makes for
   * its footer — and it is what lets the filter live in the query at all.
   */
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('assessedAt', query),
    ...(query.customerId
      ? {
          object: {
            $in: (
              await ObjectRecord.find({ customer: new Types.ObjectId(query.customerId) })
                .select('_id')
                .lean()
            ).map((object) => object._id),
          },
        }
      : {}),
  };

  const [assessments, total] = await Promise.all([
    ObjectAssessment.find(filter)
    .populate({ path: 'object', select: 'code name customer' })
    .sort({ assessedAt: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    ObjectAssessment.countDocuments(filter),
  ]);

  // The band names an operator configured, not the ones this build shipped with.
  const bands = await getRiskBands();

  const rows: Row[] = assessments.map((assessment) => ({
    objectCode: labelOf(assessment.object, 'code'),
    objectName: nameOf(assessment.object),
    score: assessment.newScore,
    previousScore: assessment.previousScore,
    riskLevel: riskBandLabelOf(assessment.riskLevel, bands),
    conclusion: assessment.conclusion,
    recommendation: assessment.recommendation,
    repairRequired: assessment.repairRequired ? 'Тийм' : 'Үгүй',
    revisitRequired: assessment.revisitRequired ? 'Тийм' : 'Үгүй',
    assessedBy: assessment.assessedByName,
    assessedAt: isoOrNull(assessment.assessedAt),
  }));

  return envelope(
    'RISK_ASSESSMENT',
    query,
    [
      { key: 'objectCode', label: 'Код', format: 'TEXT' },
      { key: 'objectName', label: 'Төхөөрөмж', format: 'TEXT' },
      { key: 'score', label: 'Үнэлгээ', format: 'NUMBER', align: 'right' },
      { key: 'previousScore', label: 'Өмнөх оноо', format: 'NUMBER', align: 'right' },
      { key: 'riskLevel', label: 'Эрсдэлийн түвшин', format: 'TEXT' },
      { key: 'conclusion', label: 'Дүгнэлт', format: 'TEXT' },
      { key: 'recommendation', label: 'Зөвлөмж', format: 'TEXT' },
      { key: 'repairRequired', label: 'Засвар шаардлагатай', format: 'TEXT' },
      { key: 'revisitRequired', label: 'Дахин үзлэг', format: 'TEXT' },
      { key: 'assessedBy', label: 'Хариуцсан', format: 'TEXT' },
      { key: 'assessedAt', label: 'Огноо', format: 'DATETIME' },
    ],
    rows,
    total > 0 ? { objectCode: `Нийт ${total}` } : null,
    total,
  );
}

// -- 15.2 SLA ------------------------------------------------------------------

/**
 * The four outcomes an SLA row can carry, drawn from the same three buckets
 * [isSlaBreached] uses so the wording can never contradict the count beside it.
 *
 * CANCELLED gets its own word. It is void rather than met or missed, and neither of the
 * two labels that used to be available said so: before this it read «Зөрчсөн» (breached),
 * and reading it off `breached` alone would now flip it to «Идэвхтэй» (active) — a
 * withdrawn call described as live work. Both are wrong in the same way, by forcing a
 * request with no SLA verdict into a column that only has verdicts.
 */
function slaResultLabel(status: ServiceRequestStatus, breached: boolean): string {
  if (status === 'CANCELLED') return 'Цуцалсан';
  if (isTerminalServiceRequestStatus(status)) {
    return breached ? 'Хугацаа хэтэрсэн' : 'Хугацаанд багтсан';
  }
  return breached ? 'Зөрчсөн' : 'Идэвхтэй';
}

async function slaReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('createdAt', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
  };

  const now = new Date();

  /**
   * THE FOOTER DESCRIBES THE REPORT; THE ROWS ARE A PAGE OF IT.
   *
   * «Зөрчсөн» was reduced over `rows`, the `.skip().limit()` window, and then printed beside
   * a «Нийт» that came from `countDocuments`. Two different sets under one footer: page one
   * of a 137-row report read «Нийт 137 · Зөрчсөн 25» and page six of the same report read
   * «Зөрчсөн 0», with nothing about the report having changed. It is now counted the way the
   * total already was, over everything the filter matches.
   *
   * [slaBreachFilter] RETURNS AN `$or`, so it is combined under `$and` rather than spread:
   * spreading it would leave the report's own `createdAt`/`customer` scope in place but let
   * the `$or` match requests outside it, and a second `$or` would simply overwrite the
   * first. `filter` itself never carries an `$and`, so this merge cannot clobber it either.
   */
  const [requests, total, breachedCount] = await Promise.all([
    ServiceRequest.find(filter)
    .populate({ path: 'customer', select: 'name' })
    .sort({ slaDueAt: 1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    ServiceRequest.countDocuments(filter),
    ServiceRequest.countDocuments({ ...filter, $and: [slaBreachFilter(now)] }),
  ]);

  /**
   * The verdict comes from [isSlaBreached], the same rule the KPI tile and the dashboard
   * counter run. This row used to decide "settled" from `completedAt` being present, which
   * left a cancelled request — never stamped, never re-opened — reading as a live call in
   * permanent breach. Status decides settlement; `completedAt` only supplies the instant.
   */
  const rows: Row[] = requests.map((request) => {
    const settledAt = request.completedAt;
    const breached = isSlaBreached(request, now);
    return {
      requestNumber: request.requestNumber,
      customer: nameOf(request.customer),
      status: SERVICE_REQUEST_STATUS_LABELS[request.status],
      slaDueAt: isoOrNull(request.slaDueAt),
      completedAt: isoOrNull(settledAt),
      slaResult: slaResultLabel(request.status, breached),
      extendedMinutes: request.slaExtendedMinutes,
    };
  });

  return envelope(
    'SLA',
    query,
    [
      { key: 'requestNumber', label: 'Хүсэлтийн №', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'slaDueAt', label: 'SLA хугацаа', format: 'DATETIME' },
      { key: 'completedAt', label: 'Дууссан', format: 'DATETIME' },
      { key: 'slaResult', label: 'SLA үр дүн', format: 'TEXT' },
      { key: 'extendedMinutes', label: 'Сунгасан (мин)', format: 'NUMBER', align: 'right' },
    ],
    rows,
    total > 0
      ? { requestNumber: `Нийт ${total}`, slaResult: `Зөрчсөн ${breachedCount}` }
      : null,
    total,
  );
}

// -- 15.2 Харилцагч, барилгын тайлан -------------------------------------------

async function customerReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const customerFilter: FilterQuery<Record<string, unknown>> = query.customerId
    ? { _id: new Types.ObjectId(query.customerId) }
    : {};

  const [customers, total] = await Promise.all([
    Customer.find(customerFilter)
      .sort({ name: 1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    Customer.countDocuments(customerFilter),
  ]);

  const ids = customers.map((customer) => customer._id);
  const range = withinRange('createdAt', query);
  /**
   * ONE HEADER, TWO HONEST KINDS OF COLUMN.
   *
   * Under a header reading «2026-03-01 – 2026-03-31» the request and planned-work columns
   * counted March while the invoiced and receivable columns were all-time, so a customer
   * billed for a year showed that year's money beside March's work. The two are not the
   * same kind of figure and the fix is not to window all four:
   *
   * FLOWS ARE WINDOWED, at the query and not by a pass over the results. Requests, works
   * and `invoicedTotal` all happened during a period and are now all scoped to the one in
   * the header. Invoices range on `issueDate`, the date the KPI's revenue also ranges on
   * and the one an invoice is actually dated by — `createdAt` is when the row was written.
   *
   * BALANCES ARE AS OF TODAY, and their labels now say so rather than letting the header
   * speak for them. `receivableTotal` is what is owed now, all-time by definition (4A, and
   * the same figure `summariseInvoices` and the dashboard publish); `objectCount` and
   * `criticalCount` are the customer's registry as it stands, since equipment installed in
   * February has not stopped existing in March. Windowing any of the three would answer a
   * question nobody asks — "how much was owed to us by invoices we happened to raise in
   * March" — and would have to be read as a balance anyway.
   *
   * Grouped aggregations rather than a query per customer, plus one more for the footer.
   * Those scoped to `ids` describe the customers ON THIS PAGE, because that is what the
   * rows need; the footer describes every customer the filter matches, so it cannot reuse
   * them.
   */
  const invoiceRange = withinRange('issueDate', query);
  /**
   * Which bands count as "critical" is configuration, so the level names cannot be
   * literals inside the pipeline: a renamed band would silently stop being counted and
   * the number would still look plausible. A band that demands a written conclusion is
   * the one an operator treats as serious.
   */
  const criticalBandKeys = (await getRiskBands())
    .filter((band) => band.requiresConclusion)
    .map((band) => band.level);

  const [requests, works, invoiced, receivable, objects, wholeSet, wholeSetReceivable] =
    await Promise.all([
    ServiceRequest.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, ...range } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    PlannedWork.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, ...range } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    // Billed in the window. A cancelled invoice was never billed for anything.
    Invoice.aggregate<{ _id: Types.ObjectId; total: number }>([
      { $match: { customer: { $in: ids }, status: { $ne: 'CANCELLED' }, ...invoiceRange } },
      { $group: { _id: '$customer', total: { $sum: '$total' } } },
    ]),
    // Owed today, whenever it was billed.
    Invoice.aggregate<{ _id: Types.ObjectId; unpaid: number }>([
      { $match: { customer: { $in: ids }, status: 'SENT' } },
      { $group: { _id: '$customer', unpaid: { $sum: '$total' } } },
    ]),
    ObjectRecord.aggregate<{ _id: Types.ObjectId; count: number; critical: number }>([
      { $match: { customer: { $in: ids } } },
      {
        $group: {
          _id: '$customer',
          count: { $sum: 1 },
          critical: {
            $sum: {
              $cond: [
                { $in: ['$latestAssessment.riskLevel', criticalBandKeys] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    // The same two figures over every customer the filter matches, each keeping its own
    // window: the footer must read the same way the column above it does.
    Invoice.aggregate<{ total: number }>([
      {
        $match: {
          ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
          status: { $ne: 'CANCELLED' },
          ...invoiceRange,
        },
      },
      { $group: { _id: null, total: { $sum: '$total' } } },
    ]),
    Invoice.aggregate<{ unpaid: number }>([
      {
        $match: {
          ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
          status: 'SENT',
        },
      },
      { $group: { _id: null, unpaid: { $sum: '$total' } } },
    ]),
  ]);

  const requestsBy = new Map(requests.map((row) => [String(row._id), row.count]));
  const worksBy = new Map(works.map((row) => [String(row._id), row.count]));
  const invoicedBy = new Map(invoiced.map((row) => [String(row._id), row.total]));
  const receivableBy = new Map(receivable.map((row) => [String(row._id), row.unpaid]));
  const objectsBy = new Map(objects.map((row) => [String(row._id), row]));

  const rows: Row[] = customers.map((customer) => {
    const key = String(customer._id);
    const object = objectsBy.get(key);
    return {
      customer: customer.name,
      objectCount: object?.count ?? 0,
      criticalCount: object?.critical ?? 0,
      requestCount: requestsBy.get(key) ?? 0,
      plannedWorkCount: worksBy.get(key) ?? 0,
      invoicedTotal: invoicedBy.get(key) ?? 0,
      receivableTotal: receivableBy.get(key) ?? 0,
    };
  });

  return envelope(
    'CUSTOMER',
    query,
    [
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      // The three balance columns carry «одоо»/«нийт» in their own labels: the date header
      // above them describes the flow columns, and without this a reader would take it to
      // describe all seven.
      { key: 'objectCount', label: 'Объект (одоо)', format: 'NUMBER', align: 'right' },
      { key: 'criticalCount', label: 'Улаан/хар (одоо)', format: 'NUMBER', align: 'right' },
      { key: 'requestCount', label: 'Хүсэлт', format: 'NUMBER', align: 'right' },
      { key: 'plannedWorkCount', label: 'Төлөвлөгөөт ажил', format: 'NUMBER', align: 'right' },
      { key: 'invoicedTotal', label: 'Нэхэмжилсэн', format: 'MONEY', align: 'right' },
      { key: 'receivableTotal', label: 'Авлага (нийт үлдэгдэл)', format: 'MONEY', align: 'right' },
    ],
    rows,
    total > 0
      ? {
          customer: `Нийт ${total}`,
          invoicedTotal: wholeSet[0]?.total ?? 0,
          receivableTotal: wholeSetReceivable[0]?.unpaid ?? 0,
        }
      : null,
    total,
  );
}

// -- 15.2 Ажилтны гүйцэтгэл ----------------------------------------------------

async function employeePerformanceReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const employeeFilter: FilterQuery<Record<string, unknown>> = query.employeeId
    ? { _id: new Types.ObjectId(query.employeeId) }
    : { status: 'ACTIVE' };

  const [employees, total] = await Promise.all([
    Employee.find(employeeFilter)
      .select('firstName lastName employeeCode')
      .sort({ lastName: 1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    Employee.countDocuments(employeeFilter),
  ]);

  const ids = employees.map((employee) => employee._id);
  const range = withinRange('createdAt', query);

  /**
   * `elapsedHours` is wall-clock time from the request being raised to it being closed —
   * nights, weekends and waiting for a part included. Nothing in the schema records labour
   * time, so no column here can claim hours worked.
   *
   * It is also a property of the request, not of the assignee: after the $unwind every
   * technician on a shared request sees the same elapsed span. Summing it would charge one
   * 24-hour call to three people as 72 hours, so it is averaged over the requests each
   * technician closed. An average cannot be added up across rows, which is exactly the
   * misreading a total invited.
   */
  /**
   * The footer's two counters, over every employee the filter matches.
   *
   * The id list is fetched in full for this, and that is not the "fetch everything and
   * throw most of it away" this endpoint was paginated to stop: it is a projection of
   * ObjectIds for a staff list, not a page of assembled report rows, and it is what lets
   * the footer describe the report rather than the twenty rows on screen.
   */
  const allIds = (await Employee.find(employeeFilter).select('_id').lean()).map(
    (employee) => employee._id,
  );
  const wholeSet = await ServiceRequest.aggregate<{ assigned: number; completed: number }>([
    { $match: { assignedEmployees: { $in: allIds }, ...range } },
    { $unwind: '$assignedEmployees' },
    { $match: { assignedEmployees: { $in: allIds } } },
    {
      $group: {
        _id: null,
        assigned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
      },
    },
  ]);

  const grouped = await ServiceRequest.aggregate<{
    _id: Types.ObjectId;
    assigned: number;
    completed: number;
    onTime: number;
    revisits: number;
    returned: number;
    elapsedHours: number;
    resolved: number;
  }>([
    { $match: { assignedEmployees: { $in: ids }, ...range } },
    { $unwind: '$assignedEmployees' },
    { $match: { assignedEmployees: { $in: ids } } },
    {
      $group: {
        _id: '$assignedEmployees',
        assigned: { $sum: 1 },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        onTime: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'COMPLETED'] },
                  { $lte: ['$completedAt', '$slaDueAt'] },
                ],
              },
              1,
              0,
            ],
          },
        },
        revisits: { $sum: { $cond: [{ $eq: ['$status', 'REVISIT_REQUIRED'] }, 1, 0] } },
        returned: { $sum: { $cond: [{ $eq: ['$status', 'RETURNED'] }, 1, 0] } },
        elapsedHours: {
          $sum: {
            $cond: [
              { $ne: ['$completedAt', null] },
              { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3_600_000] },
              0,
            ],
          },
        },
        resolved: { $sum: { $cond: [{ $ne: ['$completedAt', null] }, 1, 0] } },
      },
    },
  ]);

  const statsBy = new Map(grouped.map((row) => [String(row._id), row]));

  const rows: Row[] = employees.map((employee) => {
    const stats = statsBy.get(String(employee._id));
    const completed = stats?.completed ?? 0;
    return {
      employee: `${employee.lastName} ${employee.firstName}`,
      employeeNumber: employee.employeeCode,
      assigned: stats?.assigned ?? 0,
      completed,
      // Null rather than zero with no completed work: a rate over an empty set is undefined.
      onTimeRate: completed > 0 ? Math.round(((stats?.onTime ?? 0) / completed) * 100) : null,
      // Null over an empty set, as with the rate above: an average of nothing is undefined,
      // and a zero here would read as "closed instantly".
      avgElapsedHours:
        stats && stats.resolved > 0
          ? Math.round((stats.elapsedHours / stats.resolved) * 10) / 10
          : null,
      revisits: stats?.revisits ?? 0,
      returned: stats?.returned ?? 0,
    };
  });

  return envelope(
    'EMPLOYEE_PERFORMANCE',
    query,
    [
      { key: 'employee', label: 'Ажилтан', format: 'TEXT' },
      { key: 'employeeNumber', label: 'Ажилтны №', format: 'TEXT' },
      { key: 'assigned', label: 'Хуваарилсан', format: 'NUMBER', align: 'right' },
      { key: 'completed', label: 'Дууссан', format: 'NUMBER', align: 'right' },
      { key: 'onTimeRate', label: 'Хугацаандаа', format: 'PERCENT', align: 'right' },
      {
        key: 'avgElapsedHours',
        label: 'Хүсэлтийн дундаж хугацаа (ц)',
        format: 'NUMBER',
        align: 'right',
      },
      { key: 'revisits', label: 'Дахин очилт', format: 'NUMBER', align: 'right' },
      { key: 'returned', label: 'Буцаалт', format: 'NUMBER', align: 'right' },
    ],
    rows,
    // The assigned and completed columns count service requests, and the footer counts
    // them across every employee the filter matches rather than across the page. It is one
    // aggregation over the same range the rows use.
    total > 0
      ? {
          employee: `Нийт ${total}`,
          assigned: wholeSet[0]?.assigned ?? 0,
          completed: wholeSet[0]?.completed ?? 0,
        }
      : null,
    total,
  );
}

// -- 15.2 Нэхэмжлэл ба авлага --------------------------------------------------

async function invoiceReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('issueDate', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
  };

  // The footer's money columns are aggregated over the whole filtered set: a receivable
  // total that summed only the page on screen would understate the debt, which is the one
  // number on this report nobody may be misled about.
  const [invoices, total, sums] = await Promise.all([
    Invoice.find(filter)
      .populate({ path: 'customer', select: 'name' })
      .sort({ issueDate: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate<{ total: number; receivable: number }>([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: '$total' },
          receivable: {
            $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, '$total', 0] },
          },
        },
      },
    ]),
  ]);

  const now = new Date();
  const rows: Row[] = invoices.map((invoice) => ({
    invoiceNumber: invoice.invoiceNumber,
    customer: nameOf(invoice.customer),
    billingPeriod: invoice.billingPeriod,
    issueDate: isoOrNull(invoice.issueDate),
    dueDate: isoOrNull(invoice.dueDate),
    status: effectiveInvoiceStatus(invoice, now),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    // Section 15.3: the receivable is issued but unpaid.
    receivable: invoice.status === 'SENT' ? invoice.total : 0,
  }));

  return envelope(
    'INVOICE_RECEIVABLE',
    query,
    [
      { key: 'invoiceNumber', label: 'Нэхэмжлэлийн №', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'billingPeriod', label: 'Тайлант үе', format: 'TEXT' },
      { key: 'issueDate', label: 'Огноо', format: 'DATE' },
      { key: 'dueDate', label: 'Төлөх хугацаа', format: 'DATE' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'subtotal', label: 'Дүн', format: 'MONEY', align: 'right' },
      { key: 'taxAmount', label: 'Татвар', format: 'MONEY', align: 'right' },
      { key: 'total', label: 'Нийт', format: 'MONEY', align: 'right' },
      { key: 'receivable', label: 'Авлага', format: 'MONEY', align: 'right' },
    ],
    rows,
    total > 0
      ? {
          invoiceNumber: `Нийт ${total}`,
          total: sums[0]?.total ?? 0,
          receivable: sums[0]?.receivable ?? 0,
        }
      : null,
    total,
  );
}

// -- 15.2 Audit ба дүгнэлтийн log ----------------------------------------------

async function auditReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const [entries, total] = await Promise.all([
    AuditLog.find(withinRange('createdAt', query))
    .sort({ createdAt: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    AuditLog.countDocuments(withinRange('createdAt', query)),
  ]);

  const rows: Row[] = entries.map((entry) => ({
    createdAt: isoOrNull(entry.createdAt),
    entityType: entry.entityType,
    action: entry.action,
    user: entry.userLabel,
    role: entry.userRole,
    reason: entry.reason,
    ip: entry.ip,
  }));

  return envelope(
    'AUDIT_LOG',
    query,
    [
      { key: 'createdAt', label: 'Огноо', format: 'DATETIME' },
      { key: 'entityType', label: 'Бүртгэл', format: 'TEXT' },
      { key: 'action', label: 'Үйлдэл', format: 'TEXT' },
      { key: 'user', label: 'Хэрэглэгч', format: 'TEXT' },
      { key: 'role', label: 'Эрх', format: 'TEXT' },
      { key: 'reason', label: 'Шалтгаан', format: 'TEXT' },
      { key: 'ip', label: 'IP', format: 'TEXT' },
    ],
    rows,
    total > 0 ? { createdAt: `Нийт ${total}` } : null,
    total,
  );
}

// -- 15.2 Техникийн дүгнэлтийн тайлан ------------------------------------------

/**
 * The unified report store as a tabular export, one row per report.
 *
 * Every producer writes there, so this is the one dataset where an assessment, a
 * planned-work result, a service conclusion and a consolidation line up as rows of the
 * same table — which is exactly what an exported registry needs to be.
 */
async function technicalReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('occurredAt', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
    ...(query.projectId ? { project: new Types.ObjectId(query.projectId) } : {}),
  };

  const [reports, total] = await Promise.all([
    Report.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .sort({ occurredAt: -1 })
      .skip(skipFor(query))
      .limit(query.limit)
      .lean(),
    Report.countDocuments(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
    ]),
  ]);

  // Grouped once for the page rather than counted per row.
  const counts = await ReportItem.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { report: { $in: reports.map((report) => report._id) } } },
    { $group: { _id: '$report', count: { $sum: 1 } } },
  ]);
  const countBy = new Map(counts.map((row) => [String(row._id), row.count]));

  // As in `riskAssessmentReport`: the configured ladder, not the compiled one.
  const bands = await getRiskBands();

  const rows: Row[] = reports.map((report) => ({
    reportNumber: report.reportNumber,
    type: REPORT_TYPE_LABELS[report.type],
    status: REPORT_STATUS_LABELS[report.status],
    title: report.title,
    customer: nameOf(report.customer),
    project: nameOf(report.project),
    building: nameOf(report.building),
    itemCount: countBy.get(String(report._id)) ?? 0,
    overallScore: report.overallScore,
    riskLevel: report.riskLevel ? riskBandLabelOf(report.riskLevel, bands) : null,
    conclusion: report.conclusion,
    author: report.approvedByName ?? report.createdByName,
    occurredAt: isoOrNull(report.occurredAt),
  }));

  return envelope(
    'TECHNICAL_REPORT',
    query,
    [
      { key: 'reportNumber', label: 'Тайлангийн №', format: 'TEXT' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'title', label: 'Гарчиг', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'project', label: 'Төсөл', format: 'TEXT' },
      { key: 'building', label: 'Барилга', format: 'TEXT' },
      { key: 'itemCount', label: 'Тоноглол', format: 'NUMBER', align: 'right' },
      { key: 'overallScore', label: 'Оноо', format: 'NUMBER', align: 'right' },
      { key: 'riskLevel', label: 'Эрсдэлийн түвшин', format: 'TEXT' },
      { key: 'conclusion', label: 'Дүгнэлт', format: 'TEXT' },
      { key: 'author', label: 'Хариуцсан', format: 'TEXT' },
      { key: 'occurredAt', label: 'Огноо', format: 'DATETIME' },
    ],
    rows,
    total > 0 ? { reportNumber: `Нийт ${total}` } : null,
    total,
  );
}

const BUILDERS: Record<ReportKey, (query: ReportQueryInput) => Promise<ReportResultDto>> = {
  PLANNED_WORK: plannedWorkReport,
  SERVICE_WORK: serviceWorkReport,
  RISK_ASSESSMENT: riskAssessmentReport,
  SLA: slaReport,
  CUSTOMER: customerReport,
  EMPLOYEE_PERFORMANCE: employeePerformanceReport,
  INVOICE_RECEIVABLE: invoiceReport,
  AUDIT_LOG: auditReport,
  TECHNICAL_REPORT: technicalReport,
};

export async function buildReport(
  key: ReportKey,
  query: ReportQueryInput,
): Promise<ReportResultDto> {
  return BUILDERS[key](query);
}

// -- 15.3 KPI ------------------------------------------------------------------

function kpi(
  key: (typeof KPI_KEYS)[number],
  value: number | null,
  numerator: number | null,
  denominator: number | null,
): KpiValueDto {
  return {
    key,
    label: KPI_LABELS[key],
    formula: KPI_FORMULAS[key],
    purpose: KPI_PURPOSES[key],
    unit: KPI_UNITS[key],
    value,
    numerator,
    denominator,
  };
}

/** A rate over an empty set is undefined, so it is reported as null rather than as zero. */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100);
}

export async function buildKpis(dateFrom: string, dateTo: string): Promise<KpiSummaryDto> {
  const from = new Date(dateFrom);
  const to = new Date(dateTo);
  // One clock for the whole summary: the breach expression is evaluated against it, so a
  // request cannot be judged open against one instant and settled against another.
  const now = new Date();
  const range = { createdAt: { $gte: from, $lte: to } };
  const settings = await getSettings();

  const [completed, plannedWorks, revisits, revenueTotals, receivableTotals] = await Promise.all([
    ServiceRequest.aggregate<{
      _id: null;
      completed: number;
      onTime: number;
      totalHours: number;
      breached: number;
    }>([
      { $match: range },
      {
        $group: {
          _id: null,
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
          onTime: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'COMPLETED'] },
                    { $lte: ['$completedAt', '$slaDueAt'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          totalHours: {
            $sum: {
              $cond: [
                { $ne: ['$completedAt', null] },
                { $divide: [{ $subtract: ['$completedAt', '$createdAt'] }, 3_600_000] },
                0,
              ],
            },
          },
          // "SLA зөрчил" is [isSlaBreached] and nothing else. This used to test
          // `completedAt == null && slaDueAt < now`, which made every cancelled request a
          // permanent breach — a cancellation never writes `completedAt`.
          breached: { $sum: { $cond: [slaBreachExpr(now), 1, 0] } },
        },
      },
    ]),
    PlannedWork.aggregate<{ _id: null; total: number; completed: number }>([
      {
        $match: {
          plannedStartDate: { $gte: from, $lte: to },
          status: { $nin: PLANNED_WORK_UNCOMMITTED_STATUSES },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: {
            $sum: { $cond: [{ $in: ['$status', PLANNED_WORK_DELIVERED_STATUSES] }, 1, 0] },
          },
        },
      },
    ]),
    ServiceRequest.countDocuments({ ...range, status: 'REVISIT_REQUIRED' }),
    Invoice.aggregate<{ _id: null; revenue: number }>([
      /**
       * The published formula is "sent and paid", so a draft is not revenue: it has not
       * left the building and can still be edited or dropped. OVERDUE is not matched here
       * because it is not a stored status — an overdue invoice is a SENT one whose due
       * date has passed, and it is already counted.
       *
       * Revenue IS a flow, so this one keeps the window. The receivable below does not.
       */
      { $match: { issueDate: { $gte: from, $lte: to }, status: { $in: INVOICE_REVENUE_STATUSES } } },
      { $group: { _id: null, revenue: { $sum: '$total' } } },
    ]),
    /**
     * A RECEIVABLE IS A BALANCE, NOT A FLOW, SO IT IS NOT WINDOWED.
     *
     * This shared the revenue pipeline's `$match` and so reported "sent inside this window
     * and not yet paid" — which is not a figure anybody wants: a customer's year-old unpaid
     * invoice, the very thing the number exists to surface, disappeared from it the moment
     * the window moved past its issue date, and the tile fell as debts aged.
     *
     * "Outstanding as of the period end" is not implementable and would be worse if it
     * were: `status` is the invoice's CURRENT state with no history behind it, so pairing
     * it with `issueDate <= to` yields neither the balance then nor the balance now. The
     * two other places that publish this figure — `summariseInvoices` and the dashboard's
     * finance tile — both read every SENT invoice with no date bound at all, and
     * `KPI_FORMULAS.RECEIVABLE_TOTAL` («Илгээсэн боловч төлөгдөөгүй нэхэмжлэл») names no
     * period, so the published formula is already the all-time one. This is now the same
     * number those two reach, as MONTHLY_REVENUE and the dashboard's revenue already are.
     */
    Invoice.aggregate<{ _id: null; receivable: number }>([
      { $match: { status: 'SENT' } },
      { $group: { _id: null, receivable: { $sum: '$total' } } },
    ]),
  ]);

  const requestStats = completed[0];
  const workStats = plannedWorks[0];

  const completedCount = requestStats?.completed ?? 0;

  return {
    dateFrom,
    dateTo,
    currency: String(settings[SETTING_KEYS.CURRENCY]),
    values: [
      kpi(
        'ON_TIME_COMPLETION_RATE',
        rate(requestStats?.onTime ?? 0, completedCount),
        requestStats?.onTime ?? 0,
        completedCount,
      ),
      kpi(
        'AVERAGE_RESOLUTION_HOURS',
        completedCount === 0
          ? null
          : Math.round(((requestStats?.totalHours ?? 0) / completedCount) * 10) / 10,
        requestStats ? Math.round(requestStats.totalHours * 10) / 10 : 0,
        completedCount,
      ),
      kpi('SLA_BREACHED_COUNT', requestStats?.breached ?? 0, null, null),
      kpi(
        'PLANNED_WORK_COMPLETION_RATE',
        rate(workStats?.completed ?? 0, workStats?.total ?? 0),
        workStats?.completed ?? 0,
        workStats?.total ?? 0,
      ),
      kpi('REVISIT_COUNT', revisits, null, null),
      kpi('MONTHLY_REVENUE', revenueTotals[0]?.revenue ?? 0, null, null),
      kpi('RECEIVABLE_TOTAL', receivableTotals[0]?.receivable ?? 0, null, null),
    ],
  };
}

/**
 * The line a truncated export carries in place of its footer.
 *
 * Exported so a test names this string rather than keeping a second copy of it that can
 * drift from the one the file actually carries.
 */
export function truncationNotice(exported: number, total: number): string {
  return `Анхааруулга: энэ файлд тайлангийн нийт ${total} мөрөөс эхний ${exported} мөр багтсан. Нийлбэр мөр татагдаагүй мөрүүдийг бас тоолох тул хасагдсан.`;
}

/**
 * CSV with a UTF-8 BOM.
 *
 * The BOM is what makes Excel open Cyrillic correctly on a double click instead of
 * mangling it into Latin-1, which is the whole reason CSV is an acceptable answer to the
 * rule 17.20 Excel requirement.
 *
 * THE FOOTER IS DROPPED WHEN THE EXPORT WAS CAPPED, and this is the point of `truncatedAt`
 * reaching here at all. Every builder aggregates `totals` over the WHOLE filtered set —
 * which is right on a paged screen, where the reader can reach every row — but an export
 * renders one window and offers no way to ask for the next. A 1,200-row report capped at
 * 1,000 was therefore downloaded as 1,000 rows under a footer reading «Нийт 1200»: a
 * financial or SLA document that disagreed with itself, and nothing in it said so, so it
 * was filed as complete. A file that cannot state a figure it did not export is worth more
 * than one that carries a total nobody can reconcile against its own rows.
 */
export function reportToCsv(report: ReportResultDto): string {
  const escape = (value: string | number | null): string => {
    if (value === null) return '';
    const text = String(value);
    return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [report.columns.map((column) => escape(column.label)).join(',')];
  for (const row of report.rows) {
    lines.push(report.columns.map((column) => escape(row[column.key] ?? null)).join(','));
  }

  if (report.truncatedAt !== null) {
    lines.push(escape(truncationNotice(report.rows.length, report.total)));
  } else if (report.totals) {
    lines.push(report.columns.map((column) => escape(report.totals?.[column.key] ?? null)).join(','));
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}
