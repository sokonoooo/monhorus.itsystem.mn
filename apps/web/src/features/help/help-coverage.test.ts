import { describe, expect, it } from 'vitest';

// Read through the bundler rather than through node:fs, because the web tsconfig carries
// only vite/client types - and this way the path is resolved the same way an import is,
// so moving App.tsx breaks the test at build time instead of at run time.
import appSource from '../../App.tsx?raw';

import { HELP_CONTENT } from './help-content';
import { FALLBACK_KEY } from './resolve-help';

/**
 * Every page in the shell has help, and this is what keeps that true.
 *
 * The route list is read out of the router rather than restated here, because a copy would
 * be exactly as stale as the problem it is meant to catch: someone adds a page, help is
 * never written for it, and nobody notices until a user presses the button and is told
 * there is nothing to read. Reading the source means adding a route to App.tsx fails this
 * test until its help exists.
 */
/**
 * Routes that deliberately have no help.
 *
 * The auth screens render outside AppShell, so they have no header and therefore no Help
 * button at all; the two redirects are never displayed to anyone.
 */
const NOT_HELPED = new Set([
  '/login',
  '/forgot-password',
  '/reset-password/:token',
  '/', // -> /dashboard
  '/dispatch', // -> /service-requests/dispatch
  '*', // the not-found page, keyed as FALLBACK_KEY instead
]);

/** Every path the router declares, including the ones that get no help of their own. */
function allRoutes(): string[] {
  const found = [...appSource.matchAll(/path="([^"]+)"/g)].map((match) => match[1] as string);
  return [...new Set(found)];
}

describe('help coverage', () => {
  const declared = allRoutes();
  const routes = declared.filter((path) => !NOT_HELPED.has(path));

  // Guards the guard: a refactor that renames the file or changes how routes are declared
  // would otherwise leave this suite passing over an empty list.
  it('finds the routes in the router', () => {
    expect(routes.length).toBeGreaterThan(40);
    expect(routes).toContain('/service-requests/dispatch');
  });

  it('has an entry for every in-shell route', () => {
    const missing = routes.filter((route) => !(route in HELP_CONTENT));
    expect(missing).toEqual([]);
  });

  it('has help for the not-found page', () => {
    expect(HELP_CONTENT[FALLBACK_KEY]).toBeDefined();
  });

  /** A key that matches no route is help nobody can ever open - usually a typo in the path. */
  it('has no entry for a route that does not exist', () => {
    const known = new Set([...routes, FALLBACK_KEY]);
    const orphans = Object.keys(HELP_CONTENT).filter((key) => !known.has(key));
    expect(orphans).toEqual([]);
  });

  it('gives every entry a title and a purpose', () => {
    const incomplete = Object.entries(HELP_CONTENT)
      .filter(([, help]) => !help.title?.trim() || !help.purpose?.trim())
      .map(([route]) => route);
    expect(incomplete).toEqual([]);
  });

  /**
   * `related` is rendered as a Link, so a typo becomes a dead click rather than a visible
   * error. Every target must be a route the router actually serves.
   */
  it('only links to routes that exist', () => {
    // Drawn from every declared route, not just the helped ones - '/forgot-password' has no
    // help of its own but is a perfectly good place to send someone. Parameterised routes
    // are excluded: '/employees/:employeeId' is not an address anyone can navigate to, so a
    // link to it would render an href of that literal string.
    const linkable = new Set(declared.filter((route) => !route.includes(':') && route !== '*'));
    const broken: string[] = [];

    for (const [route, help] of Object.entries(HELP_CONTENT)) {
      for (const link of help.related ?? []) {
        if (!linkable.has(link.to)) broken.push(`${route} -> ${link.to}`);
      }
    }

    expect(broken).toEqual([]);
  });

  /**
   * SLA was deliberately hidden from customers; the portal help must not put back in words
   * what the screens stopped showing.
   */
  it('never mentions SLA or deadlines on portal pages', () => {
    const offenders = Object.entries(HELP_CONTENT)
      .filter(([route]) => route.startsWith('/portal'))
      .filter(([, help]) => /sla|хугацаа дуус|эцсийн хугацаа|countdown/i.test(JSON.stringify(help)))
      .map(([route]) => route);

    expect(offenders).toEqual([]);
  });
});
