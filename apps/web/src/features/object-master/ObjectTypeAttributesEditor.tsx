import {
  MAX_ATTRIBUTE_OPTIONS,
  MAX_TYPE_ATTRIBUTES,
  OBJECT_ATTRIBUTE_TYPES,
  OBJECT_ATTRIBUTE_TYPE_HINTS,
  OBJECT_ATTRIBUTE_TYPE_LABELS,
  type ObjectAttributeType,
  type ObjectTypeAttributeDto,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Button } from '../../components/ui/Button';
import { FIELD_INPUT, FIELD_INPUT_ERROR, FIELD_SELECT } from '../../components/ui/control-styles';

/**
 * The per-type attribute editor (requirements 4.1).
 *
 * An administrator says here what an object of this type must record beyond the section 4.2
 * fields its category already gives it — "Автомат таслуур has a Хайлмал that is either
 * Хайлмалтай or Хайлмалгүй". The Үнэлгээ бүртгэх form then asks whatever is defined here, so
 * adding a field to a type needs no code.
 *
 * ORDER IS THE ARRAY ORDER, top to bottom, and that is the only representation of it. The
 * ↑/↓ buttons swap two entries and the whole array is sent as it stands, which is why
 * reordering needs no endpoint and no `sortOrder` to renumber.
 *
 * Its own file rather than another section inside `ObjectTypesPage`: that page is already
 * eight hundred lines of list, filters, drawer and icon upload, and this is a self-contained
 * editor over one value.
 */

interface Props {
  value: readonly ObjectTypeAttributeDto[];
  onChange: (next: ObjectTypeAttributeDto[]) => void;
  disabled: boolean;
  /**
   * The keys this type was loaded with — the ones objects may already carry values under.
   *
   * FROZEN, for the same reason `updateObjectTypeSchema` refuses to change a type's `code`:
   * the key is the join between a definition and every value recorded against it, and moving
   * one turns all of them into orphans nobody can see. Renaming the label is safe and stays
   * available; renaming the key is not offered at all. To change a key, delete the attribute
   * and add it again — which is visibly the destructive operation it actually is.
   *
   * Empty for a type being registered, where nothing can be stored against anything yet.
   */
  savedKeys: ReadonlySet<string>;
  /**
   * Errors keyed exactly as the shared schema paths them — `attributes.0.key`,
   * `attributes.1.options.2.value` — so a server rejection and a client one land on the same
   * input with nothing translating between them.
   */
  fieldErrors: Record<string, string>;
}

function emptyAttribute(): ObjectTypeAttributeDto {
  // TEXT rather than SELECT, so a newly added row is immediately valid: a SELECT with no
  // options is refused by the schema, and offering that as the default would mean every
  // added row starts out failing.
  return { key: '', label: '', type: 'TEXT', required: false, options: [] };
}

/**
 * A key proposed from the label, so the common case needs no thought.
 *
 * The key must be a plain Latin identifier — it is a storage path, a dotted error key and a
 * React key at once — while the label is Mongolian, so most labels reduce to nothing here and
 * fall back to `attr`, deduplicated against its siblings. That is fine: the key is a machine
 * identifier and the label is the thing a human reads. Both stay editable.
 */
export function suggestAttributeKey(label: string, taken: readonly string[]): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^[^a-z]+/, '')
      .replace(/_+$/, '')
      .slice(0, 40) || 'attr';

  if (!taken.includes(base)) return base;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return base;
}

/**
 * Whether the key may still follow the label as it is typed.
 *
 * IT CANNOT BE "IS THE KEY EMPTY". Typing runs one character at a time, so the key would stop
 * being empty after the very first keystroke and freeze at `f` while the label went on to
 * read `Fuse`.
 *
 * The test is instead whether the key is still exactly what the PREVIOUS label suggested. If
 * it is, nobody has chosen it by hand and it may keep tracking; the moment it differs,
 * somebody chose it and it is theirs.
 *
 * This is a convenience for a row being written, and NOTHING MORE. It is not what protects a
 * saved key — the coincidence it is built on genuinely happens (retype "Fuse" over a row
 * already keyed `fuse` and the two agree again), so a saved key is made read-only outright
 * rather than defended by a heuristic. See `savedKeys`.
 */
function keyStillFollowsLabel(
  current: string,
  previousLabel: string,
  taken: readonly string[],
): boolean {
  return current === '' || current === suggestAttributeKey(previousLabel, taken);
}

export function ObjectTypeAttributesEditor({
  value,
  onChange,
  disabled,
  savedKeys,
  fieldErrors,
}: Props): ReactElement {
  function patch(index: number, change: Partial<ObjectTypeAttributeDto>): void {
    onChange(
      value.map((entry, position) =>
        position === index ? { ...entry, ...change } : { ...entry },
      ),
    );
  }

  /** Swaps a row with its neighbour. The same shape as the dashboard's arrangement editor. */
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
    if (value.length >= MAX_TYPE_ATTRIBUTES) return;
    onChange([...value.map((entry) => ({ ...entry })), emptyAttribute()]);
  }

  function remove(index: number): void {
    onChange(value.filter((_, position) => position !== index).map((entry) => ({ ...entry })));
  }

  /**
   * Changing the type clears the option list when the new type cannot carry one.
   *
   * The schema refuses options on a TEXT box, so leaving them behind would hand the user a
   * rejection for a dropdown change they made two fields away from the message.
   */
  function changeType(index: number, type: ObjectAttributeType): void {
    patch(index, { type, options: type === 'SELECT' ? (value[index]?.options ?? []) : [] });
  }

  function patchOption(
    index: number,
    optionIndex: number,
    change: Partial<{ value: string; label: string }>,
  ): void {
    const attribute = value[index];
    if (!attribute) return;
    patch(index, {
      options: attribute.options.map((option, position) =>
        position === optionIndex ? { ...option, ...change } : { ...option },
      ),
    });
  }

  function addOption(index: number): void {
    const attribute = value[index];
    if (!attribute || attribute.options.length >= MAX_ATTRIBUTE_OPTIONS) return;
    patch(index, { options: [...attribute.options, { value: '', label: '' }] });
  }

  function removeOption(index: number, optionIndex: number): void {
    const attribute = value[index];
    if (!attribute) return;
    patch(index, { options: attribute.options.filter((_, position) => position !== optionIndex) });
  }

  return (
    <fieldset className="mt-6">
      <legend className="mb-1 w-full border-b border-slate-200 pb-1.5 text-sm font-semibold text-slate-900">
        Шаардлагатай үзүүлэлт
      </legend>
      <p className="mb-3 text-xs text-slate-500">
        Энэ төрлийн тоноглолд «Үнэлгээ бүртгэх» маягт дээр нэмж асуух талбарууд. Эндхийн
        дарааллаар харагдана.
      </p>

      {value.length === 0 && (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
          Үзүүлэлт тодорхойлоогүй байна. Энэ төрлийн тоноглолд нэмэлт талбар асуухгүй.
        </p>
      )}

      <div className="space-y-3">
        {value.map((attribute, index) => {
          const rowError =
            fieldErrors[`attributes.${index}.key`] ??
            fieldErrors[`attributes.${index}.label`] ??
            fieldErrors[`attributes.${index}.type`] ??
            fieldErrors[`attributes.${index}.options`];
          // The row is named by its label where it has one, so every control's accessible
          // name says which attribute it belongs to rather than only its position.
          const rowName = attribute.label.trim() || `${index + 1}-р үзүүлэлт`;
          /** Already on the type, so objects may hold values under this key. See `savedKeys`. */
          const keyFrozen = savedKeys.has(attribute.key);

          return (
            <div key={index} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-start gap-2">
                <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                  <label className="min-w-0">
                    {/*
                      "Үзүүлэлтийн нэр" rather than a bare "Нэр": this editor sits inside the
                      type drawer, which already has a "Нэр" of its own, and a wrapping label
                      contributes to the accessible name whether or not an aria-label is also
                      set. Two controls answering to the same query is a test that passes
                      against the wrong input.
                    */}
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Үзүүлэлтийн нэр<span className="ml-0.5 text-red-600">*</span>
                    </span>
                    <input
                      type="text"
                      value={attribute.label}
                      disabled={disabled}
                      aria-label={`Үзүүлэлт ${index + 1} нэр`}
                      placeholder="Жишээ: Хайлмал хамгаалалт"
                      className={
                        fieldErrors[`attributes.${index}.label`] ? FIELD_INPUT_ERROR : FIELD_INPUT
                      }
                      onChange={(event) => {
                        const label = event.target.value;
                        const siblings = value
                          .filter((_, position) => position !== index)
                          .map((entry) => entry.key);
                        patch(index, {
                          label,
                          ...(!keyFrozen &&
                          keyStillFollowsLabel(attribute.key, attribute.label, siblings)
                            ? { key: suggestAttributeKey(label, siblings) }
                            : {}),
                        });
                      }}
                    />
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Утгын төрөл
                    </span>
                    <select
                      value={attribute.type}
                      disabled={disabled}
                      aria-label={`Үзүүлэлт ${index + 1} төрөл`}
                      className={FIELD_SELECT}
                      onChange={(event) =>
                        changeType(index, event.target.value as ObjectAttributeType)
                      }
                    >
                      {OBJECT_ATTRIBUTE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {OBJECT_ATTRIBUTE_TYPE_LABELS[type]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="flex shrink-0 gap-0.5 pt-5">
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

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <label className="min-w-0">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Түлхүүр</span>
                  <input
                    type="text"
                    value={attribute.key}
                    disabled={disabled || keyFrozen}
                    aria-label={`Үзүүлэлт ${index + 1} түлхүүр`}
                    className={
                      fieldErrors[`attributes.${index}.key`] ? FIELD_INPUT_ERROR : FIELD_INPUT
                    }
                    onChange={(event) => patch(index, { key: event.target.value })}
                  />
                  {keyFrozen && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Хадгалагдсан түлхүүрийг өөрчлөх боломжгүй. Нэрийг нь чөлөөтэй засна.
                    </span>
                  )}
                </label>

                <label className="flex items-center gap-2 pt-5 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={attribute.required}
                    disabled={disabled}
                    aria-label={`${rowName} заавал бөглөх`}
                    className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    onChange={(event) => patch(index, { required: event.target.checked })}
                  />
                  Заавал бөглөнө
                </label>
              </div>

              <p className="mt-1.5 text-xs text-slate-500">
                {OBJECT_ATTRIBUTE_TYPE_HINTS[attribute.type]}
              </p>

              {attribute.type === 'SELECT' && (
                <div className="mt-3 border-t border-slate-200 pt-3">
                  <p className="mb-2 text-xs font-medium text-slate-600">Сонголтууд</p>
                  <div className="space-y-2">
                    {attribute.options.map((option, optionIndex) => (
                      <div key={optionIndex} className="flex items-center gap-2">
                        <input
                          type="text"
                          value={option.label}
                          disabled={disabled}
                          aria-label={`${rowName} сонголт ${optionIndex + 1} нэр`}
                          placeholder="Жишээ: Хайлмалтай"
                          className={
                            fieldErrors[`attributes.${index}.options.${optionIndex}.label`]
                              ? FIELD_INPUT_ERROR
                              : FIELD_INPUT
                          }
                          onChange={(event) => {
                            const label = event.target.value;
                            /*
                              The stored value tracks the option's label by exactly the same
                              rule as a key tracks its attribute's, and stops for the same
                              reason: once an option has a value, that value is what objects
                              carry, and moving it orphans every one of them.
                            */
                            const siblings = attribute.options
                              .filter((_, position) => position !== optionIndex)
                              .map((entry) => entry.value.toLowerCase());
                            patchOption(index, optionIndex, {
                              label,
                              ...(keyStillFollowsLabel(
                                option.value.toLowerCase(),
                                option.label,
                                siblings,
                              )
                                ? { value: suggestAttributeKey(label, siblings).toUpperCase() }
                                : {}),
                            });
                          }}
                        />
                        <input
                          type="text"
                          value={option.value}
                          disabled={disabled}
                          aria-label={`${rowName} сонголт ${optionIndex + 1} утга`}
                          className={
                            fieldErrors[`attributes.${index}.options.${optionIndex}.value`]
                              ? FIELD_INPUT_ERROR
                              : FIELD_INPUT
                          }
                          onChange={(event) =>
                            patchOption(index, optionIndex, { value: event.target.value })
                          }
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(index, optionIndex)}
                          disabled={disabled}
                          aria-label={`${rowName} сонголт ${optionIndex + 1} устгах`}
                          className="shrink-0 rounded px-1.5 py-0.5 text-red-600 hover:bg-red-50 disabled:opacity-30"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => addOption(index)}
                    disabled={disabled || attribute.options.length >= MAX_ATTRIBUTE_OPTIONS}
                    className="mt-2"
                  >
                    Сонголт нэмэх
                  </Button>
                </div>
              )}

              {rowError && <p className="mt-2 text-xs text-red-600">{rowError}</p>}
            </div>
          );
        })}
      </div>

      {fieldErrors.attributes && (
        <p className="mt-2 text-xs text-red-600">{fieldErrors.attributes}</p>
      )}

      <Button
        type="button"
        variant="secondary"
        onClick={add}
        disabled={disabled || value.length >= MAX_TYPE_ATTRIBUTES}
        className="mt-3"
      >
        Үзүүлэлт нэмэх
      </Button>
    </fieldset>
  );
}
