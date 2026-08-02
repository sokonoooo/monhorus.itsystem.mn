import { RISK_BANDS, riskBandsOf, type RiskBand } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { settingsService } from '../services/settings.service';

/**
 * The risk bands currently in force.
 *
 * Read from Тохиргоо rather than printed as constants, so a legend or a threshold shown on
 * screen cannot drift from the values the backend is actually banding against. The shipped
 * defaults stand in until the request lands, which keeps the first paint correct for
 * anybody who has not changed them.
 *
 * Cached for the page's lifetime: thresholds change about once a year, and every screen
 * showing a score would otherwise fetch them.
 */
let cached: RiskBand[] | null = null;
let inflight: Promise<RiskBand[]> | null = null;

async function loadBands(): Promise<RiskBand[]> {
  if (cached) return cached;

  inflight ??= settingsService
    .get()
    .then((settings) => {
      const map = Object.fromEntries(
        settings.groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.value])),
      );
      cached = riskBandsOf(map as Parameters<typeof riskBandsOf>[0]);
      return cached;
    })
    .catch(() => [...RISK_BANDS])
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test seam, and used after a settings change so the next read is fresh. */
export function invalidateRiskBands(): void {
  cached = null;
}

export function useRiskBands(): readonly RiskBand[] {
  const [bands, setBands] = useState<readonly RiskBand[]>(cached ?? RISK_BANDS);

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
