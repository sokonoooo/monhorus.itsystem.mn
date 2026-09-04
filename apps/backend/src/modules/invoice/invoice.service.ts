import {
  PERMISSIONS,
  SETTING_KEYS,
  canTransitionInvoice,
  type CancelInvoiceInput,
  type CreateInvoiceInput,
  type GenerateMonthlyInvoicesInput,
  type InvoiceDetailDto,
  type InvoiceEffectiveStatus,
  type InvoiceGenerationCandidateDto,
  type InvoiceGenerationPreviewDto,
  type InvoiceLineDto,
  type InvoiceListItemDto,
  type InvoiceListQueryInput,
  type InvoiceStatus,
  type InvoiceSummaryDto,
  type PaginatedData,
  type RecordInvoicePaymentInput,
  type SendInvoiceInput,
  type UpdateInvoiceInput,
} from '@monhorus/shared';
import { Types, type FilterQuery, type HydratedDocument } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import { creatorName } from '../../common/utils/creator.util';
import { dayBounds } from '../../common/utils/day-bounds.util';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { env } from '../../config/env';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { Customer } from '../objects/object.models';
import {
  ServiceAgreement,
  type IServiceAgreement,
} from '../service-agreement/service-agreement.model';
import { getSettings } from '../settings/settings.service';
import { Invoice, nextInvoiceNumber, type IInvoice, type IInvoiceLine } from './invoice.model';

type Doc<T> = HydratedDocument<T>;
type WithId<T> = T & { _id: Types.ObjectId };

const ENTITY = 'Invoice';

/** Amounts are whole currency units; MNT has no minor unit in practice. */
function round(value: number): number {
  return Math.round(value);
}

/** A MongoDB unique-index violation, whatever wrapper mongoose put around it. */
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

function nameOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('name' in value)) return null;
  return String((value as { name: unknown }).name);
}

function idOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Types.ObjectId) return String(value);
  if (typeof value === 'object' && '_id' in value) {
    return String((value as { _id: unknown })._id);
  }
  return String(value);
}

function numberOf(value: unknown, field: string): string | null {
  if (typeof value !== 'object' || value === null || !(field in value)) return null;
  return String((value as Record<string, unknown>)[field]);
}

/**
 * The last instant of the due date, as an Ulaanbaatar calendar day.
 *
 * `dueDate` is stored as a calendar date stamped at UTC midnight, so `setUTCHours(23,59…)`
 * closed the day eight hours early: between 00:00 and 08:00 local the invoice list still
 * called an invoice SENT while the dashboard — which has always framed the same question
 * with `dayBounds(now, APP_TIMEZONE)` — already counted it OVERDUE. Two surfaces, one
 * invoice, two answers, for a third of every day. The day is now framed the way the rest
 * of the product frames a day.
 */
function dueEndOf(dueDate: Date): Date {
  return dayBounds(dueDate, env.APP_TIMEZONE).end;
}

/**
 * The instant an invoice becomes overdue is the start of today, locally: an invoice due
 * yesterday or earlier is overdue, one due today is not.
 *
 * Exported because the list filter, the receivables roll-up and `effectiveInvoiceStatus`
 * must all frame the same boundary, and because `dashboard.service.ts` reaches the same
 * instant by the same expression. A test pins the three together across the whole day.
 */
export function overdueBoundary(now: Date = new Date()): Date {
  return dayBounds(now, env.APP_TIMEZONE).start;
}

/**
 * Requirements 12.3 OVERDUE, derived rather than stored.
 *
 * Only a SENT invoice can become overdue: a draft has not been issued and a paid or
 * cancelled invoice is settled. The comparison is against the end of the due date, so an
 * invoice is not overdue on the day it falls due.
 */
export function effectiveInvoiceStatus(
  invoice: Pick<IInvoice, 'status' | 'dueDate'>,
  now: Date = new Date(),
): InvoiceEffectiveStatus {
  if (invoice.status !== 'SENT') return invoice.status;
  return now > dueEndOf(invoice.dueDate) ? 'OVERDUE' : 'SENT';
}

export function overdueDaysOf(
  invoice: Pick<IInvoice, 'status' | 'dueDate'>,
  now: Date = new Date(),
): number | null {
  if (effectiveInvoiceStatus(invoice, now) !== 'OVERDUE') return null;
  const dueEnd = dueEndOf(invoice.dueDate);
  return Math.floor((now.getTime() - dueEnd.getTime()) / 86_400_000) + 1;
}

function toLineDto(line: IInvoiceLine): InvoiceLineDto {
  return {
    id: String(line._id),
    source: line.source,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.amount,
  };
}

function toListItemDto(invoice: WithId<IInvoice>, now: Date): InvoiceListItemDto {
  return {
    id: String(invoice._id),
    invoiceNumber: invoice.invoiceNumber,
    customerId: idOf(invoice.customer) ?? '',
    customerName: nameOf(invoice.customer),
    billingType: invoice.billingType,
    billingPeriod: invoice.billingPeriod,
    issueDate: invoice.issueDate.toISOString(),
    dueDate: invoice.dueDate.toISOString(),
    subtotal: invoice.subtotal,
    taxAmount: invoice.taxAmount,
    total: invoice.total,
    currency: invoice.currency,
    status: invoice.status,
    effectiveStatus: effectiveInvoiceStatus(invoice, now),
    overdueDays: overdueDaysOf(invoice, now),
    createdByName: creatorName(invoice.createdBy, invoice.createdByName),
    createdAt: invoice.createdAt.toISOString(),
  };
}

function deleteBlockersOf(invoice: WithId<IInvoice>): string[] {
  // A draft has never left the building; anything else is a record of something that
  // already happened and is corrected by cancelling, not by deleting.
  if (invoice.status === 'DRAFT') return [];
  return ['Ноорогоос өөр төлөвт шилжсэн нэхэмжлэлийг устгахгүй. Цуцлах үйлдлийг ашиглана уу.'];
}

async function toDetailDto(invoice: WithId<IInvoice>, now: Date): Promise<InvoiceDetailDto> {
  const replacedBy = await Invoice.findOne({ replacesInvoice: invoice._id })
    .select('invoiceNumber')
    .lean();

  return {
    ...toListItemDto(invoice, now),
    serviceAgreementId: idOf(invoice.serviceAgreement),
    serviceAgreementNumber: numberOf(invoice.serviceAgreement, 'agreementNumber'),
    lines: invoice.lines.map(toLineDto),
    taxPercent: invoice.taxPercent,
    notes: invoice.notes,
    sentAt: invoice.sentAt?.toISOString() ?? null,
    payment:
      invoice.paidAt && invoice.paymentMethod && invoice.paymentReference
        ? {
            paidAt: invoice.paidAt.toISOString(),
            method: invoice.paymentMethod,
            reference: invoice.paymentReference,
            amount: invoice.paymentAmount ?? invoice.total,
            recordedByName: invoice.paymentRecordedByName,
          }
        : null,
    cancelledAt: invoice.cancelledAt?.toISOString() ?? null,
    cancelReason: invoice.cancelReason,
    replacesInvoiceId: idOf(invoice.replacesInvoice),
    replacesInvoiceNumber: numberOf(invoice.replacesInvoice, 'invoiceNumber'),
    replacedByInvoiceId: replacedBy ? String(replacedBy._id) : null,
    replacedByInvoiceNumber: replacedBy?.invoiceNumber ?? null,
    statusHistory: invoice.statusHistory.map((entry) => ({
      id: String(entry._id),
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      reason: entry.reason,
      changedByName: entry.changedByName,
      changedAt: entry.changedAt.toISOString(),
    })),
    createdByName: invoice.createdByName,
    updatedAt: invoice.updatedAt.toISOString(),
    deleteBlockers: deleteBlockersOf(invoice),
  };
}

const POPULATE = [
  { path: 'customer', select: 'name' },
  { path: 'serviceAgreement', select: 'agreementNumber monthlyFee currency' },
  { path: 'replacesInvoice', select: 'invoiceNumber' },
];

/** Tax rate and currency in force right now, requirements 12.2 and 16.1. */
async function financeContext(): Promise<{ taxPercent: number; currency: string }> {
  const settings = await getSettings();
  return {
    taxPercent: Number(settings[SETTING_KEYS.FINANCE_TAX_PERCENT]),
    currency: String(settings[SETTING_KEYS.CURRENCY]),
  };
}

/** Requirements 12.2: lines sum to the subtotal, tax applies to it, total is the sum. */
function totalsOf(
  lines: readonly { amount: number }[],
  taxPercent: number,
): { subtotal: number; taxAmount: number; total: number } {
  const subtotal = round(lines.reduce((sum, line) => sum + line.amount, 0));
  const taxAmount = round((subtotal * taxPercent) / 100);
  return { subtotal, taxAmount, total: subtotal + taxAmount };
}

function buildLines(
  input: readonly { description: string; quantity: number; unitPrice: number }[],
): Pick<IInvoiceLine, 'source' | 'description' | 'quantity' | 'unitPrice' | 'amount'>[] {
  return input.map((line) => ({
    source: 'MANUAL' as const,
    description: line.description,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: round(line.quantity * line.unitPrice),
  }));
}

function actorOf(actor: AuthContext): {
  id: string;
  role: AuthContext['role'];
  label: string | null;
} {
  return { id: actor.userId, role: actor.role, label: actor.fullName ?? null };
}

// -- Read ---------------------------------------------------------------------

export async function listInvoices(
  query: InvoiceListQueryInput,
  /** Injectable so a test can walk a whole day; production never passes it. */
  now: Date = new Date(),
): Promise<PaginatedData<InvoiceListItemDto> & { summary: InvoiceSummaryDto }> {
  const filter: FilterQuery<IInvoice> = {};

  if (query.customerId) filter.customer = new Types.ObjectId(query.customerId);
  if (query.billingType) filter.billingType = query.billingType;
  if (query.search) {
    filter.invoiceNumber = new RegExp(query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  }
  if (query.periodFrom || query.periodTo) {
    filter.billingPeriod = {
      ...(query.periodFrom ? { $gte: query.periodFrom } : {}),
      ...(query.periodTo ? { $lte: query.periodTo } : {}),
    };
  }

  /**
   * OVERDUE is derived, so it cannot be a plain equality on `status`. It is expressed as
   * the condition that defines it, which keeps the filter in the database and the page
   * count honest rather than filtering after pagination.
   */
  if (query.status === 'OVERDUE') {
    filter.status = 'SENT';
    filter.dueDate = { $lt: overdueBoundary(now) };
  } else if (query.status === 'SENT') {
    filter.status = 'SENT';
    filter.dueDate = { $gte: overdueBoundary(now) };
  } else if (query.status) {
    filter.status = query.status as InvoiceStatus;
  }

  const skip = (query.page - 1) * query.limit;
  const [rows, total, summary] = await Promise.all([
    Invoice.find(filter)
      .populate(POPULATE)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(query.limit)
      .lean<WithId<IInvoice>[]>(),
    Invoice.countDocuments(filter),
    summariseInvoices(
      query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {},
      now,
    ),
  ]);

  return {
    items: rows.map((row) => toListItemDto(row, now)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
    summary,
  };
}

/** Receivables roll-up, requirements 15.1 and 15.3. */
export async function summariseInvoices(
  filter: FilterQuery<IInvoice> = {},
  now: Date = new Date(),
): Promise<InvoiceSummaryDto> {
  const dueBoundary = overdueBoundary(now);
  const { currency } = await financeContext();

  const rows = await Invoice.aggregate<{ _id: InvoiceStatus; count: number; total: number }>([
    { $match: filter },
    { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } },
  ]);

  const overdue = await Invoice.aggregate<{ count: number; total: number }>([
    { $match: { ...filter, status: 'SENT', dueDate: { $lt: dueBoundary } } },
    { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$total' } } },
  ]);

  const byStatus = new Map(rows.map((row) => [row._id, row]));
  const sent = byStatus.get('SENT');
  const paid = byStatus.get('PAID');
  const overdueRow = overdue[0];

  return {
    draftCount: byStatus.get('DRAFT')?.count ?? 0,
    sentCount: sent?.count ?? 0,
    paidCount: paid?.count ?? 0,
    overdueCount: overdueRow?.count ?? 0,
    cancelledCount: byStatus.get('CANCELLED')?.count ?? 0,
    // Section 15.3 defines the receivable as issued but unpaid, which includes the
    // overdue portion rather than excluding it.
    receivableTotal: sent?.total ?? 0,
    overdueTotal: overdueRow?.total ?? 0,
    paidTotal: paid?.total ?? 0,
    currency,
  };
}

export async function getInvoice(invoiceId: string): Promise<InvoiceDetailDto> {
  const invoice = await Invoice.findById(invoiceId)
    .populate(POPULATE)
    .lean<WithId<IInvoice> | null>();
  if (!invoice) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');
  }
  return toDetailDto(invoice, new Date());
}

// -- Generation preview -------------------------------------------------------

/**
 * The half-open UTC bounds of a `YYYY-MM` billing period.
 *
 * UTC rather than `APP_TIMEZONE` because a billing period is a calendar label, not an
 * instant: "2026-08" is the same month for every reader, and pinning it to a zone would
 * make the set of billable agreements depend on when the run happened to be started.
 * `billingPeriod` is already regex-validated to `^\d{4}-(0[1-9]|1[0-2])$` by the schema
 * and by the model, so this cannot receive a malformed value.
 */
function billingPeriodBounds(billingPeriod: string): { start: Date; end: Date } {
  const year = Number(billingPeriod.slice(0, 4));
  const month = Number(billingPeriod.slice(5, 7));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    // First instant of the next month; compared with `$lt`, so the whole month is covered.
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/**
 * The agreements a monthly run may bill for a given period.
 *
 * ACTIVE is necessary but NOT sufficient, and that gap is what this exists to close.
 * `EXPIRED` is a declared `ServiceAgreementStatus` that **nothing in the backend ever
 * writes** — there is no expiry sweep — so an agreement whose term ended years ago is
 * still sitting at ACTIVE. Filtering on status alone therefore kept generating a monthly
 * invoice for it, for ever, and the customer received a real bill for a contract that had
 * finished. Requirements 12.1 bills a *service period*, so the term has to be part of the
 * predicate rather than a status anyone has to remember to maintain.
 *
 * The test is overlap, not containment: an agreement that ends mid-month was in force for
 * part of that month and still bills it. Only an agreement whose term ended before the
 * period opened — or had not started when it closed — is excluded.
 */
function billableAgreementFilter(billingPeriod: string): FilterQuery<IServiceAgreement> {
  const { start, end } = billingPeriodBounds(billingPeriod);
  return {
    status: 'ACTIVE',
    startDate: { $lt: end },
    endDate: { $gte: start },
  };
}

/**
 * The already-invoiced agreements for a period, keyed by agreement id.
 *
 * Keyed by AGREEMENT, not by customer. The preview has always returned one row per
 * agreement while the clash lookup was keyed on the customer, so a customer holding two
 * agreements had both rows marked as already invoiced the moment either one was billed —
 * and, worse, the generator only ever billed one of them. Preview and generation now ask
 * the same question of the same key, which is the only way the two can agree.
 *
 * A MONTHLY_SERVICE invoice entered by hand with no agreement attached is deliberately not
 * treated as a clash: it is not this agreement's monthly bill, nothing can tell which
 * agreement it was meant for, and treating it as one would put the preview back out of
 * step with the run.
 */
async function invoicedAgreements(
  billingPeriod: string,
): Promise<Map<string, { _id: Types.ObjectId; invoiceNumber: string }>> {
  const existing = await Invoice.find({
    billingPeriod,
    billingType: 'MONTHLY_SERVICE',
    serviceAgreement: { $ne: null },
    status: { $ne: 'CANCELLED' },
  })
    .select('serviceAgreement invoiceNumber')
    .lean();

  return new Map(existing.map((row) => [String(row.serviceAgreement), row]));
}

/**
 * What a monthly run would produce, requirements 12.1.
 *
 * Only an ACTIVE agreement whose term covers the period is billable — see
 * `billableAgreementFilter`. One row per agreement: a customer with a head office and a
 * warehouse holds two agreements and owes two monthly fees. An agreement whose period is
 * already invoiced is returned with the clash attached rather than omitted, so the
 * operator sees why.
 */
export async function previewMonthlyInvoices(
  billingPeriod: string,
): Promise<InvoiceGenerationPreviewDto> {
  const { taxPercent } = await financeContext();

  const agreements = await ServiceAgreement.find(billableAgreementFilter(billingPeriod))
    .populate({ path: 'customer', select: 'name' })
    .sort({ agreementNumber: 1 })
    .lean();

  const existingByAgreement = await invoicedAgreements(billingPeriod);

  const candidates: InvoiceGenerationCandidateDto[] = agreements.map((agreement) => {
    const clash = existingByAgreement.get(String(agreement._id));
    return {
      customerId: idOf(agreement.customer) ?? '',
      customerName: nameOf(agreement.customer) ?? '-',
      serviceAgreementId: String(agreement._id),
      serviceAgreementNumber: agreement.agreementNumber,
      monthlyFee: agreement.monthlyFee,
      currency: agreement.currency,
      existingInvoiceId: clash ? String(clash._id) : null,
      existingInvoiceNumber: clash?.invoiceNumber ?? null,
    };
  });

  return { billingPeriod, taxPercent, candidates };
}

// -- Write --------------------------------------------------------------------

/**
 * Requirements 12.3 no-duplicate, asked with the same key the unique index enforces:
 * customer + agreement + period + type.
 *
 * The agreement is part of the key because a customer can legitimately hold more than one
 * ACTIVE agreement — a head office and a warehouse — and each owes its own monthly fee.
 * Keyed on the customer alone, the second agreement's invoice was refused for ever and the
 * money it represented could never be billed for that period.
 *
 * An invoice with no agreement keys on `null`, which is a single slot per customer, period
 * and type: two hand-entered invoices for the same customer, period and type still clash,
 * exactly as before.
 */
async function assertNoDuplicate(
  customerId: Types.ObjectId,
  serviceAgreementId: Types.ObjectId | null,
  billingPeriod: string,
  billingType: string,
): Promise<void> {
  const clash = await Invoice.findOne({
    customer: customerId,
    serviceAgreement: serviceAgreementId,
    billingPeriod,
    billingType,
    status: { $ne: 'CANCELLED' },
  })
    .select('invoiceNumber')
    .lean();

  if (clash) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Энэ харилцагчид ${billingPeriod} тайлант үед ${clash.invoiceNumber} нэхэмжлэл аль хэдийн үүссэн байна.`,
    );
  }
}

export async function createInvoice(
  input: CreateInvoiceInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InvoiceDetailDto> {
  const customerId = new Types.ObjectId(input.customerId);
  const customer = await Customer.findById(customerId).select('name').lean();
  if (!customer) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Харилцагч олдсонгүй.');
  }

  const serviceAgreementId = input.serviceAgreementId
    ? new Types.ObjectId(input.serviceAgreementId)
    : null;
  await assertNoDuplicate(
    customerId,
    serviceAgreementId,
    input.billingPeriod,
    input.billingType,
  );

  const { taxPercent, currency } = await financeContext();
  const lines = buildLines(input.lines);
  const totals = totalsOf(lines, taxPercent);

  const invoice = await Invoice.create({
    invoiceNumber: await nextInvoiceNumber(),
    customer: customerId,
    serviceAgreement: serviceAgreementId,
    billingType: input.billingType,
    billingPeriod: input.billingPeriod,
    issueDate: new Date(input.issueDate),
    dueDate: new Date(input.dueDate),
    lines,
    taxPercent,
    ...totals,
    currency,
    status: 'DRAFT',
    statusHistory: [
      {
        fromStatus: null,
        toStatus: 'DRAFT',
        reason: null,
        changedBy: new Types.ObjectId(actor.userId),
        changedByName: actor.fullName ?? null,
        changedAt: new Date(),
      },
    ],
    replacesInvoice: input.replacesInvoiceId
      ? new Types.ObjectId(input.replacesInvoiceId)
      : null,
    notes: input.notes ?? null,
    createdBy: new Types.ObjectId(actor.userId),
    createdByName: actor.fullName ?? null,
  });

  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: {
      invoiceNumber: invoice.invoiceNumber,
      customer: customer.name,
      billingPeriod: invoice.billingPeriod,
      total: invoice.total,
    },
  });

  return getInvoice(String(invoice._id));
}

/** One skipped row of a monthly run, named by the agreement it belongs to. */
export interface SkippedGeneration {
  /** Kept first and unchanged: the web reads this field. */
  customerId: string;
  /** Null only when the customer had no billable agreement at all. */
  serviceAgreementId: string | null;
  serviceAgreementNumber: string | null;
  reason: string;
}

/**
 * Generates one monthly invoice per billable AGREEMENT of each selected customer.
 *
 * The run used to be keyed on the customer: it took a customer id list and did a single
 * `findOne` for an agreement, in index order and without a sort. A customer holding two
 * ACTIVE agreements — a head office at ₮2,400,000 and a warehouse at ₮600,000 — was shown
 * two rows totalling ₮3,000,000 by the preview, and then billed for exactly one of them,
 * whichever the index happened to return first. There was no skipped entry, the run
 * reported success, and the unique index on (customer, period, type) then refused the
 * second invoice for ever, so the missing ₮2,400,000 could never be billed for that
 * period. Every step below is keyed on the agreement id instead, which is the thing an
 * invoice is actually for.
 *
 * The request body still carries `customerIds`, so the web needs no change to keep
 * working: a ticked customer now bills every agreement of theirs that the preview listed.
 *
 * Each agreement is processed independently: a duplicate on one must not abandon the rest
 * of the run, so failures are collected and reported rather than thrown.
 */
export async function generateMonthlyInvoices(
  input: GenerateMonthlyInvoicesInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<{ created: InvoiceListItemDto[]; skipped: SkippedGeneration[] }> {
  const { taxPercent, currency } = await financeContext();
  const created: InvoiceListItemDto[] = [];
  const skipped: SkippedGeneration[] = [];
  const now = new Date();

  // De-duplicated because the same customer twice in the body must not mean two runs.
  const customerIds = [...new Set(input.customerIds)];

  // The same predicate the preview uses. Re-applied here rather than trusted from the
  // preview because this endpoint takes an id list and is callable on its own, so a stale
  // preview must not be able to bill a term that has since ended.
  //
  // Sorted by agreement number so a run is deterministic: the previous `findOne` had no
  // sort at all, which is how the choice of which agreement got billed came down to index
  // order.
  const agreements = await ServiceAgreement.find({
    customer: { $in: customerIds.map((id) => new Types.ObjectId(id)) },
    ...billableAgreementFilter(input.billingPeriod),
  })
    .populate({ path: 'customer', select: 'name' })
    .sort({ agreementNumber: 1 })
    .lean();

  // A customer with nothing billable is still reported, as before — silence is what made
  // the original bug invisible.
  const billableCustomers = new Set(agreements.map((agreement) => idOf(agreement.customer) ?? ''));
  for (const customerId of customerIds) {
    if (billableCustomers.has(customerId)) continue;
    skipped.push({
      customerId,
      serviceAgreementId: null,
      serviceAgreementNumber: null,
      reason: 'Тухайн тайлант үед хүчинтэй үйлчилгээний нөхцөл олдсонгүй.',
    });
  }

  for (const agreement of agreements) {
    const customerId = idOf(agreement.customer) ?? '';
    const customerObjectId = new Types.ObjectId(customerId);
    const skip = (reason: string): void => {
      skipped.push({
        customerId,
        serviceAgreementId: String(agreement._id),
        serviceAgreementNumber: agreement.agreementNumber,
        reason,
      });
    };

    try {
      await assertNoDuplicate(
        customerObjectId,
        agreement._id,
        input.billingPeriod,
        'MONTHLY_SERVICE',
      );
    } catch {
      skip(`${agreement.agreementNumber} нөхцөлд энэ тайлант үед нэхэмжлэл аль хэдийн үүссэн.`);
      continue;
    }

    const lines = [
      {
        source: 'AGREEMENT_MONTHLY_FEE' as const,
        description: `Сарын тогтмол төлбөр · ${agreement.agreementNumber} · ${input.billingPeriod}`,
        quantity: 1,
        unitPrice: agreement.monthlyFee,
        amount: round(agreement.monthlyFee),
      },
    ];
    const totals = totalsOf(lines, taxPercent);

    let invoice;
    try {
      invoice = await Invoice.create({
        invoiceNumber: await nextInvoiceNumber(now),
        customer: customerObjectId,
        serviceAgreement: agreement._id,
        billingType: 'MONTHLY_SERVICE',
        billingPeriod: input.billingPeriod,
        issueDate: new Date(input.issueDate),
        dueDate: new Date(input.dueDate),
        lines,
        taxPercent,
        ...totals,
        currency,
        status: 'DRAFT',
        statusHistory: [
          {
            fromStatus: null,
            toStatus: 'DRAFT',
            reason: 'Сарын нэхэмжлэл автоматаар боловсруулсан.',
            changedBy: new Types.ObjectId(actor.userId),
            changedByName: actor.fullName ?? null,
            changedAt: now,
          },
        ],
        createdBy: new Types.ObjectId(actor.userId),
        createdByName: actor.fullName ?? null,
      });
    } catch (error) {
      // The pre-check above loses to a concurrent run; the unique index is what actually
      // decides. A refused write is reported as a skip rather than abandoning the rest of
      // the run — and, crucially, rather than being counted as created.
      if (isDuplicateKey(error)) {
        skip(`${agreement.agreementNumber} нөхцөлд энэ тайлант үед нэхэмжлэл аль хэдийн үүссэн.`);
        continue;
      }
      throw error;
    }

    await recordAudit({
      entityType: ENTITY,
      entityId: invoice._id,
      action: 'Created',
      actor: actorOf(actor),
      meta,
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        billingPeriod: invoice.billingPeriod,
        serviceAgreement: agreement.agreementNumber,
        total: invoice.total,
        source: 'MONTHLY_RUN',
      },
    });

    const populated = await Invoice.findById(invoice._id)
      .populate(POPULATE)
      .lean<WithId<IInvoice>>();
    if (populated) created.push(toListItemDto(populated, now));
  }

  return { created, skipped };
}

function loadDraft(invoice: Doc<IInvoice> | null): Doc<IInvoice> {
  if (!invoice) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');
  }
  if (invoice.status !== 'DRAFT') {
    throw AppError.conflict(
      ERROR_CODES.VALIDATION_ERROR,
      'Зөвхөн ноорог нэхэмжлэлийг засна. Илгээсэн нэхэмжлэлийг цуцалж, шинээр үүсгэнэ.',
    );
  }
  return invoice;
}

export async function updateInvoice(
  invoiceId: string,
  input: UpdateInvoiceInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InvoiceDetailDto> {
  const invoice = loadDraft(await Invoice.findById(invoiceId));
  const before = { total: invoice.total, lines: invoice.lines.length, dueDate: invoice.dueDate };

  if (input.issueDate) invoice.issueDate = new Date(input.issueDate);
  if (input.dueDate) invoice.dueDate = new Date(input.dueDate);
  if (input.notes !== undefined) invoice.notes = input.notes ?? null;

  if (input.lines) {
    // The tax rate is re-read rather than reused: a draft edited after a rate change must
    // bill at the rate in force when it is finally issued.
    const { taxPercent } = await financeContext();
    invoice.set('lines', buildLines(input.lines));
    const totals = totalsOf(invoice.lines, taxPercent);
    invoice.taxPercent = taxPercent;
    invoice.subtotal = totals.subtotal;
    invoice.taxAmount = totals.taxAmount;
    invoice.total = totals.total;
  }

  await invoice.save();

  // Section 12.3: a price change after the invoice exists creates its own audit entry.
  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: { total: invoice.total, lines: invoice.lines.length, dueDate: invoice.dueDate },
  });

  return getInvoice(invoiceId);
}

async function transition(
  invoice: Doc<IInvoice>,
  to: InvoiceStatus,
  reason: string | null,
  actor: AuthContext,
): Promise<void> {
  if (!canTransitionInvoice(invoice.status, to)) {
    throw AppError.conflict(
      ERROR_CODES.VALIDATION_ERROR,
      `"${invoice.status}" төлвөөс "${to}" төлөвт шилжих боломжгүй.`,
    );
  }
  invoice.statusHistory.push({
    _id: new Types.ObjectId(),
    fromStatus: invoice.status,
    toStatus: to,
    reason,
    changedBy: new Types.ObjectId(actor.userId),
    changedByName: actor.fullName ?? null,
    changedAt: new Date(),
  });
  invoice.status = to;
}

export async function sendInvoice(
  invoiceId: string,
  input: SendInvoiceInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InvoiceDetailDto> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');

  if (input.dueDate) invoice.dueDate = new Date(input.dueDate);
  await transition(invoice, 'SENT', null, actor);
  invoice.sentAt = new Date();
  await invoice.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    oldValue: { status: 'DRAFT' },
    newValue: { status: 'SENT', dueDate: invoice.dueDate, total: invoice.total },
  });

  // Section 14.3: invoice issued -> админ.
  await notify({
    event: 'INVOICE_ISSUED',
    title: `${invoice.invoiceNumber} нэхэмжлэл илгээгдлээ`,
    body: `Төлөх дүн ${invoice.total.toLocaleString('mn-MN')} ${invoice.currency}.`,
    entityType: ENTITY,
    entityId: invoice._id,
    linkPath: `/invoices/${String(invoice._id)}`,
    permission: PERMISSIONS.INVOICE_VIEW,
  });

  return getInvoice(invoiceId);
}

export async function recordPayment(
  invoiceId: string,
  input: RecordInvoicePaymentInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InvoiceDetailDto> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');

  // Requirements 12.3: the payment amount must equal the invoice total. V1 has no
  // partial payment, so a mismatch is rejected rather than stored as a balance.
  if (round(input.amount) !== invoice.total) {
    throw AppError.badRequest(
      ERROR_CODES.VALIDATION_ERROR,
      'Төлбөрийн дүн нэхэмжлэлийн нийт дүнтэй тэнцүү байх ёстой.',
      [{ field: 'amount', message: `Нийт дүн ${invoice.total.toLocaleString('mn-MN')}.` }],
    );
  }

  // Requirements 12.3 asks for a warning on a duplicate reference, not a refusal: the
  // same bank reference can legitimately settle a re-issued invoice.
  const duplicateReference = await Invoice.findOne({
    _id: { $ne: invoice._id },
    paymentReference: input.reference,
  })
    .select('invoiceNumber')
    .lean();

  await transition(
    invoice,
    'PAID',
    duplicateReference
      ? `Гүйлгээний дугаар ${duplicateReference.invoiceNumber} дээр давхардсан.`
      : null,
    actor,
  );
  invoice.paidAt = new Date(input.paidAt);
  invoice.paymentMethod = input.method;
  invoice.paymentReference = input.reference;
  invoice.paymentAmount = round(input.amount);
  invoice.paymentRecordedBy = new Types.ObjectId(actor.userId);
  invoice.paymentRecordedByName = actor.fullName ?? null;
  await invoice.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'StatusChanged',
    actor: actorOf(actor),
    meta,
    oldValue: { status: 'SENT' },
    newValue: {
      status: 'PAID',
      method: input.method,
      reference: input.reference,
      amount: invoice.paymentAmount,
    },
    reason: duplicateReference
      ? `Анхаар: гүйлгээний дугаар ${duplicateReference.invoiceNumber} дээр давхардсан.`
      : null,
  });

  return getInvoice(invoiceId);
}

export async function cancelInvoice(
  invoiceId: string,
  input: CancelInvoiceInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<InvoiceDetailDto> {
  const invoice = await Invoice.findById(invoiceId);
  if (!invoice) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');

  const from = invoice.status;
  await transition(invoice, 'CANCELLED', input.reason, actor);
  invoice.cancelledAt = new Date();
  invoice.cancelReason = input.reason;
  await invoice.save();

  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'Cancelled',
    actor: actorOf(actor),
    meta,
    oldValue: { status: from },
    newValue: { status: 'CANCELLED' },
    reason: input.reason,
  });

  return getInvoice(invoiceId);
}

export async function deleteInvoice(
  invoiceId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const invoice = await Invoice.findById(invoiceId).lean<WithId<IInvoice> | null>();
  if (!invoice) throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Нэхэмжлэл олдсонгүй.');

  const blockers = deleteBlockersOf(invoice);
  if (blockers.length > 0) {
    throw AppError.conflict(ERROR_CODES.VALIDATION_ERROR, blockers[0] ?? 'Устгах боломжгүй.');
  }

  await Invoice.deleteOne({ _id: invoice._id });
  await recordAudit({
    entityType: ENTITY,
    entityId: invoice._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: { invoiceNumber: invoice.invoiceNumber, status: invoice.status },
    newValue: null,
    reason: 'Ноорог нэхэмжлэл устгасан.',
  });
}
