import { describe, expect, it } from 'vitest';

import { DEFAULT_RISK_BANDS, type RiskBandConfig } from './risk-band';
import {
  SETTING_KEYS,
  defaultSettings,
  rejectedSettingOverrides,
  riskBandsOf,
  riskLevelFor,
  type SettingsMap,
} from './settings';

function withStored(key: (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS], value: unknown): SettingsMap {
  const settings = defaultSettings();
  (settings as Record<string, unknown>)[key] = value;
  return settings;
}

describe('rejectedSettingOverrides', () => {
  it('reports nothing on an installation that has configured nothing', () => {
    expect(rejectedSettingOverrides(defaultSettings())).toEqual([]);
  });

  /**
   * The P1. A ladder that does not tile 0..100 is right to be discarded, but it used to be
   * discarded in silence: Тохиргоо kept showing the administrator's numbers while every
   * score was banded against the shipped cut points, and `decommissions` travels with the
   * band.
   */
  it('reports a stored ladder that was discarded, with the reason', () => {
    const holed: RiskBandConfig[] = DEFAULT_RISK_BANDS.map((band) =>
      band.key === 'OUT_OF_SERVICE' ? { ...band, minScore: 5 } : band,
    );

    const rejected = rejectedSettingOverrides(withStored(SETTING_KEYS.EVAL_RISK_BANDS, holed));

    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.key).toBe(SETTING_KEYS.EVAL_RISK_BANDS);
    expect(rejected[0]!.issues.join(' ')).toContain('0 оноогоор эхэлнэ');

    // And the discard itself still happens — the shipped ladder is what gets served.
    expect(riskBandsOf(withStored(SETTING_KEYS.EVAL_RISK_BANDS, holed)).map((band) => band.min)).toEqual(
      [81, 61, 41, 21, 0],
    );
  });

  it('reports a stored value that is not a list at all', () => {
    expect(rejectedSettingOverrides(withStored(SETTING_KEYS.EVAL_RISK_BANDS, 'нэг'))).toEqual([
      { key: SETTING_KEYS.EVAL_RISK_BANDS, issues: ['Эрсдэлийн түвшний утга жагсаалт биш байна.'] },
    ]);
  });

  it('reports a discarded stage list too', () => {
    const rejected = rejectedSettingOverrides(withStored(SETTING_KEYS.REQUEST_STAGES, []));
    expect(rejected.map((entry) => entry.key)).toEqual([SETTING_KEYS.REQUEST_STAGES]);
    expect(rejected[0]!.issues.length).toBeGreaterThan(0);
  });
});

describe('riskLevelFor', () => {
  it('is unchanged on the shipped ladder, inside and outside the scale', () => {
    const bands = riskBandsOf(defaultSettings());
    expect(riskLevelFor(0, bands)).toBe('OUT_OF_SERVICE');
    expect(riskLevelFor(85, bands)).toBe('NORMAL');
    expect(riskLevelFor(100, bands)).toBe('NORMAL');
    expect(riskLevelFor(150, bands)).toBe('OUT_OF_SERVICE');
    expect(riskLevelFor(-1, bands)).toBe('OUT_OF_SERVICE');
  });

  /**
   * The fallback used to be the literal `'OUT_OF_SERVICE'`. Seven backend services persist
   * this answer, so on a ladder that does not contain that key it wrote an assessment under
   * a band its own configuration no longer has — displayed as «Түвшин N», with
   * `decommissions` answering false.
   */
  it('falls back to the worst CONFIGURED band, not to a band name', () => {
    const noOutOfService = riskBandsOf(
      withStored(
        SETTING_KEYS.EVAL_RISK_BANDS,
        DEFAULT_RISK_BANDS.filter((band) => band.key !== 'OUT_OF_SERVICE').map((band) =>
          band.key === 'CRITICAL' ? { ...band, minScore: 0, decommissions: true } : band,
        ),
      ),
    );

    expect(noOutOfService.some((band) => band.level === 'OUT_OF_SERVICE')).toBe(false);
    expect(riskLevelFor(150, noOutOfService)).toBe('CRITICAL');
    expect(riskLevelFor(-1, noOutOfService)).toBe('CRITICAL');
  });

  it('still answers something when handed no ladder at all', () => {
    expect(riskLevelFor(50, [])).toBe('OUT_OF_SERVICE');
  });
});
