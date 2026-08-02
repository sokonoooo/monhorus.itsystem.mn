import { forwardRef, type InputHTMLAttributes } from 'react';

import { FILTER_INPUT, FILTER_INPUT_ERROR } from './control-styles';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | undefined;
  hint?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, id, className = '', ...rest },
  ref,
) {
  const inputId = id ?? `field-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;

  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-slate-700">
        {label}
        {rest.required === true && <span className="ml-1 text-red-600">*</span>}
      </label>
      <input
        {...rest}
        id={inputId}
        ref={ref}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={`${error ? FILTER_INPUT_ERROR : FILTER_INPUT} ${className}`}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${inputId}-hint`} className="text-sm text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
});
