import { PERMISSIONS } from '@monhorus/shared';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoiceService } from '../../services/invoice.service';
import { makeInvoiceListItem, makeInvoiceSummary } from '../../test/fixtures';
import { renderWithAuth } from '../../test/render';
import { CustomerInvoicesTab } from './CustomerInvoicesTab';

const CUSTOMER_ID = 'c1';

function render() {
  return renderWithAuth(<CustomerInvoicesTab customerId={CUSTOMER_ID} />, {
    permissions: [PERMISSIONS.INVOICE_VIEW],
  });
}

/** One window of a longer ledger, with the receivables roll-up the tab renders above it. */
function invoicePage(page: number, count: number, total: number) {
  return {
    items: Array.from({ length: count }, (_, offset) =>
      makeInvoiceListItem({
        id: `i-${page}-${offset}`,
        invoiceNumber: `INV-${page}-${offset}`,
      }),
    ),
    page,
    limit: 20,
    total,
    totalPages: Math.ceil(total / 20),
    summary: makeInvoiceSummary({ receivableTotal: 9_000_000 }),
  };
}

/**
 * The tab asked for fifty invoices and rendered them whole, so a long-standing customer's
 * fifty-first invoice could not be reached from this page at all — it was absent rather
 * than hidden behind a control.
 */
describe('CustomerInvoicesTab paging', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('asks for one page of invoices rather than fifty', async () => {
    const list = vi.spyOn(invoiceService, 'list').mockResolvedValue(invoicePage(1, 20, 120));

    render();
    await screen.findByRole('table');

    expect(list).toHaveBeenCalledWith({ customerId: CUSTOMER_ID, page: 1, limit: 20 });
  });

  it('numbers the invoices continuously across pages', async () => {
    const user = userEvent.setup();
    vi.spyOn(invoiceService, 'list').mockImplementation(async (query) =>
      invoicePage(query?.page ?? 1, 20, 120),
    );

    render();

    const table = await screen.findByRole('table');
    expect(within(table).getByRole('columnheader', { name: '№' })).toBeInTheDocument();
    expect(within(table).getAllByRole('cell')[0]?.textContent?.trim()).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Дараах' }));

    // Page 2 of 20 begins at 21. Restarting at 1 is the failure this exists to catch.
    await waitFor(() =>
      expect(
        within(screen.getByRole('table')).getAllByRole('cell')[0]?.textContent?.trim(),
      ).toBe('21'),
    );
  });

  it('states the customer ledger total rather than the rows on screen', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(invoicePage(1, 20, 120));

    render();
    await screen.findByRole('table');

    expect(screen.getByText(/Нийт 120/)).toBeInTheDocument();
  });

  /**
   * The roll-up is computed by the server over the whole ledger, so it must keep reading
   * the same while the table shows one page of it. A summary that tracked the visible rows
   * would understate what the customer owes.
   */
  it('keeps the receivable summary over the whole ledger, not the page', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(invoicePage(1, 20, 120));

    render();
    await screen.findByRole('table');

    expect(screen.getByText(/9,000,000/)).toBeInTheDocument();
  });

  it('offers no pager when the ledger fits on one page', async () => {
    vi.spyOn(invoiceService, 'list').mockResolvedValue(invoicePage(1, 3, 3));

    render();
    await screen.findByRole('table');

    expect(screen.queryByRole('button', { name: 'Дараах' })).not.toBeInTheDocument();
  });
});
