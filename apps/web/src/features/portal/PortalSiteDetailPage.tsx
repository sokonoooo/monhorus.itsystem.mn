import type { BuildingDto, FloorDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';

/** One building: its floors, each a way into the drawing. */
export function PortalSiteDetailPage(): ReactElement {
  const { buildingId } = useParams<{ buildingId: string }>();
  const navigate = useNavigate();

  const [building, setBuilding] = useState<BuildingDto | null>(null);
  const [floors, setFloors] = useState<FloorDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!buildingId) return;
    setLoading(true);
    setError(null);
    try {
      const [record, floorPage] = await Promise.all([
        portalService.getBuilding(buildingId),
        portalService.listFloors(buildingId),
      ]);
      setBuilding(record);
      setFloors([...floorPage.items]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [buildingId]);

  useEffect(() => {
    void load();
  }, [load]);

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
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
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

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="border-b border-slate-200 px-5 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Давхар</h2>
        </div>
        <DataTable
          columns={columns}
          rows={floors}
          rowKey={(row) => row.id}
          onRowClick={(row) => navigate(`/portal/sites/${building.id}/floors/${row.id}`)}
          emptyTitle="Давхар байхгүй"
          emptyDescription="Энэ барилгад давхар бүртгэгдээгүй байна."
          ariaLabel="Давхар"
        />
      </div>
    </>
  );
}
