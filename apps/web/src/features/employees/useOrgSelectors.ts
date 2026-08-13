import type { CompanyDto, DepartmentDto, PositionDto, TeamDto } from '@monhorus/shared';
import { useCallback, useEffect, useState } from 'react';

import { orgService } from '../../services/org.service';

export interface OrgSelectorState {
  companies: CompanyDto[];
  departments: DepartmentDto[];
  positions: PositionDto[];
  teams: TeamDto[];
  loading: boolean;
  error: string | null;
}

/**
 * How many options one selector may offer.
 *
 * The three org lists are paginated because they are management tables too, and a form
 * dropdown wants a list rather than a page. One deliberately large page is what a `<select>`
 * can usefully hold anyway: past a few hundred entries the control itself is the problem,
 * and the answer then is a searchable picker rather than a second page nobody can reach.
 */
const OPTION_LIMIT = 200;

/**
 * Dependent organisation selectors: Company -> Department -> Position / Team.
 *
 * Each level refetches when its parent changes. The caller is responsible for
 * clearing the child values; this hook only supplies the option lists, and the
 * backend independently rejects any mismatched combination that reaches it.
 */
export function useOrgSelectors(companyId: string, departmentId: string): OrgSelectorState {
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [positions, setPositions] = useState<PositionDto[]>([]);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = useCallback((message: string) => setError(message), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    orgService
      .companies({ limit: OPTION_LIMIT })
      .then((result) => {
        if (!cancelled) setCompanies(result.items);
      })
      .catch(() => fail('Компанийн жагсаалт ачаалж чадсангүй.'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fail]);

  useEffect(() => {
    let cancelled = false;

    if (!companyId) {
      setDepartments([]);
      return undefined;
    }

    orgService
      .departments({ companyId, limit: OPTION_LIMIT })
      .then((result) => {
        if (!cancelled) setDepartments(result.items);
      })
      .catch(() => fail('Албаны жагсаалт ачаалж чадсангүй.'));

    return () => {
      cancelled = true;
    };
  }, [companyId, fail]);

  useEffect(() => {
    let cancelled = false;

    if (!companyId) {
      setPositions([]);
      setTeams([]);
      return undefined;
    }

    Promise.all([
      orgService.positions({
        companyId,
        ...(departmentId ? { departmentId } : {}),
        limit: OPTION_LIMIT,
      }),
      orgService.teams(companyId, departmentId || undefined),
    ])
      .then(([positionResult, teamResult]) => {
        if (cancelled) return;
        setPositions(positionResult.items);
        setTeams(teamResult);
      })
      .catch(() => fail('Албан тушаал, багийн жагсаалт ачаалж чадсангүй.'));

    return () => {
      cancelled = true;
    };
  }, [companyId, departmentId, fail]);

  return { companies, departments, positions, teams, loading, error };
}
