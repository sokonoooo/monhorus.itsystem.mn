/**
 * Object master data (requirements 4.1, 4.2, 11.4 and 11.5).
 *
 * An Object is master data: it is created and edited in its own module and a Floor merely
 * links to it. Nothing here copies or re-creates an Object.
 *
 * Two levels of typing, and they do different jobs:
 *
 *   - CATEGORY is structural and fixed. It decides which section 4.2 fields exist at all,
 *     and it drives the load formulas in section 11.5.
 *   - TYPE is a row in the administrator-managed catalogue of section 4.1, for example
 *     MCB or Гэрэл. It carries the plan icon and the "generates a conclusion" flag.
 *
 * A type is scoped to exactly one category, otherwise a cable type could be attached to a
 * panel and the per-category validation would have nothing to stand on.
 */
export const OBJECT_CATEGORIES = ['PANEL', 'CIRCUIT', 'EQUIPMENT'] as const;
export type ObjectCategory = (typeof OBJECT_CATEGORIES)[number];

export const OBJECT_CATEGORY_LABELS: Record<ObjectCategory, string> = {
  PANEL: 'Самбар',
  CIRCUIT: 'Хэлхээ/шугам',
  EQUIPMENT: 'Тоноглол/төхөөрөмж',
};

export const OBJECT_CATEGORY_DESCRIPTIONS: Record<ObjectCategory, string> = {
  PANEL: 'Цахилгааныг хуваарилах, хамгаалах, салгах төв цэг. Хүчин чадалтай.',
  CIRCUIT: 'Самбараас гарах шугам. Эхлэх, дуусах цэг, кабель, автоматтай.',
  EQUIPMENT: 'Цахилгаан хэрэглэгч төхөөрөмж. Нэрлэсэн чадал, тоо, коэффициенттэй.',
};

/**
 * Operational status.
 *
 * Rule 17.17 keeps a decommissioned object out of the capacity calculation, and rule 17.9
 * forbids leaving a black-band device in active use, which is why DECOMMISSIONED is a
 * first-class status rather than an inactive flag.
 */
export const OBJECT_STATUSES = ['ACTIVE', 'INACTIVE', 'DECOMMISSIONED'] as const;
export type ObjectStatus = (typeof OBJECT_STATUSES)[number];

export const OBJECT_STATUS_LABELS: Record<ObjectStatus, string> = {
  ACTIVE: 'Ашиглалтад байгаа',
  INACTIVE: 'Түр идэвхгүй',
  DECOMMISSIONED: 'Ашиглалтаас гарсан',
};

/** Only an active object contributes to the load figures (rule 17.17). */
export function countsTowardLoad(status: ObjectStatus): boolean {
  return status === 'ACTIVE';
}

// -- Section 4.1 type registry ----------------------------------------------

/**
 * Plan marker icons.
 *
 * Section 4.1 requires an icon per type but names no set, so this is a fixed catalogue of
 * neutral keys. The keys are stored, never the glyphs, so the rendering can change without
 * touching data. The plan editor that consumes them is not approved yet; the field is
 * carried now so the registry matches section 4.1 in full.
 */
export const OBJECT_ICONS = [
  'PANEL',
  'BREAKER',
  'LIGHT',
  'SOCKET',
  'SWITCH',
  'CABLE',
  'MOTOR',
  'PUMP',
  'CAMERA',
  'SENSOR',
  'UPS',
  'SERVER_RACK',
  'HVAC',
  'OTHER',
] as const;
export type ObjectIcon = (typeof OBJECT_ICONS)[number];

export const OBJECT_ICON_LABELS: Record<ObjectIcon, string> = {
  PANEL: 'Самбар',
  BREAKER: 'Автомат таслуур',
  LIGHT: 'Гэрэл',
  SOCKET: 'Залгуур',
  SWITCH: 'Унтраалга',
  CABLE: 'Кабель',
  MOTOR: 'Мотор',
  PUMP: 'Насос',
  CAMERA: 'Камер',
  SENSOR: 'Мэдрэгч',
  UPS: 'UPS',
  SERVER_RACK: 'Server rack',
  HVAC: 'Агааржуулалт',
  OTHER: 'Бусад',
};

// -- Section 11.5 load calculation ------------------------------------------

/**
 * Why a load figure cannot be produced.
 *
 * Rule 17.18 requires an incomplete calculation to be presented as "Бүрэн бус" rather than
 * as a number, so the reason travels with the result instead of being flattened to zero.
 */
export const LOAD_INCOMPLETE_REASONS = [
  'MISSING_RATED_POWER',
  'MISSING_QUANTITY',
  'MISSING_CAPACITY',
  'MISSING_PERMITTED_CAPACITY',
  'NO_EQUIPMENT',
] as const;
export type LoadIncompleteReason = (typeof LOAD_INCOMPLETE_REASONS)[number];

export const LOAD_INCOMPLETE_REASON_LABELS: Record<LoadIncompleteReason, string> = {
  MISSING_RATED_POWER: 'Нэрлэсэн чадал бүртгэгдээгүй',
  MISSING_QUANTITY: 'Тоо ширхэг бүртгэгдээгүй',
  MISSING_CAPACITY: 'Хүчин чадал бүртгэгдээгүй',
  MISSING_PERMITTED_CAPACITY: 'Зөвшөөрөгдөх чадал бүртгэгдээгүй',
  NO_EQUIPMENT: 'Холбогдсон тоноглол алга',
};

export const LOAD_INCOMPLETE_LABEL = 'Бүрэн бус';

/** Section 11.5: "Коэффициентгүй бол 1.0." */
export const DEFAULT_USAGE_COEFFICIENT = 1;

export interface EquipmentLoadInput {
  ratedPowerKw: number | null;
  quantity: number | null;
  usageCoefficient: number | null;
  status: ObjectStatus;
}

export interface LoadResult {
  /** Null when the inputs are incomplete; never silently zero. */
  valueKw: number | null;
  complete: boolean;
  reasons: readonly LoadIncompleteReason[];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Section 11.5: Σ (Төхөөрөмжийн нэрлэсэн чадал × Тоо ширхэг × Ашиглалтын коэффициент).
 *
 * A decommissioned object contributes nothing but is not an incompleteness either: it is
 * simply out of scope for the calculation (rule 17.17).
 */
export function equipmentLoadKw(input: EquipmentLoadInput): LoadResult {
  if (!countsTowardLoad(input.status)) {
    return { valueKw: 0, complete: true, reasons: [] };
  }

  const reasons: LoadIncompleteReason[] = [];
  if (input.ratedPowerKw === null) reasons.push('MISSING_RATED_POWER');
  if (input.quantity === null) reasons.push('MISSING_QUANTITY');

  if (reasons.length > 0) return { valueKw: null, complete: false, reasons };

  const coefficient = input.usageCoefficient ?? DEFAULT_USAGE_COEFFICIENT;
  return {
    valueKw: round(input.ratedPowerKw! * input.quantity! * coefficient),
    complete: true,
    reasons: [],
  };
}

/** Sums child results, propagating incompleteness rather than hiding it. */
export function sumLoads(parts: readonly LoadResult[]): LoadResult {
  const reasons = new Set<LoadIncompleteReason>();
  let total = 0;
  let complete = true;

  for (const part of parts) {
    if (!part.complete || part.valueKw === null) {
      complete = false;
      for (const reason of part.reasons) reasons.add(reason);
      continue;
    }
    total += part.valueKw;
  }

  return complete
    ? { valueKw: round(total), complete: true, reasons: [] }
    : { valueKw: null, complete: false, reasons: [...reasons] };
}

/**
 * Section 11.5 load percentage: ачаалал ÷ хүчин чадал × 100.
 *
 * Used for both the circuit ratio (against its permitted capacity) and the panel ratio
 * (against its capacity), because section 11.5 defines them with the same shape.
 */
export function loadPercent(load: LoadResult, capacityKw: number | null): LoadResult {
  if (!load.complete || load.valueKw === null) {
    return { valueKw: null, complete: false, reasons: load.reasons };
  }
  if (capacityKw === null || capacityKw <= 0) {
    return { valueKw: null, complete: false, reasons: ['MISSING_CAPACITY'] };
  }
  return { valueKw: round((load.valueKw / capacityKw) * 100), complete: true, reasons: [] };
}

/** Section 11.5 reserve: Самбарын нийт хүчин чадал - Одоогийн тооцоолсон ачаалал. */
export function reserveKw(load: LoadResult, capacityKw: number | null): LoadResult {
  if (!load.complete || load.valueKw === null) {
    return { valueKw: null, complete: false, reasons: load.reasons };
  }
  if (capacityKw === null) {
    return { valueKw: null, complete: false, reasons: ['MISSING_CAPACITY'] };
  }
  return { valueKw: round(capacityKw - load.valueKw), complete: true, reasons: [] };
}

/**
 * Rule 17.16: calculated and measured load are stored separately and the difference is
 * shown. Positive variance means the measured figure exceeds the calculation.
 */
export function loadVarianceKw(
  calculated: LoadResult,
  measuredKw: number | null,
): LoadResult {
  if (measuredKw === null) {
    return { valueKw: null, complete: false, reasons: [] };
  }
  if (!calculated.complete || calculated.valueKw === null) {
    return { valueKw: null, complete: false, reasons: calculated.reasons };
  }
  return { valueKw: round(measuredKw - calculated.valueKw), complete: true, reasons: [] };
}

/**
 * Section 11.5 reports reserve in kW, kVA and percent. kVA is deliberately absent from
 * this module: converting kW to kVA needs a power factor, section 4.2 records no such
 * field on a panel, and section 19.2 leaves the electrical reference tables unapproved.
 * Inventing a power factor would produce a number that looks authoritative and is not.
 */
export const KVA_UNAVAILABLE_NOTE =
  'kVA-г тооцохын тулд чадлын коэффициент (power factor) шаардлагатай бөгөөд одоогоор батлагдаагүй байна.';
