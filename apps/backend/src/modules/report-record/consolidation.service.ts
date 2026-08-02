import {
  REPORT_STATUS_LABELS,
  type ConsolidateReportsInput,
  type ReportDto,
  type ReportStatus,
  type ReturnReportInput,
} from '@monhorus/shared';
import { Types, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  customerScopeFilter,
  resolveCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { Report, ReportItem, type IReport } from './report-record.model';
import {
  applyReportSafely,
  toReportDto,
  writeReport,
  type ReportItemInput,
} from './report-record.service';

/**
 * The consolidation workflow: several reports, or individual findings from them, reviewed
 * together and signed off as one.
 *
 * A consolidation is a NEW report with its own number, its own narrative and its own
 * DRAFT → SUBMITTED → APPROVED → PUBLISHED chain. The findings are COPIED into its own
 * items, each carrying `sourceReport`/`sourceReportItem`, and the sources are never
 * touched: a consolidated report must keep saying what was found even if a source is
 * later corrected, and a source must keep its own approval untouched by the roll-up that
 * cited it.
 */

type Doc<T> = T & { _id: Types.ObjectId };
type ReportDoc = HydratedDocument<IReport>;

const META_ONLY: RequestMeta = { userAgent: null, ip: null };

/** What an audit row carries for a report, old and new alike. */
function auditSnapshot(report: Doc<IReport>): Record<string, unknown> {
  return {
    status: report.status,
    title: report.title,
    overallScore: report.overallScore,
    riskLevel: report.riskLevel,
    conclusion: report.conclusion,
    recommendation: report.recommendation,
    sourceReportIds: (report.sourceReportIds ?? []).map(String),
    sourceReportItemIds: (report.sourceReportItemIds ?? []).map(String),
    returnReason: report.returnReason,
  };
}

async function dtoOf(report: Doc<IReport>): Promise<ReportDto> {
  const items = await ReportItem.find({ report: report._id });
  return toReportDto(report, items);
}

// -- Creation ----------------------------------------------------------------

/**
 * Whether `candidate` is a worse finding than `held` for the same object.
 *
 * Two selected sources may legitimately both report on one panel — two monthly reports in
 * one quarter, say — and a report holds one item per object. The worst finding is the one
 * kept, matching how every other figure in this domain is combined; keeping the last one
 * loaded would make the outcome depend on read order.
 */
function isWorse(candidate: number | null, held: number | null): boolean {
  if (candidate === null) return false;
  if (held === null) return true;
  return candidate < held;
}

export async function createConsolidatedReport(
  input: ConsolidateReportsInput,
  auth: AuthContext,
  meta: RequestMeta = META_ONLY,
): Promise<ReportDto> {
  const scope = resolveCustomerScope(auth);
  const scoped = customerScopeFilter(scope);

  // A source outside the caller's scope is filtered out here and therefore reads as NOT
  // FOUND below, exactly like a source that never existed. Answering "forbidden" instead
  // would confirm the id is real in another tenant, which is the enumeration oracle the
  // scope filter exists to close.
  const sourceReports = await Report.find({
    _id: { $in: input.sourceReportIds.map((id) => new Types.ObjectId(id)) },
    ...scoped,
  });
  if (sourceReports.length !== input.sourceReportIds.length) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Сонгосон эх тайлан олдсонгүй.');
  }

  const sourceItems = await ReportItem.find({
    _id: { $in: input.sourceReportItemIds.map((id) => new Types.ObjectId(id)) },
    ...scoped,
  });
  if (sourceItems.length !== input.sourceReportItemIds.length) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Сонгосон тайлангийн мөр олдсонгүй.');
  }

  // An item selected directly AND through the report that contains it is a contradiction
  // in the request — the selection said two different things about the same finding — so
  // it is refused rather than silently deduplicated.
  const selectedReportIds = new Set(input.sourceReportIds);
  const contradictions = sourceItems.filter((item) => selectedReportIds.has(String(item.report)));
  if (contradictions.length > 0) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Тайлангийн мөрийг болон түүнийг агуулсан тайланг зэрэг сонгосон байна. Аль нэгийг нь сонгоно уу.',
      contradictions.map((item) => ({
        field: 'sourceReportItemIds',
        message: `Мөр ${String(item._id)} нь сонгосон тайланд аль хэдийн багтсан байна.`,
      })),
    );
  }

  // One consolidation, one customer. Customer is this system's tenant boundary, and a
  // report with no customer cannot be proven to share a tenant with anything, so it only
  // ever consolidates with records that also have none.
  const customerKeys = new Set(
    [...sourceReports, ...sourceItems].map((doc) => (doc.customer ? String(doc.customer) : '')),
  );
  if (customerKeys.size > 1) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Өөр өөр харилцагчийн тайланг нэг нэгтгэлд оруулах боломжгүй.',
    );
  }
  const [customerKey] = customerKeys;
  const sharedCustomer = customerKey ? new Types.ObjectId(customerKey) : null;

  const wholeReportItems = await ReportItem.find({
    report: { $in: sourceReports.map((report) => report._id) },
  });

  const findings = new Map<string, ReportItemInput>();
  for (const item of [...wholeReportItems, ...sourceItems]) {
    const candidate: ReportItemInput = {
      object: item.object,
      score: item.score,
      observation: item.observation,
      conclusion: item.conclusion,
      recommendation: item.recommendation,
      evidenceAttachments: [...item.evidenceAttachments],
      sourceReport: item.report,
      sourceReportItem: item._id,
    };
    const held = findings.get(String(item.object));
    if (!held || isWorse(candidate.score ?? null, held.score ?? null)) {
      findings.set(String(item.object), candidate);
    }
  }

  const report = await writeReport({
    type: 'CONSOLIDATED',
    status: 'DRAFT',
    title: input.title,
    sourceType: 'CONSOLIDATION',
    sourceId: null,
    conclusion: input.conclusion ?? null,
    recommendation: input.recommendation ?? null,
    items: [...findings.values()],
    // Only needed when the sources carried no items at all: with items present the
    // hierarchy is resolved from the equipment they name, which also recovers
    // project/building rather than just the tenant.
    ...(findings.size === 0 ? { hierarchy: { customer: sharedCustomer } } : {}),
    sourceReportIds: sourceReports.map((sourceReport) => sourceReport._id),
    sourceReportItemIds: sourceItems.map((item) => item._id),
    actor: { id: new Types.ObjectId(auth.userId), name: auth.fullName },
    // A consolidation describes the review being performed now, not the dates of the
    // work its sources describe — those live on the sources and the copied items.
    occurredAt: new Date(),
  });

  await recordAudit({
    entityType: 'Report',
    entityId: report._id,
    action: 'Created',
    actor: { id: auth.userId, role: auth.role, label: auth.fullName },
    meta,
    newValue: auditSnapshot(report),
  });

  return dtoOf(report);
}

// -- Workflow ----------------------------------------------------------------

/**
 * The chain every report type shares. Kept here rather than in shared because no other
 * caller moves a report by hand yet; the producers write their status through
 * `writeReport` from their own module's workflow.
 */
const ALLOWED_TRANSITIONS: Record<ReportStatus, readonly ReportStatus[]> = {
  DRAFT: ['SUBMITTED'],
  RETURNED: ['SUBMITTED'],
  SUBMITTED: ['APPROVED', 'RETURNED'],
  APPROVED: ['PUBLISHED'],
  PUBLISHED: [],
};

function assertTransition(report: Doc<IReport>, to: ReportStatus): void {
  if (!ALLOWED_TRANSITIONS[report.status].includes(to)) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      `"${REPORT_STATUS_LABELS[report.status]}" төлөвөөс "${REPORT_STATUS_LABELS[to]}" төлөвт шилжих боломжгүй.`,
      [{ field: 'status', message: 'Төлөвийн шилжилт зөвшөөрөгдөөгүй.' }],
    );
  }
}

/**
 * Scoped to `type: 'CONSOLIDATED'` in the query itself: a producer-owned report moves
 * through its own module's workflow, so through these endpoints it does not exist — and
 * neither does a consolidation in another tenant, for the same anti-enumeration reason
 * as in creation.
 */
async function loadConsolidatedOrThrow(
  reportId: string,
  auth: AuthContext,
): Promise<ReportDoc> {
  const scope = resolveCustomerScope(auth);
  const report = await Report.findOne({
    _id: new Types.ObjectId(reportId),
    type: 'CONSOLIDATED',
    ...customerScopeFilter(scope),
  });
  if (!report) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэгдсэн тайлан олдсонгүй.');
  }
  return report;
}

async function auditTransition(
  action: 'Submitted' | 'Approved' | 'Returned' | 'Published',
  report: Doc<IReport>,
  oldValue: Record<string, unknown>,
  auth: AuthContext,
  meta: RequestMeta,
  reason: string | null = null,
): Promise<void> {
  await recordAudit({
    entityType: 'Report',
    entityId: report._id,
    action,
    actor: { id: auth.userId, role: auth.role, label: auth.fullName },
    meta,
    reason,
    oldValue,
    newValue: auditSnapshot(report),
  });
}

export async function submitConsolidatedReport(
  reportId: string,
  auth: AuthContext,
  meta: RequestMeta = META_ONLY,
): Promise<ReportDto> {
  const report = await loadConsolidatedOrThrow(reportId, auth);
  assertTransition(report, 'SUBMITTED');

  const before = auditSnapshot(report);
  report.status = 'SUBMITTED';
  report.submittedBy = new Types.ObjectId(auth.userId);
  report.submittedByName = auth.fullName;
  report.submittedAt = new Date();
  // A resubmission reads as pending review rather than still returned.
  report.returnReason = null;
  await report.save();

  await auditTransition('Submitted', report, before, auth, meta);
  return dtoOf(report);
}

export async function approveConsolidatedReport(
  reportId: string,
  auth: AuthContext,
  meta: RequestMeta = META_ONLY,
): Promise<ReportDto> {
  const report = await loadConsolidatedOrThrow(reportId, auth);
  assertTransition(report, 'APPROVED');

  const before = auditSnapshot(report);
  report.status = 'APPROVED';
  report.approvedBy = new Types.ObjectId(auth.userId);
  report.approvedByName = auth.fullName;
  report.approvedAt = new Date();
  await report.save();

  // Approval is what makes the findings believed, so this is the moment a consolidated
  // finding reaches the equipment it describes, like any other report's.
  await applyReportSafely(report._id);

  await auditTransition('Approved', report, before, auth, meta);
  return dtoOf(report);
}

export async function returnConsolidatedReport(
  reportId: string,
  input: ReturnReportInput,
  auth: AuthContext,
  meta: RequestMeta = META_ONLY,
): Promise<ReportDto> {
  const report = await loadConsolidatedOrThrow(reportId, auth);
  assertTransition(report, 'RETURNED');

  const before = auditSnapshot(report);
  report.status = 'RETURNED';
  report.returnedBy = new Types.ObjectId(auth.userId);
  report.returnedByName = auth.fullName;
  report.returnedAt = new Date();
  report.returnReason = input.reason;
  await report.save();

  await auditTransition('Returned', report, before, auth, meta, input.reason);
  return dtoOf(report);
}

export async function publishConsolidatedReport(
  reportId: string,
  auth: AuthContext,
  meta: RequestMeta = META_ONLY,
): Promise<ReportDto> {
  const report = await loadConsolidatedOrThrow(reportId, auth);
  assertTransition(report, 'PUBLISHED');

  const before = auditSnapshot(report);
  report.status = 'PUBLISHED';
  report.publishedBy = new Types.ObjectId(auth.userId);
  report.publishedByName = auth.fullName;
  report.publishedAt = new Date();
  await report.save();

  // No second push to equipment: approval already applied the findings, and PUBLISHED
  // only widens who may read them.
  await auditTransition('Published', report, before, auth, meta);
  return dtoOf(report);
}
