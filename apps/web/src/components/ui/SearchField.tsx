import { forwardRef, type InputHTMLAttributes, type ReactElement } from 'react';

import { FILTER_SEARCH } from './control-styles';

/**
 * A search box with a magnifier inside it.
 *
 * Purely presentational. Every prop is forwarded to the `input`, so each page keeps the
 * commit behaviour it already had — some filter on Enter and on blur, some filter as you
 * type — and this changes only how the box looks. The native clear affordance is left
 * alone for the same reason.
 *
 * The icon is `pointer-events-none` so clicking it focuses the field underneath rather
 * than swallowing the click.
 */
interface SearchFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Layout classes for the wrapper, not the input.
   *
   * The magnifier has to be positioned against something, so the input gained a parent.
   * A call site that sized the input itself — `flex-1`, a min-width — must put those on
   * the wrapper instead, or the box collapses to its intrinsic width inside a flex row.
   */
  wrapperClassName?: string;
}

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(
  function SearchField({ className = '', wrapperClassName = '', ...rest }, ref): ReactElement {
    return (
      <div className={`relative ${wrapperClassName}`}>
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        <input ref={ref} type="search" {...rest} className={`${FILTER_SEARCH} ${className}`} />
      </div>
    );
  },
);
