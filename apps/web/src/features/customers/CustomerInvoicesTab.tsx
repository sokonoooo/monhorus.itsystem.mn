import {
  INVOICE_EFFECTIVE_STATUSES,
  INVOICE_EFFECTIVE_STATUS_LABELS,
  type InvoiceEffectiveStatus,
  type InvoiceListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_LABEL, FILTER_SEARCH_SLOT, FILTER_SELECT } from '../../components/ui/control-styles';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { invoiceService, type InvoicePage } from '../../services/invoice.service';
import { BillingTypeBadge, InvoiceStatusBadge, Money } from '../invoices/InvoiceBadges';

const PAGE_SIZE = 20;

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Invoices issued to this customer, with their receivable position. */
export function CustomerInvoicesTab({ customerId }: { customerId: string }): ReactElement {
  const navigate = useNavigate();

  // Paging and filtering live in component state, NOT in the URL as they do on
  // CustomerListPage. This is a tab inside CustomerDetailPage, which already owns the query
  // string for tab selection; three sibling tabs each writing `page`/`search` there would
  // overwrite one another and collide with the parent's `tab` param.
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchDraft, setSearchDraft] = useState('');
  const [status, setStatus] = useState<InvoiceEffectiveStatus | ''>('');

  const [data, setData] = useState<InvoicePage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // Search and status go to the server: only the current page is ever in hand here,
      // so filtering client-side would filter one page out of many.
      const result = await invoiceService.list({
        customerId,
        page,
        limit: PAGE_SIZE,
        ...(search ? { search } : {}),
        ...(status ? { status } : {}),
      });
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Нэхэмжлэл ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [customerId, page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Any narrowing returns to page 1; page 4 of the old result is empty under the new one. */
  function commitSearch(value: string): void {
    setSearch(value);
    setPage(1);
  }

  const rows = data?.items ?? [];
  const summary = data?.summary ?? null;
  const hasFilters = search !== '' || status !== '';

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

      {/* The controls are CustomerListPage's, but without its FILTER_BAR card: this tab
          already sits inside CustomerDetailPage's white card and a second one would nest. */}
      <div className="flex flex-wrap items-end gap-3">
        <div className={FILTER_SEARCH_SLOT}>
          <label htmlFor="customer-invoice-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="customer-invoice-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitSearch(searchDraft.trim());
            }}
            onBlur={() => commitSearch(searchDraft.trim())}
            placeholder="Нэхэмжлэлийн дугаар"
          />
        </div>

        <div>
          <label htmlFor="customer-invoice-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="customer-invoice-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as InvoiceEffectiveStatus | '');
              setPage(1);
            }}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {INVOICE_EFFECTIVE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {INVOICE_EFFECTIVE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>

        <div className="ml-auto">
          <ColumnPicker controller={columnState} />
        </div>
      </div>

      {/* Already inside CustomerDetailPage's white card, so this takes the ring-only
          treatment the sibling tabs use rather than nesting a second white card. */}
      <div className="overflow-hidden rounded-lg ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={rows}
          rowKey={(row) => row.id}
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? PAGE_SIZE }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/invoices/${row.id}`)}
          emptyTitle="Нэхэмжлэл алга"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох нэхэмжлэл алга.'
              : 'Энэ харилцагчид нэхэмжлэл илгээгээгүй байна.'
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={setPage}
          />
        )}
      </div>
    </div>
  );
}
