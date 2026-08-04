import {
  INVOICE_REVENUE_STATUSES,
  KPI_FORMULAS,
  KPI_KEYS,
  KPI_LABELS,
  KPI_PURPOSES,
  KPI_UNITS,
  PLANNED_WORK_STATUS_LABELS,
  REPORT_DESCRIPTIONS,
  REPORT_LABELS,
  REPORT_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  RISK_LEVEL_LABELS,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TYPE_LABELS,
  SETTING_KEYS,
  effectivePlannedWorkStatus,
  type KpiSummaryDto,
  type KpiValueDto,
  type ReportColumnDto,
  type ReportKey,
  type ReportQueryInput,
  type ReportResultDto,
  type ReportRowDto,
} from '@monhorus/shared';
import { Types, type FilterQuery } from 'mongoose';

import { AuditLog } from '../audit/audit-log.model';
import { Employee } from '../employee/employee.model';
import { Invoice } from '../invoice/invoice.model';
import { effectiveInvoiceStatus } from '../invoice/invoice.service';
import { ObjectAssessment, ObjectRecord } from '../object-master/object-master.models';
import { Customer } from '../objects/object.models';
import { PlannedWork } from '../planned-work/planned-work.models';
import { Report, ReportItem } from '../report-record/report-record.model';
import { ServiceRequest } from '../service-request/service-request.model';
import { getSettings } from '../settings/settings.service';

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

function envelope(
  key: ReportKey,
  query: ReportQueryInput,
  columns: readonly ReportColumnDto[],
  rows: readonly Row[],
  totals: ReportRowDto | null,
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
    totals,
    // A capped row set is stated rather than silently truncated, so an export cannot be
    // mistaken for a complete one.
    truncatedAt: rows.length >= query.limit ? query.limit : null,
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
  const works = await PlannedWork.find(filter)
    .populate([
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
      { path: 'customer', select: 'name' },
    ])
    .sort({ plannedStartDate: -1 })
    .limit(query.limit)
    .lean();

  const rows: Row[] = works.map((work) => ({
    workNumber: work.workNumber,
    title: work.title,
    customer: nameOf(work.customer),
    project: nameOf(work.project),
    building: nameOf(work.building),
    plannedStart: isoOrNull(work.plannedStartDate),
    plannedEnd: isoOrNull(work.plannedEndDate),
    actualEnd: isoOrNull(work.actualEndDate),
    status: PLANNED_WORK_STATUS_LABELS[
      effectivePlannedWorkStatus(work.status, work.plannedEndDate, now)
    ],
    taskCount: work.taskCount,
    progressPercent: work.progressPercent,
    completedLate: work.completedLate ? 'Тийм' : 'Үгүй',
  }));

  const totalProgress = rows.reduce((sum, row) => sum + Number(row.progressPercent ?? 0), 0);

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
    rows.length > 0
      ? {
          workNumber: `Нийт ${rows.length}`,
          progressPercent: Math.round(totalProgress / rows.length),
        }
      : null,
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

  const requests = await ServiceRequest.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

  const rows: Row[] = requests.map((request) => ({
    requestNumber: request.requestNumber,
    type: SERVICE_REQUEST_TYPE_LABELS[request.requestType],
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
      { key: 'type', label: 'Төрөл', format: 'TEXT' },
      { key: 'urgent', label: 'Яаралтай', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'building', label: 'Барилга', format: 'TEXT' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'createdAt', label: 'Үүссэн', format: 'DATETIME' },
      { key: 'completedAt', label: 'Дууссан', format: 'DATETIME' },
      { key: 'resolutionHours', label: 'Шийдвэрлэсэн цаг', format: 'NUMBER', align: 'right' },
    ],
    rows,
    rows.length > 0 ? { requestNumber: `Нийт ${rows.length}` } : null,
  );
}

// -- 15.2 Эрсдэл ба үнэлгээ ---------------------------------------------------

async function riskAssessmentReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const assessments = await ObjectAssessment.find(withinRange('assessedAt', query))
    .populate({ path: 'object', select: 'code name customer' })
    .sort({ assessedAt: -1 })
    .limit(query.limit)
    .lean();

  const filtered = query.customerId
    ? assessments.filter(
        (row) => labelOf(row.object, 'customer') === query.customerId,
      )
    : assessments;

  const rows: Row[] = filtered.map((assessment) => ({
    objectCode: labelOf(assessment.object, 'code'),
    objectName: nameOf(assessment.object),
    score: assessment.newScore,
    previousScore: assessment.previousScore,
    riskLevel: RISK_LEVEL_LABELS[assessment.riskLevel],
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
    rows.length > 0 ? { objectCode: `Нийт ${rows.length}` } : null,
  );
}

// -- 15.2 SLA ------------------------------------------------------------------

async function slaReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('createdAt', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
  };

  const requests = await ServiceRequest.find(filter)
    .populate({ path: 'customer', select: 'name' })
    .sort({ slaDueAt: 1 })
    .limit(query.limit)
    .lean();

  const now = new Date();
  const rows: Row[] = requests.map((request) => {
    const settledAt = request.completedAt;
    const breached = settledAt
      ? settledAt > request.slaDueAt
      : now > request.slaDueAt;
    return {
      requestNumber: request.requestNumber,
      customer: nameOf(request.customer),
      type: SERVICE_REQUEST_TYPE_LABELS[request.requestType],
      status: SERVICE_REQUEST_STATUS_LABELS[request.status],
      slaDueAt: isoOrNull(request.slaDueAt),
      completedAt: isoOrNull(settledAt),
      slaResult: settledAt
        ? breached
          ? 'Хугацаа хэтэрсэн'
          : 'Хугацаанд багтсан'
        : breached
          ? 'Зөрчсөн'
          : 'Идэвхтэй',
      extendedMinutes: request.slaExtendedMinutes,
    };
  });

  const breachedCount = rows.filter(
    (row) => row.slaResult === 'Зөрчсөн' || row.slaResult === 'Хугацаа хэтэрсэн',
  ).length;

  return envelope(
    'SLA',
    query,
    [
      { key: 'requestNumber', label: 'Хүсэлтийн №', format: 'TEXT' },
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'type', label: 'Төрөл', format: 'TEXT' },
      { key: 'status', label: 'Төлөв', format: 'TEXT' },
      { key: 'slaDueAt', label: 'SLA хугацаа', format: 'DATETIME' },
      { key: 'completedAt', label: 'Дууссан', format: 'DATETIME' },
      { key: 'slaResult', label: 'SLA үр дүн', format: 'TEXT' },
      { key: 'extendedMinutes', label: 'Сунгасан (мин)', format: 'NUMBER', align: 'right' },
    ],
    rows,
    rows.length > 0 ? { requestNumber: `Нийт ${rows.length}`, slaResult: `Зөрчсөн ${breachedCount}` } : null,
  );
}

// -- 15.2 Харилцагч, барилгын тайлан -------------------------------------------

async function customerReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const customers = await Customer.find(
    query.customerId ? { _id: new Types.ObjectId(query.customerId) } : {},
  )
    .sort({ name: 1 })
    .limit(query.limit)
    .lean();

  const ids = customers.map((customer) => customer._id);
  const range = withinRange('createdAt', query);

  // Four grouped aggregations rather than four queries per customer.
  const [requests, works, invoices, objects] = await Promise.all([
    ServiceRequest.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, ...range } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    PlannedWork.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, ...range } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    Invoice.aggregate<{ _id: Types.ObjectId; total: number; unpaid: number }>([
      { $match: { customer: { $in: ids }, status: { $ne: 'CANCELLED' } } },
      {
        $group: {
          _id: '$customer',
          total: { $sum: '$total' },
          unpaid: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, '$total', 0] } },
        },
      },
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
                { $in: ['$latestAssessment.riskLevel', ['CRITICAL', 'OUT_OF_SERVICE']] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const requestsBy = new Map(requests.map((row) => [String(row._id), row.count]));
  const worksBy = new Map(works.map((row) => [String(row._id), row.count]));
  const invoicesBy = new Map(invoices.map((row) => [String(row._id), row]));
  const objectsBy = new Map(objects.map((row) => [String(row._id), row]));

  const rows: Row[] = customers.map((customer) => {
    const key = String(customer._id);
    const invoice = invoicesBy.get(key);
    const object = objectsBy.get(key);
    return {
      customer: customer.name,
      objectCount: object?.count ?? 0,
      criticalCount: object?.critical ?? 0,
      requestCount: requestsBy.get(key) ?? 0,
      plannedWorkCount: worksBy.get(key) ?? 0,
      invoicedTotal: invoice?.total ?? 0,
      receivableTotal: invoice?.unpaid ?? 0,
    };
  });

  return envelope(
    'CUSTOMER',
    query,
    [
      { key: 'customer', label: 'Харилцагч', format: 'TEXT' },
      { key: 'objectCount', label: 'Объект', format: 'NUMBER', align: 'right' },
      { key: 'criticalCount', label: 'Улаан/хар', format: 'NUMBER', align: 'right' },
      { key: 'requestCount', label: 'Хүсэлт', format: 'NUMBER', align: 'right' },
      { key: 'plannedWorkCount', label: 'Төлөвлөгөөт ажил', format: 'NUMBER', align: 'right' },
      { key: 'invoicedTotal', label: 'Нэхэмжилсэн', format: 'MONEY', align: 'right' },
      { key: 'receivableTotal', label: 'Авлага', format: 'MONEY', align: 'right' },
    ],
    rows,
    rows.length > 0
      ? {
          customer: `Нийт ${rows.length}`,
          invoicedTotal: rows.reduce((sum, row) => sum + Number(row.invoicedTotal ?? 0), 0),
          receivableTotal: rows.reduce((sum, row) => sum + Number(row.receivableTotal ?? 0), 0),
        }
      : null,
  );
}

// -- 15.2 Ажилтны гүйцэтгэл ----------------------------------------------------

async function employeePerformanceReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const employees = await Employee.find(
    query.employeeId ? { _id: new Types.ObjectId(query.employeeId) } : { status: 'ACTIVE' },
  )
    .select('firstName lastName employeeCode')
    .sort({ lastName: 1 })
    .limit(query.limit)
    .lean();

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
    rows.length > 0
      ? {
          employee: `Нийт ${rows.length}`,
          assigned: rows.reduce((sum, row) => sum + Number(row.assigned ?? 0), 0),
          completed: rows.reduce((sum, row) => sum + Number(row.completed ?? 0), 0),
        }
      : null,
  );
}

// -- 15.2 Нэхэмжлэл ба авлага --------------------------------------------------

async function invoiceReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const filter: FilterQuery<Record<string, unknown>> = {
    ...withinRange('issueDate', query),
    ...(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
  };

  const invoices = await Invoice.find(filter)
    .populate({ path: 'customer', select: 'name' })
    .sort({ issueDate: -1 })
    .limit(query.limit)
    .lean();

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
    rows.length > 0
      ? {
          invoiceNumber: `Нийт ${rows.length}`,
          total: rows.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
          receivable: rows.reduce((sum, row) => sum + Number(row.receivable ?? 0), 0),
        }
      : null,
  );
}

// -- 15.2 Audit ба дүгнэлтийн log ----------------------------------------------

async function auditReport(query: ReportQueryInput): Promise<ReportResultDto> {
  const entries = await AuditLog.find(withinRange('createdAt', query))
    .sort({ createdAt: -1 })
    .limit(query.limit)
    .lean();

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
    rows.length > 0 ? { createdAt: `Нийт ${rows.length}` } : null,
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

  const reports = await Report.find(filter)
    .populate([
      { path: 'customer', select: 'name' },
      { path: 'project', select: 'name' },
      { path: 'building', select: 'name' },
    ])
    .sort({ occurredAt: -1 })
    .limit(query.limit)
    .lean();

  // Grouped once for the page rather than counted per row.
  const counts = await ReportItem.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { report: { $in: reports.map((report) => report._id) } } },
    { $group: { _id: '$report', count: { $sum: 1 } } },
  ]);
  const countBy = new Map(counts.map((row) => [String(row._id), row.count]));

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
    riskLevel: report.riskLevel ? RISK_LEVEL_LABELS[report.riskLevel] : null,
    conclusion: report.conclusion,
    author: report.approvedByName ?? report.createdByName,
    occurredAt: isoOrNull(report.occurredAt),
  }));

  return envelope(
    'TECHNICAL_REPORT',
    query,
    [
      { key: 'reportNumber', label: 'Тайлангийн №', format: 'TEXT' },
      { key: 'type', label: 'Төрөл', format: 'TEXT' },
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
    rows.length > 0 ? { reportNumber: `Нийт ${rows.length}` } : null,
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
  const range = { createdAt: { $gte: from, $lte: to } };
  const settings = await getSettings();

  const [completed, plannedWorks, revisits, invoiceTotals] = await Promise.all([
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
          breached: {
            $sum: {
              $cond: [
                {
                  $or: [
                    {
                      $and: [
                        { $ne: ['$completedAt', null] },
                        { $gt: ['$completedAt', '$slaDueAt'] },
                      ],
                    },
                    {
                      $and: [
                        { $eq: ['$completedAt', null] },
                        { $lt: ['$slaDueAt', new Date()] },
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]),
    PlannedWork.aggregate<{ _id: null; total: number; completed: number }>([
      { $match: { plannedStartDate: { $gte: from, $lte: to } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
        },
      },
    ]),
    ServiceRequest.countDocuments({ ...range, status: 'REVISIT_REQUIRED' }),
    Invoice.aggregate<{ _id: null; revenue: number; receivable: number }>([
      /**
       * The published formula is "sent and paid", so a draft is not revenue: it has not
       * left the building and can still be edited or dropped. OVERDUE is not matched here
       * because it is not a stored status — an overdue invoice is a SENT one whose due
       * date has passed, and it is already counted.
       */
      { $match: { issueDate: { $gte: from, $lte: to }, status: { $in: INVOICE_REVENUE_STATUSES } } },
      {
        $group: {
          _id: null,
          revenue: { $sum: '$total' },
          receivable: { $sum: { $cond: [{ $eq: ['$status', 'SENT'] }, '$total', 0] } },
        },
      },
    ]),
  ]);

  const requestStats = completed[0];
  const workStats = plannedWorks[0];
  const money = invoiceTotals[0];

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
      kpi('MONTHLY_REVENUE', money?.revenue ?? 0, null, null),
      kpi('RECEIVABLE_TOTAL', money?.receivable ?? 0, null, null),
    ],
  };
}

/**
 * CSV with a UTF-8 BOM.
 *
 * The BOM is what makes Excel open Cyrillic correctly on a double click instead of
 * mangling it into Latin-1, which is the whole reason CSV is an acceptable answer to the
 * rule 17.20 Excel requirement.
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
  if (report.totals) {
    lines.push(report.columns.map((column) => escape(report.totals?.[column.key] ?? null)).join(','));
  }

  return `﻿${lines.join('\r\n')}\r\n`;
}
