import type { ListUsersQuery, PaginatedData, UserDto } from '@monhorus/shared';
import { useCallback, useEffect, useState } from 'react';

import { ApiError } from '../lib/api-client';
import { userService } from '../services/user.service';

interface UseUsersResult {
  data: PaginatedData<UserDto> | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useUsers(query: ListUsersQuery): UseUsersResult {
  const [data, setData] = useState<PaginatedData<UserDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Serialised so the effect depends on the query's value, not its object identity.
  const queryKey = JSON.stringify(query);

  const fetchUsers = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await userService.list(JSON.parse(queryKey) as ListUsersQuery));
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : 'Хэрэглэгчийн жагсаалт ачаалж чадсангүй.',
      );
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  return { data, loading, error, refetch: fetchUsers };
}
