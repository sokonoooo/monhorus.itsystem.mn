import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { TableColumnsController } from '../../hooks/use-table-columns';

/**
 * Column chooser for a table.
 *
 * A popover rather than a drawer: choosing columns is a small adjustment made while
 * looking at the table, and a full-screen panel would hide the thing being adjusted.
 * Reordering uses buttons so a keyboard reaches it as easily as a mouse.
 */
export function ColumnPicker<T>({
  controller,
}: {
  controller: TableColumnsController<T>;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent): void {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const hiddenCount = controller.preferences.filter((entry) => !entry.visible).length;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50"
      >
        <svg
          className="h-3.5 w-3.5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h10M4 18h6" strokeLinecap="round" />
        </svg>
        Багана
        {hiddenCount > 0 && (
          <span className="rounded-full bg-slate-200 px-1.5 text-[10px] text-slate-700">
            {hiddenCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="group"
          aria-label="Баганын тохиргоо"
          className="absolute right-0 z-30 mt-1 w-64 rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200"
        >
          <ul className="max-h-72 space-y-0.5 overflow-y-auto">
            {controller.preferences.map((entry, index) => (
              <li key={entry.key} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-50">
                <input
                  type="checkbox"
                  id={`col-${entry.key}`}
                  checked={entry.visible}
                  onChange={() => controller.toggle(entry.key)}
                  className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                />
                <label
                  htmlFor={`col-${entry.key}`}
                  className="min-w-0 flex-1 cursor-pointer truncate text-xs text-slate-700"
                >
                  {controller.labelOf(entry.key)}
                </label>
                <button
                  type="button"
                  onClick={() => controller.move(entry.key, -1)}
                  disabled={index === 0}
                  aria-label={`${controller.labelOf(entry.key)} дээш`}
                  className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => controller.move(entry.key, 1)}
                  disabled={index === controller.preferences.length - 1}
                  aria-label={`${controller.labelOf(entry.key)} доош`}
                  className="rounded px-1 text-[11px] text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                >
                  ↓
                </button>
              </li>
            ))}
          </ul>

          {controller.isCustomised && (
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                type="button"
                onClick={controller.reset}
                className="w-full rounded-md px-2 py-1 text-left text-xs font-medium text-blue-600 hover:bg-blue-50"
              >
                Үндсэн байдалд
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
