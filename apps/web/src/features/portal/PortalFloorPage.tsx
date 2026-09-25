import type {
  FloorDto,
  FloorPlanDto,
  ObjectListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { SearchField } from '../../components/ui/SearchField';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { FILTER_LABEL } from '../../components/ui/control-styles';
import { riskLabelOf } from '../../components/ui/risk-palette';
import { useRiskBands } from '../../hooks/use-risk-bands';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { filterFloorObjects } from '../projects/FloorDetailPage';
import { PortalFloorPlan, unplacedOnPlanCount } from './PortalFloorPlan';

/**
 * One floor: the drawing, with the equipment on it.
 *
 * The plan and the equipment list are two reads because the plan is optional — a floor
 * without a drawing is a normal state, not a failure, and the equipment list is useful on
 * its own. A failed plan read therefore does not take the page down.
 */
/** Rows per page for the equipment table. The plan is still given every object. */
const OBJECT_TABLE_PAGE_SIZE = 20;

/**
 * A ceiling on the paging loop, not on the floor. An unbounded loop against a miscounting
 * server would spin forever; what came back is what the table and the plan show.
 */
const MAX_OBJECT_PAGES = 20;

/**
 * Every object on the floor, not the first hundred.
 *
 * The list endpoint caps a page at 100, so a single request lost every marker past the
 * first page — a floor with 120 devices drew 100 pins and gave no hint that twenty were
 * missing. The staff floor screen already walks the pages for exactly this reason; this is
 * the portal doing the same rather than trusting a floor to stay small.
 */
async function fetchAllFloorObjects(floorId: string): Promise<ObjectListItemDto[]> {
  const items: ObjectListItemDto[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const response = await portalService.listObjects(floorId, page);
    items.push(...response.items);
    totalPages = response.totalPages;
    page += 1;
  } while (page <= totalPages && page <= MAX_OBJECT_PAGES);
  return items;
}

export function PortalFloorPage(): ReactElement {
  const { buildingId, floorId } = useParams<{ buildingId: string; floorId: string }>();
  const navigate = useNavigate();
  // The band names in force, so a customer reads the operator's own wording.
  const bands = useRiskBands();

  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [plan, setPlan] = useState<FloorPlanDto | null>(null);
  const [objects, setObjects] = useState<ObjectListItemDto[]>([]);
  // Table-only view state. The plan and the unplaced count always see every object.
  const [objectSearch, setObjectSearch] = useState('');
  const [objectPage, setObjectPage] = useState(1);

  // The same filter the staff floor screen uses, imported rather than copied so the two
  // cannot answer differently for the same search term.
  const matchedObjects = filterFloorObjects(objects, objectSearch);
  const objectTotalPages = Math.max(1, Math.ceil(matchedObjects.length / OBJECT_TABLE_PAGE_SIZE));
  const visibleObjects = matchedObjects.slice(
    (objectPage - 1) * OBJECT_TABLE_PAGE_SIZE,
    objectPage * OBJECT_TABLE_PAGE_SIZE,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!floorId) return;
    setLoading(true);
    setError(null);
    setPlanError(null);

    try {
      const [record, allObjects] = await Promise.all([
        portalService.getFloor(floorId),
        fetchAllFloorObjects(floorId),
      ]);
      setFloor(record);
      setObjects(allObjects);

      try {
        setPlan(await portalService.getFloorPlan(floorId));
      } catch (caught) {
        setPlanError(
          caught instanceof ApiError ? caught.message : 'Төлөвлөгөө ачаалж чадсангүй.',
        );
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Давхар ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [floorId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !floor) {
    return (
      <ErrorState
        description={error ?? 'Давхар олдсонгүй.'}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  const unplaced = unplacedOnPlanCount(objects);

  const columns: Column<ObjectListItemDto>[] = [
    {
      key: 'name',
      header: 'Тоноглол',
      render: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">{row.name}</p>
          <p className="truncate text-xs text-slate-500">{row.code}</p>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Төрөл',
      render: (row) => <span className="text-slate-700">{row.objectType?.name ?? '-'}</span>,
    },
    {
      key: 'risk',
      header: 'Эрсдэл',
      render: (row) => (
        <span className="text-slate-700">
          {row.latestAssessment?.riskLevel
            ? riskLabelOf(row.latestAssessment.riskLevel, bands)
            : 'Үнэлгээгүй'}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={floor.name}
        description={floor.buildingName ?? undefined}
        backTo={{
          to: `/portal/sites/${buildingId ?? ''}`,
          label: 'Барилга руу буцах',
        }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Миний барилга', to: '/portal/sites' },
          { label: floor.buildingName ?? 'Барилга', to: `/portal/sites/${buildingId ?? ''}` },
          { label: floor.name },
        ]}
      />

      <div className="space-y-4">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Давхрын төлөвлөгөө</h2>

          {planError && (
            <EmptyState title="Төлөвлөгөө ачаалж чадсангүй" description={planError} />
          )}

          {!planError && plan === null && (
            <EmptyState
              title="Төлөвлөгөө байхгүй"
              description="Энэ давхарт зураг оруулаагүй байна. Тоноглолын жагсаалтыг доор харна уу."
            />
          )}

          {!planError && plan !== null && (
            <>
              <PortalFloorPlan
                plan={plan}
                objects={objects}
                onOpenObject={(object) =>
                  navigate(
                    `/portal/sites/${buildingId ?? ''}/floors/${floor.id}/objects/${object.id}`,
                  )
                }
              />
              {unplaced > 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  Планд байрлуулаагүй {unplaced} объект байна.
                </p>
              )}
            </>
          )}
        </div>

        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-sm font-semibold text-slate-900">Тоноглол</h2>
          </div>
          <div className="border-b border-slate-200 px-5 py-3">
            <label htmlFor="portal-floor-search" className={FILTER_LABEL}>
              Хайлт
            </label>
            <SearchField
              id="portal-floor-search"
              value={objectSearch}
              onChange={(event) => {
                setObjectSearch(event.target.value);
                // A narrower result rarely has the page the reader is standing on.
                setObjectPage(1);
              }}
              placeholder="Код, нэр эсвэл төрөл"
            />
          </div>
          <DataTable
            columns={columns}
            rows={visibleObjects}
            rowKey={(row) => row.id}
            numbering={{ page: objectPage, limit: OBJECT_TABLE_PAGE_SIZE }}
            onRowClick={(row) =>
              navigate(`/portal/sites/${buildingId ?? ''}/floors/${floor.id}/objects/${row.id}`)
            }
            emptyTitle={objectSearch ? 'Хайлтад тохирох тоноглол алга' : 'Тоноглол байхгүй'}
            emptyDescription={
              objectSearch
                ? 'Өөр түлхүүр үгээр хайж үзнэ үү.'
                : 'Энэ давхарт тоноглол бүртгэгдээгүй байна.'
            }
            ariaLabel="Тоноглол"
          />
          <Pagination
            page={objectPage}
            totalPages={objectTotalPages}
            total={matchedObjects.length}
            onPageChange={setObjectPage}
          />
        </div>
      </div>
    </>
  );
}
