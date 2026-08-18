import { z } from 'zod';

import {
  OBJECT_CATEGORIES,
  OBJECT_ICONS,
  OBJECT_STATUSES,
} from '../constants/object-master';
import {
  MAX_ATTRIBUTE_OPTIONS,
  MAX_TYPE_ATTRIBUTES,
  OBJECT_ATTRIBUTE_TYPES,
} from '../constants/object-type-attribute';
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

/**
 * One option of a SELECT attribute.
 *
 * The value is what is stored on the object; the label is what a human picks. Kept apart on
 * purpose — a label is edited freely (a typo, a clearer wording) without touching anything
 * already recorded, which would not be true if the stored value were the label.
 */
const objectAttributeOptionSchema = z
  .object({
    value: z
      .string()
      .trim()
      .min(1, 'Сонголтын утга заавал.')
      .max(60)
      .regex(/^[A-Za-z0-9_-]+$/, 'Сонголтын утга зөвхөн үсэг, тоо, зураас агуулна.'),
    label: z.string().trim().min(1, 'Сонголтын нэр заавал.').max(120),
  })
  .strict();

/**
 * One attribute an object type demands of its objects.
 *
 * `key` is constrained to a plain lower-camel identifier because it is simultaneously a Mongo
 * path inside `attributeValues`, a segment of a dotted form-error key, and a React key. A dot
 * or a `$` in any of those is a defect rather than a name.
 */
export const objectTypeAttributeSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1, 'Түлхүүр заавал.')
      .max(40)
      .regex(/^[a-z][a-zA-Z0-9_]*$/, 'Түлхүүр жижиг үсгээр эхэлж, үсэг/тоо/доогуур зураас агуулна.'),
    label: z.string().trim().min(1, 'Үзүүлэлтийн нэр заавал.').max(120),
    type: z.enum(OBJECT_ATTRIBUTE_TYPES, { required_error: 'Үзүүлэлтийн төрөл заавал.' }),
    required: z.boolean().default(false),
    options: z.array(objectAttributeOptionSchema).max(MAX_ATTRIBUTE_OPTIONS).default([]),
  })
  .strict()
  .superRefine((attribute, ctx) => {
    /**
     * A SELECT is its option list, so an empty one is not a half-finished attribute — it is a
     * field a user can never satisfy, and marking it required would make the type unusable.
     */
    if (attribute.type === 'SELECT' && attribute.options.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Сонголт төрөлд дор хаяж нэг утга нэмнэ үү.',
      });
    }

    // Refused rather than stripped: options on a text box are a mistake about what the
    // attribute is, and silently dropping them hides the mistake until somebody looks.
    if (attribute.type !== 'SELECT' && attribute.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Зөвхөн "Сонголт" төрөл утгын жагсаалттай байна.',
      });
    }

    const seen = new Set<string>();
    attribute.options.forEach((option, index) => {
      if (seen.has(option.value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'value'],
          message: 'Сонголтын утга давхардсан байна.',
        });
      }
      seen.add(option.value);
    });
  });

/**
 * The attribute list of one type.
 *
 * THE ARRAY ORDER IS THE DISPLAY ORDER — there is deliberately no `sortOrder` field. A second
 * representation of the same fact is a second thing that can disagree with the first, and
 * reordering is then a renumbering rather than a move. Sending the array rearranged is the
 * whole operation, which is also why adding, editing, deleting and reordering need no
 * endpoint of their own.
 */
export const objectTypeAttributesSchema = z
  .array(objectTypeAttributeSchema)
  .max(MAX_TYPE_ATTRIBUTES, `Нэг төрөлд дээд тал нь ${MAX_TYPE_ATTRIBUTES} үзүүлэлт байна.`)
  .superRefine((attributes, ctx) => {
    // The key is the join between a definition and every value stored against it, so two
    // definitions sharing one would make the stored value ambiguous rather than duplicated.
    const seen = new Set<string>();
    attributes.forEach((attribute, index) => {
      if (seen.has(attribute.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, 'key'],
          message: 'Түлхүүр давхардсан байна.',
        });
      }
      seen.add(attribute.key);
    });
  });

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
  /**
   * A previously uploaded SVG from `POST /files/object-type-icons`, or nothing.
   *
   * The upload happens first because the type does not exist yet at that point, exactly as
   * a service-request attachment is uploaded before the request. `icon` stays required
   * regardless: it is the fallback whenever this is absent.
   */
  iconFileId: objectIdSchema.nullish(),
  /**
   * The fields objects of this type must carry. Empty for every type that wants none, which
   * is every type that exists today — so a caller written before attributes existed keeps
   * working unchanged.
   */
  attributes: objectTypeAttributesSchema.default([]),
  /**
   * Whether a service call may be raised against equipment of this type.
   *
   * The catalogue holds structural types nobody calls about (a cable run, a circuit) next to
   * the ones people do (a light, a socket). Rather than infer that from `category`, which
   * means something else, an administrator states it per type, and the call form shows only
   * what is marked here.
   */
  canCreateCall: z.boolean().default(false),
  /**
   * The SLA window, in hours, for a call raised against this type. Required exactly when
   * `canCreateCall` is true - see the refinement below - and meaningless otherwise.
   *
   * Bounded at 720 hours to match `sla.urgent_hours` and `sla.standard_hours`, so the three
   * places that express an SLA window agree on what is a plausible one.
   */
  callSlaHours: z.number().int().positive().max(720).nullish(),
});

export const updateObjectTypeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    showOnPlan: z.boolean().optional(),
    insidePanel: z.boolean().optional(),
    generatesConclusion: z.boolean().optional(),
    icon: z.enum(OBJECT_ICONS).optional(),
    /**
     * Set, replace, or clear the custom icon. Three-valued on purpose:
     * absent leaves it alone, an id replaces it, `null` clears it back to the `icon` enum.
     */
    iconFileId: objectIdSchema.nullish(),
    isActive: z.boolean().optional(),
    /**
     * The whole attribute list, replaced wholesale — add, edit, delete and reorder are all
     * "send the array as it should now be". Absent leaves the existing definitions alone.
     *
     * Editable, unlike `category` and `code` below, because it is safe to be: the values
     * already stored against a removed attribute are kept rather than cascaded away, so an
     * edit here changes what is asked for next time and never destroys what was recorded.
     */
    attributes: objectTypeAttributesSchema.optional(),
    canCreateCall: z.boolean().optional(),
    callSlaHours: z.number().int().positive().max(720).nullish(),
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
  /**
   * The panel enclosure this device is physically mounted inside — an RCD, a busbar, a
   * meter, a surge arrester.
   *
   * Independent of `circuitId` and never a substitute for it. A device may carry both (a
   * sub-panel's main breaker really is mounted in one panel and fed by a circuit from
   * another), so the two are not mutually exclusive here. LOAD REACHES A DEVICE ONLY
   * THROUGH ITS CIRCUIT: this edge is a statement about where the thing is, never about
   * what it consumes, and the section 11.5 walk descends panel → circuit → equipment and
   * never touches it. See `calculatedLoadOf` in the backend's `load.service.ts`.
   */
  panelId: objectIdSchema.nullish(),
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
  /**
   * The values for whatever the chosen type declares (requirements 4.1).
   *
   * ON `baseObjectFields` RATHER THAN ON THE THREE BRANCHES, because an attribute is a fact
   * about the type and means the same thing whichever category the type belongs to. Every
   * branch below is `.strict()`, so a key not declared somewhere in the shared base is
   * rejected outright — which is why this cannot simply be passed through.
   *
   * Only the primitive kinds are accepted here. WHICH keys are legal, whether each is
   * required, and whether a SELECT value is one of its options are all questions about
   * definitions held in the database, so zod cannot answer them: `validateAttributeValues`
   * in `constants/object-type-attribute.ts` does, from the same code on both sides.
   */
  attributeValues: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .default({}),
};

/**
 * A pin belongs to a drawing, and the drawing belongs to a floor.
 *
 * Without the floor there is no plan to place the object on, so a position arriving without
 * one is rejected rather than stored as a coordinate pointing at nothing.
 *
 * Exported because the service request carries the same optional pin: one rule, one message,
 * so a floorless coordinate is refused identically wherever it is offered.
 */
export function rejectFloorlessPosition(
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
 * Placing equipment on a floor plan with one click.
 *
 * The user picks a type once and then taps the drawing; each tap must produce a real object
 * without a form in the way. So the payload carries only what a tap can actually express —
 * which tenant, which type, which floor, and where — and the identity of the thing (`code`
 * and `name`) is generated by the backend.
 *
 * DELIBERATELY NOT A LOOSENED `createObjectSchema`. Making `code` and `name` optional there
 * would let a nameless object in through the full form, which is the one path that has a
 * human filling those fields in. Generation belongs on the server anyway: codes are unique
 * per customer against an index the browser cannot see, so only the server can allocate one
 * that will survive the insert.
 *
 * `category` is absent on purpose too — it is read from the chosen type, so a caller cannot
 * claim a category the type does not have.
 */
export const quickPlaceObjectSchema = z
  .object({
    customerId: objectIdSchema,
    objectTypeId: objectIdSchema,
    /** Required here, unlike on the create form: a tap on a plan always has a plan. */
    floorId: objectIdSchema,
    /** Required for the same reason, and 0..1 by the same rule as everywhere else. */
    planPosition: planPositionSchema,
  })
  .strict()
  // The same floorless-pin rule as the create form, from the same function, so the two
  // paths can never drift into disagreeing about it.
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
    /**
     * The type's declared attributes, as they should now stand.
     *
     * NOT PARTIAL, unlike the three blocks above. A declared attribute absent here is
     * cleared, because an absent key and a deliberately emptied one are indistinguishable on
     * the wire and only one of the two readings lets a user ever remove a value they entered
     * by mistake. What is preserved instead is the values of attributes the type no longer
     * declares — see `mergeAttributeValues`.
     *
     * Optional as a whole, though: an update that never mentions it enforces nothing and
     * changes nothing, so a rename is not the moment a required attribute is demanded.
     */
    attributeValues: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
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

/**
 * Asks the backend for the next free code under a panel.
 *
 * A suggestion, not a reservation: nothing is written and the caller stays free to type
 * something else. It is a server question because uniqueness is a server fact — a client
 * counting the rows it happens to have loaded would collide with the ones it has not.
 */
export const objectCodeSuggestionQuerySchema = z.object({
  panelId: objectIdSchema,
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
    /**
     * The object's per-type attributes, answered while the report is being written
     * (requirements 4.1). THIS IS THE FORM THAT ASKS THEM.
     *
     * THEY ARE NOT PART OF THE ASSESSMENT. They are facts about the equipment — is this
     * breaker fused — not observations about this visit, so they are written onto the OBJECT
     * and this entry keeps none of them. A copy per report would create as many answers as
     * there are reports with no way to say which is current. They travel on this payload
     * because the moment somebody is standing in front of the equipment with a report open is
     * the moment they can look and answer, and because doing it here is one call rather than
     * two with a half-applied state in between. `measuredLoadKw` already reaches the object
     * by the same route.
     *
     * OPTIONAL, AND ABSENT MEANS "NOT ASKED". A client that does not send them — the employee
     * mobile app — records its assessment exactly as it did before, nothing is enforced
     * against it, and nothing already stored is cleared. Sending them invites the check.
     */
    attributeValues: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
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

export type ObjectTypeAttributeInput = z.infer<typeof objectTypeAttributeSchema>;
export type CreateObjectTypeInput = z.infer<typeof createObjectTypeSchema>;
export type UpdateObjectTypeInput = z.infer<typeof updateObjectTypeSchema>;
export type ObjectTypeListQueryInput = z.infer<typeof objectTypeListQuerySchema>;
export type PlanPositionInput = z.infer<typeof planPositionSchema>;
export type CreateObjectInput = z.infer<typeof createObjectSchema>;
export type QuickPlaceObjectInput = z.infer<typeof quickPlaceObjectSchema>;
export type UpdateObjectInput = z.infer<typeof updateObjectSchema>;
export type UpdateObjectPositionInput = z.infer<typeof updateObjectPositionSchema>;
export type ObjectListQueryInput = z.infer<typeof objectListQuerySchema>;
export type ObjectCodeSuggestionQueryInput = z.infer<typeof objectCodeSuggestionQuerySchema>;
export type LinkFloorObjectsInput = z.infer<typeof linkFloorObjectsSchema>;
export type LoadMeasurementInput = z.infer<typeof loadMeasurementSchema>;
export type CreateObjectAssessmentInput = z.infer<typeof createObjectAssessmentSchema>;
export type ObjectAssessmentListQueryInput = z.infer<typeof objectAssessmentListQuerySchema>;
