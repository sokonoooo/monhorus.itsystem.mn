import type { CompanyDto, DepartmentListItemDto } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { orgService } from '../../services/org.service';

/**
 * One page of options is the whole list, as far as a `<select>` is concerned.
 *
 * The org lists are paginated for their management tables; a dropdown wants every choice
 * at once, and past a few hundred entries a native select is the wrong control anyway.
 *
 * 100 is the ceiling `paginationQuerySchema` enforces, and `validate` rejects an over-ask
 * rather than clamping it. See the longer note in `features/employees/useOrgSelectors.ts`:
 * this was 200, and because both fetches here are wrapped in `.catch(() => undefined)` the
 * resulting 400 surfaced as an empty filter rather than as an error.
 */
const OPTION_LIMIT = 100;

/**
 * The companies a record may be filed under, and the departments of one of them.
 *
 * Only active records are asked for: these feed the pickers on the forms and the filter
 * bars, and a deactivated company exists so that what is already assigned to it keeps
 * working, not so that something new can be assigned to it. A row that already points at a
 * deactivated parent still shows its name, because the list rows carry `companyName` and
 * `departmentName` rather than resolving them through these lists.
 */
export function useCompanyOptions(): readonly CompanyDto[] {
  const [companies, setCompanies] = useState<readonly CompanyDto[]>([]);

  useEffect(() => {
    let cancelled = false;

    orgService
      .companies({ limit: OPTION_LIMIT })
      // A picker that will not load leaves the page usable; the table beside it carries its
      // own error state, and a second banner for a dropdown would only obscure it.
      .then((result) => {
        if (!cancelled) setCompanies(result.items);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return companies;
}

/** The departments of one company, or nothing at all until a company is chosen. */
export function useDepartmentOptions(companyId: string): readonly DepartmentListItemDto[] {
  const [departments, setDepartments] = useState<readonly DepartmentListItemDto[]>([]);

  useEffect(() => {
    if (!companyId) {
      setDepartments([]);
      return undefined;
    }

    let cancelled = false;

    orgService
      .departments({ companyId, limit: OPTION_LIMIT })
      .then((result) => {
        if (!cancelled) setDepartments(result.items);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [companyId]);

  return departments;
}
