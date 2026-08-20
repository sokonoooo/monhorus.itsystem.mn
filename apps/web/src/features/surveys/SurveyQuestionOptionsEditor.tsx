import { MAX_SURVEY_CHOICE_OPTIONS, type SurveyQuestionOptionDto } from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Button } from '../../components/ui/Button';
import { FIELD_INPUT, FIELD_INPUT_ERROR } from '../../components/ui/control-styles';

/**
 * The choice list of a SINGLE_CHOICE question.
 *
 * Two fields per row, exactly like the equipment-type attribute editor it is modelled on:
 * the LABEL is what a customer reads and the VALUE is what an answer records. They are kept
 * apart because renaming a choice must not rewrite what people already picked — the answer
 * carries the value, so editing "Цаг тухайд нь ирсэн" into better Mongolian leaves every
 * stored answer still pointing at the same option.
 *
 * ORDER IS THE ARRAY ORDER and that is its only representation. The whole list is sent as it
 * stands, so reordering needs no endpoint of its own.
 */

interface Props {
  value: readonly SurveyQuestionOptionDto[];
  onChange: (next: SurveyQuestionOptionDto[]) => void;
  disabled: boolean;
  /**
   * Values the question was loaded with — the ones answers may already be recorded against.
   *
   * FROZEN for the same reason a saved attribute key is: the value is the join between the
   * option and every answer that chose it, and moving one orphans all of them. The label
   * stays editable, because that is the human-readable half and nothing joins on it.
   *
   * Empty for a question being created, where nothing can have been answered yet.
   */
  savedValues: ReadonlySet<string>;
  /**
   * Errors keyed exactly as the shared schema paths them — `options`, `options.0.value` — so
   * a server rejection lands on the same input a client one would.
   */
  fieldErrors: Record<string, string>;
}

/**
 * A machine value proposed from the label, so the common case needs no thought.
 *
 * The label is Mongolian and the value is a plain Latin identifier, so most labels reduce to
 * nothing here and fall back to `opt`, numbered against its siblings. That is fine: the value
 * is what an answer stores and the label is what a customer reads. Both stay editable.
 */
export function suggestOptionValue(label: string, taken: readonly string[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 40) || 'opt';

  if (!taken.includes(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

/**
 * Whether the value may still follow the label as it is typed.
 *
 * IT CANNOT BE "IS THE VALUE EMPTY": typing runs a character at a time, so the value would
 * stop being empty after the first keystroke and freeze there. The test is instead whether
 * the value is still exactly what the PREVIOUS label suggested — if it is, nobody chose it by
 * hand and it may keep tracking; the moment it differs, somebody chose it and it is theirs.
 *
 * A convenience for a row being written and nothing more. A saved value is made read-only
 * outright rather than defended by this heuristic. See `savedValues`.
 */
function valueStillFollowsLabel(
  current: string,
  previousLabel: string,
  taken: readonly string[],
): boolean {
  return current === '' || current === suggestOptionValue(previousLabel, taken);
}

export function SurveyQuestionOptionsEditor({
  value,
  onChange,
  disabled,
  savedValues,
  fieldErrors,
}: Props): ReactElement {
  function patch(index: number, change: Partial<SurveyQuestionOptionDto>): void {
    onChange(
      value.map((entry, position) => (position === index ? { ...entry, ...change } : { ...entry })),
    );
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= value.length) return;

    const next = value.map((entry) => ({ ...entry }));
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    onChange(next);
  }

  function add(): void {
    if (value.length >= MAX_SURVEY_CHOICE_OPTIONS) return;
    onChange([...value.map((entry) => ({ ...entry })), { value: '', label: '' }]);
  }

  function remove(index: number): void {
    onChange(value.filter((_, position) => position !== index).map((entry) => ({ ...entry })));
  }

  return (
    <fieldset className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Сонголтууд</legend>
      <p className="mb-2 text-xs text-slate-500">
        Хэрэглэгчид эндхийн дарааллаар харагдана. Дор хаяж хоёр сонголт шаардлагатай.
      </p>

      {value.length === 0 && (
        <p className="mb-2 rounded-lg bg-white px-3 py-2 text-xs text-slate-500">
          Сонголт нэмээгүй байна. Сонголтгүй асуултад хариулах боломжгүй.
        </p>
      )}

      <div className="space-y-2">
        {value.map((option, index) => {
          const rowName = option.label.trim() || `${index + 1}-р сонголт`;
          /** Already saved, so answers may already record this value. See `savedValues`. */
          const valueFrozen = savedValues.has(option.value);

          return (
            <div key={index} className="flex items-start gap-2">
              <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="min-w-0">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Сонголт {index + 1} нэр
                  </span>
                  <input
                    type="text"
                    value={option.label}
                    disabled={disabled}
                    aria-label={`Сонголт ${index + 1} нэр`}
                    placeholder="Жишээ: Цаг тухайд нь ирсэн"
                    className={
                      fieldErrors[`options.${index}.label`] ? FIELD_INPUT_ERROR : FIELD_INPUT
                    }
                    onChange={(event) => {
                      const label = event.target.value;
                      const siblings = value
                        .filter((_, position) => position !== index)
                        .map((entry) => entry.value);
                      patch(index, {
                        label,
                        ...(!valueFrozen && valueStillFollowsLabel(option.value, option.label, siblings)
                          ? { value: suggestOptionValue(label, siblings) }
                          : {}),
                      });
                    }}
                  />
                </label>

                <label className="min-w-0">
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Сонголт {index + 1} утга
                  </span>
                  <input
                    type="text"
                    value={option.value}
                    disabled={disabled || valueFrozen}
                    aria-label={`Сонголт ${index + 1} утга`}
                    className={
                      fieldErrors[`options.${index}.value`] ? FIELD_INPUT_ERROR : FIELD_INPUT
                    }
                    onChange={(event) => patch(index, { value: event.target.value })}
                  />
                  {valueFrozen && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Хадгалагдсан утгыг өөрчлөхгүй. Нэрийг нь чөлөөтэй засна.
                    </span>
                  )}
                </label>
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

      {fieldErrors.options && <p className="mt-2 text-xs text-red-600">{fieldErrors.options}</p>}

      <Button
        type="button"
        variant="secondary"
        onClick={add}
        disabled={disabled || value.length >= MAX_SURVEY_CHOICE_OPTIONS}
        className="mt-3"
      >
        Сонголт нэмэх
      </Button>
    </fieldset>
  );
}
