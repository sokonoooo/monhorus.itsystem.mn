import {
  RISK_LEVELS,
  RISK_LEVEL_LABELS,
  type FloorPlanDto,
  type ObjectListItemDto,
  type PlanPositionDto,
  type RiskLevel,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { RISK_SURFACE_STYLES } from '../../components/ui/DomainBadges';
import { EmptyState } from '../../components/ui/States';
import { authorisedFileUrl } from '../../lib/file-url';
import { markerStyle } from '../projects/plan-geometry';

/** What a band-less object is called. "No finding yet" is an absence, not a sixth band. */
const UNASSESSED_LABEL = 'Үнэлгээгүй';

function bandOf(object: ObjectListItemDto): RiskLevel | null {
  return object.latestAssessment?.riskLevel ?? null;
}

function bandLabel(level: RiskLevel | null): string {
  return level === null ? UNASSESSED_LABEL : RISK_LEVEL_LABELS[level];
}

/**
 * Whether a stored coordinate can honestly be drawn.
 *
 * `planPosition` is a fraction of the image's own box, so anything outside 0..1 — or a NaN
 * that survived a bad write — names a spot that is not on the drawing. Such a marker is
 * SKIPPED rather than clamped to the nearest edge: a dot pinned to the border looks exactly
 * like a real placement there, and inventing a location for somebody's switchgear is worse
 * than admitting the location is missing. It still appears in the unplaced count and in the
 * list beneath the plan, so nothing is silently lost.
 */
function isDrawable(position: PlanPositionDto | null | undefined): position is PlanPositionDto {
  if (!position) return false;
  const { x, y } = position;
  return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

/** Severity as a sortable number. `RISK_LEVELS` is declared best-first, so index IS order. */
function severityOf(object: ObjectListItemDto): number {
  const level = bandOf(object);
  return level === null ? -1 : RISK_LEVELS.indexOf(level);
}

/**
 * The objects the plan draws: placed, and of a type the registry marks as shown on plans.
 *
 * Both halves are load-bearing. `showOnPlan` is what an administrator sets to say "this
 * kind of thing belongs on a drawing" — a cable run has a floor and can carry a position
 * without ever having been meant to appear as a dot.
 *
 * Sorted worst-band LAST so the severe marker paints on top where two overlap. Overlap is
 * normal on a dense floor, and the one a reader must not lose is the red one.
 */
export function planMarkerObjects(
  objects: readonly ObjectListItemDto[],
): readonly ObjectListItemDto[] {
  return objects
    .filter((object) => object.objectType?.showOnPlan === true && isDrawable(object.planPosition))
    .slice()
    .sort((a, b) => severityOf(a) - severityOf(b));
}

/** Objects that belong on a plan but are not on one. A failed coordinate counts here too. */
export function unplacedOnPlanCount(objects: readonly ObjectListItemDto[]): number {
  return objects.filter(
    (object) => object.objectType?.showOnPlan === true && !isDrawable(object.planPosition),
  ).length;
}

/**
 * The floor drawing with a marker per piece of equipment.
 *
 * The image is served by `GET /files/:fileId`, which needs a bearer token, so it cannot be
 * a bare `<img src>` — `authorisedFileUrl` fetches it and hands back an object URL, exactly
 * as the staff plan components do.
 */
export function PortalFloorPlan({
  plan,
  objects,
  onOpenObject,
}: {
  plan: FloorPlanDto;
  objects: readonly ObjectListItemDto[];
  onOpenObject: (object: ObjectListItemDto) => void;
}): ReactElement {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let revoke: string | null = null;

    setImageUrl(null);
    setImageFailed(false);

    authorisedFileUrl(plan.downloadUrl)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        revoke = url;
        setImageUrl(url);
      })
      .catch(() => {
        if (!cancelled) setImageFailed(true);
      });

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [plan.downloadUrl]);

  // Nothing in this app rasterises PDFs, so a PDF plan is stated rather than half-drawn.
  if (plan.mimeType === 'application/pdf') {
    return (
      <EmptyState
        title="Зураг PDF хэлбэртэй"
        description="PDF төлөвлөгөөг энд харуулах боломжгүй. Тоноглолын жагсаалтыг доор харна уу."
      />
    );
  }

  if (imageFailed) {
    return (
      <EmptyState
        title="Зураг ачаалж чадсангүй"
        description="Давхрын зургийг татаж чадсангүй. Тоноглолын жагсаалтыг доор харна уу."
      />
    );
  }

  const markers = planMarkerObjects(objects);

  return (
    <div className="relative mx-auto w-fit">
      {imageUrl === null ? (
        <div className="h-64 w-full animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <img src={imageUrl} alt={plan.title ?? 'Давхрын төлөвлөгөө'} className="max-w-full" />
      )}

      {imageUrl !== null &&
        markers.map((object) => {
          const level = bandOf(object);
          const label = `${object.name} · ${bandLabel(level)}`;
          return (
            <button
              key={object.id}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onOpenObject(object)}
              style={markerStyle(object.planPosition ?? null)}
              /*
                A real button, not a coloured div. It is the only way into the equipment from
                the drawing, so it has to be a focus stop with a name: the plan is then
                traversable by keyboard and a screen reader hears the equipment and its band
                rather than "graphic". `-translate-*-1/2` is the CSS spelling of centring the
                marker on its point.
              */
              className={`absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600 ${
                RISK_SURFACE_STYLES[level ?? 'UNASSESSED']
              }`}
            />
          );
        })}
    </div>
  );
}
