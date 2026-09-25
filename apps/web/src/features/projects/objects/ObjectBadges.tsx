import {
  LOAD_INCOMPLETE_LABEL,
  LOAD_INCOMPLETE_REASON_LABELS,
  OBJECT_CATEGORY_LABELS,
  OBJECT_STATUS_LABELS,
  type LoadValueDto,
  type ObjectCategory,
  type ObjectStatus,
  type RiskLevel,
  type RiskSummaryDto,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import {
  riskLabelOf,
  riskPaletteOf,
  type RiskBandView,
} from '../../../components/ui/risk-palette';
import { useRiskBands } from '../../../hooks/use-risk-bands';

const BASE =
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap';

const GREEN = 'bg-green-50 text-green-700 ring-green-200';
const YELLOW = 'bg-amber-50 text-amber-700 ring-amber-200';
const GREY = 'bg-slate-100 text-slate-600 ring-slate-200';
const BLUE = 'bg-blue-50 text-blue-700 ring-blue-200';
const VIOLET = 'bg-violet-50 text-violet-700 ring-violet-200';
const STONE = 'bg-stone-800 text-stone-50 ring-stone-700';

const CATEGORY_STYLES: Record<ObjectCategory, string> = {
  PANEL: VIOLET,
  CIRCUIT: BLUE,
  EQUIPMENT: GREY,
};

export function ObjectCategoryBadge({ category }: { category: ObjectCategory }): ReactElement {
  return (
    <span className={`${BASE} ${CATEGORY_STYLES[category]}`}>
      {OBJECT_CATEGORY_LABELS[category]}
    </span>
  );
}

const STATUS_STYLES: Record<ObjectStatus, string> = {
  ACTIVE: GREEN,
  INACTIVE: YELLOW,
  DECOMMISSIONED: STONE,
};

export function ObjectStatusBadge({ status }: { status: ObjectStatus }): ReactElement {
  return <span className={`${BASE} ${STATUS_STYLES[status]}`}>{OBJECT_STATUS_LABELS[status]}</span>;
}

/*
 * Band colour is resolved through `risk-palette.ts`, never from a table keyed on the level.
 *
 * The dot on a legend swatch (`.dot`) and the solid fill on a score chip (`.solid`) are the
 * same hue by construction, because they are two fields of one palette entry: a legend drawn
 * in a different shade from the thing it explains is worse than no legend. `.solid` carries
 * its own ink for the same reason it always did — amber at this weight cannot hold white
 * text at a readable contrast, so that colour takes dark ink and legibility decides it.
 */

/**
 * A single object's үнэлгээ, as a percent in its band colour (requirement 10.1).
 *
 * The score is already a 0-100 figure, so the percent is the score itself with no conversion.
 *
 * One figure, one element. The band name is not printed beside it in a table: the colour
 * carries it and `RiskLegend` states what each colour means, which is how requirement item 3
 * asks for it. Pass `showLabel` on a detail page, where there is room and no legend nearby.
 *
 * The band name remains the accessible name in every case, so the meaning survives for a
 * screen reader and on hover even where the colour is the only visible signal.
 */
export function ScorePercent({
  level,
  score,
  showLabel = false,
}: {
  level: RiskLevel | null;
  score: number | null;
  showLabel?: boolean;
}): ReactElement {
  // Read here rather than threaded from the page: this chip appears in fourteen call sites
  // across seven features, and the hook holds one module-level cache for all of them.
  const bands = useRiskBands();

  if (level === null || score === null) {
    return (
      <span
        className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500 ring-1 ring-inset ring-slate-200"
        title="Үнэлгээгүй"
      >
        Үнэлгээгүй
      </span>
    );
  }

  const label = riskLabelOf(level, bands);

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span
        className={`inline-flex min-w-[3rem] items-center justify-center rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums ${riskPaletteOf(level, bands).solid}`}
        title={label}
        aria-label={`${label} ${score}%`}
      >
        {score}%
      </span>
      {showLabel && <span className="text-xs text-slate-600">{label}</span>}
    </span>
  );
}

/**
 * The same figure as `ScorePercent`, kept as a separate name for the places that read as a
 * scored row rather than a bare cell.
 *
 * It used to draw a number, a proportional bar and a text pill: three renderings of one
 * value, which is the crowding requirement item 1 objects to and cost a table three columns
 * of width. The bar is gone; the colour already ranks the row, and the number is exact.
 */
export function ScoreBar({
  level,
  score,
  showPill = false,
}: {
  level: RiskLevel | null;
  score: number | null;
  showPill?: boolean;
}): ReactElement {
  return <ScorePercent level={level} score={score} showLabel={showPill} />;
}

/**
 * What each colour means, and the band it covers.
 *
 * EVERYTHING here comes from the bands it is handed — the boundaries, the names and the
 * colours alike — so the legend cannot drift from the ladder actually in force. It takes the
 * whole `RiskBand` rather than a bare range for exactly that reason: a legend that resolved
 * its own colours would be a second opinion about the configuration it is explaining.
 *
 * Only the bands passed in are drawn, which is also how the three reserved spare keys stay
 * off the screen: an administrator who has not configured a sixth band has no sixth band.
 */
export function RiskLegend({ bands }: { bands: readonly RiskBandView[] }): ReactElement {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {bands.map((band) => (
        <span key={band.level} className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span
            className={`h-2.5 w-2.5 rounded-sm ${riskPaletteOf(band.level, bands).dot}`}
            aria-hidden="true"
          />
          {band.min}-{band.max}% {riskLabelOf(band.level, bands)}
        </span>
      ))}
    </div>
  );
}

/**
 * Risk roll-up for a project, building or floor row (requirements 10.2).
 *
 * Counts per band, never a single rolled-up score: section 19.2 leaves the aggregation
 * method unapproved. All five bands from section 10 are shown rather than the prototype's
 * three colours, because collapsing five bands into three would invent a mapping.
 */
export function RiskSummaryCell({ summary }: { summary: RiskSummaryDto }): ReactElement {
  const bands = useRiskBands();

  if (summary.counts.length === 0 && summary.unassessedCount === 0) {
    return <span className="whitespace-nowrap text-xs text-slate-400">-</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      {summary.counts.map((entry) => (
        <span
          key={entry.level}
          title={riskLabelOf(entry.level, bands)}
          aria-label={`${riskLabelOf(entry.level, bands)} ${entry.count}`}
          className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 text-xs ring-1 ring-inset ring-slate-200"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${riskPaletteOf(entry.level, bands).dot}`}
            aria-hidden="true"
          />
          <span className="font-medium text-slate-900">{entry.count}</span>
        </span>
      ))}
      {summary.unassessedCount > 0 && (
        <span
          title="Үнэлгээгүй объект"
          aria-label={`Үнэлгээгүй ${summary.unassessedCount}`}
          className="inline-flex items-center gap-1 rounded-md bg-white px-1.5 py-0.5 text-xs text-slate-500 ring-1 ring-inset ring-slate-200"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
          {summary.unassessedCount}
        </span>
      )}
      {summary.hasCritical && (
        // Section 10.2 requires a warning marker on the red and black bands.
        <span className="rounded-md bg-red-50 px-1.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-inset ring-red-200">
          Анхаар
        </span>
      )}
    </div>
  );
}

/**
 * A section 11.5 figure.
 *
 * An incomplete calculation renders as "Бүрэн бус" with the reason, never as a zero, so a
 * missing technical field cannot be mistaken for a genuine reading (rule 17.18).
 */
export function LoadValue({
  value,
  unit = 'kW',
}: {
  value: LoadValueDto;
  unit?: string;
}): ReactElement {
  if (!value.complete || value.valueKw === null) {
    const reasons = value.reasons.map((reason) => LOAD_INCOMPLETE_REASON_LABELS[reason]);
    return (
      <span className="whitespace-nowrap text-xs text-amber-700" title={reasons.join(', ')}>
        {LOAD_INCOMPLETE_LABEL}
      </span>
    );
  }

  return (
    <span className="whitespace-nowrap text-slate-900">
      {value.valueKw.toLocaleString('mn-MN')} {unit}
    </span>
  );
}

/** Signed variance: measured minus calculated (rule 17.16). */
export function VarianceValue({ value }: { value: LoadValueDto }): ReactElement {
  if (!value.complete || value.valueKw === null) {
    return <span className="whitespace-nowrap text-xs text-slate-400">-</span>;
  }

  const tone =
    value.valueKw > 0 ? 'text-red-700' : value.valueKw < 0 ? 'text-amber-700' : 'text-slate-700';

  return (
    <span className={`whitespace-nowrap ${tone}`}>
      {value.valueKw > 0 ? '+' : ''}
      {value.valueKw.toLocaleString('mn-MN')} kW
    </span>
  );
}

/** Load ratio against capacity. Over 100 percent is shown, never clamped. */
export function LoadPercent({ value }: { value: LoadValueDto }): ReactElement {
  if (!value.complete || value.valueKw === null) {
    return <span className="text-xs text-amber-700">{LOAD_INCOMPLETE_LABEL}</span>;
  }

  const percent = value.valueKw;
  const tone = percent > 100 ? 'bg-red-600' : percent >= 90 ? 'bg-amber-500' : 'bg-green-600';

  return (
    <div className="min-w-[110px]">
      <div className="mb-1 text-xs font-medium text-slate-900">{percent}%</div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}
