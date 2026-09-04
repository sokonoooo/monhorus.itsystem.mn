import { DEFAULT_RISK_BANDS, SETTING_KEYS } from '@monhorus/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '../../config/logger';
import { resetDomainCollections, startTestApp, stopTestApp } from '../../test/helpers';
import { Setting } from './setting.model';
import { getRiskBands, getSettings, invalidateSettingsCache } from './settings.service';

/**
 * A stored override that does not validate is discarded — loudly.
 *
 * Discarding is right: a ladder with a hole in it would mis-band every score, and
 * `decommissions` travels with the band. Doing it in SILENCE was not. Тохиргоо went on
 * rendering the administrator's own cut points while nothing in the system read them, so
 * the only symptom was equipment quietly banded against numbers that had been replaced.
 *
 * The API refuses an invalid ladder, so this writes one straight into the collection —
 * which is exactly how a real one arrives: a value saved before a rule existed, or a
 * hand-edited document.
 */

beforeAll(async () => {
  await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  invalidateSettingsCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function storeRaw(key: string, value: unknown): Promise<void> {
  await Setting.updateOne(
    { key },
    { $set: { value, updatedBy: null, updatedByName: 'test' } },
    { upsert: true },
  );
  invalidateSettingsCache();
}

describe('a rejected settings override', () => {
  it('says nothing on an installation that has configured nothing', async () => {
    const warn = vi.spyOn(logger, 'warn');
    await getSettings();
    expect(warn).not.toHaveBeenCalled();
  });

  it('says nothing for a VALID stored ladder', async () => {
    await storeRaw(
      SETTING_KEYS.EVAL_RISK_BANDS,
      DEFAULT_RISK_BANDS.map((band) =>
        band.key === 'CRITICAL' ? { ...band, label: 'Аюултай' } : band,
      ),
    );

    const warn = vi.spyOn(logger, 'warn');
    const bands = await getRiskBands();

    expect(warn).not.toHaveBeenCalled();
    expect(bands.find((band) => band.level === 'CRITICAL')?.labelMn).toBe('Аюултай');
  });

  /** The P1: this used to be a silent substitution. */
  it('reports an invalid ladder rather than substituting the shipped one in silence', async () => {
    // A hole at the bottom: nothing owns scores 0..4.
    await storeRaw(
      SETTING_KEYS.EVAL_RISK_BANDS,
      DEFAULT_RISK_BANDS.map((band) =>
        band.key === 'OUT_OF_SERVICE' ? { ...band, minScore: 5 } : band,
      ),
    );

    const warn = vi.spyOn(logger, 'warn');
    const bands = await getRiskBands();

    expect(warn).toHaveBeenCalledTimes(1);
    const [context, message] = warn.mock.calls[0] as [
      { settingKey: string; issues: readonly string[] },
      string,
    ];
    expect(context.settingKey).toBe(SETTING_KEYS.EVAL_RISK_BANDS);
    expect(context.issues.join(' ')).toContain('0 оноогоор эхэлнэ');
    expect(message).toContain('rejected');

    // The substitution still happens — the system serves a coherent ladder, just not theirs.
    expect(bands.map((band) => band.min)).toEqual([81, 61, 41, 21, 0]);
  });

  it('reports a rejected stage list too', async () => {
    await storeRaw(SETTING_KEYS.REQUEST_STAGES, []);

    const warn = vi.spyOn(logger, 'warn');
    await getSettings();

    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]![0] as { settingKey: string }).settingKey).toBe(
      SETTING_KEYS.REQUEST_STAGES,
    );
  });

  /**
   * The warning is emitted where the cache is FILLED, not inside the derivation. The
   * derivations run on every SLA computation and every risk read; logging there would
   * repeat one line thousands of times a minute and bury it.
   */
  it('warns once per cache fill, not once per read', async () => {
    await storeRaw(
      SETTING_KEYS.EVAL_RISK_BANDS,
      DEFAULT_RISK_BANDS.map((band) =>
        band.key === 'OUT_OF_SERVICE' ? { ...band, minScore: 5 } : band,
      ),
    );

    const warn = vi.spyOn(logger, 'warn');
    await getRiskBands();
    await getRiskBands();
    await getSettings();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
