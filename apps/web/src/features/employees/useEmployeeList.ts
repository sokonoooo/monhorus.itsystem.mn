import type { EmployeeListItemDto, EmployeeListQuery, PaginatedData } from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';

interface UseEmployeeListResult {
  data: PaginatedData<EmployeeListItemDto> | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/**
 * Employee list fetch.
 *
 * The query is serialised into the dependency so the effect reacts to its value
 * rather than its object identity, and a request counter discards responses that
 * arrive after a newer one, which is the usual cause of a list flickering back to
 * stale rows when a user types quickly into the search box.
 */
export function useEmployeeList(query: EmployeeListQuery): UseEmployeeListResult {
  const [data, setData] = useState<PaginatedData<EmployeeListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);
  const queryKey = JSON.stringify(query);

  const fetchList = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result = await employeeService.list(JSON.parse(queryKey) as EmployeeListQuery);
      if (requestId !== requestIdRef.current) return;
      setData(result);
    } catch (caught) {
      if (requestId !== requestIdRef.current) return;
      setError(
        caught instanceof ApiError ? caught.message : 'Ажилтны жагсаалт ачаалж чадсангүй.',
      );
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  return { data, loading, error, refetch: fetchList };
}
