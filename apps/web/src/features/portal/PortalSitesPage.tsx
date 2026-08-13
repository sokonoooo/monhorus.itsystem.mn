import type { BuildingDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { DataTable, type Column } from '../../components/ui/DataTable';
import { PageHeader } from '../../components/ui/PageHeader';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';

/**
 * The customer's own buildings.
 *
 * `GET /buildings` bounds itself to the caller's organisation server-side, so no
 * `customerId` is sent — it could not widen the answer, and sending one would imply it
 * might. Read-only by construction: every write path on the hierarchy is keyed on a staff
 * permission, so there is no edit control here to hide.
 */
export function PortalSitesPage(): ReactElement {
  const navigate = useNavigate();

  const [buildings, setBuildings] = useState<BuildingDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const result = await portalService.listBuildings();
      setBuildings([...result.items]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

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

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={buildings ?? []}
          rowKey={(row) => row.id}
          numbering
          loading={loading}
          error={error}
          onRetry={() => void load()}
          onRowClick={(row) => navigate(`/portal/sites/${row.id}`)}
          emptyTitle="Барилга байхгүй"
          emptyDescription="Танай байгууллагад бүртгэлтэй барилга алга байна."
        />
      </div>
    </>
  );
}
