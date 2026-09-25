import type { StageColour } from '@monhorus/shared';

import { CHART_COLOURS } from '../charts/Charts';

/**
 * The seven stage colours, as Tailwind classes.
 *
 * Lives beside the badges rather than in the settings editor because the editor is one
 * consumer of the palette, not its owner: a badge on a list row, a dot on a board heading
 * and a swatch in the colour picker all have to resolve «Ногоон» to the same green, and a
 * screen that invented its own would drift the moment an administrator renamed a stage.
 *
 * Written out per colour, never composed as `bg-${colour}-50`. Tailwind scans the source
 * for whole class names at build time, so a constructed one produces no CSS at all — which
 * is also why the shared palette is a closed list of names instead of free hex.
 */
export const STAGE_BADGE_STYLES: Record<StageColour, string> = {
  grey: 'bg-slate-100 text-slate-600 ring-slate-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  green: 'bg-green-50 text-green-700 ring-green-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
};

/** Solid fill, for surfaces that mark a stage without wrapping text — a board heading dot. */
export const STAGE_DOT_STYLES: Record<StageColour, string> = {
  grey: 'bg-slate-400',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
};

/**
 * The weighted data mark for a stage — a ring segment, a column.
 *
 * Hex rather than a class because a chart fills an SVG attribute, and drawn from
 * `CHART_COLOURS` so a stage ring on the portal reads as the same set of hues as every
 * other chart in the product. Kept here for the reason the rest of this file exists: one
 * place resolves a stage colour to ink, so an administrator recolouring a stage in
 * Тохиргоо moves the badge, the dot and the chart together.
 *
 * Two stage colours have no same-named entry in the chart set — `indigo` takes `violet`
 * and `grey` takes `slate`, which are those ramps' names for the same hue.
 */
export const STAGE_CHART_FILLS: Record<StageColour, string> = {
  grey: CHART_COLOURS.slate,
  blue: CHART_COLOURS.blue,
  indigo: CHART_COLOURS.violet,
  amber: CHART_COLOURS.amber,
  orange: CHART_COLOURS.orange,
  green: CHART_COLOURS.green,
  red: CHART_COLOURS.red,
};
