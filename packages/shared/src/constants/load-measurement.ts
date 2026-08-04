/**
 * Load measurement vocabulary — "Multiple Load Units".
 *
 * A visit does not only produce a kW figure. A technician standing at a three-phase panel
 * with a clamp meter reads amps, one per phase, and a voltage between phases; the kW head
 * is what gets summed afterwards. Before this vocabulary existed the only place to put any
 * of it was `measuredLoadKw`, so an amp reading either went unrecorded or was quietly
 * written into a field that the floor roll-up adds up — which is how a 42 A reading turns
 * into 42 kW of phantom load on a floor total.
 *
 * WHAT IS AND IS NOT SUMMABLE
 *
 * `measuredLoadKw` stays the single authoritative, summable head on both the assessment and
 * the object, and nothing here feeds it except an explicit kW reading (see the schema's
 * ACTIVE_POWER rule). Amps and volts are recorded observations: they are shown next to the
 * assessment that took them and are never added to anything. Adding amps across panels is
 * not a quantity; adding volts is not a quantity either. Capacity is likewise untouched and
 * remains kW-only, because a permitted capacity in amps would need a voltage and a power
 * factor that section 4.2 records nowhere.
 *
 * Shaped after `MATERIAL_UNITS`: a `const` tuple plus a `*_LABELS` record of Mongolian
 * labels, consumed by `z.enum(...)` in the schema.
 */

/** What was measured. Each kind has exactly one unit — see `LOAD_MEASUREMENT_KIND_UNIT`. */
export const LOAD_MEASUREMENT_KINDS = ['CURRENT', 'VOLTAGE', 'ACTIVE_POWER'] as const;
export type LoadMeasurementKind = (typeof LOAD_MEASUREMENT_KINDS)[number];

export const LOAD_MEASUREMENT_KIND_LABELS: Record<LoadMeasurementKind, string> = {
  CURRENT: 'Гүйдэл',
  VOLTAGE: 'Хүчдэл',
  ACTIVE_POWER: 'Идэвхтэй чадал',
};

export const LOAD_MEASUREMENT_UNITS = ['AMPERE', 'VOLT', 'KILOWATT'] as const;
export type LoadMeasurementUnit = (typeof LOAD_MEASUREMENT_UNITS)[number];

export const LOAD_MEASUREMENT_UNIT_LABELS: Record<LoadMeasurementUnit, string> = {
  AMPERE: 'А',
  VOLT: 'В',
  KILOWATT: 'кВт',
};

/**
 * The one unit each kind may be recorded in.
 *
 * Stored on the reading rather than looked up at read time so a row says in full what it
 * is, and validated on write against this table so a current can never be stored in kW.
 * The pairing is fixed, not a preference: unit conversion between these kinds needs a
 * voltage and a power factor, neither of which is recorded (see `KVA_UNAVAILABLE_NOTE`).
 */
export const LOAD_MEASUREMENT_KIND_UNIT: Record<LoadMeasurementKind, LoadMeasurementUnit> = {
  CURRENT: 'AMPERE',
  VOLTAGE: 'VOLT',
  ACTIVE_POWER: 'KILOWATT',
};

/**
 * Which conductor the reading was taken on.
 *
 * Null means "not phase-specific": a single-phase supply, or a total. A three-phase panel
 * carries three separate CURRENT readings, one per phase, because the imbalance between
 * them is the finding — averaging them into one number would erase it.
 */
export const LOAD_MEASUREMENT_PHASES = ['L1', 'L2', 'L3', 'N'] as const;
export type LoadMeasurementPhase = (typeof LOAD_MEASUREMENT_PHASES)[number];

export const LOAD_MEASUREMENT_PHASE_LABELS: Record<LoadMeasurementPhase, string> = {
  L1: 'L1 фаз',
  L2: 'L2 фаз',
  L3: 'L3 фаз',
  N: 'Тэг (N)',
};

/**
 * Kinds a phase may be named on.
 *
 * Power is not carried on a single conductor in any sense this system records, so an
 * ACTIVE_POWER reading is always the whole thing and its phase is always null.
 */
export const PHASED_LOAD_MEASUREMENT_KINDS: readonly LoadMeasurementKind[] = [
  'CURRENT',
  'VOLTAGE',
];

export function unitForLoadMeasurementKind(kind: LoadMeasurementKind): LoadMeasurementUnit {
  return LOAD_MEASUREMENT_KIND_UNIT[kind];
}

export function acceptsPhase(kind: LoadMeasurementKind): boolean {
  return PHASED_LOAD_MEASUREMENT_KINDS.includes(kind);
}

/** How many readings one assessment may carry. Three phases of two kinds, plus headroom. */
export const MAX_LOAD_MEASUREMENTS = 12;

/** `12.4 А`, `230 В`, `8.1 кВт` — the one place a reading is turned into text. */
export function formatLoadMeasurement(reading: {
  value: number;
  unit: LoadMeasurementUnit;
  phase?: LoadMeasurementPhase | null;
}): string {
  const amount = `${reading.value} ${LOAD_MEASUREMENT_UNIT_LABELS[reading.unit]}`;
  return reading.phase ? `${amount} (${reading.phase})` : amount;
}
