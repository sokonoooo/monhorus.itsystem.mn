import type {
  FloorPlanDto,
  ObjectListItemDto,
  PlanPositionDto,
  RiskLevel,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import {
  riskLabelOf,
  riskLevelsInOrder,
  riskPaletteOf,
  type RiskBandView,
} from '../../components/ui/risk-palette';
import { useRiskBands } from '../../hooks/use-risk-bands';
import { EmptyState } from '../../components/ui/States';
import { authorisedFileUrl } from '../../lib/file-url';
import { useAuthorisedFileUrls } from '../../lib/use-authorised-file-urls';
import { markerStyle } from '../projects/plan-geometry';
import { ObjectTypeGlyph } from '../projects/plan-icons';

/** What a band-less object is called. "No finding yet" is an absence, not a sixth band. */
const UNASSESSED_LABEL = 'Үнэлгээгүй';

function bandOf(object: ObjectListItemDto): RiskLevel | null {
  return object.latestAssessment?.riskLevel ?? null;
}

function bandLabel(level: RiskLevel | null, bands: readonly RiskBandView[] | null): string {
  return level === null ? UNASSESSED_LABEL : riskLabelOf(level, bands);
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

/**
 * Severity as a sortable number.
 *
 * Read off the CONFIGURED ladder, best-first, so a higher index is a worse band. It cannot
 * come from `RISK_LEVELS`: that list is the storage vocabulary and its order is the order
 * the keys were reserved in, which stops being severity the moment an administrator re-cuts
 * the bands or names a spare. An unassessed object sorts below every band at -1.
 */
function severityOf(object: ObjectListItemDto, order: readonly RiskLevel[]): number {
  const level = bandOf(object);
  return level === null ? -1 : order.indexOf(level);
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
  bands?: readonly RiskBandView[] | null,
): readonly ObjectListItemDto[] {
  const order = riskLevelsInOrder(bands);
  return objects
    .filter((object) => object.objectType?.showOnPlan === true && isDrawable(object.planPosition))
    .slice()
    .sort((a, b) => severityOf(a, order) - severityOf(b, order));
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
  // Marker colour and marker name both come from the configured ladder: a customer reading
  // this plan must see the same band names and hues the staff console shows.
  const bands = useRiskBands();

  /**
   * Custom type icons, fetched once per DISTINCT icon rather than once per marker.
   *
   * `objectType.iconUrl` is an authenticated download path, so it cannot be used as a bare
   * `src`. This is the same resolution the staff panel performs, and the deduplication is
   * the point of it: one icon shared by forty markers must cost one request, not forty.
   */
  const iconFiles = [
    ...new Set(
      objects
        .map((object) => object.objectType?.iconUrl ?? null)
        .filter((url): url is string => url !== null),
    ),
  ].map((url) => ({ id: url, downloadUrl: url }));
  const iconUrls = useAuthorisedFileUrls(iconFiles);

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

  const markers = planMarkerObjects(objects, bands);

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
          const label = `${object.name} · ${bandLabel(level, bands)}`;
          return (
            <button
              key={object.id}
              type="button"
              aria-label={label}
              title={label}
              onClick={() => onOpenObject(object)}
              style={markerStyle(object.planPosition ?? null)}
              /*
                Shaped like the staff marker, deliberately: a risk-coloured pill carrying the
                object type's own glyph and its code. An unadorned coloured dot — which this
                was — makes a busy floor read as a field of identical circles, because the
                colour only says how bad it is and nothing at all about what it is.

                A real button rather than a styled div: it is the only way into the equipment
                from the drawing, so it has to be a focus stop with a name. `-translate-*-1/2`
                is the CSS spelling of centring the marker on its stored point.
              */
              className={`absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1 text-[10px] font-semibold shadow-sm ring-2 ring-inset focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                riskPaletteOf(level, bands).badge
              }`}
            >
              <ObjectTypeGlyph
                icon={object.objectType?.icon ?? null}
                iconUrl={
                  object.objectType?.iconUrl ? (iconUrls[object.objectType.iconUrl] ?? null) : null
                }
              />
              <span>{object.code}</span>
            </button>
          );
        })}
    </div>
  );
}
