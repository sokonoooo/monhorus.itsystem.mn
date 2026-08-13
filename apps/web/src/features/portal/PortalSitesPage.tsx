import type { BuildingDto, PaginatedData } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SEARCH_SLOT } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';

/** The same page size as the other portal lists, so the screens read as one product. */
const PAGE_SIZE = 20;

/**
 * The customer's own buildings.
 *
 * `GET /buildings` bounds itself to the caller's organisation server-side, so no
 * `customerId` is sent — it could not widen the answer, and sending one would imply it
 * might. Read-only by construction: every write path on the hierarchy is keyed on a staff
 * permission, so there is no edit control here to hide.
 *
 * PAGED AND SEARCHED SERVER-SIDE. This used to fetch one capped page and render no pager,
 * so a customer with more buildings than the cap simply never saw the rest and nothing on
 * screen said so. For the same reason the search is a query parameter rather than a filter
 * over `items`: filtering here would only ever search the page in hand.
 */
export function PortalSitesPage(): ReactElement {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const search = searchParams.get('search') ?? '';

  const [data, setData] = useState<PaginatedData<BuildingDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower search invalidates the cursor; page 4 of a shorter list reads as "empty".
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(
        await portalService.listBuildings({
          page,
          limit: PAGE_SIZE,
          ...(search ? { search } : {}),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns: Column<BuildingDto>[] = [
    {
      key: 'name',
      header: 'Барилга',
      render: (row) => <span className="font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'project',
      header: 'Төсөл',
      render: (row) => <span className="text-slate-700">{row.projectName ?? '-'}</span>,
    },
    {
      key: 'address',
      header: 'Хаяг',
      render: (row) => <span className="text-slate-700">{row.address ?? '-'}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Миний барилга"
        description="Танай байгууллагад бүртгэлтэй барилгууд."
        breadcrumbs={[{ label: 'Нүүр', to: '/portal' }, { label: 'Миний барилга' }]}
      />

      <div className={FILTER_BAR}>
        <div className={FILTER_SEARCH_SLOT}>
          <label htmlFor="portal-building-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="portal-building-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Барилгын нэр"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          numbering={{ page, limit: PAGE_SIZE }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/portal/sites/${row.id}`)}
          emptyTitle="Барилга байхгүй"
          emptyDescription={
            search
              ? 'Хайлтад тохирох барилга олдсонгүй.'
              : 'Танай байгууллагад бүртгэлтэй барилга алга байна.'
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(next) => updateParam('page', String(next))}
          />
        )}
      </div>
    </>
  );
}
