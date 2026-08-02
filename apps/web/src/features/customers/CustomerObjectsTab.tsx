import type { BuildingDto, ProjectDto } from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { projectService } from '../../services/project.service';
import { BuildingRiskChart } from './BuildingRiskChart';

function Stat({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

/**
 * The customer's projects and where the risk sits in each.
 *
 * A bar per building, sized by how many objects it holds and segmented by risk band, so
 * the question "where is the risk" is answerable at a glance. The building and floor
 * counts come from the project record; the bands come from each building's own roll-up.
 */
export function CustomerObjectsTab({ customerId }: { customerId: string }): ReactElement {
  const [projects, setProjects] = useState<ProjectDto[] | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<BuildingDto[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    projectService
      .listProjects({ customerId, limit: 100 })
      .then((page) => {
        if (cancelled) return;
        const items = page.items as ProjectDto[];
        setProjects(items);
        setSelectedProjectId(items[0]?.id ?? null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof ApiError ? caught.message : 'Төсөл ачаалж чадсангүй.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const loadBuildings = useCallback(async (projectId: string): Promise<void> => {
    setBuildingsLoading(true);
    setError(null);
    try {
      const page = await projectService.listBuildings({ projectId, limit: 100 });
      setBuildings(page.items as BuildingDto[]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Барилга ачаалж чадсангүй.');
    } finally {
      setBuildingsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) void loadBuildings(selectedProjectId);
  }, [selectedProjectId, loadBuildings]);

  if (loading) return <Skeleton className="h-80 w-full" />;
  if (error && !buildings) return <ErrorState description={error} />;

  if (!projects || projects.length === 0) {
    return (
      <EmptyState
        title="Төсөл бүртгэгдээгүй"
        description="Энэ харилцагчид төсөл бүртгэгдээгүй байна."
      />
    );
  }

  const project = projects.find((entry) => entry.id === selectedProjectId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="viz-project" className={FILTER_LABEL}>
            Төсөл
          </label>
          <select
            id="viz-project"
            value={selectedProjectId ?? ''}
            onChange={(event) => setSelectedProjectId(event.target.value)}
            className={FILTER_SELECT}
          >
            {projects.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </div>

        {selectedProjectId && (
          <Link
            to={`/projects/${selectedProjectId}`}
            className="text-xs font-medium text-blue-600 hover:underline"
          >
            Төслийн дэлгэрэнгүй
          </Link>
        )}
      </div>

      {project && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Барилга" value={project.buildingCount} />
          <Stat label="Давхар" value={project.floorCount} />
          <Stat label="Объект" value={project.objectCount} />
          <Stat label="Үнэлгээгүй" value={project.riskSummary.unassessedCount} />
        </div>
      )}

      {buildingsLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : !buildings || buildings.length === 0 ? (
        <EmptyState
          title="Барилга бүртгэгдээгүй"
          description="Энэ төсөлд барилга бүртгэгдээгүй байна."
        />
      ) : (
        <BuildingRiskChart buildings={buildings} />
      )}
    </div>
  );
}
