import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FloorPlanCanvas, type PlanMarker } from './FloorPlanCanvas';

/**
 * The floor plan blanked the whole page with "Maximum update depth exceeded".
 *
 * `planSizeForAspect` returns a fresh object each call, the image's `ref` was an inline
 * arrow (so React re-invoked it on every render), and a cached picture reports
 * `complete === true` immediately — so every render set state and scheduled the next one.
 *
 * jsdom leaves `complete` false and `naturalWidth` 0 on every image, which is exactly why
 * the entire suite passed while the page could not render at all in a browser. This test
 * defines both, so the cached-image path the bug lived on is the path under test.
 */
function asCachedImages(width: number, height: number): void {
  Object.defineProperty(HTMLImageElement.prototype, 'complete', {
    configurable: true,
    get: () => true,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLImageElement.prototype, 'naturalHeight', {
    configurable: true,
    get: () => height,
  });
}

const MARKER: PlanMarker = {
  id: 'o1',
  code: 'CT-LDB-1',
  name: 'Гэрэлтүүлгийн самбар',
  icon: 'PANEL',
  iconUrl: null,
  typeName: 'Түгээх самбар',
  riskLevel: 'NORMAL',
  position: { x: 0.5, y: 0.5 },
};

describe('FloorPlanCanvas with a cached plan image', () => {
  afterEach(() => {
    for (const prop of ['complete', 'naturalWidth', 'naturalHeight']) {
      Reflect.deleteProperty(HTMLImageElement.prototype, prop);
    }
    vi.restoreAllMocks();
  });

  it('settles instead of re-rendering forever', () => {
    asCachedImages(1714, 1384);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() =>
      render(
        <FloorPlanCanvas
          imageUrl="blob:plan"
          imageAlt="2-р давхар"
          markers={[MARKER]}
          editing={false}
          selectedId={null}
          onSelect={() => undefined}
          onMarkerMove={() => undefined}
        />,
      ),
    ).not.toThrow();

    expect(screen.getByAltText('2-р давхар')).toBeInTheDocument();

    // The failure this replaces: React aborts with this exact message and unmounts.
    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/Maximum update depth exceeded/);
  });

  it('stays settled when the same picture reports its size again', () => {
    asCachedImages(1714, 1384);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const props = {
      imageUrl: 'blob:plan',
      imageAlt: '2-\u0440 \u0434\u0430\u0432\u0445\u0430\u0440',
      markers: [MARKER],
      editing: false,
      selectedId: null,
      onSelect: () => undefined,
      onMarkerMove: () => undefined,
    };

    const { rerender } = render(<FloorPlanCanvas {...props} />);
    // A re-render re-invokes the image ref. The aspect has not moved, so nothing
    // about the plan's size has, and the render must not cascade.
    expect(() => rerender(<FloorPlanCanvas {...props} />)).not.toThrow();

    const logged = errors.mock.calls.flat().join(' ');
    expect(logged).not.toMatch(/Maximum update depth exceeded/);
  });
});
