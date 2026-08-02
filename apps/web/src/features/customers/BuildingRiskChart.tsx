import {
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  type BuildingDto,
  type RiskLevel,
} from '@monhorus/shared';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';

/** Section 10 assigns each band its colour; nothing here invents one. */
const BAND_COLOURS: Record<RiskLevel, string> = {
  NORMAL: '#4a9a5e',
  ATTENTION: '#d9a441',
  SCHEDULE_REPAIR: '#e08542',
  CRITICAL: '#cf5a52',
  OUT_OF_SERVICE: '#3f3a36',
};

/** Nothing assessed yet is its own case, not a band. */
const UNASSESSED_COLOUR = '#5b8dd9';

const MIN_BAR_HEIGHT = 44;
const MAX_BAR_HEIGHT = 190;

interface BuildingBar {
  building: BuildingDto;
  index: number;
  total: number;
  segments: { key: string; label: string; count: number; colour: string }[];
  hasCritical: boolean;
}

function toBars(buildings: readonly BuildingDto[]): BuildingBar[] {
  return buildings.map((building, index) => {
    const counts = new Map(building.riskSummary.counts.map((entry) => [entry.level, entry.count]));

    const segments: BuildingBar['segments'] = RISK_LEVELS.map((level) => ({
      key: level as string,
      label: RISK_LEVEL_LABELS[level],
      count: counts.get(level) ?? 0,
      colour: BAND_COLOURS[level],
    })).filter((segment) => segment.count > 0);

    if (building.riskSummary.unassessedCount > 0) {
      segments.push({
        key: 'UNASSESSED',
        label: 'Үнэлгээгүй',
        count: building.riskSummary.unassessedCount,
        colour: UNASSESSED_COLOUR,
      });
    }

    return {
      building,
      index: index + 1,
      total: segments.reduce((sum, segment) => sum + segment.count, 0),
      segments,
      hasCritical: building.riskSummary.hasCritical,
    };
  });
}

/**
 * Buildings in a project, by object count and risk.
 *
 * The bar height is the number of objects and each band is a segment of it, so a building
 * that is entirely healthy reads as one solid green bar and a mixed one shows the mix.
 *
 * It is stacked rather than given a single colour on purpose: colouring a whole building
 * by one band would be an aggregate judgement, and section 19.2 leaves the building-level
 * aggregation method (worst, average or weighted) unapproved. Counts state what is there
 * without deciding that question. Section 10.2's warning marker is carried separately.
 */
export function BuildingRiskChart({
  buildings,
}: {
  buildings: readonly BuildingDto[];
}): ReactElement {
  const bars = toBars(buildings);
  const maxTotal = bars.reduce((highest, bar) => Math.max(highest, bar.total), 0);

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">
        Барилгын visualization
      </h3>

      <div className="overflow-x-auto pb-2">
        <ul
          className="flex items-end gap-2.5"
          style={{ minHeight: MAX_BAR_HEIGHT + 16 }}
          role="img"
          aria-label={`Барилгын эрсдэл: ${bars
            .map((bar) => `${bar.building.name} ${bar.total} объект`)
            .join(', ')}`}
        >
          {bars.map((bar) => {
            // A building with no objects still gets the minimum bar, otherwise it
            // disappears from the chart entirely and reads as "not there".
            const height =
              maxTotal === 0
                ? MIN_BAR_HEIGHT
                : MIN_BAR_HEIGHT + (bar.total / maxTotal) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);

            return (
              <li key={bar.building.id} className="shrink-0">
                <Link
                  to={`/buildings/${bar.building.id}`}
                  title={`${bar.building.name} · ${bar.total} объект${
                    bar.hasCritical ? ' · анхаарах шаардлагатай' : ''
                  }`}
                  className="group flex w-14 flex-col justify-end focus:outline-none"
                  style={{ height: MAX_BAR_HEIGHT }}
                >
                  {bar.hasCritical && (
                    <span
                      className="mb-1 text-center text-xs font-bold text-red-600"
                      aria-hidden="true"
                    >
                      !
                    </span>
                  )}

                  <span
                    className="relative flex w-full flex-col-reverse overflow-hidden rounded-lg shadow-sm ring-1 ring-black/5 transition-transform group-hover:-translate-y-0.5"
                    style={{ height }}
                  >
                    {bar.segments.length === 0 ? (
                      <span className="h-full w-full bg-slate-200" />
                    ) : (
                      bar.segments.map((segment) => (
                        <span
                          key={segment.key}
                          className="w-full"
                          style={{
                            height: `${(segment.count / bar.total) * 100}%`,
                            backgroundColor: segment.colour,
                          }}
                        />
                      ))
                    )}

                    <span className="absolute inset-x-0 bottom-1 text-center text-xs font-semibold text-white drop-shadow">
                      {bar.index}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-2">
        {RISK_LEVELS.map((level) => (
          <span key={level} className="flex items-center gap-1.5 text-[11px] text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: BAND_COLOURS[level] }}
              aria-hidden="true"
            />
            {RISK_LEVEL_LABELS[level]}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: UNASSESSED_COLOUR }}
            aria-hidden="true"
          />
          Үнэлгээгүй
        </span>
      </div>

      <ol className="mt-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {bars.map((bar) => (
          <li key={bar.building.id} className="flex items-baseline gap-2 text-xs">
            <span className="w-4 shrink-0 text-right font-semibold text-slate-400">
              {bar.index}
            </span>
            <Link
              to={`/buildings/${bar.building.id}`}
              className="min-w-0 flex-1 truncate text-slate-700 hover:text-blue-600 hover:underline"
            >
              {bar.building.name}
            </Link>
            <span className="shrink-0 tabular-nums text-slate-500">{bar.total}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
