import {
  MAX_RISK_BANDS,
  RISK_COLOURS,
  RISK_LEVELS,
  resolveRiskBands,
  validateRiskBands,
  type RiskBandConfig,
  type RiskColour,
  type RiskLevel,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Button } from '../../components/ui/Button';
import { FIELD_INPUT, FIELD_INPUT_ERROR, FIELD_SELECT } from '../../components/ui/control-styles';
import { RISK_PALETTE } from '../../components/ui/risk-palette';

/**
 * The risk ladder of `evaluation.risk_bands`, edited as one value.
 *
 * Modelled on `StageListField`, and for the same reason: the WHOLE ARRAY is the setting, so
 * there is no per-row endpoint and no sort field. Reordering is nothing more than swapping
 * two entries before the page saves.
 *
 * THE KEY IS NEVER EDITABLE. Six collections persist a `riskLevel`, two of them required and
 * two indexed, so the key is what every assessment ever written joins on. Renaming «Ноцтой
 * эрсдэлтэй» must leave all of that history pointing at the same band — only the label moves.
 * A new row takes the first unused reserved key for the same reason: deriving one from the
 * Mongolian label would make the identifier follow the text it has to outlive.
 *
 * WHAT THE ROW SHOWS THAT THE ADMIN DID NOT TYPE is the resolved range. Only the LOWER bound
 * of a band is configurable — the top is the next band's minimum minus one — so "41-60"
 * cannot be typed and can only be derived. Printing it is what makes a ladder with a hole in
 * it visible before Хадгалах rather than after.
 *
 * Problems are surfaced as the admin types rather than on save. `validateRiskBands` returns
 * every fault at once and the rules are cross-referential — moving one minimum re-cuts its
 * neighbour — so a message next to a single field could not say what is actually wrong.
 */

interface Props {
  value: readonly RiskBandConfig[];
  onChange: (next: RiskBandConfig[]) => void;
  /** No editing at all for a caller who may only read; see the page's `canManage`. */
  readOnly: boolean;
  /** Controls are locked while a save is in flight, exactly as every other field is. */
  saving: boolean;
  /**
   * Server rejections pathed relative to this setting — `0.label`, `2.minScore` — so a
   * field error the backend raises lands on the same input the client would mark.
   */
  fieldErrors: Record<string, string>;
}

/** What each behaviour flag does, worded as the consequence rather than as the field name. */
const BEHAVIOUR_FIELDS = [
  {
    field: 'requiresConclusion',
    label: 'Дүгнэлт заавал',
    hint: 'Энэ түвшний илрүүлэлт бичгэн дүгнэлт, авсан арга хэмжээтэй байна.',
  },
  {
    field: 'requiresRecommendation',
    label: 'Зөвлөмж заавал',
    hint: 'Энэ түвшний илрүүлэлт зөвлөмжтэй байна.',
  },
  {
    field: 'decommissions',
    label: 'Ашиглалтаас гаргана',
    hint: 'Энэ түвшинд хүрсэн тоноглол ашиглалтаас гарна. Зөвхөн нэг түвшинд тавина.',
  },
  {
    field: 'notifies',
    label: 'Мэдэгдэл илгээнэ',
    hint: 'Энэ түвшинд хүрэхэд диспетчерт мэдэгдэнэ.',
  },
] as const satisfies readonly {
  field: keyof Pick<
    RiskBandConfig,
    'requiresConclusion' | 'requiresRecommendation' | 'decommissions' | 'notifies'
  >;
  label: string;
  hint: string;
}[];

/**
 * The first reserved key nothing on screen is using.
 *
 * `RISK_LEVELS` is the closed vocabulary a score may be STORED as — the five original keys
 * plus three spares reserved so a sixth band costs a settings change rather than a data
 * migration. A new row therefore cannot invent a key; it can only take one that is free.
 */
function nextRiskKey(taken: readonly RiskLevel[]): RiskLevel | null {
  return RISK_LEVELS.find((key) => !taken.includes(key)) ?? null;
}

/** A plain copy, so a row edit never mutates the array the page still holds as a draft. */
function copy(band: RiskBandConfig): RiskBandConfig {
  return { ...band };
}

export function RiskBandListField({
  value,
  onChange,
  readOnly,
  saving,
  fieldErrors,
}: Props): ReactElement {
  const disabled = saving;
  const problems = validateRiskBands(value);

  /**
   * The range each band owns, by key.
   *
   * `resolveRiskBands` sorts before it derives, so the tile a row is shown is the one the
   * backend will read the score against no matter what order the rows are sitting in.
   */
  const ranges = new Map(
    resolveRiskBands(value).map((band) => [band.key, `${band.min}-${band.max}`]),
  );

  function patch(index: number, change: Partial<RiskBandConfig>): void {
    onChange(
      value.map((band, position) =>
        position === index ? { ...copy(band), ...change } : copy(band),
      ),
    );
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;

    const next = value.map(copy);
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    onChange(next);
  }

  function add(): void {
    const key = nextRiskKey(value.map((band) => band.key));
    if (!key) return;

    onChange([
      ...value.map(copy),
      {
        key,
        label: '',
        colour: 'grey',
        // Deliberately a minimum that collides with nothing and starts nothing: 0 would
        // silently take the bottom band's place. `validateRiskBands` complains on the next
        // render, which is the prompt to give the new band a cut point of its own.
        minScore: 100,
        requiresConclusion: false,
        requiresRecommendation: false,
        // Never on by default. It is an irreversible write to another collection, and
        // exactly one band in a ladder may carry it.
        decommissions: false,
        notifies: true,
      },
    ]);
  }

  function remove(index: number): void {
    onChange(value.filter((_, position) => position !== index).map(copy));
  }

  if (readOnly) {
    // Read-only is a summary, not a greyed-out form: there is nothing to type into, and a
    // row of disabled checkboxes says less about the ladder than its bands, their ranges
    // and what each one demands.
    return (
      <ul className="space-y-1.5">
        {value.map((band) => {
          const demands = BEHAVIOUR_FIELDS.filter((entry) => band[entry.field]).map(
            (entry) => entry.label,
          );
          return (
            <li key={band.key} className="flex items-start gap-2 text-sm">
              <span
                aria-hidden="true"
                className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${RISK_PALETTE[band.colour].dot}`}
              />
              <span className="min-w-0">
                <span className="block text-slate-800">
                  {band.label}
                  <span className="ml-1 text-xs tabular-nums text-slate-500">
                    {ranges.get(band.key) ?? `${band.minScore}-`}
                  </span>
                </span>
                <span className="block text-xs text-slate-500">
                  {demands.length > 0 ? demands.join(', ') : 'Нэмэлт шаардлагагүй'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Эрсдэлийн түвшин</legend>
      <p className="mb-2 text-xs text-slate-500">
        0-100 оноог хуваах шат. Түвшин бүрийн доод оноог л оруулна — дээд хязгаар нь дараагийн
        түвшнээс автоматаар гарна.
      </p>

      {problems.length > 0 && (
        <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-200">
          <p className="font-medium">Хадгалахын өмнө засах зүйл:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </div>
      )}

      {value.length === 0 && (
        <p className="mb-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
          Түвшин тодорхойлоогүй байна. Түвшингүй бол оноо ямар ч дүгнэлт өгөхгүй.
        </p>
      )}

      <div className="space-y-2">
        {value.map((band, index) => {
          const rowName = band.label.trim() || `${index + 1}-р түвшин`;

          return (
            <div
              key={band.key}
              className="flex items-start gap-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-slate-200"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px_110px]">
                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Түвшин {index + 1} нэр
                    </span>
                    <input
                      type="text"
                      value={band.label}
                      disabled={disabled}
                      aria-label={`Түвшин ${index + 1} нэр`}
                      placeholder="Жишээ: Хэвийн"
                      className={fieldErrors[`${index}.label`] ? FIELD_INPUT_ERROR : FIELD_INPUT}
                      onChange={(event) => patch(index, { label: event.target.value })}
                    />
                    {/* Shown but never edited: it is what six collections of assessment
                        history join on — see the note at the top of this file. */}
                    <span className="mt-1 block font-mono text-[10px] text-slate-400">
                      {band.key}
                    </span>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Түвшин {index + 1} өнгө
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-5 w-5 shrink-0 rounded ${RISK_PALETTE[band.colour].dot}`}
                      />
                      <select
                        value={band.colour}
                        disabled={disabled}
                        aria-label={`Түвшин ${index + 1} өнгө`}
                        className={FIELD_SELECT}
                        onChange={(event) =>
                          patch(index, { colour: event.target.value as RiskColour })
                        }
                      >
                        {RISK_COLOURS.map((colour) => (
                          <option key={colour} value={colour}>
                            {RISK_PALETTE[colour].label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Түвшин {index + 1} доод оноо
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={band.minScore}
                      disabled={disabled}
                      aria-label={`Түвшин ${index + 1} доод оноо`}
                      className={
                        fieldErrors[`${index}.minScore`] ? FIELD_INPUT_ERROR : FIELD_INPUT
                      }
                      onChange={(event) =>
                        // Kept as a number because the whole array is the value: a
                        // half-typed string cannot ride along in a `RiskBandConfig` the way
                        // it can in a scalar setting's text draft. An emptied box reads as
                        // NaN, which `validateRiskBands` reports rather than storing.
                        patch(index, { minScore: Number.parseInt(event.target.value, 10) })
                      }
                    />
                    {/* The band's actual tile. Only the lower bound is typed; this is the
                        range that produces, so a gap or an overlap is visible here first. */}
                    <span className="mt-1 block text-[10px] tabular-nums text-slate-500">
                      {ranges.get(band.key) ?? '-'} оноо
                    </span>
                  </label>
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Түвшин {index + 1} үйлдэл
                  </span>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {BEHAVIOUR_FIELDS.map((entry) => (
                      <label
                        key={entry.field}
                        title={entry.hint}
                        className="flex items-center gap-1.5 text-xs text-slate-700"
                      >
                        <input
                          type="checkbox"
                          checked={band[entry.field]}
                          disabled={disabled}
                          aria-label={`Түвшин ${index + 1}: ${entry.label}`}
                          className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                          onChange={(event) =>
                            patch(index, { [entry.field]: event.target.checked })
                          }
                        />
                        {entry.label}
                      </label>
                    ))}
                  </div>
                  {fieldErrors[`${index}.decommissions`] && (
                    <p className="mt-1 text-xs text-red-600">
                      {fieldErrors[`${index}.decommissions`]}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 gap-0.5 pt-6">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={disabled || index === 0}
                  aria-label={`${rowName} дээш`}
                  className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={disabled || index === value.length - 1}
                  aria-label={`${rowName} доош`}
                  className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-200 disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={disabled}
                  aria-label={`${rowName} устгах`}
                  className="rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                >
                  ✕
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        onClick={add}
        // The ceiling is the number of reserved storage keys, not a layout choice: there is
        // no key left to give a seventh… ninth band, and inventing one would mean a
        // migration of every assessment ever written.
        disabled={disabled || value.length >= MAX_RISK_BANDS}
        className="mt-3"
      >
        Түвшин нэмэх
      </Button>
    </fieldset>
  );
}
