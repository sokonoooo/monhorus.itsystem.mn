import { DEFAULT_SERVICE_REQUEST_STAGES } from '@monhorus/shared';
import { useEffect, useState } from 'react';

import { vocabularyService, type VocabularyStageDto } from '../services/vocabulary.service';

/**
 * The request stages currently configured.
 *
 * Read from the server so a filter offers the steps THIS business recognises: an
 * administrator who renamed «Нээлттэй» or folded two statuses together expects the change
 * everywhere, and a screen printing the bundled list would quietly disagree with the labels
 * the server puts on the rows beside it.
 *
 * READ FROM `/vocabulary`, NOT `/settings`. This used to fetch the settings document and
 * pick one key out of it, which needs `settings.view` — a permission a customer does not
 * hold, and the customer portal is one of the two callers. The old comment here explained at
 * length why the fallback had to be generous *because* a customer's read was refused; that
 * reasoning is gone, because the read now succeeds for anyone signed in.
 *
 * FALLING BACK IS STILL RIGHT, and now for one plain reason rather than a permissions one:
 * this is a grouping, not a number. A stale LABEL on a filter that still filters correctly
 * is a cosmetic wrong; an empty filter is a screen a user cannot narrow at all. That remains
 * the OPPOSITE of `use-risk-bands.ts`, where a threshold presented as the rule would be a
 * wrong number and silence is the only honest answer.
 *
 * Cached for the page's lifetime: stages change about as often as the org chart, and every
 * screen with a status filter would otherwise fetch them. Only a successful read is cached,
 * so a refused or failed one is retried on the next mount.
 */
let cached: readonly VocabularyStageDto[] | null = null;
let inflight: Promise<readonly VocabularyStageDto[] | null> | null = null;

/**
 * The shipped list in the shape the endpoint publishes.
 *
 * `ServiceRequestStage` also carries `entryStatus` and `onBoard`, which decide what a MOVE
 * does and which columns a board draws. Neither is published and neither belongs to a
 * filter, so the fallback is narrowed to the same fields rather than the consumers being
 * handed two different shapes depending on whether the fetch succeeded.
 */
const FALLBACK: readonly VocabularyStageDto[] = DEFAULT_SERVICE_REQUEST_STAGES.map((stage) => ({
  key: stage.key,
  label: stage.label,
  colour: stage.colour,
  statuses: [...stage.statuses],
  hidden: stage.hidden,
}));

async function loadStages(): Promise<readonly VocabularyStageDto[] | null> {
  if (cached) return cached;

  inflight ??= vocabularyService
    .get()
    .then((vocabulary) => {
      const stages = vocabulary.requestStages;
      // The server already discards a stored list that no longer covers every status, so
      // anything non-empty that arrives is a usable grouping.
      if (!Array.isArray(stages) || stages.length === 0) return null;

      cached = stages.map((stage) => ({
        key: stage.key,
        label: stage.label,
        colour: stage.colour,
        statuses: [...stage.statuses],
        hidden: stage.hidden,
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
export function invalidateRequestStages(): void {
  cached = null;
}

export function useRequestStages(): readonly VocabularyStageDto[] {
  const [stages, setStages] = useState<readonly VocabularyStageDto[]>(cached ?? FALLBACK);

  useEffect(() => {
    let cancelled = false;
    void loadStages().then((resolved) => {
      if (!cancelled && resolved) setStages(resolved);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return stages;
}
