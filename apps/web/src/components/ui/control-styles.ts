/**
 * The look of every text box, dropdown and search field in the admin console.
 *
 * These were inline class strings before, copied per call site, and they had drifted:
 * 26 filter dropdowns carried one spelling, four form dropdowns carried another with a
 * different padding scale, two more were one-offs, and the focus ring was `focus:ring-2
 * focus:ring-blue-600` in some places and `focus:ring-2 focus:ring-inset
 * focus:ring-blue-600` in others — visibly different, because without `inset` the ring is
 * painted outside the box and nudges its neighbours in a tight filter row.
 *
 * There are two sizes, not two designs. `FIELD_*` is the dense size used inside forms,
 * where a three-column grid puts a lot of controls on screen at once; `FILTER_*` is the
 * roomier size used in the filter bar above a table and anywhere a control stands alone.
 * Everything else — radius, ring, hover, focus, disabled — is shared, which is what makes
 * the two read as one system rather than as two.
 *
 * The `_ERROR` variants are whole classes rather than something to append. Tailwind
 * decides between two utilities that set the same property by their order in the
 * generated stylesheet, NOT by their order in the class attribute, so
 * `${INPUT} ${error ? 'ring-red-400' : ''}` does not reliably turn the ring red. The
 * colours have to be mutually exclusive at the point of use.
 */

/** Rounding, surface and border width. The one thing every control has in common. */
const SURFACE = 'rounded-lg border-0 bg-white text-slate-900 shadow-sm ring-1 ring-inset';

/**
 * Inset on purpose — see the note above about rings nudging their neighbours.
 *
 * The hover is a ring darkening rather than a background change: several of these sit on
 * a white card, and a background hover would make the control vanish into it.
 */
const RING_DEFAULT = 'ring-slate-300 hover:ring-slate-400 focus:ring-blue-600';
const RING_ERROR = 'ring-red-400 hover:ring-red-400 focus:ring-red-600';
/** Settings marks a field the operator has changed but not yet saved. */
const RING_DIRTY = 'ring-blue-400 hover:ring-blue-500 focus:ring-blue-600';

const FOCUS = 'focus:outline-none focus:ring-2 focus:ring-inset';

const DISABLED =
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 disabled:shadow-none disabled:hover:ring-slate-300';

const PLACEHOLDER = 'placeholder:text-slate-400';

/**
 * Room for the chevron drawn by `.select-chevron` in `index.css`.
 *
 * The native chevron is given up (`appearance-none`) because it is drawn by the operating
 * system: it is a different glyph, size and colour on macOS, Windows and Linux, so the
 * control that appears most often in this UI was the one that looked different on every
 * machine.
 */
const CHEVRON = 'select-chevron cursor-pointer appearance-none';

// -- Inside a form ----------------------------------------------------------

const FIELD_BOX = `block w-full px-2.5 py-1.5 text-sm ${SURFACE} ${FOCUS} ${DISABLED} ${PLACEHOLDER}`;
const FIELD_SELECT_BOX = `block w-full py-1.5 pl-2.5 pr-8 text-sm ${SURFACE} ${FOCUS} ${DISABLED} ${CHEVRON}`;

export const FIELD_INPUT = `${FIELD_BOX} ${RING_DEFAULT}`;
export const FIELD_INPUT_ERROR = `${FIELD_BOX} ${RING_ERROR}`;
export const FIELD_INPUT_DIRTY = `${FIELD_BOX} ${RING_DIRTY}`;
export const FIELD_TEXTAREA = FIELD_INPUT;
export const FIELD_SELECT = `${FIELD_SELECT_BOX} ${RING_DEFAULT}`;
export const FIELD_SELECT_ERROR = `${FIELD_SELECT_BOX} ${RING_ERROR}`;

// -- Standalone, and in the filter bar above a table -------------------------

const FILTER_BOX = `block w-full px-3 py-2 text-sm ${SURFACE} ${FOCUS} ${DISABLED} ${PLACEHOLDER}`;

/**
 * Auto width, not full: filter dropdowns sit in a wrapping flex row and size themselves
 * to their longest option, so a row of them does not stretch into equal columns. Add
 * `w-full` at a call site that wants the other behaviour.
 */
const FILTER_SELECT_BOX = `py-2 pl-3 pr-9 text-sm ${SURFACE} ${FOCUS} ${DISABLED} ${CHEVRON}`;

export const FILTER_INPUT = `${FILTER_BOX} ${RING_DEFAULT}`;
export const FILTER_INPUT_ERROR = `${FILTER_BOX} ${RING_ERROR}`;
export const FILTER_SELECT = `${FILTER_SELECT_BOX} ${RING_DEFAULT}`;
export const FILTER_SELECT_ERROR = `${FILTER_SELECT_BOX} ${RING_ERROR}`;

/** The left padding clears the magnifier that [SearchField] draws inside the box. */
export const FILTER_SEARCH = `block w-full py-2 pl-9 pr-3 text-sm ${SURFACE} ${RING_DEFAULT} ${FOCUS} ${DISABLED} ${PLACEHOLDER}`;

/** A compact dropdown for a toolbar, where a full-height control would dominate the row. */
export const COMPACT_SELECT = `py-1 pl-2 pr-7 text-xs ${SURFACE} ${RING_DEFAULT} ${FOCUS} ${DISABLED} ${CHEVRON}`;

/** The small caption above a filter control. */
export const FILTER_LABEL = 'mb-1 block text-xs font-medium text-slate-600';

/** The white bar the filter controls sit in, above the table. */
export const FILTER_BAR =
  'mb-4 flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200';

/** The search box in a filter bar, which grows to take the space the dropdowns leave. */
export const FILTER_SEARCH_SLOT = 'min-w-[220px] flex-1';
