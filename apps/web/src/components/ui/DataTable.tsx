import { Fragment, useId, type ReactElement, type ReactNode } from 'react';

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
  /**
   * Detail panel for a row, revealed underneath it.
   *
   * Opting in is what adds the expander column and the second `<tr>` per open row: with
   * this prop absent the table renders exactly the markup it always has, so the callers
   * that never asked for expansion are untouched. Expansion is controlled rather than
   * internal because the owner usually has to do something when a row opens - fetch the
   * detail, remember which rows the user left open - and an internal `useState` would hide
   * that from it.
   */
  renderExpanded?: (row: T) => ReactNode;
  /** Keys (as returned by `rowKey`) whose detail panel is currently open. */
  expandedKeys?: readonly string[];
  onToggleExpand?: (key: string, row: T) => void;
  /** Accessible name for a row's expander, so a screen reader hears which row it opens. */
  expandLabel?: (row: T) => string;
  /**
   * A leading № column counting the rows.
   *
   * `true` numbers the rows on screen from 1, which is what an unpaginated table wants.
   * Passing the page and the page size instead numbers them CONTINUOUSLY across pages —
   * page 2 of 20 starts at 21 — which is the only numbering that means anything on a
   * paginated list: a reader asked to "check row 34" must be able to find row 34.
   *
   * The arithmetic lives here rather than in each caller's column array on purpose. It is
   * one off-by-one repeated thirteen times otherwise, and the copies drift: a page that
   * forgets `- 1` numbers its first page from 21.
   */
  numbering?: true | { page: number; limit: number };
}

/** The number to print against the first row on screen. */
function firstNumber(numbering: true | { page: number; limit: number }): number {
  if (numbering === true) return 1;
  // Defensive rather than trusting: a page of 0 or a negative limit would otherwise
  // produce negative row numbers, and a list is more useful mis-numbered from 1 than
  // numbered from -19.
  const page = Math.max(1, Math.floor(numbering.page));
  const limit = Math.max(0, Math.floor(numbering.limit));
  return (page - 1) * limit + 1;
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
  renderExpanded,
  expandedKeys,
  onToggleExpand,
  expandLabel,
  numbering,
}: DataTableProps<T>): ReactElement {
  // Hooks run before the early returns below, which is why this is not inside the branch.
  const panelIdPrefix = useId();
  const expandable = renderExpanded !== undefined;
  const numbered = numbering !== undefined;
  const startNumber = numbering === undefined ? 1 : firstNumber(numbering);
  const openKeys = new Set(expandedKeys ?? []);

  if (loading) {
    return (
      <TableSkeleton
        columns={columns.length + (expandable ? 1 : 0) + (numbered ? 1 : 0)}
      />
    );
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
            {expandable && (
              <th scope="col" className="w-8 px-2 py-2.5">
                <span className="sr-only">Дэлгэх</span>
              </th>
            )}
            {numbered && (
              // Narrow and right-aligned, as a column of figures reads best, and never
              // wrapping — a four-digit row number on page 50 must stay on one line.
              <th
                scope="col"
                className="w-12 whitespace-nowrap px-4 py-2.5 text-right font-semibold text-slate-700"
              >
                №
              </th>
            )}
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
          {rows.map((row, index) => {
            const key = rowKey(row);
            const open = expandable && openKeys.has(key);
            const panelId = `${panelIdPrefix}-${key}`;

            const rowElement = (
              <tr
                key={key}
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
                {expandable && (
                  <td className="px-2 py-2.5 align-top">
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={panelId}
                      aria-label={expandLabel?.(row) ?? 'Дэлгэрэнгүй мөр'}
                      // The row underneath may itself be clickable; opening the panel must
                      // not also fire that.
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleExpand?.(key, row);
                      }}
                      onKeyDown={(event) => event.stopPropagation()}
                      className="inline-flex h-6 w-6 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                    >
                      <svg
                        className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        aria-hidden="true"
                      >
                        <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                )}
                {numbered && (
                  <td className="px-4 py-2.5 text-right align-top tabular-nums text-slate-500">
                    {startNumber + index}
                  </td>
                )}
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
            );

            if (!expandable) return rowElement;

            return (
              <Fragment key={key}>
                {rowElement}
                {open && (
                  <tr>
                    <td
                      id={panelId}
                      // The data columns, plus the expander, plus № when it is on.
                      // A short colSpan leaves the panel not reaching the table's edge.
                      colSpan={columns.length + 1 + (numbered ? 1 : 0)}
                      className="bg-slate-50/70 px-4 py-3"
                    >
                      {renderExpanded(row)}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
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
