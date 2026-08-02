import {
  PLANNED_WORK_STATUS_LABELS,
  type PlannedWorkListItemDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { ColumnPicker } from '../../components/ui/ColumnPicker';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { useTableColumns } from '../../hooks/use-table-columns';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/** Quantity-weighted progress, coloured by how far along it is. */
function ProgressCell({ percent }: { percent: number }): ReactElement {
  const tone = percent >= 100 ? 'bg-green-600' : percent >= 50 ? 'bg-blue-600' : 'bg-amber-500';
  return (
    <div className="min-w-[110px]">
      <div className="mb-1 text-xs font-medium tabular-nums text-slate-900">{percent}%</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full ${tone}`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
    </div>
  );
}

/** The customer's planned works and how far each has got. */
export function CustomerPlannedWorkTab({ customerId }: { customerId: string }): ReactElement {
  const navigate = useNavigate();
  const [rows, setRows] = useState<PlannedWorkListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    plannedWorkService
      .list({ customerId, limit: 50 })
      .then((page) => {
        if (!cancelled) setRows(page.items as PlannedWorkListItemDto[]);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof ApiError ? caught.message : 'Төлөвлөгөөт ажил ачаалж чадсангүй.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const columns: ReadonlyArray<Column<PlannedWorkListItemDto>> = [
    {
      key: 'work',
      header: 'Ажил',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.title}</span>,
    },
    {
      key: 'workNumber',
      header: 'Ажлын №',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.workNumber}</span>,
    },
    {
      key: 'project',
      header: 'Төсөл',
      render: (row) => <span className="text-slate-700">{row.project?.name ?? '-'}</span>,
    },
    {
      key: 'plannedStart',
      header: 'Эхлэх',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedStartDate)}</span>
      ),
    },
    {
      key: 'plannedEnd',
      header: 'Дуусах',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{formatDate(row.plannedEndDate)}</span>
      ),
    },
    {
      key: 'progress',
      header: 'Гүйцэтгэл',
      render: (row) => <ProgressCell percent={row.progressPercent} />,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) => (
        <span
          className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
            row.effectiveStatus === 'OVERDUE'
              ? 'bg-red-50 text-red-700 ring-red-200'
              : row.effectiveStatus === 'COMPLETED'
                ? 'bg-green-50 text-green-700 ring-green-200'
                : 'bg-slate-100 text-slate-600 ring-slate-200'
          }`}
        >
          {PLANNED_WORK_STATUS_LABELS[row.effectiveStatus]}
        </span>
      ),
    },
  ];

  const columnState = useTableColumns('customer-planned-work', columns);

  return (
    <div className="space-y-2">
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
          onRowClick={(row) => navigate(`/planned-work/${row.id}`)}
          emptyTitle="Төлөвлөгөөт ажил алга"
          emptyDescription="Энэ харилцагчид төлөвлөгөөт ажил бүртгэгдээгүй байна."
        />
      </div>
    </div>
  );
}
