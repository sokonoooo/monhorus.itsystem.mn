import { PERMISSIONS } from '@monhorus/shared';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoiceService } from '../../services/invoice.service';
import { objectService } from '../../services/object.service';
import { makeInvoiceListItem, makeInvoicePage } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { InvoiceListPage } from './InvoiceListPage';

describe('InvoiceListPage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(objectService, 'customers').mockResolvedValue([]);
  });

  it('lists invoices with their totals', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(
      makeInvoicePage([makeInvoiceListItem()]),
    );

    renderWithAuth(<InvoiceListPage />, { permissions: [PERMISSIONS.INVOICE_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('INV-202607-0001')).toBeInTheDocument();
    expect(within(table).getByText(/1,650,000/)).toBeInTheDocument();
  });

  /** Section 12.3 OVERDUE is derived from the due date, so the row shows it as a state. */
  it('shows an unpaid past-due invoice as overdue with its day count', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(
      makeInvoicePage([
        makeInvoiceListItem({ status: 'SENT', effectiveStatus: 'OVERDUE', overdueDays: 12 }),
      ]),
    );

    renderWithAuth(<InvoiceListPage />, { permissions: [PERMISSIONS.INVOICE_VIEW] });

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Хугацаа хэтэрсэн (12 хоног)')).toBeInTheDocument();
  });

  /** Section 19.2 leaves the overdue action open, so the screen states that nothing happens. */
  it('says no automatic action is taken on an overdue invoice', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(
      makeInvoicePage([makeInvoiceListItem()], { overdueCount: 3, overdueTotal: 900_000 }),
    );

    renderWithAuth(<InvoiceListPage />, { permissions: [PERMISSIONS.INVOICE_VIEW] });

    expect(await screen.findByText('3 нэхэмжлэл хугацаа хэтэрсэн')).toBeInTheDocument();
    expect(screen.getByText(/автоматаар үйлдэл хийхгүй/)).toBeInTheDocument();
  });

  it('shows the receivables roll-up in the header', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(
      makeInvoicePage([makeInvoiceListItem()], { receivableTotal: 4_500_000, paidTotal: 1_200_000 }),
    );

    renderWithAuth(<InvoiceListPage />, { permissions: [PERMISSIONS.INVOICE_VIEW] });

    expect(await screen.findByText('4,500,000 MNT')).toBeInTheDocument();
    expect(screen.getByText('1,200,000 MNT')).toBeInTheDocument();
  });

  it('hides the create actions from a read-only caller', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(makeInvoicePage([]));

    renderWithAuth(<InvoiceListPage />, { permissions: [PERMISSIONS.INVOICE_VIEW] });

    await screen.findByRole('heading', { name: 'Нэхэмжлэл ба төлбөр' });
    expect(screen.queryByRole('button', { name: 'Шинэ нэхэмжлэл' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Сарын нэхэмжлэл боловсруулах' }),
    ).not.toBeInTheDocument();
  });

  it('offers the create actions to a caller holding invoice.manage', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(makeInvoicePage([]));

    renderWithAuth(<InvoiceListPage />, {
      permissions: [PERMISSIONS.INVOICE_VIEW, PERMISSIONS.INVOICE_MANAGE],
    });

    expect(await screen.findByRole('button', { name: 'Шинэ нэхэмжлэл' })).toBeInTheDocument();
  });
});
