import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAN_ASPECT,
  PLAN_FLOW_WIDTH,
  clamp01,
  markerStyle,
  planSizeForAspect,
  positionWithin,
  samePlanPosition,
  toCanvasPoint,
  toPlanPosition,
} from './plan-geometry';

function boxed(width: number, height: number, left = 0, top = 0): HTMLElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
  return element;
}

describe('plan geometry', () => {
  it('clamps to the unit range', () => {
    expect(clamp01(-0.4)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });

  /** The pin and the plan panel share these two, so they are asserted together. */
  it('resolves a pointer against the rendered box and draws it back', () => {
    expect(positionWithin(boxed(400, 200), 100, 100)).toEqual({ x: 0.25, y: 0.5 });
    // The same fraction whatever the box: that is the point of normalising.
    expect(positionWithin(boxed(800, 400), 200, 200)).toEqual({ x: 0.25, y: 0.5 });
    expect(markerStyle({ x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' });
  });

  it('has nothing to say about a box that has not been laid out', () => {
    expect(positionWithin(boxed(0, 0), 10, 10)).toBeNull();
  });

  it('keeps the canvas box one width wide and follows the image aspect', () => {
    expect(planSizeForAspect(2)).toEqual({ width: PLAN_FLOW_WIDTH, height: PLAN_FLOW_WIDTH / 2 });
    // An image that has not decoded has no aspect to follow.
    expect(planSizeForAspect(Number.NaN)).toEqual(planSizeForAspect(DEFAULT_PLAN_ASPECT));
    expect(planSizeForAspect(0)).toEqual(planSizeForAspect(DEFAULT_PLAN_ASPECT));
  });

  it('round-trips a position through the canvas box', () => {
    const size = planSizeForAspect(2);
    const point = toCanvasPoint({ x: 0.25, y: 0.75 }, size);
    expect(point).toEqual({ x: 250, y: 375 });
    expect(toPlanPosition(point, size)).toEqual({ x: 0.25, y: 0.75 });
  });

  /** A marker dragged past the edge lands on it, never off the drawing. */
  it('clamps a point dragged outside the drawing', () => {
    const size = planSizeForAspect(1);
    expect(toPlanPosition({ x: -40, y: 4000 }, size)).toEqual({ x: 0, y: 1 });
  });

  it('treats a drag that ended where it started as no change', () => {
    expect(samePlanPosition({ x: 0.5, y: 0.5 }, { x: 0.500001, y: 0.499999 })).toBe(true);
    expect(samePlanPosition({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.5 })).toBe(false);
    expect(samePlanPosition(null, null)).toBe(true);
    expect(samePlanPosition(null, { x: 0, y: 0 })).toBe(false);
  });
});
