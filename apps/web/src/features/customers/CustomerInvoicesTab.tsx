import type { InvoiceListItemDto, InvoiceSummaryDto } from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { invoiceService } from '../../services/invoice.service';
import { BillingTypeBadge, InvoiceStatusBadge, Money } from '../invoices/InvoiceBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Invoices issued to this customer, with their receivable position. */
export function CustomerInvoicesTab({ customerId }: { customerId: string }): ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<InvoiceListItemDto[]>([]);
  const [summary, setSummary] = useState<InvoiceSummaryDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoiceService
      .list({ customerId, limit: 50 })
      .then((page) => {
        if (cancelled) return;
        setRows(page.items as InvoiceListItemDto[]);
        setSummary(page.summary);
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
  }, [customerId]);

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
          onRowClick={(row) => navigate(`/invoices/${row.id}`)}
          emptyTitle="Нэхэмжлэл алга"
          emptyDescription="Энэ харилцагчид нэхэмжлэл илгээгээгүй байна."
        />
      </div>
    </div>
  );
}
