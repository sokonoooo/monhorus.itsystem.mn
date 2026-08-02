import type { ReactElement, ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Crumb {
  label: string;
  to?: string;
}

/** The parent a detail page returns to. */
export interface BackTarget {
  to: string;
  label: string;
}

interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbs?: readonly Crumb[];
  /**
   * Renders a back link above the title. Breadcrumbs alone are easy to miss, so every detail
   * page that has a parent also offers this single explicit way back.
   */
  backTo?: BackTarget;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  backTo,
  actions,
}: PageHeaderProps): ReactElement {
  return (
    <div className="mb-5">
      {backTo && (
        <Link
          to={backTo.to}
          className="mb-1.5 inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
        >
          <svg
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {backTo.label}
        </Link>
      )}

      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Замчлал" className="mb-1.5">
          <ol className="flex flex-wrap items-center gap-1 text-xs text-slate-500">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <span aria-hidden="true">/</span>}
                {crumb.to ? (
                  <Link to={crumb.to} className="hover:text-slate-700 hover:underline">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="text-slate-700">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* break-words keeps long Mongolian headings from overflowing the shell. */}
          <h1 className="break-words text-xl font-semibold text-slate-900">{title}</h1>
          {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
