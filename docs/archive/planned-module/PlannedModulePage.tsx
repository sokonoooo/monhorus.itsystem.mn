import type { ReactElement } from 'react';
import { Link, useLocation } from 'react-router-dom';

import { PageHeader } from '../components/ui/PageHeader';
import { NAV_ITEMS, navItemByPath } from '../config/navigation';
import { useAuth } from '../contexts/auth-context';

/**
 * Placeholder for navigation entries that are not part of Phase 1.
 *
 * Rather than being a dead end, it lists the modules that do work and that the
 * current user is permitted to open, so a reviewer landing here can navigate
 * straight to something functional.
 */
export function PlannedModulePage(): ReactElement {
  const location = useLocation();
  const { canAny } = useAuth();

  const item = navItemByPath(location.pathname);
  const title = item?.label ?? 'Модуль';

  const workingModules = NAV_ITEMS.filter(
    (entry) =>
      entry.implemented && (entry.permissions.length === 0 || canAny(...entry.permissions)),
  );

  return (
    <>
      <PageHeader
        title={title}
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: title }]}
      />

      <div className="rounded-xl bg-white px-6 py-12 text-center ring-1 ring-slate-200">
        <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
          Хөгжүүлэлт төлөвлөгдсөн
        </span>
        <p className="mt-4 text-base font-semibold text-slate-900">{title}</p>
        <p className="mx-auto mt-1 max-w-lg text-sm text-slate-600">
          Энэ модуль дараагийн үе шатанд хэрэгжинэ. Одоогоор өгөгдөл харуулахгүй.
        </p>

        {workingModules.length > 0 && (
          <div className="mx-auto mt-8 max-w-lg border-t border-slate-200 pt-6">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Одоо ажиллаж байгаа модулиуд
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {workingModules.map((entry) => (
                <Link
                  key={entry.key}
                  to={entry.path}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                >
                  {entry.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
