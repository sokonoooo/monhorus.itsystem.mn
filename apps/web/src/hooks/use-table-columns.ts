import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Column } from '../components/ui/DataTable';

/**
 * Per-user column preferences for one table.
 *
 * Stored in `localStorage` rather than on the server. A column choice is a private view
 * preference with no consequence if it is lost, it must apply the instant it is toggled,
 * and putting it behind a request would mean a round trip on every checkbox. The dashboard
 * layout is on the server because it is worth carrying between machines; this is not.
 *
 * The stored order is reconciled against the table's real columns on every read, so a
 * column the screen has since dropped disappears and a new one appears at its natural
 * position rather than being silently hidden from whoever customised earliest.
 */
export interface ColumnPreference {
  key: string;
  visible: boolean;
}

const STORAGE_PREFIX = 'monhorus.table.';

function storageKey(tableKey: string): string {
  return `${STORAGE_PREFIX}${tableKey}`;
}

function readStored(tableKey: string): ColumnPreference[] | null {
  try {
    const raw = localStorage.getItem(storageKey(tableKey));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed.filter(
      (entry): entry is ColumnPreference =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as ColumnPreference).key === 'string' &&
        typeof (entry as ColumnPreference).visible === 'boolean',
    );
  } catch {
    // A corrupt or unreadable preference falls back to the table's own order rather than
    // taking the screen down with it.
    return null;
  }
}

/**
 * Merges a stored preference with the columns the table actually declares.
 *
 * Unknown keys are dropped and missing ones appended in their declared position, so the
 * result always covers exactly the current column set.
 */
export function reconcileColumns<T>(
  columns: ReadonlyArray<Column<T>>,
  stored: readonly ColumnPreference[] | null,
): ColumnPreference[] {
  const declared = new Map(columns.map((column, index) => [column.key, index]));

  if (!stored) {
    return columns.map((column) => ({ key: column.key, visible: true }));
  }

  const kept = stored.filter((entry) => declared.has(entry.key));
  const present = new Set(kept.map((entry) => entry.key));

  const appended = columns
    .filter((column) => !present.has(column.key))
    .map((column) => ({ key: column.key, visible: true }));

  // A new column is inserted where the table declares it, not dumped at the end, so a
  // familiar table does not rearrange itself around the newcomer.
  const merged = [...kept, ...appended];
  merged.sort((left, right) => {
    const leftKept = present.has(left.key);
    const rightKept = present.has(right.key);
    if (leftKept && rightKept) {
      return kept.findIndex((e) => e.key === left.key) - kept.findIndex((e) => e.key === right.key);
    }
    if (!leftKept && !rightKept) {
      return (declared.get(left.key) ?? 0) - (declared.get(right.key) ?? 0);
    }
    return leftKept ? -1 : 1;
  });

  return merged;
}

export interface TableColumnsController<T> {
  /** Visible columns in the caller's chosen order, ready to hand to the table. */
  visibleColumns: ReadonlyArray<Column<T>>;
  /** Every column with its current state, for the picker. */
  preferences: readonly ColumnPreference[];
  /** Label lookup for the picker. */
  labelOf: (key: string) => string;
  toggle: (key: string) => void;
  move: (key: string, direction: -1 | 1) => void;
  reset: () => void;
  isCustomised: boolean;
}

export function useTableColumns<T>(
  tableKey: string,
  columns: ReadonlyArray<Column<T>>,
): TableColumnsController<T> {
  const [preferences, setPreferences] = useState<ColumnPreference[]>(() =>
    reconcileColumns(columns, readStored(tableKey)),
  );
  const [isCustomised, setIsCustomised] = useState(() => readStored(tableKey) !== null);

  // The declared column set can change between renders of the same table, for example
  // when a permission resolves and unlocks a cost column.
  const declaredKeys = columns.map((column) => column.key).join('|');
  useEffect(() => {
    setPreferences(reconcileColumns(columns, readStored(tableKey)));
    // `columns` is rebuilt on every render by most callers, so the key list is the honest
    // dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, declaredKeys]);

  const persist = useCallback(
    (next: ColumnPreference[]): void => {
      setPreferences(next);
      setIsCustomised(true);
      try {
        localStorage.setItem(storageKey(tableKey), JSON.stringify(next));
      } catch {
        // A full or blocked storage quota must not stop the column from toggling.
      }
    },
    [tableKey],
  );

  const columnByKey = useMemo(
    () => new Map(columns.map((column) => [column.key, column])),
    [columns],
  );

  const visibleColumns = useMemo(
    () =>
      preferences
        .filter((entry) => entry.visible)
        .map((entry) => columnByKey.get(entry.key))
        .filter((column): column is Column<T> => column !== undefined),
    [preferences, columnByKey],
  );

  const toggle = useCallback(
    (key: string): void => {
      const next = preferences.map((entry) =>
        entry.key === key ? { ...entry, visible: !entry.visible } : entry,
      );
      // Hiding the last column would leave an unrecoverable empty table.
      if (next.every((entry) => !entry.visible)) return;
      persist(next);
    },
    [preferences, persist],
  );

  const move = useCallback(
    (key: string, direction: -1 | 1): void => {
      const index = preferences.findIndex((entry) => entry.key === key);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= preferences.length) return;

      const next = [...preferences];
      const moved = next[index]!;
      next[index] = next[target]!;
      next[target] = moved;
      persist(next);
    },
    [preferences, persist],
  );

  const reset = useCallback((): void => {
    try {
      localStorage.removeItem(storageKey(tableKey));
    } catch {
      // Nothing to recover from: the in-memory reset below is what the user sees.
    }
    setPreferences(reconcileColumns(columns, null));
    setIsCustomised(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tableKey, declaredKeys]);

  const labelOf = useCallback(
    (key: string): string => columnByKey.get(key)?.header ?? key,
    [columnByKey],
  );

  return { visibleColumns, preferences, labelOf, toggle, move, reset, isCustomised };
}
