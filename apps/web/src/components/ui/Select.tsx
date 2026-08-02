import { forwardRef, type SelectHTMLAttributes } from 'react';

import { FILTER_SELECT, FILTER_SELECT_ERROR } from './control-styles';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: SelectOption[];
  error?: string | undefined;
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, options, error, placeholder, id, className = '', ...rest },
  ref,
) {
  const selectId = id ?? `select-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <div className="space-y-1.5">
      <label htmlFor={selectId} className="block text-sm font-medium text-slate-700">
        {label}
        {rest.required === true && <span className="ml-1 text-red-600">*</span>}
      </label>
      <select
        {...rest}
        id={selectId}
        ref={ref}
        aria-invalid={error ? 'true' : undefined}
        className={`${error ? FILTER_SELECT_ERROR : FILTER_SELECT} w-full ${className}`}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
});
