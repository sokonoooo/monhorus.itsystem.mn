import { createContext, useContext, useId, type ReactElement, type ReactNode } from 'react';

import { FIELD_INPUT, FIELD_SELECT } from '../../components/ui/control-styles';

/**
 * Carries the generated input id from Field down to the control inside it.
 *
 * Without this the label and its control are not associated, which breaks both
 * assistive technology and label-based test queries. Using context keeps every
 * existing call site unchanged.
 */
const FieldIdContext = createContext<string | undefined>(undefined);

function useControlId(): string {
  const fromField = useContext(FieldIdContext);
  const fallback = useId();
  return fromField ?? fallback;
}

/**
 * Compact enterprise form primitives.
 *
 * A two-column grid on wide screens, single column below, with the label above the
 * control so long Mongolian labels wrap instead of squeezing the input.
 */

export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <fieldset>
      <legend className="mb-3 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
        {title}
      </legend>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3.5 md:grid-cols-2 xl:grid-cols-3">
        {children}
      </div>
    </fieldset>
  );
}

interface FieldProps {
  label: string;
  children: ReactNode;
  required?: boolean;
  error?: string | undefined;
  hint?: string | undefined;
}

export function Field({ label, children, required, error, hint }: FieldProps): ReactElement {
  const controlId = useId();

  return (
    <div className="min-w-0">
      <label
        htmlFor={controlId}
        className="mb-1 block break-words text-xs font-medium text-slate-600"
      >
        {label}
        {required && <span className="ml-0.5 text-red-600">*</span>}
      </label>
      <FieldIdContext.Provider value={controlId}>{children}</FieldIdContext.Provider>
      {error && (
        <p id={`${controlId}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      {!error && hint && (
        <p id={`${controlId}-hint`} className="mt-1 text-xs text-slate-500">
          {hint}
        </p>
      )}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  type = 'text',
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
}): ReactElement {
  const id = useControlId();
  return (
    <input
      id={id}
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD_INPUT}
    />
  );
}

export interface Option {
  value: string;
  label: string;
}

export function SelectInput({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  options: readonly Option[];
  placeholder?: string;
  disabled?: boolean;
}): ReactElement {
  const id = useControlId();
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
      className={FIELD_SELECT}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
