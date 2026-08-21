/**
 * Risk bands — the ladder a 0-100 score is read against.
 *
 * Five bands ship by default because that is what the requirements describe, but the
 * count, the names, the colours and the cut points are an administrator's decision. What
 * is *not* negotiable is that a score always lands somewhere: the bands tile 0..100 with
 * no gap and no overlap, which is why only the lower bound of each is configurable and
 * the upper bound is derived from the band above it.
 *
 * Behaviour travels with the band rather than with its name. Today the rule "a dangerous
 * finding must carry a conclusion" is written as `riskLevel === 'CRITICAL' ||
 * riskLevel === 'OUT_OF_SERVICE'`, which quietly means "the two bands that happened to be
 * called that when it was written". Rename one and the safety gate moves with the word
 * instead of with the meaning. The flags below say what a band *does*, so renaming it is
 * only renaming it.
 */

import { RISK_LEVELS, type RiskLevel } from './service-request';

export const RISK_COLOURS = [
  'green',
  'yellow',
  'orange',
  'red',
  'black',
  'grey',
  'blue',
  'purple',
] as const;

export type RiskColour = (typeof RISK_COLOURS)[number];

export interface RiskBandConfig {
  /** One of the reserved storage keys. Stable across renames. */
  readonly key: RiskLevel;
  readonly label: string;
  readonly colour: RiskColour;
  /** Lowest score in the band. The top of the band is the next band's minimum minus one. */
  readonly minScore: number;
  /**
   * A finding in this band must carry a written conclusion and what was done about it.
   * Default: the two worst bands, matching requirement 10.1.
   */
  readonly requiresConclusion: boolean;
  /** A finding in this band must carry a recommendation. */
  readonly requiresRecommendation: boolean;
  /**
   * Reaching this band takes the equipment out of service.
   *
   * An irreversible write to another collection, so exactly one band should carry it —
   * the worst one — and it is off by default everywhere else.
   */
  readonly decommissions: boolean;
  /** Reaching this band alerts dispatch. Off for the healthy band, on for the rest. */
  readonly notifies: boolean;
}

/**
 * The shipped ladder, worst-first so the order matches how the product talks about
 * severity and how the portal reads a building "worst band present" first.
 */
export const DEFAULT_RISK_BANDS: readonly RiskBandConfig[] = [
  {
    key: 'OUT_OF_SERVICE',
    label: 'Ашиглах боломжгүй',
    colour: 'black',
    minScore: 0,
    requiresConclusion: true,
    requiresRecommendation: true,
    decommissions: true,
    notifies: true,
  },
  {
    key: 'CRITICAL',
    label: 'Ноцтой эрсдэлтэй',
    colour: 'red',
    minScore: 21,
    requiresConclusion: true,
    requiresRecommendation: true,
    decommissions: false,
    notifies: true,
  },
  {
    key: 'SCHEDULE_REPAIR',
    label: 'Ойрын хугацаанд засварлах',
    colour: 'orange',
    minScore: 41,
    requiresConclusion: false,
    requiresRecommendation: true,
    decommissions: false,
    notifies: true,
  },
  {
    key: 'ATTENTION',
    label: 'Анхаарах шаардлагатай',
    colour: 'yellow',
    minScore: 61,
    requiresConclusion: false,
    requiresRecommendation: true,
    decommissions: false,
    notifies: true,
  },
  {
    key: 'NORMAL',
    label: 'Хэвийн',
    colour: 'green',
    minScore: 81,
    requiresConclusion: false,
    requiresRecommendation: false,
    decommissions: false,
    notifies: false,
  },
];

/** A band with its resolved score range. */
export interface ResolvedRiskBand extends RiskBandConfig {
  readonly min: number;
  readonly max: number;
}

/**
 * Bands in ascending score order, each with the range it owns.
 *
 * The caller may hand these in any order; sorting here means the stored configuration
 * cannot produce overlapping ranges just because a row was moved.
 */
export function resolveRiskBands(
  bands: readonly RiskBandConfig[],
): readonly ResolvedRiskBand[] {
  const ascending = [...bands].sort((a, b) => a.minScore - b.minScore);
  return ascending.map((band, index) => {
    const next = ascending[index + 1];
    return { ...band, min: band.minScore, max: next ? next.minScore - 1 : 100 };
  });
}

/**
 * The band a score falls in.
 *
 * Returns the lowest band when a score sits below every configured minimum, which can
 * only happen if the bottom band does not start at zero — a configuration this module
 * rejects, but reading is not the place to throw.
 */
export function riskBandForScore(
  score: number,
  bands: readonly RiskBandConfig[],
): ResolvedRiskBand | null {
  const resolved = resolveRiskBands(bands);
  if (resolved.length === 0) return null;
  return (
    resolved.find((band) => score >= band.min && score <= band.max) ?? resolved[0] ?? null
  );
}

export function riskBandByKey(
  key: RiskLevel,
  bands: readonly RiskBandConfig[],
): RiskBandConfig | null {
  return bands.find((band) => band.key === key) ?? null;
}

/**
 * Faults in a proposed ladder, as messages an administrator can act on.
 *
 * The rules exist to keep two promises: every score between 0 and 100 lands in exactly
 * one band, and something is still dangerous. A ladder where nothing decommissions and
 * nothing demands a conclusion is legal — an administrator may genuinely want that — but
 * a ladder with a hole in it is not, because a score that matches no band would be stored
 * as whatever the fallback happened to be.
 */
export function validateRiskBands(bands: readonly RiskBandConfig[]): string[] {
  const issues: string[] = [];

  if (bands.length < 2) {
    issues.push('Дор хаяж хоёр түвшин тодорхойлно.');
    return issues;
  }
  if (bands.length > RISK_LEVELS.length) {
    issues.push(`Хамгийн ихдээ ${RISK_LEVELS.length} түвшин тохируулна.`);
    return issues;
  }

  const seen = new Set<string>();
  for (const band of bands) {
    if (!RISK_LEVELS.includes(band.key)) {
      issues.push(`«${band.key}» түвшний түлхүүр бүртгэлгүй байна.`);
    }
    if (seen.has(band.key)) issues.push(`«${band.key}» түлхүүр давхардсан байна.`);
    seen.add(band.key);

    if (!band.label.trim()) issues.push(`«${band.key}» түвшний нэр хоосон байна.`);
    if (!Number.isInteger(band.minScore) || band.minScore < 0 || band.minScore > 100) {
      issues.push(`«${band.label || band.key}» түвшний доод оноо 0-100 хооронд байна.`);
    }
  }

  const ascending = [...bands].sort((a, b) => a.minScore - b.minScore);
  if (ascending[0]?.minScore !== 0) {
    issues.push('Хамгийн доод түвшин 0 оноогоор эхэлнэ.');
  }
  for (let i = 1; i < ascending.length; i += 1) {
    if (ascending[i]!.minScore === ascending[i - 1]!.minScore) {
      issues.push(
        `«${ascending[i]!.label || ascending[i]!.key}» түвшний доод оноо давхардсан байна.`,
      );
    }
  }

  if (bands.filter((band) => band.decommissions).length > 1) {
    issues.push('Зөвхөн нэг түвшин тоноглолыг ашиглалтаас гаргана.');
  }

  return issues;
}

/**
 * A neutral name for a reserved key nobody has configured yet.
 *
 * Only ever seen if a stored record names a spare band that the current configuration
 * dropped; printing the key itself would show a reader `BAND_7`.
 */
export function fallbackRiskLabel(key: RiskLevel): string {
  const index = RISK_LEVELS.indexOf(key);
  return `Түвшин ${index + 1}`;
}
