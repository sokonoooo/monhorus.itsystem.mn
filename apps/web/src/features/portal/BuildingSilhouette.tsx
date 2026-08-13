import { RISK_LEVELS, RISK_LEVEL_LABELS, type FloorDto, type RiskLevel } from '@monhorus/shared';
import type { ReactElement } from 'react';

/** Solid severity fills — the same computed ramp the portal charts use. */
const RISK_FILL: Record<RiskLevel | 'UNASSESSED', string> = {
  NORMAL: '#15803d',
  ATTENTION: '#fcd34d',
  SCHEDULE_REPAIR: '#f97316',
  CRITICAL: '#991b1b',
  OUT_OF_SERVICE: '#1c1917',
  UNASSESSED: '#cbd5e1',
};

/** Fills dark enough that white text on them clears contrast; the rest take ink. */
const LIGHT_FILLS = new Set<RiskLevel | 'UNASSESSED'>(['ATTENTION', 'UNASSESSED']);

/**
 * The worst band present on a floor.
 *
 * `RISK_LEVELS` is ordered least to most severe, so the last one with anything in it is the
 * answer. A floor with nothing assessed is UNASSESSED rather than NORMAL — "not looked at"
 * must never render as "fine", which is the whole reason the summary carries the two counts
 * separately.
 */
export function worstRiskLevel(floor: FloorDto): RiskLevel | 'UNASSESSED' {
  for (let index = RISK_LEVELS.length - 1; index >= 0; index -= 1) {
    const level = RISK_LEVELS[index]!;
    const found = floor.riskSummary.counts.find((entry) => entry.level === level);
    if (found && found.count > 0) return level;
  }
  return 'UNASSESSED';
}

/** Bar height in px for a floor, tallest floor tallest. Mirrors the mobile silhouette. */
export function barHeight(floorNumber: number | null, tallest: number): number {
  const number = floorNumber ?? 0;
  const clamped = Math.min(Math.max(number, 0), tallest);
  return 28 + (clamped / Math.max(tallest, 1)) * 70;
}

/**
 * The building, drawn as its floors.
 *
 * THE SAME PICTURE THE CUSTOMER MOBILE APP DRAWS, so somebody who has used the phone
 * recognises this immediately: one bar per floor, standing on a ground line, ordered from
 * the ground up, each filled with that floor's worst risk band and as tall as the floor is
 * high. It answers "which floor is the problem on" before any table can.
 *
 * NOT A FLOOR PLAN. The plan lives one level down, on the floor itself, where there is a
 * drawing and coordinates to put markers on. This is the level above: a building has no
 * drawing, only floors, so the shape of the building is the only thing there is to draw.
 *
 * Colour never carries the meaning alone — each bar is labelled with its floor and its band
 * is named in the tooltip and the legend beneath.
 */
export function BuildingSilhouette({
  floors,
  onSelect,
  selectedFloorId,
}: {
  floors: readonly FloorDto[];
  onSelect?: (floor: FloorDto) => void;
  selectedFloorId?: string | null;
}): ReactElement {
  if (floors.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-slate-500">
        Энэ барилгад давхар бүртгэгдээгүй байна.
      </p>
    );
  }

  // Ground up, so the drawing stands the way the building does.
  const ascending = [...floors].sort(
    (left, right) => (left.floorNumber ?? 0) - (right.floorNumber ?? 0),
  );
  const tallest = ascending.reduce(
    (highest, floor) => Math.max(highest, floor.floorNumber ?? 0),
    1,
  );

  // Only the bands actually standing in this building, worst last.
  const present = [...new Set(ascending.map(worstRiskLevel))].sort(
    (left, right) =>
      [...RISK_LEVELS, 'UNASSESSED'].indexOf(left) - [...RISK_LEVELS, 'UNASSESSED'].indexOf(right),
  );

  return (
    <div>
      <div className="overflow-x-auto pb-1">
        <ul className="flex items-end gap-1" aria-label="Барилгын харагдац">
          {ascending.map((floor) => {
            const level = worstRiskLevel(floor);
            const selected = selectedFloorId === floor.id;
            const label =
              floor.floorNumber === null ? floor.name.slice(0, 3) : String(floor.floorNumber);
            return (
              <li key={floor.id}>
                <button
                  type="button"
                  onClick={() => onSelect?.(floor)}
                  title={`${floor.name} — ${
                    level === 'UNASSESSED' ? 'Үнэлгээ хийгээгүй' : RISK_LEVEL_LABELS[level]
                  } · ${floor.objectCount} тоноглол`}
                  aria-label={`${floor.name}, ${
                    level === 'UNASSESSED' ? 'үнэлгээ хийгээгүй' : RISK_LEVEL_LABELS[level]
                  }`}
                  aria-current={selected ? 'true' : undefined}
                  className={`flex w-7 items-end justify-center rounded-t-md pb-1 text-[10px] font-semibold transition-transform hover:-translate-y-0.5 ${
                    LIGHT_FILLS.has(level) ? 'text-slate-800' : 'text-white'
                  } ${selected ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
                  style={{
                    height: `${barHeight(floor.floorNumber, tallest)}px`,
                    backgroundColor: RISK_FILL[level],
                  }}
                >
                  {label}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* The ground the floors stand on — it is what makes the bars read as a building. */}
      <div className="h-1 rounded-full bg-slate-300" />

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {present.map((level) => (
          <li key={level} className="flex items-center gap-1.5 text-xs text-slate-600">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: RISK_FILL[level] }}
            />
            {level === 'UNASSESSED' ? 'Үнэлгээ хийгээгүй' : RISK_LEVEL_LABELS[level]}
          </li>
        ))}
      </ul>
    </div>
  );
}
