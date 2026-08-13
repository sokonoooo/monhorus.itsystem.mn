import type { BuildingDto, FloorDto, PaginatedData } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { FILTER_BAR, FILTER_LABEL, FILTER_SEARCH_SLOT } from '../../components/ui/control-styles';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { BuildingSilhouette } from './BuildingSilhouette';

/** The same page size as the other portal lists. */
const PAGE_SIZE = 20;

/**
 * One building: its floors, each a way into the drawing.
 *
 * The two reads are kept apart on purpose. The building is what the whole screen is about,
 * so failing to load it is a page-level error; the floors are a paged, searchable list, so
 * turning a page must not blank out the heading and breadcrumbs that say where the reader
 * is. Both the page and the search live in the URL, and the search is answered server-side —
 * a tall building holds far more floors than one page shows.
 */
/** A ceiling on the paging loop, not on the building. */
const MAX_FLOOR_PAGES = 20;

/**
 * Every floor, for the drawing.
 *
 * SEPARATE FROM THE TABLE'S PAGE ON PURPOSE. The table shows twenty floors at a time and
 * may be filtered by a search; the silhouette is a picture of the whole building, and one
 * drawn from a filtered page would be a picture of a different building. This walks the
 * pages the way the floor screens walk theirs, for the same reason.
 */
async function fetchAllFloors(buildingId: string): Promise<FloorDto[]> {
  const items: FloorDto[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await portalService.listFloors(buildingId, { page, limit: 100 });
    items.push(...response.items);
    totalPages = response.totalPages;
    page += 1;
  } while (page <= totalPages && page <= MAX_FLOOR_PAGES);
  return items;
}

export function PortalSiteDetailPage(): ReactElement {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const search = searchParams.get('search') ?? '';

  const [building, setBuilding] = useState<BuildingDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [floors, setFloors] = useState<PaginatedData<FloorDto> | null>(null);
  /** The whole building, for the drawing — never the table's filtered page. */
  const [allFloors, setAllFloors] = useState<FloorDto[]>([]);
  const [floorsLoading, setFloorsLoading] = useState(true);
  const [floorsError, setFloorsError] = useState<string | null>(null);

  const [searchDraft, setSearchDraft] = useState(search);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    // A narrower search invalidates the cursor; page 4 of a shorter list reads as "empty".
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  const loadBuilding = useCallback(async (): Promise<void> => {
    if (!buildingId) return;
    setLoading(true);
    setError(null);
    try {
      setBuilding(await portalService.getBuilding(buildingId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  const loadFloors = useCallback(async (): Promise<void> => {
    if (!buildingId) return;
    setFloorsLoading(true);
    setFloorsError(null);
    try {
      setFloors(
        await portalService.listFloors(buildingId, {
          page,
          limit: PAGE_SIZE,
          ...(search ? { search } : {}),
        }),
      );
    } catch (caught) {
      setFloorsError(caught instanceof ApiError ? caught.message : 'Давхар ачаалж чадсангүй.');
    } finally {
      setFloorsLoading(false);
    }
  }, [buildingId, page, search]);

  useEffect(() => {
    void loadBuilding();
  }, [loadBuilding]);

  // The drawing's own load: it does not follow the table's page or its search.
  useEffect(() => {
    if (!buildingId) return undefined;
    let cancelled = false;
    fetchAllFloors(buildingId)
      .then((found) => {
        if (!cancelled) setAllFloors(found);
      })
      // A drawing that cannot be loaded renders its own empty state; it must never take
      // the floor table down with it.
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  useEffect(() => {
    void loadFloors();
  }, [loadFloors]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (error || !building) {
    return (
      <ErrorState
        description={error ?? 'Барилга олдсонгүй.'}
        action={
          <Button
            onClick={() => {
              void loadBuilding();
              void loadFloors();
            }}
          >
            Дахин оролдох
          </Button>
        }
      />
    );
  }

  const columns: Column<FloorDto>[] = [
    {
      key: 'name',
      header: 'Давхар',
      render: (row) => <span className="font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="text-slate-700">{row.code}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={building.name}
        description={building.address ?? undefined}
        backTo={{ to: '/portal/sites', label: 'Миний барилга руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Миний барилга', to: '/portal/sites' },
          { label: building.name },
        ]}
      />

      <div className={FILTER_BAR}>
        <div className={FILTER_SEARCH_SLOT}>
          <label htmlFor="portal-floor-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="portal-floor-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Давхрын нэр эсвэл код"
          />
        </div>
      </div>

      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Барилгын харагдац</h2>
        <BuildingSilhouette
          floors={allFloors}
          onSelect={(floor) => navigate(`/portal/sites/${buildingId ?? ''}/floors/${floor.id}`)}
        />
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Давхар</h2>
        </div>
        <DataTable
          columns={columns}
          rows={floors?.items ?? []}
          rowKey={(row) => row.id}
          numbering={{ page, limit: PAGE_SIZE }}
          loading={floorsLoading}
          error={floorsError}
          onRetry={() => void loadFloors()}
          onRowClick={(row) => navigate(`/portal/sites/${building.id}/floors/${row.id}`)}
          emptyTitle="Давхар байхгүй"
          emptyDescription={
            search
              ? 'Хайлтад тохирох давхар олдсонгүй.'
              : 'Энэ барилгад давхар бүртгэгдээгүй байна.'
          }
          ariaLabel="Давхар"
        />
        {floors && (
          <Pagination
            page={floors.page}
            totalPages={floors.totalPages}
            total={floors.total}
            onPageChange={(next) => updateParam('page', String(next))}
          />
        )}
      </div>
    </>
  );
}
