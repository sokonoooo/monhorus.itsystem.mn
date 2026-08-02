import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';

/**
 * The row actions of a table, behind one button.
 *
 * Every table used to print its actions as a row of small text buttons, which made the
 * action column the widest thing on the page and put Устгах one mis-click away from Засах.
 * A single control that opens a menu costs one tap and gives the destructive item somewhere
 * it cannot be hit by accident.
 */

export interface RowActionItem {
  label: string;
  /** What the item does. Omit when the item only navigates and carries `to` instead. */
  onSelect?: () => void;
  /**
   * Route for an item that only navigates.
   *
   * Rendered as a real link so the browser keeps its own behaviour: middle-click and
   * cmd-click still open the row in a new tab. These actions used to be plain links in the
   * table, and putting them behind a button would have quietly taken that away.
   */
  to?: string;
  /** Destructive actions are coloured and always sorted to the end. */
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /** Why the item is disabled. Shown so a greyed-out action is not a dead end. */
  disabledReason?: string;
}

/**
 * The menu is positioned against the viewport rather than the button.
 *
 * A table scrolls horizontally and clips its own overflow, so a menu positioned inside the
 * row would be cut off at the table edge on exactly the narrow screens that need it most.
 */
function menuPosition(anchor: DOMRect, menu: DOMRect): { top: number; left: number } {
  const margin = 8;
  const below = anchor.bottom + 4;
  const fitsBelow = below + menu.height + margin <= window.innerHeight;

  return {
    top: fitsBelow ? below : Math.max(margin, anchor.top - menu.height - 4),
    left: Math.max(
      margin,
      Math.min(anchor.right - menu.width, window.innerWidth - menu.width - margin),
    ),
  };
}

export function RowActions({
  items,
  label = 'Үйлдэл',
}: {
  items: readonly RowActionItem[];
  label?: string;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Destructive last, so it is never the item under the cursor when the menu opens.
  const ordered = [...items].sort(
    (a, b) => Number(a.tone === 'danger') - Number(b.tone === 'danger'),
  );

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    setPosition(
      menuPosition(
        buttonRef.current.getBoundingClientRect(),
        menuRef.current.getBoundingClientRect(),
      ),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    function handlePointerDown(event: MouseEvent): void {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    // A menu pinned to the viewport would otherwise drift away from its row.
    function close(): void {
      setOpen(false);
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  if (ordered.length === 0) return null;

  return (
    // The row beneath is usually clickable. Every event is stopped here so opening the menu
    // never also navigates away from the row being acted on.
    <div
      className="flex justify-end"
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      role="presentation"
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>

      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          style={{
            position: 'fixed',
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            // Kept out of sight until measured, so it never flashes in the wrong place.
            visibility: position ? 'visible' : 'hidden',
          }}
          className="z-50 min-w-[10rem] overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-slate-200"
        >
          {ordered.map((item) => {
            const tone =
              item.tone === 'danger'
                ? 'text-red-600 hover:bg-red-50 disabled:hover:bg-transparent'
                : 'text-slate-700 hover:bg-slate-50 disabled:hover:bg-transparent';
            const shape = `block w-full px-3 py-1.5 text-left text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${tone}`;

            if (item.to !== undefined && !item.disabled) {
              return (
                <Link
                  key={item.label}
                  to={item.to}
                  role="menuitem"
                  onClick={() => setOpen(false)}
                  className={shape}
                >
                  {item.label}
                </Link>
              );
            }

            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                title={item.disabled ? item.disabledReason : undefined}
                onClick={() => {
                  setOpen(false);
                  item.onSelect?.();
                }}
                className={shape}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
