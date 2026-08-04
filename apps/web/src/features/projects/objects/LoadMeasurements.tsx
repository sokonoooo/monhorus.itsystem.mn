import {
  LOAD_MEASUREMENT_KINDS,
  LOAD_MEASUREMENT_KIND_LABELS,
  LOAD_MEASUREMENT_KIND_UNIT,
  LOAD_MEASUREMENT_PHASES,
  LOAD_MEASUREMENT_PHASE_LABELS,
  LOAD_MEASUREMENT_UNIT_LABELS,
  MAX_LOAD_MEASUREMENTS,
  acceptsPhase,
  formatLoadMeasurement,
  type LoadMeasurementDto,
  type LoadMeasurementKind,
  type LoadMeasurementPhase,
} from '@monhorus/shared';
import type { ReactElement } from 'react';

import { Button } from '../../../components/ui/Button';
import { FIELD_INPUT, FIELD_SELECT } from '../../../components/ui/control-styles';

/**
 * A load reading as the form holds it — "Multiple Load Units".
 *
 * The value is a string because a half-typed "23." is a legitimate state of a number box
 * and coercing on every keystroke eats the decimal point. It is parsed once, on submit.
 * The unit is not held at all: there is exactly one per kind, so storing it would only
 * create a second thing to keep in step with the kind select.
 */
export interface LoadMeasurementDraft {
  kind: LoadMeasurementKind;
  value: string;
  /** '' means "not phase-specific" — a single-phase supply, or a total. */
  phase: LoadMeasurementPhase | '';
}

/**
 * Kinds a technician may add as a row.
 *
 * ACTIVE_POWER is deliberately absent: kW is entered in "Хэмжсэн ачаалал", which is the
 * authoritative summable head, and offering a second kW box would let one form produce two
 * different power figures — a contradiction the backend then has to refuse. The reading is
 * still a first-class kind; it is simply written in one place. A kW reading that arrives
 * through the API is displayed here like any other.
 */
const ADDABLE_KINDS = LOAD_MEASUREMENT_KINDS.filter((kind) => kind !== 'ACTIVE_POWER');

const KIND_OPTIONS = ADDABLE_KINDS.map((kind) => ({
  value: kind,
  label: `${LOAD_MEASUREMENT_KIND_LABELS[kind]} (${LOAD_MEASUREMENT_UNIT_LABELS[LOAD_MEASUREMENT_KIND_UNIT[kind]]})`,
}));

const PHASE_OPTIONS = [
  { value: '', label: 'Фазгүй' },
  ...LOAD_MEASUREMENT_PHASES.map((phase) => ({
    value: phase,
    label: LOAD_MEASUREMENT_PHASE_LABELS[phase],
  })),
];

/**
 * A row that does not collide with one already on the form.
 *
 * The backend refuses two readings of the same kind on the same phase, so an "add" that
 * defaulted blindly would hand the technician a refusal for a button press. Non-phase-
 * specific first, because that is the common single-phase case; then the phases in order,
 * which is what filling in a three-phase panel actually looks like.
 */
export function nextMeasurementDraft(
  current: readonly LoadMeasurementDraft[],
): LoadMeasurementDraft {
  const kind: LoadMeasurementKind = 'CURRENT';
  const taken = new Set(
    current.filter((row) => row.kind === kind).map((row) => row.phase as string),
  );
  const free = ['', ...LOAD_MEASUREMENT_PHASES].find((phase) => !taken.has(phase));
  return { kind, value: '', phase: (free ?? '') as LoadMeasurementPhase | '' };
}

/** The draft rows as the create schema wants them: unit resolved, blank phase nulled. */
export function toMeasurementPayload(
  rows: readonly LoadMeasurementDraft[],
): { kind: LoadMeasurementKind; value: number; unit: string; phase: string | null }[] {
  return rows.map((row) => ({
    kind: row.kind,
    // A blank box becomes NaN rather than 0: zero amps is a reading a technician might
    // genuinely take, so it must not be what an unfilled row silently means. The schema
    // refuses the NaN and names the row.
    value: row.value.trim() === '' ? Number.NaN : Number(row.value),
    unit: LOAD_MEASUREMENT_KIND_UNIT[row.kind],
    phase: acceptsPhase(row.kind) && row.phase !== '' ? row.phase : null,
  }));
}

interface EditorProps {
  rows: readonly LoadMeasurementDraft[];
  onChange: (rows: LoadMeasurementDraft[]) => void;
  /** Keyed `measurements.<index>.<field>`, as zod and the API both report them. */
  fieldErrors: Record<string, string>;
  disabled?: boolean;
}

/**
 * The repeatable reading editor on the assessment form.
 *
 * Compact on purpose — the same form is filled in on a phone — so a row is one line: what
 * was measured, the number, which conductor, and a way to take the row back off.
 */
export function LoadMeasurementEditor({
  rows,
  onChange,
  fieldErrors,
  disabled = false,
}: EditorProps): ReactElement {
  function update(index: number, patch: Partial<LoadMeasurementDraft>): void {
    onChange(
      rows.map((row, position) => {
        if (position !== index) return row;
        const merged = { ...row, ...patch };
        // A kind that carries no phase must not keep the one the previous kind had.
        return acceptsPhase(merged.kind) ? merged : { ...merged, phase: '' as const };
      }),
    );
  }

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">Бусад хэмжилт (А, В)</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onChange([...rows, nextMeasurementDraft(rows)])}
          disabled={disabled || rows.length >= MAX_LOAD_MEASUREMENTS}
        >
          Хэмжилт нэмэх
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
          Гүйдэл, хүчдэлийн хэмжилт бүртгэх бол мөр нэмнэ үү. Гурван фазын самбарт фаз тус
          бүрээр нь тусад нь бүртгэнэ.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const rowError =
              fieldErrors[`measurements.${index}.value`] ??
              fieldErrors[`measurements.${index}.unit`] ??
              fieldErrors[`measurements.${index}.phase`];
            return (
              <li key={index}>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.kind}
                    disabled={disabled}
                    aria-label={`${index + 1}-р хэмжилтийн төрөл`}
                    onChange={(event) =>
                      update(index, { kind: event.target.value as LoadMeasurementKind })
                    }
                    className={`${FIELD_SELECT} w-auto min-w-[9.5rem] flex-1`}
                  >
                    {KIND_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <input
                    type="number"
                    inputMode="decimal"
                    value={row.value}
                    disabled={disabled}
                    aria-label={`${index + 1}-р хэмжилтийн утга`}
                    onChange={(event) => update(index, { value: event.target.value })}
                    className={`${FIELD_INPUT} w-24 flex-none`}
                  />

                  <select
                    value={row.phase}
                    disabled={disabled || !acceptsPhase(row.kind)}
                    aria-label={`${index + 1}-р хэмжилтийн фаз`}
                    onChange={(event) =>
                      update(index, { phase: event.target.value as LoadMeasurementPhase | '' })
                    }
                    className={`${FIELD_SELECT} w-auto min-w-[6.5rem] flex-none`}
                  >
                    {PHASE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={`${index + 1}-р хэмжилт хасах`}
                    onClick={() => onChange(rows.filter((_, position) => position !== index))}
                    className="shrink-0 rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    Хасах
                  </button>
                </div>
                {rowError && <p className="mt-1 text-xs text-red-600">{rowError}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The readings on a stored assessment, read-only.
 *
 * Renders nothing at all when there are none, rather than an empty heading: most
 * assessments carry only a kW figure, and every assessment recorded before readings existed
 * carries none.
 */
export function LoadMeasurementList({
  measurements,
}: {
  measurements: readonly LoadMeasurementDto[];
}): ReactElement | null {
  if (measurements.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-1.5">
      {measurements.map((reading, index) => (
        <li
          key={`${reading.kind}-${reading.phase ?? ''}-${index}`}
          className="rounded-md bg-slate-50 px-2 py-1 text-xs text-slate-700 ring-1 ring-inset ring-slate-200"
        >
          <span className="text-slate-500">{LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}</span>{' '}
          <span className="font-medium text-slate-900">{formatLoadMeasurement(reading)}</span>
        </li>
      ))}
    </ul>
  );
}
