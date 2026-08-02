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

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: memoryStorage,
});

afterEach(() => {
  cleanup();
  memoryStorage.clear();
  vi.restoreAllMocks();
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
