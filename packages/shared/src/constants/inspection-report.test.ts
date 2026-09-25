import { describe, expect, it } from 'vitest';

import {
  OVERALL_SAFETY_LABELS,
  SEVERITY_ORDER,
  isRiskFinding,
  overallSafetyLabelOf,
  overallSafetyLevel,
  severityOrderOf,
} from './inspection-report';
import { DEFAULT_RISK_BANDS, type RiskBandConfig } from './risk-band';
import { RISK_LEVELS, type RiskBand } from './service-request';
import { SETTING_KEYS, defaultSettings, riskBandsOf } from './settings';

/**
 * The report's verdict, read against a CONFIGURED ladder.
 *
 * The bands are built through `riskBandsOf` rather than hand-written, so these exercise
 * the same shape and the same ordering the server hands the report — a ladder assembled
 * only for the test could agree with the code and disagree with production.
 */
function bandsFor(configured?: readonly RiskBandConfig[]): RiskBand[] {
  const settings = defaultSettings();
  if (configured) settings[SETTING_KEYS.EVAL_RISK_BANDS] = configured as RiskBandConfig[];
  return riskBandsOf(settings);
}

/** The shipped five, plus a MILD sixth the product says is only a settings change. */
const WITH_MILD_SIXTH: readonly RiskBandConfig[] = [
  ...DEFAULT_RISK_BANDS.filter((band) => band.key !== 'NORMAL'),
  { ...DEFAULT_RISK_BANDS.find((band) => band.key === 'NORMAL')!, minScore: 81 },
  {
    key: 'BAND_6',
    label: 'Маш сайн',
    colour: 'blue',
    minScore: 91,
    requiresConclusion: false,
    requiresRecommendation: false,
    decommissions: false,
    notifies: false,
  },
];

describe('severityOrderOf', () => {
  it('reproduces SEVERITY_ORDER when no ladder is passed', () => {
    expect(severityOrderOf()).toEqual(SEVERITY_ORDER);
    expect(severityOrderOf(null)).toEqual(SEVERITY_ORDER);
    expect(severityOrderOf([])).toEqual(SEVERITY_ORDER);
  });

  it('ranks the shipped ladder worst-first by its lower bound', () => {
    expect(severityOrderOf(bandsFor()).slice(0, 5)).toEqual([
      'OUT_OF_SERVICE',
      'CRITICAL',
      'SCHEDULE_REPAIR',
      'ATTENTION',
      'NORMAL',
    ]);
  });

  it('puts reserved keys the ladder does not use LAST, never ahead of a real band', () => {
    const order = severityOrderOf(bandsFor());
    expect(order.slice(5)).toEqual(['BAND_6', 'BAND_7', 'BAND_8']);
    expect(order).toHaveLength(RISK_LEVELS.length);
    expect(order.indexOf('BAND_8')).toBeGreaterThan(order.indexOf('OUT_OF_SERVICE'));
  });

  it('ranks a configured mild sixth band as the mildest, not the worst', () => {
    expect(severityOrderOf(bandsFor(WITH_MILD_SIXTH))).toEqual([
      'OUT_OF_SERVICE',
      'CRITICAL',
      'SCHEDULE_REPAIR',
      'ATTENTION',
      'NORMAL',
      'BAND_6',
      'BAND_7',
      'BAND_8',
    ]);
  });
});

describe('overallSafetyLevel', () => {
  it('is unchanged on an installation that has configured nothing', () => {
    const bands = bandsFor();
    for (const levels of [
      ['NORMAL', 'ATTENTION', 'CRITICAL'],
      ['NORMAL'],
      ['SCHEDULE_REPAIR', 'OUT_OF_SERVICE'],
      ['ATTENTION', null, 'NORMAL'],
    ] as const) {
      expect(overallSafetyLevel(levels, bands)).toBe(overallSafetyLevel(levels));
    }
  });

  it('has no verdict when nothing was scored', () => {
    expect(overallSafetyLevel([null, null], bandsFor())).toBeNull();
    expect(overallSafetyLevel([], bandsFor())).toBeNull();
  });

  it('still takes the worst band when one is present', () => {
    expect(overallSafetyLevel(['NORMAL', 'CRITICAL', 'ATTENTION'], bandsFor())).toBe('CRITICAL');
  });

  /**
   * The P1 itself. Before the fix `SEVERITY_ORDER` put the reserved spares ahead of
   * `OUT_OF_SERVICE`, so one healthy sub-task in a configured sixth band decided the
   * verdict of the whole printed act.
   */
  it('does not report an inspection at a MILD configured sixth band', () => {
    const bands = bandsFor(WITH_MILD_SIXTH);

    expect(overallSafetyLevel(['BAND_6', 'NORMAL'], bands)).toBe('NORMAL');
    expect(overallSafetyLevel(['BAND_6', 'ATTENTION'], bands)).toBe('ATTENTION');
    expect(overallSafetyLevel(['BAND_6', 'OUT_OF_SERVICE'], bands)).toBe('OUT_OF_SERVICE');
    expect(overallSafetyLevel(['BAND_6'], bands)).toBe('BAND_6');
  });
});

describe('isRiskFinding', () => {
  it('files exactly the four bands worse than Хэвийн on the shipped ladder', () => {
    const bands = bandsFor();
    const configured = bands.map((band) => band.level);
    expect(configured.filter((level) => isRiskFinding(level, bands))).toEqual([
      'ATTENTION',
      'SCHEDULE_REPAIR',
      'CRITICAL',
      'OUT_OF_SERVICE',
    ]);
  });

  /**
   * A level stored under a ladder that has since dropped it has no flags to read. It is
   * surfaced rather than hidden — the same answer the positional rule gave before, so an
   * installation that has configured nothing sees no change.
   */
  it('still surfaces a level the current ladder no longer contains', () => {
    const bands = bandsFor();
    expect(RISK_LEVELS.filter((level) => isRiskFinding(level, bands))).toEqual(
      RISK_LEVELS.filter((level) => isRiskFinding(level)),
    );
  });

  it('agrees with the un-threaded positional rule for the shipped ladder', () => {
    for (const level of ['NORMAL', 'ATTENTION', 'SCHEDULE_REPAIR', 'CRITICAL', 'OUT_OF_SERVICE'] as const) {
      expect(isRiskFinding(level, bandsFor())).toBe(isRiskFinding(level));
    }
  });

  it('never files nothing', () => {
    expect(isRiskFinding(null, bandsFor())).toBe(false);
  });

  /** A mild sixth band is healthy equipment; it must not be printed as a зөрчил. */
  it('does not file a MILD configured sixth band, nor demote Хэвийн into one', () => {
    const bands = bandsFor(WITH_MILD_SIXTH);
    expect(isRiskFinding('BAND_6', bands)).toBe(false);
    expect(isRiskFinding('NORMAL', bands)).toBe(false);
    expect(isRiskFinding('ATTENTION', bands)).toBe(true);
  });

  it('files a band the administrator made demand a conclusion, whatever it is called', () => {
    const bands = bandsFor(
      DEFAULT_RISK_BANDS.map((band) =>
        band.key === 'NORMAL'
          ? { ...band, label: 'Хяналтад', requiresConclusion: true }
          : band,
      ),
    );
    expect(isRiskFinding('NORMAL', bands)).toBe(true);
  });
});

describe('overallSafetyLabelOf', () => {
  it('keeps the report verdict wording for every band on an unconfigured install', () => {
    const bands = bandsFor();
    for (const band of bands) {
      expect(overallSafetyLabelOf(band.level, bands)).toBe(OVERALL_SAFETY_LABELS[band.level]);
    }
    expect(overallSafetyLabelOf('NORMAL', bands)).toBe('Аюулгүй / Хэвийн');
    expect(overallSafetyLabelOf('SCHEDULE_REPAIR', bands)).toBe('Засвар шаардлагатай');
  });

  it('falls back to the verdict wording when no ladder is passed', () => {
    expect(overallSafetyLabelOf('CRITICAL')).toBe(OVERALL_SAFETY_LABELS.CRITICAL);
  });

  it('uses the administrator wording where they actually changed it', () => {
    const bands = bandsFor(
      DEFAULT_RISK_BANDS.map((band) =>
        band.key === 'NORMAL' ? { ...band, label: 'Бүрэн бүтэн' } : band,
      ),
    );
    expect(overallSafetyLabelOf('NORMAL', bands)).toBe('Бүрэн бүтэн');
    // Untouched bands keep the report's own verdict wording.
    expect(overallSafetyLabelOf('CRITICAL', bands)).toBe(OVERALL_SAFETY_LABELS.CRITICAL);
  });

  it('names a configured spare band instead of printing «Түвшин 6»', () => {
    expect(overallSafetyLabelOf('BAND_6', bandsFor(WITH_MILD_SIXTH))).toBe('Маш сайн');
  });
});
