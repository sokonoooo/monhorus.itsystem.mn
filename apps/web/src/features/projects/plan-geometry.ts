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

// -- Plan space on a zoomable canvas -----------------------------------------

/**
 * The drawing's box in canvas units.
 *
 * A zoomable canvas needs a coordinate space of its own to place things in, and a plan
 * position is only a fraction — it says nothing about how wide the drawing is. The box is
 * therefore fixed at `PLAN_FLOW_WIDTH` units wide whatever the image's pixel size, with the
 * height following the picture's true aspect, so the zoom levels mean the same thing on a
 * 900px scan and a 6000px one. Zoom, not the unit count, is what magnifies the drawing, and
 * the image is scaled by the browser rather than resampled by us, so it stays crisp.
 */
export interface PlanSize {
  width: number;
  height: number;
}

export const PLAN_FLOW_WIDTH = 1000;

/**
 * The shape assumed before the image reports its own.
 *
 * An image that has not decoded yet has no natural size, and a marker has to be drawn
 * somewhere: 4:3 is the commonest floor-plan scan ratio, and the canvas re-measures and
 * refits the moment the real one arrives.
 */
export const DEFAULT_PLAN_ASPECT = 4 / 3;

export function planSizeForAspect(aspect: number): PlanSize {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_PLAN_ASPECT;
  return { width: PLAN_FLOW_WIDTH, height: PLAN_FLOW_WIDTH / safe };
}

/** A stored fraction as a point in the canvas's own units. */
export function toCanvasPoint(
  position: PlanPositionDto,
  size: PlanSize,
): { x: number; y: number } {
  return { x: position.x * size.width, y: position.y * size.height };
}

/**
 * A point in canvas units back to the stored fraction.
 *
 * Clamped, because a marker dragged past the edge of the drawing has to land on it: a
 * position outside 0..1 would name a spot that is not on the plan at all.
 */
export function toPlanPosition(
  point: { x: number; y: number },
  size: PlanSize,
): PlanPositionDto {
  if (size.width === 0 || size.height === 0) return { x: 0, y: 0 };
  return { x: clamp01(point.x / size.width), y: clamp01(point.y / size.height) };
}

/**
 * Whether two positions name the same spot.
 *
 * Compared with a tolerance rather than by equality: a drag that ends where it started
 * still arrives as a slightly different pair of floats, and that is not an edit worth
 * sending to the server.
 */
export function samePlanPosition(
  a: PlanPositionDto | null,
  b: PlanPositionDto | null,
  epsilon = 1e-4,
): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a.x - b.x) < epsilon && Math.abs(a.y - b.y) < epsilon;
}
