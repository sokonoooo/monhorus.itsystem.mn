import type { PlanPositionDto } from '@monhorus/shared';

/**
 * The one coordinate model for anything drawn on a floor plan.
 *
 * A plan position is a fraction of the rendered image's own box, never a pixel pair, so the
 * same stored value lands on the same part of the drawing whatever size the image happens to
 * be laid out at. Both the object placement panel and the service-request pin resolve and
 * draw positions through here, so there is exactly one implementation of that arithmetic.
 */

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * How far a press has to travel before it counts as a drag rather than a click.
 *
 * In device pixels, because that is what a hand shaking on a mouse button produces; a
 * fraction of the plan would mean something different on every screen.
 */
export const DRAG_THRESHOLD_PX = 4;

/**
 * Turns a pointer position into a plan coordinate.
 *
 * Measured against the rendered image's own box. A zero-sized box means the image has not
 * been laid out yet and there is nothing meaningful to compute.
 */
export function positionWithin(
  element: HTMLElement,
  clientX: number,
  clientY: number,
): PlanPositionDto | null {
  const rect = element.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

/**
 * Where a marker sits inside the image's box.
 *
 * The absolute counterpart of `positionWithin`: percentages so the overlay tracks the image
 * as it is laid out, paired with a `-translate-*-1/2` on the marker itself so the point,
 * rather than the marker's corner, is what the coordinate names.
 */
export function markerStyle(position: PlanPositionDto | null): { left: string; top: string } {
  return {
    left: `${(position?.x ?? 0) * 100}%`,
    top: `${(position?.y ?? 0) * 100}%`,
  };
}
