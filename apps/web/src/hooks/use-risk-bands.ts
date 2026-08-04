import { SETTING_KEYS, riskBandsOf, type RiskBand } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { settingsService } from '../services/settings.service';

/**
 * The risk bands currently in force.
 *
 * Read from Тохиргоо rather than printed as constants, so a legend or a threshold shown on
 * screen cannot drift from the values the backend is actually banding against.
 *
 * Null means "not known", and callers must then say nothing about the bands. This hook
 * used to fall back to the shipped `RISK_BANDS` on failure, which meant a refused or
 * failed `GET /settings` printed the bundled thresholds in the legend as though they were
 * the ones in force — a wrong number presented as the rule, which is worse than no number
 * at all. The mobile apps refuse to print thresholds for exactly this reason, and
 * `use-sla-hours.ts` takes the same line.
 *
 * Cached for the page's lifetime: thresholds change about once a year, and every screen
 * showing a score would otherwise fetch them. Only a successful read is cached, so a
 * refused or failed one is retried on the next mount.
 */
let cached: RiskBand[] | null = null;
let inflight: Promise<RiskBand[] | null> | null = null;

const REQUIRED_KEYS = [
  SETTING_KEYS.EVAL_NORMAL_MIN,
  SETTING_KEYS.EVAL_ATTENTION_MIN,
  SETTING_KEYS.EVAL_SCHEDULE_REPAIR_MIN,
  SETTING_KEYS.EVAL_CRITICAL_MIN,
] as const;

async function loadBands(): Promise<RiskBand[] | null> {
  if (cached) return cached;

  inflight ??= settingsService
    .get()
    .then((settings) => {
      const map = Object.fromEntries(
        settings.groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.value])),
      ) as Parameters<typeof riskBandsOf>[0];

      // A payload missing any of the four thresholds, or carrying a non-numeric one, is
      // not something to guess around: `riskBandsOf` would hand back NaN bounds and the
      // legend would print "NaN-NaN%".
      if (REQUIRED_KEYS.some((key) => map[key] == null)) return null;

      const bands = riskBandsOf(map);
      if (bands.some((band) => !Number.isFinite(band.min) || !Number.isFinite(band.max))) {
        return null;
      }

      cached = bands;
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

export function useRiskBands(): readonly RiskBand[] | null {
  const [bands, setBands] = useState<readonly RiskBand[] | null>(cached);

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
