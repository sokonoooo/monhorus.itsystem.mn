import type { HelpRegistry, PageHelp } from './help-content.types';

/**
 * Finds the help entry for a pathname.
 *
 * Matching is by route PATTERN, with `:param` segments treated as wildcards, and the most
 * specific match wins. That ordering is load-bearing rather than tidy: `/service-requests/new`
 * and `/service-requests/:requestId` both match `/service-requests/new`, and a reader on the
 * create form must not be shown instructions for reading an existing request.
 *
 * "Most specific" means the most literal segments, so a pattern that spells a segment out
 * beats one that accepts anything there.
 */
function score(pattern: string, path: string): number | null {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = path.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;

  let literals = 0;
  for (let i = 0; i < patternParts.length; i += 1) {
    const expected = patternParts[i] as string;
    const actual = pathParts[i] as string;
    if (expected.startsWith(':')) continue;
    if (expected !== actual) return null;
    literals += 1;
  }
  return literals;
}

/** Entry used when a URL matches no route at all - the not-found screen. */
export const FALLBACK_KEY = '*';

export function resolveHelp(registry: HelpRegistry, pathname: string): PageHelp | null {
  let best: PageHelp | null = null;
  let bestScore = -1;

  for (const [pattern, help] of Object.entries(registry)) {
    if (pattern === FALLBACK_KEY) continue;
    const matched = score(pattern, pathname);
    if (matched === null || matched <= bestScore) continue;
    best = help;
    bestScore = matched;
  }

  // The router sends anything unmatched to the not-found page, so an unmatched pathname
  // here means the reader is looking at that page - and it gets help like any other.
  return best ?? registry[FALLBACK_KEY] ?? null;
}
