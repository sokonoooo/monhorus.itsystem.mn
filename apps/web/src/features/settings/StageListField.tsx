import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_STATUS_LABELS,
  STAGE_COLOURS,
  validateStages,
  type ServiceRequestStage,
  type ServiceRequestStatus,
  type StageColour,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Button } from '../../components/ui/Button';
import { FIELD_INPUT, FIELD_INPUT_ERROR, FIELD_SELECT } from '../../components/ui/control-styles';

/**
 * The stage list of `workflow.request_stages`, edited as one value.
 *
 * Modelled on the survey option editor: the WHOLE ARRAY is the setting, so there is no
 * per-row endpoint and no sort field — the array order IS the order operators see, and
 * reordering is nothing more than swapping two entries before the page saves.
 *
 * The key is deliberately not editable. It is the identifier saved filters and board
 * columns join on, so renaming «Нээлттэй» must leave every one of them pointing at the
 * same stage; only the label moves. A new row gets a generated key for the same reason —
 * deriving it from the label would make the identifier follow the text it must outlive.
 *
 * Problems are surfaced as the admin types rather than on save. `validateStages` returns
 * every fault at once, and a stage list is cross-referential — a status pulled out of one
 * stage is orphaned unless it lands in another — so a message next to a single field
 * could not say what is actually wrong.
 */

interface Props {
  value: readonly ServiceRequestStage[];
  onChange: (next: ServiceRequestStage[]) => void;
  /** No editing at all for a caller who may only read; see the page's `canManage`. */
  readOnly: boolean;
  /** Controls are locked while a save is in flight, exactly as every other field is. */
  saving: boolean;
  /**
   * Server rejections pathed relative to this setting — `0.label`, `2.statuses` — so a
   * field error the backend raises lands on the same input the client would mark.
   */
  fieldErrors: Record<string, string>;
}

/**
 * Tailwind classes per palette name, written out rather than composed.
 *
 * Tailwind scans the source for complete class names at build time, so `bg-${colour}-500`
 * produces no CSS at all. That is also why the shared palette is a closed list of names
 * instead of free hex — see `STAGE_COLOURS`.
 */
export const STAGE_COLOUR_SWATCH: Record<StageColour, string> = {
  grey: 'bg-slate-400',
  blue: 'bg-blue-500',
  indigo: 'bg-indigo-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  green: 'bg-green-500',
  red: 'bg-red-500',
};

export const STAGE_COLOUR_LABELS: Record<StageColour, string> = {
  grey: 'Саарал',
  blue: 'Цэнхэр',
  indigo: 'Хар хөх',
  amber: 'Шар',
  orange: 'Улбар шар',
  green: 'Ногоон',
  red: 'Улаан',
};

/**
 * An identifier for a stage that does not exist yet.
 *
 * Numbered rather than derived from the label, because the label is Mongolian and the key
 * has to survive being rewritten. Uniqueness is checked against what is on screen, since
 * that is the whole list being saved.
 */
function nextStageKey(taken: readonly string[]): string {
  for (let suffix = taken.length + 1; suffix < taken.length + 100; suffix += 1) {
    const candidate = `STAGE_${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `STAGE_${Date.now()}`;
}

/** A plain copy, so a row edit never mutates the array the page still holds as a draft. */
function copy(stage: ServiceRequestStage): ServiceRequestStage {
  return { ...stage, statuses: [...stage.statuses] };
}

export function StageListField({
  value,
  onChange,
  readOnly,
  saving,
  fieldErrors,
}: Props): ReactElement {
  const disabled = saving;
  const problems = validateStages(value);

  function patch(index: number, change: Partial<ServiceRequestStage>): void {
    onChange(value.map((stage, position) => (position === index ? { ...copy(stage), ...change } : copy(stage))));
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
    const key = nextStageKey(value.map((stage) => stage.key));
    onChange([
      ...value.map(copy),
      {
        key,
        label: '',
        colour: 'grey',
        // No statuses yet, so nothing this stage could legally start at. `validateStages`
        // says so on the next render, which is the prompt to pick some.
        statuses: [],
        entryStatus: SERVICE_REQUEST_STATUSES[0],
        hidden: false,
        onBoard: true,
      },
    ]);
  }

  function remove(index: number): void {
    onChange(value.filter((_, position) => position !== index).map(copy));
  }

  /**
   * Adds or drops one status, keeping the group in engine order.
   *
   * Sorting by `SERVICE_REQUEST_STATUSES` rather than by click order means the same set of
   * ticks always produces the same array, so re-ticking a status the admin ticked off does
   * not leave the setting looking changed when nothing about it is.
   *
   * The entry status is pulled back into the group when the status it named is removed.
   * Leaving it dangling would raise a second complaint about a choice the admin never
   * made — they removed a status, they did not choose an impossible starting point.
   */
  function toggleStatus(index: number, status: ServiceRequestStatus): void {
    const stage = value[index];
    if (!stage) return;

    const wanted = new Set(stage.statuses);
    if (wanted.has(status)) wanted.delete(status);
    else wanted.add(status);

    const statuses = SERVICE_REQUEST_STATUSES.filter((candidate) => wanted.has(candidate));
    patch(index, {
      statuses,
      entryStatus: statuses.includes(stage.entryStatus)
        ? stage.entryStatus
        : (statuses[0] ?? stage.entryStatus),
    });
  }

  if (readOnly) {
    // Read-only is a summary, not a greyed-out form: there is nothing to type into, and a
    // hundred disabled checkboxes would say less about the configuration than its list of
    // stages and what each one covers.
    return (
      <ul className="space-y-1.5">
        {value.map((stage) => (
          <li key={stage.key} className="flex items-start gap-2 text-sm">
            <span
              aria-hidden="true"
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_COLOUR_SWATCH[stage.colour]}`}
            />
            <span className="min-w-0">
              <span className="block text-slate-800">
                {stage.label}
                {stage.hidden && <span className="ml-1 text-xs text-slate-400">(нуусан)</span>}
              </span>
              <span className="block text-xs text-slate-500">
                {stage.statuses.map((status) => SERVICE_REQUEST_STATUS_LABELS[status]).join(', ')}
              </span>
            </span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <fieldset className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-medium text-slate-600">Үе шатууд</legend>
      <p className="mb-2 text-xs text-slate-500">
        Жагсаалт, самбар, шүүлтүүрт эндхийн дарааллаар харагдана. Төлөв бүр яг нэг үе шатанд
        хамаарах ёстой.
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
          Үе шат тодорхойлоогүй байна. Үе шатгүй бол хүсэлт хаана ч харагдахгүй.
        </p>
      )}

      <div className="space-y-2">
        {value.map((stage, index) => {
          const rowName = stage.label.trim() || `${index + 1}-р үе шат`;
          const selected = new Set(stage.statuses);

          return (
            <div
              key={stage.key}
              className="flex items-start gap-2 rounded-lg bg-white p-2.5 ring-1 ring-inset ring-slate-200"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Үе шат {index + 1} нэр
                    </span>
                    <input
                      type="text"
                      value={stage.label}
                      disabled={disabled}
                      aria-label={`Үе шат ${index + 1} нэр`}
                      placeholder="Жишээ: Нээлттэй"
                      className={fieldErrors[`${index}.label`] ? FIELD_INPUT_ERROR : FIELD_INPUT}
                      onChange={(event) => patch(index, { label: event.target.value })}
                    />
                    {/* The key is what filters and board columns join on, so it is shown
                        but never edited — see the note at the top of this file. */}
                    <span className="mt-1 block font-mono text-[10px] text-slate-400">
                      {stage.key}
                    </span>
                  </label>

                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Үе шат {index + 1} өнгө
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`h-5 w-5 shrink-0 rounded ${STAGE_COLOUR_SWATCH[stage.colour]}`}
                      />
                      <select
                        value={stage.colour}
                        disabled={disabled}
                        aria-label={`Үе шат ${index + 1} өнгө`}
                        className={FIELD_SELECT}
                        onChange={(event) =>
                          patch(index, { colour: event.target.value as StageColour })
                        }
                      >
                        {STAGE_COLOURS.map((colour) => (
                          <option key={colour} value={colour}>
                            {STAGE_COLOUR_LABELS[colour]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>

                <div>
                  <span className="mb-1 block text-xs font-medium text-slate-600">
                    Үе шат {index + 1} төлвүүд
                  </span>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {SERVICE_REQUEST_STATUSES.map((status) => (
                      <label key={status} className="flex items-center gap-1 text-xs text-slate-700">
                        <input
                          type="checkbox"
                          checked={selected.has(status)}
                          disabled={disabled}
                          aria-label={`Үе шат ${index + 1}: ${SERVICE_REQUEST_STATUS_LABELS[status]}`}
                          className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                          onChange={() => toggleStatus(index, status)}
                        />
                        {SERVICE_REQUEST_STATUS_LABELS[status]}
                      </label>
                    ))}
                  </div>
                  {fieldErrors[`${index}.statuses`] && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors[`${index}.statuses`]}</p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
                  <label className="min-w-0">
                    <span className="mb-1 block text-xs font-medium text-slate-600">
                      Үе шат {index + 1} эхлэх төлөв
                    </span>
                    <select
                      value={stage.entryStatus}
                      disabled={disabled || stage.statuses.length === 0}
                      aria-label={`Үе шат ${index + 1} эхлэх төлөв`}
                      className={FIELD_SELECT}
                      onChange={(event) =>
                        patch(index, { entryStatus: event.target.value as ServiceRequestStatus })
                      }
                    >
                      {/* Only this stage's own statuses: moving a request to a stage means
                          moving it to that status, so a choice from another group would be
                          a move somewhere else entirely. */}
                      {stage.statuses.map((status) => (
                        <option key={status} value={status}>
                          {SERVICE_REQUEST_STATUS_LABELS[status]}
                        </option>
                      ))}
                      {stage.statuses.length === 0 && <option value="">Төлөв сонгоогүй</option>}
                    </select>
                  </label>

                  <div className="flex items-end gap-4 pb-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={stage.hidden}
                        disabled={disabled}
                        aria-label={`Үе шат ${index + 1} нуух`}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                        onChange={(event) => patch(index, { hidden: event.target.checked })}
                      />
                      Шүүлтүүрт харуулахгүй
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={stage.onBoard}
                        disabled={disabled}
                        aria-label={`Үе шат ${index + 1} самбарт`}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300"
                        onChange={(event) => patch(index, { onBoard: event.target.checked })}
                      />
                      Самбарт багана гаргах
                    </label>
                  </div>
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

      <Button type="button" variant="secondary" onClick={add} disabled={disabled} className="mt-3">
        Үе шат нэмэх
      </Button>
    </fieldset>
  );
}
