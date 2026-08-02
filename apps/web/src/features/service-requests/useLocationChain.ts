import {
  OBJECT_HIERARCHY_ORDER,
  type CustomerDto,
  type ObjectNodeDto,
  type ObjectNodeKind,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { objectService } from '../../services/object.service';

/** Levels selectable on the request form, below the customer. */
export const LOCATION_LEVELS: readonly ObjectNodeKind[] = OBJECT_HIERARCHY_ORDER.filter(
  (kind) => kind !== 'CUSTOMER',
);

export type LocationSelection = Partial<Record<ObjectNodeKind, string>>;

interface UseLocationChainResult {
  customers: CustomerDto[];
  options: Partial<Record<ObjectNodeKind, ObjectNodeDto[]>>;
  selection: LocationSelection;
  loadingKind: ObjectNodeKind | null;
  error: string | null;
  selectCustomer: (customerId: string) => void;
  selectNode: (kind: ObjectNodeKind, nodeId: string) => void;
  customerId: string;
}

/**
 * Dependent location selector for the service-request form.
 *
 * Selecting a level clears every deeper level and cancels their in-flight requests,
 * so a stale id from a previously chosen parent can never be submitted. The backend
 * independently re-validates the whole chain.
 */
export function useLocationChain(): UseLocationChainResult {
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [selection, setSelection] = useState<LocationSelection>({});
  const [options, setOptions] = useState<Partial<Record<ObjectNodeKind, ObjectNodeDto[]>>>({});
  const [loadingKind, setLoadingKind] = useState<ObjectNodeKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Monotonic counter per level; a response from a superseded request is discarded.
  const requestIds = useRef<Partial<Record<ObjectNodeKind, number>>>({});

  useEffect(() => {
    let cancelled = false;
    objectService
      .customers()
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch(() => setError('Харилцагчийн жагсаалт ачаалж чадсангүй.'));

    return () => {
      cancelled = true;
    };
  }, []);

  const fetchLevel = useCallback(
    async (kind: ObjectNodeKind, parentId: string, isRoot: boolean): Promise<void> => {
      const nextId = (requestIds.current[kind] ?? 0) + 1;
      requestIds.current[kind] = nextId;

      setLoadingKind(kind);
      try {
        const result = isRoot
          ? await objectService.rootNodes(parentId, kind)
          : await objectService.children(parentId);

        // Discard if a newer request for this level has started.
        if (requestIds.current[kind] !== nextId) return;
        setOptions((previous) => ({ ...previous, [kind]: result }));
      } catch {
        if (requestIds.current[kind] !== nextId) return;
        setError('Объектын жагсаалт ачаалж чадсангүй.');
        setOptions((previous) => ({ ...previous, [kind]: [] }));
      } finally {
        if (requestIds.current[kind] === nextId) setLoadingKind(null);
      }
    },
    [],
  );

  const selectCustomer = useCallback(
    (nextCustomerId: string): void => {
      setCustomerId(nextCustomerId);
      setSelection({});
      setOptions({});
      setError(null);

      if (nextCustomerId) {
        void fetchLevel('PROJECT', nextCustomerId, true);
      }
    },
    [fetchLevel],
  );

  const selectNode = useCallback(
    (kind: ObjectNodeKind, nodeId: string): void => {
      const levelIndex = LOCATION_LEVELS.indexOf(kind);

      setSelection((previous) => {
        const next: LocationSelection = {};
        // Keep only levels above the one being changed.
        for (let index = 0; index < levelIndex; index += 1) {
          const key = LOCATION_LEVELS[index];
          if (key && previous[key]) next[key] = previous[key];
        }
        if (nodeId) next[kind] = nodeId;
        return next;
      });

      setOptions((previous) => {
        const next: Partial<Record<ObjectNodeKind, ObjectNodeDto[]>> = {};
        for (let index = 0; index <= levelIndex; index += 1) {
          const key = LOCATION_LEVELS[index];
          if (key && previous[key]) next[key] = previous[key];
        }
        return next;
      });

      // Invalidate deeper levels so a late response cannot repopulate them.
      for (let index = levelIndex + 1; index < LOCATION_LEVELS.length; index += 1) {
        const key = LOCATION_LEVELS[index];
        if (key) requestIds.current[key] = (requestIds.current[key] ?? 0) + 1;
      }

      const childKind = LOCATION_LEVELS[levelIndex + 1];
      if (nodeId && childKind) {
        void fetchLevel(childKind, nodeId, false);
      }
    },
    [fetchLevel],
  );

  return {
    customers,
    options,
    selection,
    loadingKind,
    error,
    selectCustomer,
    selectNode,
    customerId,
  };
}
