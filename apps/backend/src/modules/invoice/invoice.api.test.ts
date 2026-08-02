import { PERMISSIONS, SETTING_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { Customer } from '../objects/object.models';
import { ServiceAgreement } from '../service-agreement/service-agreement.model';
import { Setting } from '../settings/setting.model';
import { invalidateSettingsCache } from '../settings/settings.service';
import { Invoice } from './invoice.model';

const API = '/api/v1';

let app: Express;
let token: string;
let customerId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/**
 * Codes come from a counter, not from the clock: two records created in the same
 * millisecond would otherwise collide on their unique code and fail intermittently.
 */
let seedSequence = 0;

async function seedCustomer(name = 'Central Tower ХХК'): Promise<string> {
  seedSequence += 1;
  const customer = await Customer.create({ code: `C-${seedSequence}`, name });
  return String(customer._id);
}

async function seedAgreement(customer: string, monthlyFee = 1_500_000): Promise<string> {
  const agreement = await ServiceAgreement.create({
    agreementNumber: `AGR-${(seedSequence += 1)}`,
    customer,
    startDate: new Date('2026-01-01'),
    endDate: new Date('2026-12-31'),
    serviceType: 'Урьдчилан сэргийлэх үйлчилгээ',
    slaUrgentHours: 6,
    slaStandardHours: 24,
    monthlyFee,
    currency: 'MNT',
    status: 'ACTIVE',
  });
  return String(agreement._id);
}

function validInvoice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    customerId,
    billingType: 'ADDITIONAL_SERVICE',
    billingPeriod: '2026-07',
    issueDate: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-07-31T00:00:00.000Z',
    lines: [{ description: 'LED солих', quantity: 2, unitPrice: 90_000 }],
    ...overrides,
  };
}

async function createInvoice(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/invoices`)
    .set('Authorization', `Bearer ${token}`)
    .send(validInvoice(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

describe('Invoice API', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    invalidateSettingsCache();
    const superUser = await createSuperUser();
    token = await login(superUser.email, superUser.password);
    customerId = await seedCustomer();
  });

  it('creates a draft invoice and totals the lines', async () => {
    const response = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoice());

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('DRAFT');
    expect(response.body.data.subtotal).toBe(180_000);
    expect(response.body.data.total).toBe(180_000);
    expect(response.body.data.invoiceNumber).toMatch(/^INV-\d{6}-\d{4}$/);
  });

  /** Requirements 12.2: tax comes from the finance settings, never from a hardcoded rate. */
  it('applies the configured tax rate rather than a built-in one', async () => {
    expect((await request(app).post(`${API}/invoices`).set('Authorization', `Bearer ${token}`).send(validInvoice())).body.data.taxAmount).toBe(0);

    await Setting.updateOne(
      { key: SETTING_KEYS.FINANCE_TAX_PERCENT },
      { $set: { key: SETTING_KEYS.FINANCE_TAX_PERCENT, value: 10 } },
      { upsert: true },
    );
    invalidateSettingsCache();

    const taxed = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoice({ billingPeriod: '2026-08' }));

    expect(taxed.body.data.taxPercent).toBe(10);
    expect(taxed.body.data.taxAmount).toBe(18_000);
    expect(taxed.body.data.total).toBe(198_000);
  });

  /** Requirements 12.3: no duplicate on customer + period + billing type. */
  it('refuses a second invoice for the same customer, period and type', async () => {
    await createInvoice();

    const duplicate = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoice());

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/аль хэдийн үүссэн/);
  });

  it('allows the same period under a different billing type', async () => {
    await createInvoice();
    await seedAgreement(customerId);

    const other = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoice({ billingType: 'MONTHLY_SERVICE' }));

    expect(other.status).toBe(201);
  });

  /** A cancelled invoice must free its slot so the corrected one can be issued. */
  it('frees the period once an invoice is cancelled', async () => {
    const invoiceId = await createInvoice();

    await request(app)
      .post(`${API}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Буруу дүнтэй.' })
      .expect(200);

    const replacement = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${token}`)
      .send(validInvoice({ replacesInvoiceId: invoiceId }));

    expect(replacement.status).toBe(201);
    expect(replacement.body.data.replacesInvoiceNumber).toBeTruthy();
  });

  it('walks DRAFT to SENT to PAID and records the payment', async () => {
    const invoiceId = await createInvoice();

    const sent = await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(sent.body.data.status).toBe('SENT');
    expect(sent.body.data.sentAt).toBeTruthy();

    const paid = await request(app)
      .post(`${API}/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paidAt: '2026-07-20T00:00:00.000Z',
        method: 'BANK_TRANSFER',
        reference: 'TRX-001',
        amount: 180_000,
      });

    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('PAID');
    expect(paid.body.data.payment.reference).toBe('TRX-001');
  });

  /** Requirements 12.3: the payment must settle the invoice in full; V1 has no part payment. */
  it('rejects a payment that does not equal the invoice total', async () => {
    const invoiceId = await createInvoice();
    await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const partial = await request(app)
      .post(`${API}/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paidAt: '2026-07-20T00:00:00.000Z',
        method: 'CASH',
        reference: 'TRX-002',
        amount: 90_000,
      });

    expect(partial.status).toBe(400);
    expect(partial.body.issues?.[0]?.field).toBe('amount');
  });

  it('refuses to pay an invoice that was never sent', async () => {
    const invoiceId = await createInvoice();

    const response = await request(app)
      .post(`${API}/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paidAt: '2026-07-20T00:00:00.000Z',
        method: 'CASH',
        reference: 'TRX-003',
        amount: 180_000,
      });

    expect(response.status).toBe(409);
  });

  it('refuses to edit an invoice once it has been sent', async () => {
    const invoiceId = await createInvoice();
    await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const response = await request(app)
      .patch(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ lines: [{ description: 'Өөр', quantity: 1, unitPrice: 1 }] });

    expect(response.status).toBe(409);
  });

  it('requires a reason to cancel', async () => {
    const invoiceId = await createInvoice();

    const response = await request(app)
      .post(`${API}/invoices/${invoiceId}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });

  /** Section 12.3 OVERDUE is derived from the due date, never stored. */
  it('reports a past-due sent invoice as OVERDUE without storing that status', async () => {
    const invoiceId = await createInvoice({
      dueDate: '2020-01-31T00:00:00.000Z',
      issueDate: '2020-01-01T00:00:00.000Z',
      billingPeriod: '2020-01',
    });
    await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const detail = await request(app)
      .get(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(detail.body.data.status).toBe('SENT');
    expect(detail.body.data.effectiveStatus).toBe('OVERDUE');
    expect(detail.body.data.overdueDays).toBeGreaterThan(0);

    const stored = await Invoice.findById(invoiceId).lean();
    expect(stored?.status).toBe('SENT');
  });

  it('filters the list by the derived overdue status', async () => {
    const overdueId = await createInvoice({
      dueDate: '2020-01-31T00:00:00.000Z',
      billingPeriod: '2020-01',
    });
    await request(app)
      .post(`${API}/invoices/${overdueId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await createInvoice({ billingPeriod: '2026-09' });

    const response = await request(app)
      .get(`${API}/invoices?status=OVERDUE`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(overdueId);
    expect(response.body.data.summary.overdueCount).toBe(1);
  });

  it('generates one monthly invoice per customer from the active agreement', async () => {
    await seedAgreement(customerId, 1_200_000);

    const preview = await request(app)
      .get(`${API}/invoices/generation-preview?billingPeriod=2026-07`)
      .set('Authorization', `Bearer ${token}`);
    expect(preview.body.data.candidates).toHaveLength(1);
    expect(preview.body.data.candidates[0].monthlyFee).toBe(1_200_000);

    const generated = await request(app)
      .post(`${API}/invoices/generate-monthly`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        billingPeriod: '2026-07',
        issueDate: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-31T00:00:00.000Z',
        customerIds: [customerId],
      });

    expect(generated.status).toBe(201);
    expect(generated.body.data.created).toHaveLength(1);
    expect(generated.body.data.created[0].total).toBe(1_200_000);
  });

  it('skips a customer already invoiced for the period instead of failing the run', async () => {
    await seedAgreement(customerId);
    const otherCustomer = await seedCustomer('Second ХХК');
    await seedAgreement(otherCustomer, 900_000);

    await request(app)
      .post(`${API}/invoices/generate-monthly`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        billingPeriod: '2026-07',
        issueDate: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-31T00:00:00.000Z',
        customerIds: [customerId],
      });

    const second = await request(app)
      .post(`${API}/invoices/generate-monthly`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        billingPeriod: '2026-07',
        issueDate: '2026-07-01T00:00:00.000Z',
        dueDate: '2026-07-31T00:00:00.000Z',
        customerIds: [customerId, otherCustomer],
      });

    expect(second.body.data.created).toHaveLength(1);
    expect(second.body.data.skipped).toHaveLength(1);
    expect(second.body.data.skipped[0].customerId).toBe(customerId);
  });

  it('writes an audit record for every money event', async () => {
    const before = await AuditLog.countDocuments({ entityType: 'Invoice' });
    const invoiceId = await createInvoice();
    await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    await request(app)
      .post(`${API}/invoices/${invoiceId}/payment`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paidAt: '2026-07-20T00:00:00.000Z',
        method: 'CARD',
        reference: 'TRX-004',
        amount: 180_000,
      });

    const after = await AuditLog.countDocuments({ entityType: 'Invoice' });
    expect(after - before).toBe(3);
  });

  it('separates issuing from preparing at the permission layer', async () => {
    const preparer = await createUserWithPermissions('prep@test.mn', [
      PERMISSIONS.INVOICE_VIEW,
      PERMISSIONS.INVOICE_MANAGE,
    ]);
    const prepToken = await login(preparer.email, preparer.password);

    const created = await request(app)
      .post(`${API}/invoices`)
      .set('Authorization', `Bearer ${prepToken}`)
      .send(validInvoice());
    expect(created.status).toBe(201);

    const send = await request(app)
      .post(`${API}/invoices/${created.body.data.id}/send`)
      .set('Authorization', `Bearer ${prepToken}`)
      .send({});
    expect(send.status).toBe(403);
  });

  it('refuses to delete anything past draft', async () => {
    const invoiceId = await createInvoice();
    await request(app)
      .post(`${API}/invoices/${invoiceId}/send`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    const response = await request(app)
      .delete(`${API}/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
  });
});
