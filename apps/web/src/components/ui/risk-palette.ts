import {
  DEFAULT_RISK_BANDS,
  RISK_LEVEL_LABELS,
  fallbackRiskLabel,
  type RiskColour,
  type RiskLevel,
} from '@monhorus/shared';

/**
 * One band as a screen needs it: what it is called, what colour it is, and what it covers.
 *
 * The shape `GET /vocabulary` publishes, and deliberately narrower than the shared
 * `RiskBand`. The four behaviour flags — must carry a conclusion, decommissions, notifies —
 * decide what the API ACCEPTS, and the API is the only place that may decide it; a type
 * that carried them here would invite a screen to answer a question the server owns.
 */
export interface RiskBandView {
  readonly level: RiskLevel;
  readonly label: string;
  readonly colour: RiskColour;
  /** Inclusive score range. Already resolved by the server, never re-derived here. */
  readonly min: number;
  readonly max: number;
}

/**
 * The one place a risk colour becomes ink.
 *
 * WHY THIS EXISTS. Eight modules each carried their own `Record<RiskLevel, string>` —
 * badges, score chips, floor-plan markers, four charts and a silhouette — and every one
 * of them hardcoded the answer to a question that is no longer constant: an administrator
 * now names, colours and re-cuts the bands in Тохиргоо, and `RISK_LEVELS` carries three
 * reserved spares that no such map could enumerate. Keying on the LEVEL means a renamed or
 * recoloured band is a code change in eight files; keying on the band's own `colour` means
 * it is a settings change and nothing else.
 *
 * WHAT A SITE DOES. `riskPaletteOf(level, bands)` — the bands from `useRiskBands()` — and
 * then the field that matches the mark being drawn. Nothing outside this file may map a
 * level to a colour.
 *
 * THE DEFAULT HUES ARE NOT UP FOR REVISION. Each field below reproduces, byte for byte,
 * the value the site that owned it used before. `fill` in particular is the ramp measured
 * for colour-blindness separation in `PortalCharts.tsx` — ΔE 21.8 on the worst adjacent
 * pair with full colour vision, 15.2 under simulated protanopia — so those five hex values
 * are a measurement, not a preference, and changing one regresses a documented result.
 *
 * TAILWIND CLASSES ARE WRITTEN OUT, never composed as `bg-${colour}-500`. Tailwind scans
 * the source for whole class names at build time, so a constructed one produces no CSS at
 * all. That is also why `RISK_COLOURS` is a closed list of names rather than free hex —
 * the same rule `stage-palette.ts` follows.
 */
export interface RiskPaletteEntry {
  /** Mongolian name of the colour itself, for the picker in Тохиргоо. */
  readonly label: string;
  /** Pale chip behind dark text: badges, pills and floor-plan markers. */
  readonly badge: string;
  /** Solid swatch with no text on it: legend squares and count dots. */
  readonly dot: string;
  /**
   * Solid fill WITH the ink that stays legible on it.
   *
   * Not always white: amber at the weight the requirement asks for cannot carry white text
   * at a readable contrast, so that one takes dark ink. Legibility decides this, not
   * consistency.
   */
  readonly solid: string;
  /** Text colour alone, for a band named in running text. */
  readonly text: string;
  /** Weighted data mark — a bar, a silhouette floor. The measured ramp; see above. */
  readonly fill: string;
  /** Whether `fill` is light enough that text on it must be dark rather than white. */
  readonly fillIsLight: boolean;
  /** Dashboard chart hex, drawn from `CHART_COLOURS` so widgets read as one set. */
  readonly chart: string;
  /** The muted variant the stacked building chart uses, where bars sit edge to edge. */
  readonly chartMuted: string;
}

export const RISK_PALETTE: Record<RiskColour, RiskPaletteEntry> = {
  green: {
    label: 'Ногоон',
    badge: 'bg-green-50 text-green-700 ring-green-200',
    dot: 'bg-green-600',
    solid: 'bg-green-600 text-white',
    text: 'text-green-700',
    fill: '#15803d',
    fillIsLight: false,
    chart: '#16a34a',
    chartMuted: '#4a9a5e',
  },
  yellow: {
    label: 'Шар',
    badge: 'bg-amber-50 text-amber-700 ring-amber-200',
    dot: 'bg-amber-400',
    solid: 'bg-amber-400 text-amber-950',
    text: 'text-amber-700',
    fill: '#fcd34d',
    fillIsLight: true,
    chart: '#f59e0b',
    chartMuted: '#d9a441',
  },
  orange: {
    label: 'Улбар шар',
    badge: 'bg-orange-50 text-orange-700 ring-orange-200',
    dot: 'bg-orange-500',
    solid: 'bg-orange-500 text-white',
    text: 'text-orange-700',
    fill: '#f97316',
    fillIsLight: false,
    chart: '#ea580c',
    chartMuted: '#e08542',
  },
  red: {
    label: 'Улаан',
    badge: 'bg-red-50 text-red-700 ring-red-200',
    dot: 'bg-red-600',
    solid: 'bg-red-600 text-white',
    text: 'text-red-700',
    fill: '#991b1b',
    fillIsLight: false,
    chart: '#dc2626',
    chartMuted: '#cf5a52',
  },
  black: {
    label: 'Хар',
    badge: 'bg-stone-800 text-stone-50 ring-stone-700',
    dot: 'bg-stone-900',
    solid: 'bg-stone-900 text-white',
    text: 'text-stone-800',
    fill: '#1c1917',
    fillIsLight: false,
    chart: '#1c1917',
    chartMuted: '#3f3a36',
  },
  /**
   * Also the answer for "no band at all".
   *
   * Grey is what absence looks like everywhere else in this product — an unassessed object,
   * an unconfigured spare key — so it is deliberately the fallback of `riskColourOf` as
   * well as a colour an administrator may pick.
   */
  grey: {
    label: 'Саарал',
    badge: 'bg-slate-100 text-slate-600 ring-slate-200',
    dot: 'bg-slate-400',
    solid: 'bg-slate-400 text-white',
    text: 'text-slate-600',
    fill: '#cbd5e1',
    fillIsLight: true,
    chart: '#94a3b8',
    chartMuted: '#8f9aa6',
  },
  blue: {
    label: 'Цэнхэр',
    badge: 'bg-blue-50 text-blue-700 ring-blue-200',
    dot: 'bg-blue-500',
    solid: 'bg-blue-600 text-white',
    text: 'text-blue-700',
    fill: '#1d4ed8',
    fillIsLight: false,
    chart: '#2563eb',
    chartMuted: '#5b8dd9',
  },
  purple: {
    label: 'Нил ягаан',
    badge: 'bg-violet-50 text-violet-700 ring-violet-200',
    dot: 'bg-violet-500',
    solid: 'bg-violet-600 text-white',
    text: 'text-violet-700',
    fill: '#6d28d9',
    fillIsLight: false,
    chart: '#7c3aed',
    chartMuted: '#8b7fc4',
  },
};

/** Nothing scored yet. An absence, never a band — see the note on `grey`. */
export const UNASSESSED_PALETTE = RISK_PALETTE.grey;

/**
 * The colour a stored level is painted in.
 *
 * `bands` is what `useRiskBands()` returned. THE TWO NULLS MEAN DIFFERENT THINGS and are
 * answered differently:
 *
 *   - `bands` null — the configuration could not be read. The shipped ladder's hues are
 *     used, which is exactly what every one of these sites hardcoded before this module
 *     existed, so an offline settings call changes nothing on screen. This is safe in a way
 *     that guessing a THRESHOLD is not: a colour states no number, so a stale hue cannot be
 *     mistaken for a rule the way "81-100%" could. `useRiskBands` still returns null for
 *     the thresholds themselves, and callers that print a boundary still say nothing.
 *   - the level is absent from `bands` — a reserved spare the administrator has not
 *     configured, or a band that was dropped after a record was written with it. Grey, so
 *     an unconfigured key reads as absence rather than borrowing another band's meaning.
 */
export function riskColourOf(
  level: RiskLevel | null | undefined,
  bands?: readonly RiskBandView[] | null,
): RiskColour {
  if (!level) return 'grey';
  if (bands) return bands.find((band) => band.level === level)?.colour ?? 'grey';
  return DEFAULT_RISK_BANDS.find((band) => band.key === level)?.colour ?? 'grey';
}

/** The ink for a level, resolved through its configured colour. */
export function riskPaletteOf(
  level: RiskLevel | null | undefined,
  bands?: readonly RiskBandView[] | null,
): RiskPaletteEntry {
  return RISK_PALETTE[riskColourOf(level, bands)];
}

/**
 * What a level is called, in the administrator's own words where there are any.
 *
 * The order is deliberate: the CONFIGURED label wins, because renaming «Ноцтой эрсдэлтэй»
 * in Тохиргоо must rename it on every screen; `RISK_LEVEL_LABELS` is the shipped wording
 * for the five original keys when no configuration has been read; and `fallbackRiskLabel`
 * catches a key that has neither, so a reader never sees `BAND_7`.
 */
export function riskLabelOf(
  level: RiskLevel,
  bands?: readonly RiskBandView[] | null,
): string {
  const configured = bands?.find((band) => band.level === level)?.label.trim();
  if (configured) return configured;
  return RISK_LEVEL_LABELS[level] ?? fallbackRiskLabel(level);
}

/**
 * The configured levels, best-first — the order `RISK_LEVELS` used to be relied on for.
 *
 * `RISK_LEVELS` can no longer be iterated for display: it carries three reserved spares
 * that no administrator has named, so a legend built from it draws «Түвшин 6» beside bands
 * that exist. Severity is the band's own lower bound rather than its position in that list,
 * which is why this sorts on `min` instead of trusting the order it was handed.
 */
export function riskLevelsInOrder(bands?: readonly RiskBandView[] | null): readonly RiskLevel[] {
  if (bands) {
    return [...bands].sort((a, b) => b.min - a.min).map((band) => band.level);
  }
  return [...DEFAULT_RISK_BANDS]
    .sort((a, b) => b.minScore - a.minScore)
    .map((band) => band.key);
}

/**
 * The band a typed score falls in, or null when nothing was typed.
 *
 * Not `riskLevelFor` from the shared package, for two reasons. The obvious one is shape:
 * the bands here come from `/vocabulary` and carry no behaviour flags. The load-bearing one
 * is its fallback — shared answers `'OUT_OF_SERVICE'` for a score outside every band, which
 * is the "behaviour travels with the name" mistake the band configuration exists to end: an
 * installation whose worst band is called something else would be handed a key it does not
 * use. This falls back to the WORST CONFIGURED BAND instead, which is the same answer on the
 * shipped ladder and the right one on any other.
 *
 * The fallback only fires for a score outside 0..100, because the caller has already
 * established that the ladder tiles that range — see `use-risk-bands.ts`. Erring towards the
 * worst band is deliberate: it makes the form demand more, never less.
 */
export function riskLevelForScore(
  score: number,
  bands: readonly RiskBandView[],
): RiskLevel | null {
  if (bands.length === 0) return null;
  const found = bands.find((band) => score >= band.min && score <= band.max);
  if (found) return found.level;
  return [...bands].sort((a, b) => a.min - b.min)[0]?.level ?? null;
}
