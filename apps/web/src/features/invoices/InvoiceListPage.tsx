import {
  INVOICE_BILLING_TYPES,
  INVOICE_BILLING_TYPE_LABELS,
  INVOICE_EFFECTIVE_STATUSES,
  INVOICE_EFFECTIVE_STATUS_LABELS,
  OVERDUE_ACTION_UNAPPROVED_NOTE,
  PERMISSIONS,
  type CustomerDto,
  type InvoiceListItemDto,
  type InvoiceListQuery,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import {
  FILTER_BAR,
  FILTER_INPUT,
  FILTER_LABEL,
  FILTER_SELECT,
} from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { invoiceService, type InvoicePage } from '../../services/invoice.service';
import { objectService } from '../../services/object.service';
import { GenerateInvoicesDrawer } from './GenerateInvoicesDrawer';
import { InvoiceFormDrawer } from './InvoiceFormDrawer';
import { BillingTypeBadge, InvoiceStatusBadge, Money } from './InvoiceBadges';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function SummaryCard({
  label,
  value,
  tone = 'slate',
}: {
  label: string;
  value: string;
  tone?: 'slate' | 'blue' | 'red' | 'green';
}): ReactElement {
  const tones: Record<string, string> = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    red: 'text-red-700',
    green: 'text-green-700',
  };
  return (
    <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  );
}

/**
 * Invoices and receivables (requirements 12).
 *
 * The status filter includes OVERDUE, which the backend derives from the due date rather
 * than storing, so the count in the header and the rows in the table always agree with
 * the clock.
 */
export function InvoiceListPage(): ReactElement {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.INVOICE_MANAGE);

  const query = useMemo<InvoiceListQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: 20,
      ...(searchParams.get('search') ? { search: searchParams.get('search')! } : {}),
      ...(searchParams.get('customerId') ? { customerId: searchParams.get('customerId')! } : {}),
      ...(searchParams.get('status')
        ? { status: searchParams.get('status') as InvoiceListQuery['status'] }
        : {}),
      ...(searchParams.get('billingType')
        ? { billingType: searchParams.get('billingType') as InvoiceListQuery['billingType'] }
        : {}),
      ...(searchParams.get('periodFrom') ? { periodFrom: searchParams.get('periodFrom')! } : {}),
      ...(searchParams.get('periodTo') ? { periodTo: searchParams.get('periodTo')! } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<InvoicePage | null>(null);
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [formOpen, setFormOpen] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const result = await invoiceService.list(JSON.parse(queryKey) as InvoiceListQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(caught instanceof ApiError ? caught.message : 'Нэхэмжлэл ачаалж чадсангүй.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    objectService
      .customers()
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const summary = data?.summary;
  const currency = summary?.currency ?? 'MNT';

  const columns: ReadonlyArray<Column<InvoiceListItemDto>> = [
    {
      key: 'invoiceNumber',
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
      key: 'customer',
      header: 'Харилцагч',
      render: (row) => <span className="text-slate-700">{row.customerName ?? '-'}</span>,
    },
    {
      key: 'billingType',
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

  const columnState = useTableColumns('invoices', columns);

  return (
    <>
      <PageHeader
        title="Нэхэмжлэл ба төлбөр"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Нэхэмжлэл ба төлбөр' }]}
        actions={
          canManage && (
            <>
              <Button variant="secondary" onClick={() => setGenerateOpen(true)}>
                Сарын нэхэмжлэл боловсруулах
              </Button>
              <Button onClick={() => setFormOpen(true)}>Шинэ нэхэмжлэл</Button>
            </>
          )
        }
      />

      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard label="Ноорог" value={String(summary.draftCount)} />
          <SummaryCard
            label="Авлага"
            value={`${summary.receivableTotal.toLocaleString('mn-MN')} ${currency}`}
            tone="blue"
          />
          <SummaryCard
            label="Хугацаа хэтэрсэн"
            value={`${summary.overdueTotal.toLocaleString('mn-MN')} ${currency}`}
            tone="red"
          />
          <SummaryCard
            label="Төлөгдсөн"
            value={`${summary.paidTotal.toLocaleString('mn-MN')} ${currency}`}
            tone="green"
          />
        </div>
      )}

      {summary && summary.overdueCount > 0 && (
        <div className="mb-4">
          <Alert variant="warning" title={`${summary.overdueCount} нэхэмжлэл хугацаа хэтэрсэн`}>
            {OVERDUE_ACTION_UNAPPROVED_NOTE}
          </Alert>
        </div>
      )}

      <div className={FILTER_BAR}>
        <div className="min-w-[200px] flex-1">
          <label htmlFor="invoice-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="invoice-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэхэмжлэлийн дугаар"
          />
        </div>

        <div>
          <label htmlFor="invoice-customer" className={FILTER_LABEL}>
            Харилцагч
          </label>
          <select
            id="invoice-customer"
            value={searchParams.get('customerId') ?? ''}
            onChange={(event) => updateParam('customerId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх харилцагч</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="invoice-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="invoice-status"
            value={searchParams.get('status') ?? ''}
            onChange={(event) => updateParam('status', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төлөв</option>
            {INVOICE_EFFECTIVE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {INVOICE_EFFECTIVE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="invoice-type" className={FILTER_LABEL}>
            Төрөл
          </label>
          <select
            id="invoice-type"
            value={searchParams.get('billingType') ?? ''}
            onChange={(event) => updateParam('billingType', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх төрөл</option>
            {INVOICE_BILLING_TYPES.map((type) => (
              <option key={type} value={type}>
                {INVOICE_BILLING_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="invoice-period" className={FILTER_LABEL}>
            Тайлант үе
          </label>
          <input
            id="invoice-period"
            type="month"
            value={searchParams.get('periodFrom') ?? ''}
            onChange={(event) => updateParam('periodFrom', event.target.value)}
            className={FILTER_INPUT}
          />
        </div>
      </div>

      <div className="mb-2 flex justify-end">
        <ColumnPicker controller={columnState} />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columnState.visibleColumns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={loading}
          error={error}
          onRowClick={(row) => navigate(`/invoices/${row.id}`)}
          emptyTitle="Нэхэмжлэл алга"
          emptyDescription="Шүүлтэд тохирох нэхэмжлэл олдсонгүй."
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(page) => updateParam('page', String(page))}
          />
        )}
      </div>

      <InvoiceFormDrawer
        open={formOpen}
        customers={customers}
        onClose={() => setFormOpen(false)}
        onSaved={(invoiceId) => {
          setFormOpen(false);
          navigate(`/invoices/${invoiceId}`);
        }}
      />

      <GenerateInvoicesDrawer
        open={generateOpen}
        onClose={() => setGenerateOpen(false)}
        onGenerated={() => {
          setGenerateOpen(false);
          void load();
        }}
      />
    </>
  );
}
