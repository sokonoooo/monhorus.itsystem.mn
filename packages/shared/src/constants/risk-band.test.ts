import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RISK_BANDS,
  resolveRiskBands,
  riskBandForScore,
  validateRiskBands,
  type RiskBandConfig,
} from './risk-band';
import { RISK_LEVELS } from './service-request';

const clone = (): RiskBandConfig[] => DEFAULT_RISK_BANDS.map((band) => ({ ...band }));

describe('risk bands', () => {
  it('ships the five documented bands', () => {
    expect(DEFAULT_RISK_BANDS).toHaveLength(5);
    expect(DEFAULT_RISK_BANDS.map((band) => band.key)).toEqual([
      'OUT_OF_SERVICE',
      'CRITICAL',
      'SCHEDULE_REPAIR',
      'ATTENTION',
      'NORMAL',
    ]);
  });

  it('reproduces the shipped cut points', () => {
    const resolved = resolveRiskBands(DEFAULT_RISK_BANDS);
    expect(resolved.map((band) => [band.min, band.max])).toEqual([
      [0, 20],
      [21, 40],
      [41, 60],
      [61, 80],
      [81, 100],
    ]);
  });

  it('tiles the whole scale with no gap and no overlap', () => {
    const resolved = resolveRiskBands(DEFAULT_RISK_BANDS);
    for (let score = 0; score <= 100; score += 1) {
      const matches = resolved.filter((band) => score >= band.min && score <= band.max);
      expect(matches).toHaveLength(1);
    }
  });

  it('bands a score against the configured ladder', () => {
    expect(riskBandForScore(100, DEFAULT_RISK_BANDS)?.key).toBe('NORMAL');
    expect(riskBandForScore(81, DEFAULT_RISK_BANDS)?.key).toBe('NORMAL');
    expect(riskBandForScore(80, DEFAULT_RISK_BANDS)?.key).toBe('ATTENTION');
    expect(riskBandForScore(0, DEFAULT_RISK_BANDS)?.key).toBe('OUT_OF_SERVICE');
  });

  it('keeps the safety rules attached to the band rather than to its name', () => {
    const worst = DEFAULT_RISK_BANDS.find((band) => band.key === 'OUT_OF_SERVICE');
    const healthy = DEFAULT_RISK_BANDS.find((band) => band.key === 'NORMAL');

    expect(worst?.decommissions).toBe(true);
    expect(worst?.requiresConclusion).toBe(true);
    // The healthy band is the one that reports nothing and alerts nobody.
    expect(healthy?.notifies).toBe(false);
    expect(healthy?.requiresRecommendation).toBe(false);
    expect(DEFAULT_RISK_BANDS.filter((band) => band.decommissions)).toHaveLength(1);
  });

  it('accepts a three band ladder', () => {
    const three: RiskBandConfig[] = [
      { ...DEFAULT_RISK_BANDS[0]!, minScore: 0 },
      { ...DEFAULT_RISK_BANDS[2]!, minScore: 40 },
      { ...DEFAULT_RISK_BANDS[4]!, minScore: 75 },
    ];
    expect(validateRiskBands(three)).toEqual([]);
    expect(resolveRiskBands(three).map((band) => [band.min, band.max])).toEqual([
      [0, 39],
      [40, 74],
      [75, 100],
    ]);
  });

  it('accepts a ladder that uses the reserved spare keys', () => {
    const six: RiskBandConfig[] = [
      ...clone(),
      {
        key: 'BAND_6',
        label: 'Онцгой хяналт',
        colour: 'purple',
        minScore: 95,
        requiresConclusion: false,
        requiresRecommendation: false,
        decommissions: false,
        notifies: false,
      },
    ];
    expect(validateRiskBands(six)).toEqual([]);
    expect(resolveRiskBands(six)).toHaveLength(6);
  });

  it('refuses a ladder that does not start at zero', () => {
    const bands = clone();
    bands[0]!.minScore = 5;
    expect(validateRiskBands(bands).some((issue) => issue.includes('0 оноогоор'))).toBe(true);
  });

  it('refuses two bands sharing a lower bound', () => {
    const bands = clone();
    bands[1]!.minScore = bands[2]!.minScore;
    expect(validateRiskBands(bands).some((issue) => issue.includes('давхардсан'))).toBe(true);
  });

  it('refuses more than one band taking equipment out of service', () => {
    const bands = clone();
    bands[1]!.decommissions = true;
    expect(
      validateRiskBands(bands).some((issue) => issue.includes('ашиглалтаас гаргана')),
    ).toBe(true);
  });

  it('refuses fewer than two bands and more than the reserved keys allow', () => {
    expect(validateRiskBands([DEFAULT_RISK_BANDS[0]!]).length).toBeGreaterThan(0);

    const tooMany: RiskBandConfig[] = RISK_LEVELS.map((key, index) => ({
      ...DEFAULT_RISK_BANDS[0]!,
      key,
      minScore: index * 10,
    }));
    expect(validateRiskBands([...tooMany, { ...tooMany[0]!, key: 'NORMAL' }]).length)
      .toBeGreaterThan(0);
  });

  it('sorts a ladder handed over out of order', () => {
    const shuffled = [...DEFAULT_RISK_BANDS].reverse();
    expect(resolveRiskBands(shuffled).map((band) => band.min)).toEqual([0, 21, 41, 61, 81]);
  });
});
