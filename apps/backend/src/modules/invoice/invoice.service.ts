import {
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
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { notify } from '../notification/notification.service';
import { Customer } from '../objects/object.models';
import { ServiceAgreement } from '../service-agreement/service-agreement.model';
import { getSettings } from '../settings/settings.service';
import { Invoice, nextInvoiceNumber, type IInvoice, type IInvoiceLine } from './invoice.model';

type Doc<T> = HydratedDocument<T>;
type WithId<T> = T & { _id: Types.ObjectId };

const ENTITY = 'Invoice';

/** Amounts are whole currency units; MNT has no minor unit in practice. */
function round(value: number): number {
  return Math.round(value);
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
  const dueEnd = new Date(invoice.dueDate);
  dueEnd.setUTCHours(23, 59, 59, 999);
  return now > dueEnd ? 'OVERDUE' : 'SENT';
}

export function overdueDaysOf(
  invoice: Pick<IInvoice, 'status' | 'dueDate'>,
  now: Date = new Date(),
): number | null {
  if (effectiveInvoiceStatus(invoice, now) !== 'OVERDUE') return null;
  const dueEnd = new Date(invoice.dueDate);
  dueEnd.setUTCHours(23, 59, 59, 999);
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
): Promise<PaginatedData<InvoiceListItemDto> & { summary: InvoiceSummaryDto }> {
  const now = new Date();
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
    filter.dueDate = { $lt: startOfDay(now) };
  } else if (query.status === 'SENT') {
    filter.status = 'SENT';
    filter.dueDate = { $gte: startOfDay(now) };
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
    summariseInvoices(query.customerId ? { customer: new Types.ObjectId(query.customerId) } : {}),
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

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

/** Receivables roll-up, requirements 15.1 and 15.3. */
export async function summariseInvoices(
  filter: FilterQuery<IInvoice> = {},
): Promise<InvoiceSummaryDto> {
  const now = new Date();
  const dueBoundary = startOfDay(now);
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
 * What a monthly run would produce, requirements 12.1.
 *
 * Only an ACTIVE agreement is billable, matching the rule the agreement module already
 * enforces for calendar generation. A customer whose period is already invoiced is
 * returned with the clash attached rather than omitted, so the operator sees why.
 */
export async function previewMonthlyInvoices(
  billingPeriod: string,
): Promise<InvoiceGenerationPreviewDto> {
  const { taxPercent } = await financeContext();

  const agreements = await ServiceAgreement.find({ status: 'ACTIVE' })
    .populate({ path: 'customer', select: 'name' })
    .sort({ agreementNumber: 1 })
    .lean();

  const existing = await Invoice.find({
    billingPeriod,
    billingType: 'MONTHLY_SERVICE',
    status: { $ne: 'CANCELLED' },
  })
    .select('customer invoiceNumber')
    .lean();

  const existingByCustomer = new Map(existing.map((row) => [String(row.customer), row]));

  const candidates: InvoiceGenerationCandidateDto[] = agreements.map((agreement) => {
    const customerId = idOf(agreement.customer) ?? '';
    const clash = existingByCustomer.get(customerId);
    return {
      customerId,
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

async function assertNoDuplicate(
  customerId: Types.ObjectId,
  billingPeriod: string,
  billingType: string,
): Promise<void> {
  const clash = await Invoice.findOne({
    customer: customerId,
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

  await assertNoDuplicate(customerId, input.billingPeriod, input.billingType);

  const { taxPercent, currency } = await financeContext();
  const lines = buildLines(input.lines);
  const totals = totalsOf(lines, taxPercent);

  const invoice = await Invoice.create({
    invoiceNumber: await nextInvoiceNumber(),
    customer: customerId,
    serviceAgreement: input.serviceAgreementId
      ? new Types.ObjectId(input.serviceAgreementId)
      : null,
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

/**
 * Generates one monthly invoice per selected customer.
 *
 * Each customer is processed independently: a duplicate on one must not abandon the rest
 * of the run, so failures are collected and reported rather than thrown.
 */
export async function generateMonthlyInvoices(
  input: GenerateMonthlyInvoicesInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<{ created: InvoiceListItemDto[]; skipped: { customerId: string; reason: string }[] }> {
  const { taxPercent, currency } = await financeContext();
  const created: InvoiceListItemDto[] = [];
  const skipped: { customerId: string; reason: string }[] = [];
  const now = new Date();

  for (const customerId of input.customerIds) {
    const objectId = new Types.ObjectId(customerId);
    const agreement = await ServiceAgreement.findOne({ customer: objectId, status: 'ACTIVE' })
      .populate({ path: 'customer', select: 'name' })
      .lean();

    if (!agreement) {
      skipped.push({ customerId, reason: 'Идэвхтэй үйлчилгээний нөхцөл олдсонгүй.' });
      continue;
    }

    try {
      await assertNoDuplicate(objectId, input.billingPeriod, 'MONTHLY_SERVICE');
    } catch {
      skipped.push({ customerId, reason: 'Энэ тайлант үед нэхэмжлэл аль хэдийн үүссэн.' });
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

    const invoice = await Invoice.create({
      invoiceNumber: await nextInvoiceNumber(now),
      customer: objectId,
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

    await recordAudit({
      entityType: ENTITY,
      entityId: invoice._id,
      action: 'Created',
      actor: actorOf(actor),
      meta,
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        billingPeriod: invoice.billingPeriod,
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
    permission: 'invoice.view',
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
