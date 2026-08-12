import {
  RISK_LEVEL_LABELS,
  type FloorDto,
  type FloorPlanDto,
  type ObjectListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalFloorPlan, unplacedOnPlanCount } from './PortalFloorPlan';

/**
 * One floor: the drawing, with the equipment on it.
 *
 * The plan and the equipment list are two reads because the plan is optional — a floor
 * without a drawing is a normal state, not a failure, and the equipment list is useful on
 * its own. A failed plan read therefore does not take the page down.
 */
export function PortalFloorPage(): ReactElement {
  const { buildingId, floorId } = useParams<{ buildingId: string; floorId: string }>();
  const navigate = useNavigate();

  const [floor, setFloor] = useState<FloorDto | null>(null);
  const [plan, setPlan] = useState<FloorPlanDto | null>(null);
  const [objects, setObjects] = useState<ObjectListItemDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!floorId) return;
    setLoading(true);
    setError(null);
    setPlanError(null);

    try {
      const [record, objectPage] = await Promise.all([
        portalService.getFloor(floorId),
        portalService.listObjects(floorId),
      ]);
      setFloor(record);
      setObjects([...objectPage.items]);

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
            ? RISK_LEVEL_LABELS[row.latestAssessment.riskLevel]
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
          <DataTable
            columns={columns}
            rows={objects}
            rowKey={(row) => row.id}
            onRowClick={(row) =>
              navigate(`/portal/sites/${buildingId ?? ''}/floors/${floor.id}/objects/${row.id}`)
            }
            emptyTitle="Тоноглол байхгүй"
            emptyDescription="Энэ давхарт тоноглол бүртгэгдээгүй байна."
            ariaLabel="Тоноглол"
          />
        </div>
      </div>
    </>
  );
}
