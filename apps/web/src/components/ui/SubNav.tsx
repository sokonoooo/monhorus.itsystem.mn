import type { ReactElement } from 'react';
import { NavLink } from 'react-router-dom';

import { useAuth } from '../../contexts/auth-context';
import type { SubNavItem } from '../../config/navigation';

/**
 * Tabs for a screen that belongs to a parent module.
 *
 * Each tab is permission-gated the same way a sidebar entry is, so a caller without
 * dispatch.view simply does not see the board tab rather than meeting a 403 after
 * clicking it. A single remaining tab renders nothing: a lone tab is noise.
 */
export function SubNav({ items }: { items: readonly SubNavItem[] }): ReactElement | null {
  const { canAny } = useAuth();

  const visible = items.filter(
    (item) => item.permissions.length === 0 || canAny(...item.permissions),
  );

  if (visible.length < 2) return null;

  return (
    <nav aria-label="Дэд цэс" className="mb-4 border-b border-slate-200">
      <ul className="-mb-px flex flex-wrap gap-1">
        {visible.map((item) => (
          <li key={item.key}>
            <NavLink
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `inline-block border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                }`
              }
            >
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
