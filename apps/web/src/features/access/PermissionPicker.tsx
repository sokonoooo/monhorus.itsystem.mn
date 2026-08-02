import {
  PERMISSION_MODULE_LABELS,
  type PermissionKey,
  type PermissionModule,
} from '@monhorus/shared';
import { useMemo, type ReactElement } from 'react';

import type { PermissionCatalogueEntry } from '../../services/rbac.service';

interface PermissionPickerProps {
  catalogue: readonly PermissionCatalogueEntry[];
  selected: readonly PermissionKey[];
  onChange: (next: PermissionKey[]) => void;
  disabled?: boolean;
}

/**
 * Groups the shared permission catalogue by module.
 *
 * The catalogue comes from the backend, which materialises it from
 * packages/shared, so this screen never holds a second copy of the permission list.
 */
export function PermissionPicker({
  catalogue,
  selected,
  onChange,
  disabled = false,
}: PermissionPickerProps): ReactElement {
  const grouped = useMemo(() => {
    const groups = new Map<string, PermissionCatalogueEntry[]>();
    for (const entry of catalogue) {
      const list = groups.get(entry.module) ?? [];
      list.push(entry);
      groups.set(entry.module, list);
    }
    return [...groups.entries()];
  }, [catalogue]);

  const selectedSet = new Set(selected);

  function toggle(key: PermissionKey): void {
    const next = new Set(selectedSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange([...next]);
  }

  function toggleModule(entries: PermissionCatalogueEntry[], allSelected: boolean): void {
    const next = new Set(selectedSet);
    for (const entry of entries) {
      if (allSelected) next.delete(entry.key);
      else next.add(entry.key);
    }
    onChange([...next]);
  }

  return (
    <div className="space-y-3">
      {grouped.map(([module, entries]) => {
        const allSelected = entries.every((entry) => selectedSet.has(entry.key));
        const someSelected = entries.some((entry) => selectedSet.has(entry.key));

        const moduleLabel = PERMISSION_MODULE_LABELS[module as PermissionModule] ?? module;

        return (
          // aria-label rather than a visually hidden legend: a legend would duplicate
          // the visible header, giving the group two identical accessible names.
          <fieldset key={module} aria-label={moduleLabel} className="rounded-lg ring-1 ring-slate-200">
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
              <span className="text-xs font-semibold text-slate-700">{moduleLabel}</span>
              <button
                type="button"
                onClick={() => toggleModule(entries, allSelected)}
                disabled={disabled}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-700 disabled:text-slate-400"
              >
                {allSelected ? 'Бүгдийг цуцлах' : 'Бүгдийг сонгох'}
                {someSelected && !allSelected ? ` (${entries.filter((e) => selectedSet.has(e.key)).length}/${entries.length})` : ''}
              </button>
            </div>
            <div className="grid grid-cols-1 gap-1 p-2 sm:grid-cols-2">
              {entries.map((entry) => (
                <label
                  key={entry.key}
                  className="flex items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selectedSet.has(entry.key)}
                    onChange={() => toggle(entry.key)}
                    disabled={disabled}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-slate-800">{entry.label}</span>
                    <span className="block truncate font-mono text-[10px] text-slate-400">
                      {entry.key}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
