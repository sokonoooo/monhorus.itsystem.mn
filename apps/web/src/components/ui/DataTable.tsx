import type { ReactElement, ReactNode } from 'react';

import { Button } from './Button';
import { EmptyState, ErrorState, TableSkeleton } from './States';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Receives the whole row so it can compose several fields. */
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  width?: string;
}

interface DataTableProps<T> {
  columns: ReadonlyArray<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
  onRowClick?: (row: T) => void;
  /**
   * Accessible name for the table itself. A page with several tables needs each one
   * addressable on its own, both for a screen reader and for a test that has to scope an
   * assertion to one table.
   */
  ariaLabel?: string;
}

/**
 * Table with built-in loading, error and empty presentation, so no caller can
 * accidentally ship a screen that renders a blank box while fetching or failing.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  error = null,
  onRetry,
  emptyTitle = 'Мэдээлэл олдсонгүй',
  emptyDescription,
  emptyAction,
  onRowClick,
  ariaLabel,
}: DataTableProps<T>): ReactElement {
  if (loading) {
    return <TableSkeleton columns={columns.length} />;
  }

  if (error) {
    return (
      <ErrorState
        description={error}
        {...(onRetry
          ? {
              action: (
                <Button variant="secondary" size="sm" onClick={onRetry}>
                  Дахин оролдох
                </Button>
              ),
            }
          : {})}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        {...(emptyDescription ? { description: emptyDescription } : {})}
        {...(emptyAction ? { action: emptyAction } : {})}
      />
    );
  }

  return (
    // Wide tables scroll inside their own container; the page never scrolls sideways.
    <div className="overflow-x-auto">
      <table aria-label={ariaLabel} className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={`whitespace-nowrap px-4 py-2.5 font-semibold text-slate-700 ${
                  column.align === 'right'
                    ? 'text-right'
                    : column.align === 'center'
                      ? 'text-center'
                      : 'text-left'
                }`}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              // A row that acts like a control has to be usable like one: it takes focus and
              // answers Enter and Space, so the table is not mouse-only. Controls inside a
              // cell stop the event before it reaches here (see RowActions).
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={
                onRowClick
                  ? (event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      // Space would otherwise scroll the page out from under the row.
                      event.preventDefault();
                      onRowClick(row);
                    }
                  : undefined
              }
              tabIndex={onRowClick ? 0 : undefined}
              className={
                onRowClick
                  ? 'cursor-pointer hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600'
                  : 'hover:bg-slate-50'
              }
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={`px-4 py-2.5 align-top ${
                    column.align === 'right'
                      ? 'text-right'
                      : column.align === 'center'
                        ? 'text-center'
                        : 'text-left'
                  }`}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({
  page,
  totalPages,
  total,
  onPageChange,
}: PaginationProps): ReactElement | null {
  if (totalPages <= 1) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
      <p className="text-sm text-slate-600">
        Нийт {total}, хуудас {page}/{totalPages}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Өмнөх
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Дараах
        </Button>
      </div>
    </div>
  );
}
