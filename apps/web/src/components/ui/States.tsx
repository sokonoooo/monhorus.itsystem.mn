import type { ReactElement, ReactNode } from 'react';

/** Shared loading, empty, error and forbidden panels used across every module. */

export function Skeleton({ className = '' }: { className?: string }): ReactElement {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 6, columns = 5 }: { rows?: number; columns?: number }): ReactElement {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="Ачааллаж байна">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex gap-3">
          {Array.from({ length: columns }, (_, columnIndex) => (
            <Skeleton key={columnIndex} className="h-8 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

interface StatePanelProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: StatePanelProps): ReactElement {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Мэдээлэл ачаалж чадсангүй',
  description,
  action,
}: Partial<StatePanelProps>): ReactElement {
  return (
    <div className="px-6 py-16 text-center" role="alert">
      <p className="text-sm font-semibold text-red-700">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function ForbiddenState(): ReactElement {
  return (
    <div className="rounded-xl bg-white px-6 py-16 text-center ring-1 ring-slate-200" role="alert">
      <p className="text-sm font-semibold text-slate-900">Хандах эрхгүй</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
        Энэ хэсэгт хандах эрх байхгүй байна. Шаардлагатай бол системийн админтай холбогдоно уу.
      </p>
    </div>
  );
}

export function PlannedModuleState({ moduleName }: { moduleName: string }): ReactElement {
  return (
    <div className="rounded-xl bg-white px-6 py-20 text-center ring-1 ring-slate-200">
      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
        Хөгжүүлэлт төлөвлөгдсөн
      </span>
      <p className="mt-4 text-base font-semibold text-slate-900">{moduleName}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-slate-600">
        Энэ модуль дараагийн үе шатанд хэрэгжинэ. Одоогоор өгөгдөл харуулахгүй.
      </p>
    </div>
  );
}
