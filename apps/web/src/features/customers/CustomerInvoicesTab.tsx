import type { InvoiceListItemDto, InvoiceSummaryDto } from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { invoiceService, type InvoicePage } from '../../services/invoice.service';
import { BillingTypeBadge, InvoiceStatusBadge, Money } from '../invoices/InvoiceBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * Invoices per screen.
 *
 * The tab used to ask for fifty and render them all, so a long-standing customer's
 * fifty-first invoice was unreachable from this page — not hidden behind a control, simply
 * absent. The summary above the table is computed by the server over the whole set, so it
 * keeps telling the truth about the receivable position while the table shows one page.
 */
const INVOICE_PAGE_SIZE = 20;

/** Invoices issued to this customer, with their receivable position. */
export function CustomerInvoicesTab({ customerId }: { customerId: string }): ReactElement {
  const navigate = useNavigate();
  const [result, setResult] = useState<InvoicePage | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Switching customer while standing on page 3 would otherwise open the next customer on
  // a page that is often past the end of their shorter list.
  useEffect(() => {
    setPage(1);
  }, [customerId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    invoiceService
      .list({ customerId, page, limit: INVOICE_PAGE_SIZE })
      .then((next) => {
        if (cancelled) return;
        setResult(next);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Нэхэмжлэл ачаалж чадсангүй.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId, page]);

  const rows: InvoiceListItemDto[] = result?.items ?? [];
  const summary: InvoiceSummaryDto | null = result?.summary ?? null;

  const columns: ReadonlyArray<Column<InvoiceListItemDto>> = [
    {
      key: 'invoice',
      header: 'Нэхэмжлэлийн №',
      render: (row) => (
        <span className="whitespace-nowrap font-medium text-slate-900">{row.invoiceNumber}</span>
      ),
    },
    {
      key: 'billingPeriod',
      header: 'Тайлант үе',
      render: (row) => <span className="whitespace-nowrap text-slate-700">{row.billingPeriod}</span>,
    },
    {
      key: 'type',
      header: 'Төрөл',
      render: (row) => <BillingTypeBadge type={row.billingType} />,
    },
    {
      key: 'issueDate',
      header: 'Огноо',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.issueDate)}</span>
      ),
    },
    {
      key: 'dueDate',
      header: 'Төлөх хугацаа',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.dueDate)}</span>
      ),
    },
    {
      key: 'total',
      header: 'Нийт дүн',
      align: 'right',
      render: (row) => <Money amount={row.total} currency={row.currency} />,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => (
        <InvoiceStatusBadge status={row.effectiveStatus} overdueDays={row.overdueDays} />
      ),
    },
  ];

  const columnState = useTableColumns('customer-invoices', columns);

  return (
    <div className="space-y-3">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Авлага</p>
            <p className="text-lg font-semibold tabular-nums text-blue-700">
              {summary.receivableTotal.toLocaleString('mn-MN')} {summary.currency}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Хугацаа хэтэрсэн</p>
            <p className="text-lg font-semibold tabular-nums text-red-700">
              {summary.overdueTotal.toLocaleString('mn-MN')} {summary.currency}
            </p>
          </div>
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs text-slate-500">Төлөгдсөн</p>
            <p className="text-lg font-semibold tabular-nums text-green-700">
              {summary.paidTotal.toLocaleString('mn-MN')} {summary.currency}
            </p>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <ColumnPicker controller={columnState} />
      </div>

      {/* Already inside CustomerDetailPage's white card, so this takes the ring-only
          treatment the sibling tabs use rather than nesting a second white card. */}
      <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          numbering={{ page, limit: INVOICE_PAGE_SIZE }}
          onRowClick={(row) => navigate(`/invoices/${row.id}`)}
          emptyTitle="Нэхэмжлэл алга"
          emptyDescription="Энэ харилцагчид нэхэмжлэл илгээгээгүй байна."
        />
        <Pagination
          page={page}
          totalPages={result?.totalPages ?? 1}
          total={result?.total ?? 0}
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
