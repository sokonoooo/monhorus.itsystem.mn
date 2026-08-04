import { PERMISSIONS, SETTING_KEYS, slaConfigOf, type SettingsMap } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { useAuth } from '../contexts/auth-context';
import { settingsService } from '../services/settings.service';

/** The two SLA windows currently in force, in hours. */
export interface SlaHours {
  urgent: number;
  standard: number;
}

/**
 * The SLA windows the backend will actually band a new request against.
 *
 * `sla.urgent_hours` and `sla.standard_hours` are administrator settings (1-720), and
 * `service-request.service.ts` computes every deadline from them: "the backend is the
 * sole authority for deadlines". A form that prints 6/24 as constants therefore promises
 * a deadline the server may not honour the moment somebody changes either value.
 *
 * Null means "not known", and callers must then say nothing about the SLA. Unlike
 * `use-risk-bands.ts`, this hook deliberately does NOT fall back to the shipped defaults
 * on failure: a wrong number presented as the rule is worse than no number at all, and
 * `GET /settings` is refused outright to the request-creating roles that lack
 * `settings.view` (DISPATCH and SALES both do).
 *
 * Cached for the page's lifetime — the windows change about once a year. Only a
 * successful read is cached, so a refused or failed one is retried on the next mount.
 */
let cached: SlaHours | null = null;
let inflight: Promise<SlaHours | null> | null = null;

async function loadSlaHours(): Promise<SlaHours | null> {
  if (cached) return cached;

  inflight ??= settingsService
    .get()
    .then((settings) => {
      const map = Object.fromEntries(
        settings.groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.value])),
      ) as SettingsMap;

      // A settings payload missing either key, or carrying a non-numeric one, is not
      // something to guess around: `slaConfigOf` would hand back NaN and the form would
      // print "SLA NaN цаг".
      if (map[SETTING_KEYS.SLA_URGENT_HOURS] == null) return null;
      if (map[SETTING_KEYS.SLA_STANDARD_HOURS] == null) return null;

      const config = slaConfigOf(map);
      if (!Number.isFinite(config.urgentHours)) return null;
      if (!Number.isFinite(config.standardHours)) return null;

      cached = { urgent: config.urgentHours, standard: config.standardHours };
      return cached;
    })
    .catch(() => null)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

/** Test seam, and used after a settings change so the next read is fresh. */
export function invalidateSlaHours(): void {
  cached = null;
}

export function useSlaHours(): SlaHours | null {
  const { can } = useAuth();
  const allowed = can(PERMISSIONS.SETTINGS_VIEW);
  const [hours, setHours] = useState<SlaHours | null>(cached);

  useEffect(() => {
    // No point asking for a document the guard will refuse; the answer is the same
    // either way, which is that this caller cannot state the SLA.
    if (!allowed) return undefined;

    let cancelled = false;
    void loadSlaHours().then((resolved) => {
      if (!cancelled) setHours(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, [allowed]);

  return allowed ? hours : null;
}
