import { useEffect, useState } from 'react';

import type { RiskBandView } from '../components/ui/risk-palette';
import { vocabularyService, type VocabularyRiskBandDto } from '../services/vocabulary.service';

/**
 * The risk bands currently in force.
 *
 * Read from the server rather than printed as constants, so a legend, a threshold or a band
 * NAME shown on screen cannot drift from what the backend is actually banding against.
 *
 * READ FROM `/vocabulary`, NOT `/settings`. This hook used to fetch the settings document
 * and pick one key out of it, which works only for a caller holding `settings.view`. A
 * CUSTOMER holds no such permission, so on the portal that call 403s — and the portal is
 * exactly where band names and colours matter most: an administrator renamed a band, and
 * the staff console followed while the customer's own building page silently kept painting
 * the labels compiled into the bundle. `/vocabulary` needs only a session and publishes the
 * resolved ladder for precisely this reason. The SLA hooks stay on `/settings`, because an
 * SLA window genuinely is staff configuration.
 *
 * Null means "not known", and callers must then say nothing about the bands. This hook
 * used to fall back to the shipped `RISK_BANDS` on failure, which meant a refused or failed
 * read printed the bundled thresholds in the legend as though they were the ones in force —
 * a wrong number presented as the rule, which is worse than no number at all. The mobile
 * apps refuse to print thresholds for exactly this reason, and `use-sla-hours.ts` takes the
 * same line.
 *
 * THAT NULL IS LOAD-BEARING, not tidiness: `ObjectFormPage` reads it as "I cannot tell which
 * side of the line this score falls on" and demands a conclusion, a recommendation and the
 * action taken for ANY score rather than guessing. Returning the shipped ladder here would
 * silently turn that into "the shipped ladder is in force", and an installation that had
 * re-cut its bands would skip the very fields the backend is about to demand — writing the
 * object and then losing its assessment to a refusal.
 *
 * COLOUR IS THE ONE THING ALLOWED TO FALL BACK, and only because a hue states no number: see
 * `risk-palette.ts`, where a null ladder paints the shipped colours and a null ladder still
 * prints no boundary anywhere.
 *
 * Cached for the page's lifetime: bands change about once a year, and every screen showing a
 * score would otherwise fetch them. Only a successful read is cached, so a refused or failed
 * one is retried on the next mount.
 */
let cached: readonly RiskBandView[] | null = null;
let inflight: Promise<readonly RiskBandView[] | null> | null = null;

/**
 * Whether the published ladder actually covers every score from 0 to 100.
 *
 * The server resolves the ranges and substitutes the shipped ladder for a stored one that
 * does not tile, so this should always hold — which is the point of checking it. A payload
 * with a hole in it is a payload this build does not understand, and banding a score against
 * a ladder that has one produces a verdict nobody configured. Unknown is the honest answer.
 */
function tiles(bands: readonly VocabularyRiskBandDto[]): boolean {
  if (bands.length === 0) return false;
  if (bands.some((band) => !Number.isInteger(band.min) || !Number.isInteger(band.max))) {
    return false;
  }

  const ascending = [...bands].sort((a, b) => a.min - b.min);
  if (ascending[0]!.min !== 0) return false;
  if (ascending[ascending.length - 1]!.max !== 100) return false;
  return ascending.every(
    (band, index) => index === 0 || band.min === ascending[index - 1]!.max + 1,
  );
}

async function loadBands(): Promise<readonly RiskBandView[] | null> {
  if (cached) return cached;

  inflight ??= vocabularyService
    .get()
    .then((vocabulary) => {
      const bands = vocabulary.riskBands;
      if (!Array.isArray(bands) || !tiles(bands)) return null;

      // Copied field by field rather than passed through, so the view type stays the
      // contract the components read and a field added to the endpoint cannot leak into
      // them unnoticed.
      cached = bands.map((band) => ({
        level: band.level,
        label: band.label,
        colour: band.colour,
        min: band.min,
        max: band.max,
      }));
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test seam, and used after a settings change so the next read is fresh. */
export function invalidateRiskBands(): void {
  cached = null;
}

export function useRiskBands(): readonly RiskBandView[] | null {
  const [bands, setBands] = useState<readonly RiskBandView[] | null>(cached);

  useEffect(() => {
    let cancelled = false;
    void loadBands().then((resolved) => {
      if (!cancelled) setBands(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return bands;
}
