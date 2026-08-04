import { z } from 'zod';

import {
  OBJECT_CATEGORIES,
  OBJECT_ICONS,
  OBJECT_STATUSES,
} from '../constants/object-master';
import {
  LOAD_MEASUREMENT_KINDS,
  LOAD_MEASUREMENT_KIND_LABELS,
  LOAD_MEASUREMENT_KIND_UNIT,
  LOAD_MEASUREMENT_PHASES,
  LOAD_MEASUREMENT_UNITS,
  LOAD_MEASUREMENT_UNIT_LABELS,
  MAX_LOAD_MEASUREMENTS,
  acceptsPhase,
} from '../constants/load-measurement';
import { RISK_LEVELS } from '../constants/service-request';
import { booleanQuerySchema, isoDateSchema, objectIdSchema, sortDirSchema } from './common.schema';

// -- Section 4.1 type registry ----------------------------------------------

export const createObjectTypeSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Код дор хаяж 2 тэмдэгттэй байна.')
    .max(32)
    .regex(/^[A-Z0-9-]+$/, 'Код зөвхөн том үсэг, тоо, зураас агуулна.'),
  name: z.string().trim().min(2, 'Нэр заавал.').max(120),
  description: z.string().trim().max(500).nullish(),
  category: z.enum(OBJECT_CATEGORIES, { required_error: 'Ангилал заавал.' }),
  showOnPlan: z.boolean().default(false),
  insidePanel: z.boolean().default(false),
  generatesConclusion: z.boolean().default(true),
  icon: z.enum(OBJECT_ICONS).default('OTHER'),
});

export const updateObjectTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    showOnPlan: z.boolean().optional(),
    insidePanel: z.boolean().optional(),
    generatesConclusion: z.boolean().optional(),
    icon: z.enum(OBJECT_ICONS).optional(),
    isActive: z.boolean().optional(),
  })
  // Category and code are omitted on purpose: changing either would silently invalidate
  // every object already using the type.
  .strict();

export const objectTypeListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().trim().max(200).optional(),
  category: z.enum(OBJECT_CATEGORIES).optional(),
  isActive: booleanQuerySchema.optional(),
});

// -- Per-category attribute blocks -------------------------------------------

/**
 * Section 4.2 panel fields. Capacity drives the section 11.5 panel ratio, so it is
 * accepted as nullable rather than required: an incomplete panel is reported as
 * "Бүрэн бус" (rule 17.18) instead of being rejected at entry.
 */
const panelAttributesSchema = z.object({
  capacityKw: z.number().positive('Хүчин чадал 0-ээс их байна.').nullish(),
  location: z.string().trim().max(200).nullish(),
  protection: z.string().trim().max(200).nullish(),
});

/** Section 4.2 and 11.4 circuit fields. */
const circuitAttributesSchema = z.object({
  panelId: objectIdSchema.nullish(),
  startPointObjectId: objectIdSchema.nullish(),
  endPointObjectId: objectIdSchema.nullish(),
  breakerRating: z.string().trim().max(60).nullish(),
  cableType: z.string().trim().max(60).nullish(),
  cableSectionMm2: z.number().positive('Огтлол 0-ээс их байна.').nullish(),
  cableLengthM: z.number().positive('Урт 0-ээс их байна.').nullish(),
  permittedCapacityKw: z.number().positive('Зөвшөөрөгдөх чадал 0-ээс их байна.').nullish(),
});

/** Section 4.2 equipment fields. */
const equipmentAttributesSchema = z.object({
  circuitId: objectIdSchema.nullish(),
  ratedPowerKw: z.number().positive('Нэрлэсэн чадал 0-ээс их байна.').nullish(),
  quantity: z.number().int('Тоо ширхэг бүхэл тоо байна.').positive('Тоо ширхэг 0-ээс их байна.').nullish(),
  usageCoefficient: z
    .number()
    .positive('Коэффициент 0-ээс их байна.')
    .max(1, 'Коэффициент 1-ээс их байж болохгүй.')
    .nullish(),
  installedAt: isoDateSchema.nullish(),
  warrantyUntil: isoDateSchema.nullish(),
});

/**
 * Where an object sits on its floor plan.
 *
 * Normalised to 0..1 of the plan's own width and height rather than stored in pixels: the
 * plan image is replaceable and may arrive as PNG, JPG, WEBP or PDF at any resolution, so a
 * pixel pair would point somewhere else the moment the image is swapped. A fraction keeps
 * pointing at the same place on the drawing.
 */
export const planPositionSchema = z
  .object({
    x: z
      .number()
      .min(0, 'Байрлал 0-1 хооронд байна.')
      .max(1, 'Байрлал 0-1 хооронд байна.'),
    y: z
      .number()
      .min(0, 'Байрлал 0-1 хооронд байна.')
      .max(1, 'Байрлал 0-1 хооронд байна.'),
  })
  .strict();

const baseObjectFields = {
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2, 'Код дор хаяж 2 тэмдэгттэй байна.')
    .max(64)
    .regex(/^[A-Z0-9./-]+$/, 'Код зөвхөн том үсэг, тоо, зураас, цэг агуулна.'),
  name: z.string().trim().min(2, 'Нэр заавал.').max(200),
  customerId: objectIdSchema,
  objectTypeId: objectIdSchema,
  /** Optional: an object may exist in the master list before it is placed on a floor. */
  floorId: objectIdSchema.nullish(),
  /** Optional placement on the floor's plan image. Only meaningful with a `floorId`. */
  planPosition: planPositionSchema.nullish(),
  description: z.string().trim().max(2000).nullish(),
  notes: z.string().trim().max(2000).nullish(),
};

/**
 * A pin belongs to a drawing, and the drawing belongs to a floor.
 *
 * Without the floor there is no plan to place the object on, so a position arriving without
 * one is rejected rather than stored as a coordinate pointing at nothing.
 */
function rejectFloorlessPosition(
  value: { floorId?: string | null; planPosition?: { x: number; y: number } | null },
  ctx: z.RefinementCtx,
): void {
  if (value.planPosition && !value.floorId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['planPosition'],
      message: 'План дээрх байрлалыг давхар сонгосон үед л тэмдэглэнэ.',
    });
  }
}

/**
 * Object create payload, discriminated by category.
 *
 * A discriminated union is what makes the per-category validation strict: a panel payload
 * carrying `ratedPowerKw` fails to parse, so a technical field can never be stored on a
 * category that has no use for it.
 */
export const createObjectSchema = z
  .discriminatedUnion('category', [
  // `.strict()` on every branch is what makes the validation type-specific: a panel
  // payload carrying an `equipment` block is rejected outright rather than having the
  // stray field quietly stripped and stored as an incomplete object.
  z
    .object({
      ...baseObjectFields,
      category: z.literal('PANEL'),
      panel: panelAttributesSchema,
    })
    .strict(),
  z
    .object({
      ...baseObjectFields,
      category: z.literal('CIRCUIT'),
      circuit: circuitAttributesSchema,
    })
    .strict(),
  z
    .object({
      ...baseObjectFields,
      category: z.literal('EQUIPMENT'),
      equipment: equipmentAttributesSchema,
    })
    .strict(),
  ])
  .superRefine(rejectFloorlessPosition);

/**
 * Object update payload.
 *
 * `category` is absent: changing it would invalidate every attribute already stored and
 * every load figure derived from them. A miscategorised object is replaced, not mutated.
 */
export const updateObjectSchema = z
  .object({
    name: z.string().trim().min(2).max(200).optional(),
    objectTypeId: objectIdSchema.optional(),
    floorId: objectIdSchema.nullish(),
    planPosition: planPositionSchema.nullish(),
    status: z.enum(OBJECT_STATUSES).optional(),
    description: z.string().trim().max(2000).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    panel: panelAttributesSchema.partial().optional(),
    circuit: circuitAttributesSchema.partial().optional(),
    equipment: equipmentAttributesSchema.partial().optional(),
  })
  .strict()
  /**
   * An omitted `floorId` means "leave the floor as it is", so the position is judged
   * against the floor the object already sits on and that check belongs to the service,
   * which can see it. Only the contradiction expressible here is refused: taking the
   * object off every floor while pinning it to one.
   */
  .superRefine((value, ctx) => {
    if (value.planPosition && value.floorId === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['planPosition'],
        message: 'План дээрх байрлалыг давхар сонгосон үед л тэмдэглэнэ.',
      });
    }
  });

/**
 * Moving or clearing a pin on the plan.
 *
 * Its own endpoint rather than a full object update: dragging a marker should not have to
 * round-trip the strict per-category payload, and a caller that sends only this cannot
 * accidentally rewrite a technical field on the way past.
 */
export const updateObjectPositionSchema = z
  .object({
    planPosition: planPositionSchema.nullable(),
  })
  .strict();

export const objectListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  customerId: objectIdSchema.optional(),
  floorId: objectIdSchema.optional(),
  buildingId: objectIdSchema.optional(),
  category: z.enum(OBJECT_CATEGORIES).optional(),
  objectTypeId: objectIdSchema.optional(),
  status: z.enum(OBJECT_STATUSES).optional(),
  riskLevel: z.enum(RISK_LEVELS).optional(),
  unlinkedOnly: booleanQuerySchema.optional(),
  sortBy: z.enum(['code', 'name', 'createdAt']).default('code'),
  sortDir: sortDirSchema,
});

/** Links or unlinks objects on a floor. The objects themselves are never copied. */
export const linkFloorObjectsSchema = z.object({
  objectIds: z.array(objectIdSchema).min(1, 'Дор хаяж нэг объект сонгоно уу.').max(200),
});

// -- Assessment --------------------------------------------------------------

/**
 * One load reading — "Multiple Load Units".
 *
 * The kind/unit pair is checked here rather than trusted, because the pair is the whole
 * meaning of the row: a CURRENT accepted with `KILOWATT` would read as kW everywhere it is
 * displayed and would be indistinguishable from a real power figure. There is exactly one
 * valid unit per kind, so the check is a table lookup and the message names both halves.
 *
 * The unit is still required on the wire rather than being filled in from the kind. A
 * client that has understood the vocabulary states both and is checked; one that has not is
 * refused, instead of having a unit invented for it.
 */
export const loadMeasurementSchema = z
  .object({
    kind: z.enum(LOAD_MEASUREMENT_KINDS, { required_error: 'Хэмжилтийн төрөл заавал.' }),
    value: z
      .number({ required_error: 'Хэмжсэн утга заавал.', invalid_type_error: 'Хэмжсэн утга тоо байна.' })
      .min(0, 'Хэмжсэн утга сөрөг байж болохгүй.')
      .max(1_000_000, 'Хэмжсэн утга хэт том байна.'),
    unit: z.enum(LOAD_MEASUREMENT_UNITS, { required_error: 'Хэмжих нэгж заавал.' }),
    phase: z.enum(LOAD_MEASUREMENT_PHASES).nullish(),
  })
  .superRefine((reading, ctx) => {
    const expected = LOAD_MEASUREMENT_KIND_UNIT[reading.kind];
    if (reading.unit !== expected) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['unit'],
        message:
          `"${LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}"-ыг зөвхөн ` +
          `${LOAD_MEASUREMENT_UNIT_LABELS[expected]} нэгжээр бүртгэнэ.`,
      });
    }

    // A phase on a power reading would claim something the system does not model.
    if (reading.phase && !acceptsPhase(reading.kind)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['phase'],
        message: `"${LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}"-д фаз заахгүй.`,
      });
    }
  });

/**
 * Assessment entry (requirements 9.2 and 10.1).
 *
 * Conditional requirements are enforced in `superRefine` because they depend on the band
 * the score falls into, and the band thresholds are configurable per section 16.1. The
 * caller supplies the score; the backend resolves the band and applies these rules.
 */
export const createObjectAssessmentSchema = z
  .object({
    newScore: z
      .number()
      .int('Оноо бүхэл тоо байна.')
      .min(0, 'Оноо 0-ээс бага байж болохгүй.')
      .max(100, 'Оноо 100-аас их байж болохгүй.'),
    conclusion: z.string().trim().max(4000).nullish(),
    recommendation: z.string().trim().max(4000).nullish(),
    actionTaken: z.string().trim().max(2000).nullish(),
    measuredLoadKw: z.number().min(0, 'Хэмжсэн ачаалал сөрөг байж болохгүй.').nullish(),
    /**
     * Additional readings in their own units (A, V, kW). Optional and additive: an
     * assessment that omits it behaves exactly as one recorded before the field existed.
     */
    measurements: z.array(loadMeasurementSchema).max(MAX_LOAD_MEASUREMENTS).optional(),
    repairRequired: z.boolean().default(false),
    revisitRequired: z.boolean().default(false),
    revisitDate: isoDateSchema.nullish(),
    revisitOwnerEmployeeId: objectIdSchema.nullish(),
    /**
     * Evidence. Section 10.1 keeps the photos with the assessment, and the product owner
     * requires at least one before a score may be recorded: a number with no picture
     * behind it is not an assessment.
     *
     * The rule lives on the create schema, not on the model, so entries stored before it
     * was introduced keep their empty set and stay readable. Only a new entry must carry
     * evidence.
     */
    photoIds: z
      .array(objectIdSchema, {
        // A missing list and an empty one are the same failure to the caller, so they
        // read the same sentence rather than zod's generic "Required".
        required_error: 'Нотлох зураг заавал: дор хаяж нэг зураг хавсаргана уу.',
        invalid_type_error: 'Нотлох зураг заавал: дор хаяж нэг зураг хавсаргана уу.',
      })
      .min(1, 'Нотлох зураг заавал: дор хаяж нэг зураг хавсаргана уу.')
      .max(20),
  })
  .superRefine((value, ctx) => {
    /**
     * ONE READING PER (KIND, PHASE).
     *
     * Three currents on L1, L2 and L3 are three different facts and all three are kept.
     * Two currents both labelled L1 are not: nothing downstream could choose between them,
     * and in practice it is a row added twice on a phone. Rejecting is the only option that
     * does not silently drop a reading a technician believes they recorded.
     *
     * "At most one ACTIVE_POWER" falls out of this for free, because a power reading may
     * not carry a phase, so every ACTIVE_POWER entry keys to (ACTIVE_POWER, null).
     */
    const seen = new Set<string>();
    value.measurements?.forEach((reading, index) => {
      const key = `${reading.kind}:${reading.phase ?? ''}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['measurements', index, 'value'],
          message: `"${LOAD_MEASUREMENT_KIND_LABELS[reading.kind]}"${
            reading.phase ? ` (${reading.phase})` : ''
          } давхардсан байна.`,
        });
      }
      seen.add(key);
    });

    /**
     * `measuredLoadKw` AND AN ACTIVE_POWER READING MAY NEVER DISAGREE.
     *
     * `measuredLoadKw` stays the authoritative, summable kW head — the floor roll-up adds
     * it up and nothing else. An ACTIVE_POWER reading is the same quantity written in the
     * readings list, so the two are one fact with two homes, and a form that offers both
     * boxes can produce a contradiction.
     *
     * The rule is: whichever is supplied populates the other (the service fills
     * `measuredLoadKw` from the reading when the kW box was left empty), and supplying both
     * with different numbers is REFUSED here rather than resolved. Picking a winner would
     * be picking which of the technician's two figures to throw away, and the losing one
     * would vanish with no trace that it was ever entered.
     */
    const power = value.measurements?.find((reading) => reading.kind === 'ACTIVE_POWER');
    if (
      power &&
      value.measuredLoadKw !== undefined &&
      value.measuredLoadKw !== null &&
      Math.abs(power.value - value.measuredLoadKw) > 1e-6
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['measuredLoadKw'],
        message:
          `Хэмжсэн ачаалал (${value.measuredLoadKw} кВт) болон бүртгэсэн ` +
          `"${LOAD_MEASUREMENT_KIND_LABELS.ACTIVE_POWER}" (${power.value} кВт) зөрж байна. ` +
          'Нэг утга болгоно уу.',
      });
    }

    // Section 9.3: a revisit needs a date and an owner.
    if (value.revisitRequired) {
      if (!value.revisitDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['revisitDate'],
          message: 'Дахин очих огноо заавал.',
        });
      }
      if (!value.revisitOwnerEmployeeId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['revisitOwnerEmployeeId'],
          message: 'Дахин очих хариуцагч заавал.',
        });
      }
    }
  });

export const objectAssessmentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});

export type CreateObjectTypeInput = z.infer<typeof createObjectTypeSchema>;
export type UpdateObjectTypeInput = z.infer<typeof updateObjectTypeSchema>;
export type ObjectTypeListQueryInput = z.infer<typeof objectTypeListQuerySchema>;
export type PlanPositionInput = z.infer<typeof planPositionSchema>;
export type CreateObjectInput = z.infer<typeof createObjectSchema>;
export type UpdateObjectInput = z.infer<typeof updateObjectSchema>;
export type UpdateObjectPositionInput = z.infer<typeof updateObjectPositionSchema>;
export type ObjectListQueryInput = z.infer<typeof objectListQuerySchema>;
export type LinkFloorObjectsInput = z.infer<typeof linkFloorObjectsSchema>;
export type LoadMeasurementInput = z.infer<typeof loadMeasurementSchema>;
export type CreateObjectAssessmentInput = z.infer<typeof createObjectAssessmentSchema>;
export type ObjectAssessmentListQueryInput = z.infer<typeof objectAssessmentListQuerySchema>;
