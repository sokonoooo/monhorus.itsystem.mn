import { describe, expect, it } from 'vitest';

import type { HelpRegistry } from './help-content.types';
import { resolveHelp } from './resolve-help';

/** Distinguishable only by title, which is all these cases need to tell apart. */
function entry(title: string) {
  return { title, purpose: `${title} зорилго` };
}

const registry: HelpRegistry = {
  '/service-requests': entry('Жагсаалт'),
  '/service-requests/new': entry('Шинэ хүсэлт'),
  '/service-requests/dispatch': entry('Dispatch'),
  '/service-requests/:requestId': entry('Дэлгэрэнгүй'),
  '/floors/:floorId/objects/:objectId': entry('Обьект'),
  '/floors/:floorId/objects/new': entry('Шинэ обьект'),
  '*': entry('Олдсонгүй'),
};

describe('resolveHelp', () => {
  it('matches an exact route', () => {
    expect(resolveHelp(registry, '/service-requests')?.title).toBe('Жагсаалт');
  });

  it('matches a parameterised route', () => {
    expect(resolveHelp(registry, '/service-requests/64af12')?.title).toBe('Дэлгэрэнгүй');
  });

  /**
   * The case that makes specificity load bearing rather than tidy. Both '/…/new' and
   * '/…/:requestId' match this path, and a reader on the create form must not be handed
   * instructions for reading an existing request.
   */
  it('prefers the literal segment over the parameter', () => {
    expect(resolveHelp(registry, '/service-requests/new')?.title).toBe('Шинэ хүсэлт');
    expect(resolveHelp(registry, '/service-requests/dispatch')?.title).toBe('Dispatch');
  });

  it('prefers the literal segment when it is the last of several', () => {
    expect(resolveHelp(registry, '/floors/f1/objects/new')?.title).toBe('Шинэ обьект');
    expect(resolveHelp(registry, '/floors/f1/objects/o1')?.title).toBe('Обьект');
  });

  it('does not match a path with a different number of segments', () => {
    // Would otherwise be caught by ':requestId' if depth were ignored.
    expect(resolveHelp(registry, '/service-requests/64af12/extra')?.title).toBe('Олдсонгүй');
  });

  /** An unmatched URL means the router is showing the not-found page, which has its own help. */
  it('falls back to the wildcard entry for an unknown path', () => {
    expect(resolveHelp(registry, '/nowhere')?.title).toBe('Олдсонгүй');
  });

  it('returns null when there is no match and no wildcard', () => {
    const { '*': _fallback, ...withoutFallback } = registry;
    expect(resolveHelp(withoutFallback, '/nowhere')).toBeNull();
  });
});
