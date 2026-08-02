import type { ReactElement, ReactNode } from 'react';

type Variant = 'info' | 'success' | 'warning' | 'error';

const STYLES: Record<Variant, string> = {
  info: 'bg-blue-50 text-blue-800 ring-blue-200',
  success: 'bg-green-50 text-green-800 ring-green-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  error: 'bg-red-50 text-red-800 ring-red-200',
};

interface AlertProps {
  variant?: Variant;
  title?: string;
  children: ReactNode;
}

export function Alert({ variant = 'info', title, children }: AlertProps): ReactElement {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`rounded-lg p-3 ring-1 ring-inset ${STYLES[variant]}`}
    >
      {title && <p className="text-sm font-semibold">{title}</p>}
      <div className="text-sm">{children}</div>
    </div>
  );
}
