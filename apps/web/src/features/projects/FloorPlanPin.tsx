import type { FloorPlanDto, PlanPositionDto } from '@monhorus/shared';
import {
  useEffect,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';

import { Button } from '../../components/ui/Button';
import { authorisedFileUrl } from '../../lib/file-url';
import { projectService } from '../../services/project.service';
import { markerStyle, positionWithin } from './plan-geometry';

interface FloorPlanPinProps {
  floorId: string;
  /** The pinned spot, or null for "no spot named". */
  value: PlanPositionDto | null;
  /**
   * Omitted for a read-only view: without it the plan is drawn with its marker and nothing
   * on it responds to a pointer, which is what reading a request needs.
   */
  onChange?: (position: PlanPositionDto | null) => void;
  disabled?: boolean;
}

/**
 * A single optional pin on a floor's plan image.
 *
 * The plan is fetched for the floor it is given rather than passed in, because both callers
 * — the request form, which only ever holds a floor id from the location chain, and the
 * request detail, which holds one from the saved request — have the id and not the image.
 *
 * The coordinate arithmetic is not repeated here: `positionWithin` and `markerStyle` are the
 * same functions `FloorPlanPanel` places objects with, so a pin and an object placed at the
 * same spot resolve to the same pair of fractions.
 */
export function FloorPlanPin({
  floorId,
  value,
  onChange,
  disabled = false,
}: FloorPlanPinProps): ReactElement {
  const [plan, setPlan] = useState<FloorPlanDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const editable = onChange !== undefined && !disabled;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPlan(null);

    projectService
      .getFloorPlan(floorId)
      .then((result) => {
        if (!cancelled) setPlan(result);
      })
      // A plan that cannot be read is treated as a floor without one: the pin is optional
      // and a failed image must not block raising the request.
      .catch(() => {
        if (!cancelled) setPlan(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [floorId]);

  /**
   * The download route is authenticated, so the image cannot be used as a bare `src`. It is
   * fetched with the bearer token and turned into an object URL, revoked when the plan
   * changes or the component unmounts.
   */
  useEffect(() => {
    if (!plan) {
      setPreviewUrl(null);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    void authorisedFileUrl(plan.downloadUrl)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(null));

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plan]);

  function handlePlanClick(event: ReactPointerEvent<HTMLElement>): void {
    if (!editable || !onChange) return;
    const position = positionWithin(event.currentTarget, event.clientX, event.clientY);
    if (!position) return;
    onChange(position);
  }

  if (loading) {
    return <div className="h-40 animate-pulse rounded-lg bg-slate-100" />;
  }

  // No drawing means there is nothing to point at. Said in one line rather than left as a
  // dead area with a control that could not do anything.
  if (!plan) {
    return (
      <p className="text-xs text-slate-500">
        Энэ давхарт план зураг хавсаргаагүй тул байрлал тэмдэглэх боломжгүй.
      </p>
    );
  }

  // PDFs are not rasterised anywhere in this app, so there is no picture to measure a
  // coordinate against — the same limit the object placement panel states.
  if (plan.mimeType === 'application/pdf') {
    return (
      <p className="text-xs text-slate-500">
        PDF план дээр байрлал тэмдэглэх боломжгүй. PNG, JPG эсвэл WEBP хэлбэрээр хуулна уу.
      </p>
    );
  }

  if (!previewUrl) {
    return <div className="h-40 animate-pulse rounded-lg bg-slate-100" />;
  }

  return (
    <div className="space-y-2">
      <div className="overflow-auto rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
        {/*
          The positioned container: the image, and a marker laid over exactly its box, so a
          pin at 0.5, 0.5 sits at the middle of the drawing and not of the card.
        */}
        <div className="relative mx-auto w-fit">
          <img
            src={previewUrl}
            alt={plan.title ?? 'Давхарын план зураг'}
            className="mx-auto block max-h-[420px] w-auto max-w-full"
            onPointerUp={handlePlanClick}
            style={editable ? { cursor: 'crosshair' } : undefined}
          />

          {value && (
            <span
              role="img"
              aria-label="План дээр тэмдэглэсэн байрлал"
              className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-600 shadow ring-2 ring-white"
              style={markerStyle(value)}
            />
          )}
        </div>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs text-slate-500">
            {value
              ? `Тэмдэглэсэн байрлал: ${(value.x * 100).toFixed(1)}% · ${(value.y * 100).toFixed(1)}%. Дахин дарж шилжүүлнэ.`
              : 'План дээр дарж асуудал гарсан байрлалыг тэмдэглэнэ үү. Заавал биш.'}
          </p>
          {value && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange?.(null)}>
              Тэмдэглэгээ арилгах
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
