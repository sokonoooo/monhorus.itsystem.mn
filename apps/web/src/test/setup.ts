import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

/**
 * Deterministic localStorage.
 *
 * The jsdom build in use here does not expose a working Storage implementation, and
 * token-storage.ts depends on one. A plain in-memory Map keeps the tests independent
 * of jsdom's storage behaviour.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const memoryStorage = new MemoryStorage();
/** Separate instance, because the two stores are separate in a browser. */
const memorySessionStorage = new MemoryStorage();

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: memoryStorage,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  writable: true,
  value: memorySessionStorage,
});

afterEach(() => {
  cleanup();
  memoryStorage.clear();
  memorySessionStorage.clear();
  vi.restoreAllMocks();
});

/**
 * ResizeObserver and DOMMatrixReadOnly.
 *
 * jsdom implements neither, and every `@xyflow/react` surface needs both: the canvas
 * measures its container with an observer and reads the viewport's zoom back out of the
 * computed transform with a matrix. Without them the floor plan and the single-line
 * diagram throw on mount, so they are stubbed here rather than in each test file.
 *
 * The observer reports whatever the element's own box says, which is nothing at all in
 * jsdom unless a test states it — the same as a browser element that has not been laid out.
 */
class TestResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element): void {
    this.callback(
      [{ target, contentRect: target.getBoundingClientRect() } as ResizeObserverEntry],
      this,
    );
  }

  unobserve(): void {}

  disconnect(): void {}
}

Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: TestResizeObserver,
});

/** Only `m22` is ever read, and only ever to recover the zoom from a `scale()`. */
class TestDOMMatrixReadOnly {
  readonly m22: number;

  constructor(transform?: string) {
    const scale = /scale\(\s*([\d.]+)/.exec(transform ?? '');
    this.m22 = scale ? Number(scale[1]) : 1;
  }
}

Object.defineProperty(globalThis, 'DOMMatrixReadOnly', {
  configurable: true,
  writable: true,
  value: TestDOMMatrixReadOnly,
});

// jsdom does not implement matchMedia, which the responsive shell touches.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});
