/**
 * Per-type attributes (requirements 4.1).
 *
 * An object type — Автомат таслуур, Гэрэлтүүлэг, UPS — declares the extra facts every object
 * of that type must carry, and an administrator defines them at runtime. "Автомат таслуур has
 * a Хайлмал that is either Хайлмалтай or Хайлмалгүй" is a statement about the type, not about
 * its category, and there was nowhere to put it: `category` decides which section 4.2 block
 * exists (see `object-master.ts`), and those three blocks are fixed in TypeScript.
 *
 * TWO LEVELS, AND THIS IS A THIRD THING ON TOP OF THEM. Category stays structural and fixed;
 * it still drives the section 11.5 load formulas. Type stays the administrator-managed
 * catalogue. What is new is that a type may now also describe fields, and nothing here is
 * keyed on a category literal — an attribute means the same thing on a panel type as on a
 * device type.
 *
 * NOTHING IN THIS FILE PARTICIPATES IN ANY CALCULATION. The load walk reads `ratedPowerKw`,
 * `quantity` and `usageCoefficient` off the typed `equipment` block and nothing else, so an
 * administrator cannot reach a load figure by renaming or deleting an attribute. That
 * separation is deliberate and is the reason these values live in their own bag rather than
 * being folded into the section 4.2 blocks.
 */

/**
 * What an attribute holds.
 *
 * Four kinds, chosen because they are the four a definition can describe completely: a
 * SELECT is its option list, and the other three are their primitive. Deliberately no DATE
 * yet — the two dates that exist (`installedAt`, `warrantyUntil`) are typed fields on the
 * equipment block with their own timezone handling, and a second, differently-handled date
 * path is not worth opening until something asks for one.
 *
 * Deliberately no REFERENCE either. An attribute pointing at another object would be an edge
 * in the estate graph, and edges are what `docs/adr/CATEGORY_REFACTOR_PLAN.md` §3.2 is for;
 * hiding one inside an untyped bag would put it beyond `populate` and beyond the delete
 * guards.
 */
export const OBJECT_ATTRIBUTE_TYPES = ['SELECT', 'TEXT', 'NUMBER', 'BOOLEAN'] as const;
export type ObjectAttributeType = (typeof OBJECT_ATTRIBUTE_TYPES)[number];

export const OBJECT_ATTRIBUTE_TYPE_LABELS: Record<ObjectAttributeType, string> = {
  SELECT: 'Сонголт',
  TEXT: 'Текст',
  NUMBER: 'Тоо',
  BOOLEAN: 'Тийм/Үгүй',
};

export const OBJECT_ATTRIBUTE_TYPE_HINTS: Record<ObjectAttributeType, string> = {
  SELECT: 'Урьдчилан тодорхойлсон жагсаалтаас нэгийг сонгоно.',
  TEXT: 'Чөлөөт бичвэр.',
  NUMBER: 'Тоон утга.',
  BOOLEAN: 'Тийм эсвэл үгүй.',
};

/** Enough for a full nameplate; a type needing more is describing two things. */
export const MAX_TYPE_ATTRIBUTES = 20;

/** A pick-one list longer than this is a lookup table, not an attribute. */
export const MAX_ATTRIBUTE_OPTIONS = 30;

/** Matches the `description` cap on the type itself, so neither is the surprising one. */
export const MAX_ATTRIBUTE_TEXT_LENGTH = 500;

/**
 * The largest magnitude a NUMBER attribute may hold.
 *
 * Not a domain limit — an attribute has no domain, that is the point of it — but a guard
 * against a value that cannot round-trip through JSON without losing precision.
 */
export const MAX_ATTRIBUTE_NUMBER = 1e12;

/** One option of a SELECT attribute. The value is stored; the label is what a human reads. */
export interface ObjectAttributeOptionDto {
  /** Stored on the object. Immutable in practice: changing it orphans every stored value. */
  value: string;
  label: string;
}

/**
 * One attribute an object type demands.
 *
 * ORDER IS THE ARRAY INDEX. There is no `sortOrder` field, because a second representation
 * of the order is a second thing to keep in step: reordering is the administrator sending
 * the array in the new order, and Mongoose stores a document array in the order given.
 */
export interface ObjectTypeAttributeDto {
  /**
   * The key the value is stored under. Immutable in practice for the same reason an option
   * value is: it is the join between a definition and every value already recorded against
   * it. Constrained to a plain identifier so it is safe as a Mongo path, a dotted form-error
   * key and a React key all at once.
   */
  key: string;
  label: string;
  type: ObjectAttributeType;
  /** Enforced when an object is written, never when one is read. See `validateAttributeValues`. */
  required: boolean;
  /** Non-empty for SELECT, empty for everything else. The schema enforces both directions. */
  options: readonly ObjectAttributeOptionDto[];
}

/** What an attribute may hold on the wire and in the database. */
export type ObjectAttributeValue = string | number | boolean;

/**
 * A validation failure, in the shape the API already speaks.
 *
 * `field` is a dotted path because that is what `validate.middleware.ts` produces from a
 * `ZodError` and what the web forms already key their error map on, so an issue raised here
 * lands under the right input with no translation on either side.
 */
export interface AttributeIssue {
  field: string;
  message: string;
}

/** The error-map key for an attribute, spelled in exactly one place. */
export function attributeFieldPath(key: string): string {
  return `attributeValues.${key}`;
}

/**
 * Whether a value counts as answered.
 *
 * `false` IS AN ANSWER. A required BOOLEAN attribute answered "Үгүй" is complete, and
 * treating falsiness as absence would make it impossible to record a no. Only `undefined`,
 * `null` and the empty string are absences.
 */
export function isAttributeFilled(value: unknown): value is ObjectAttributeValue {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return typeof value === 'number' || typeof value === 'boolean';
}

function optionLabels(def: ObjectTypeAttributeDto): string {
  return def.options.map((option) => option.label).join(', ');
}

/**
 * Checks a set of attribute values against the definitions their type carries.
 *
 * THE ONE IMPLEMENTATION OF THE RULE, called from the web forms before submit and from the
 * service before write. The rule cannot live in a zod schema because it depends on
 * definitions read from the database, so it is a function instead — the same reason and the
 * same shape as `rejectFloorlessPosition` in `schemas/object-master.schema.ts`. The frontend
 * call is a courtesy so a user is told before the round trip; the backend never trusts that
 * it happened.
 *
 * AN UNDECLARED KEY IS REFUSED, NOT DROPPED. A payload naming an attribute the type does not
 * declare is a stale form or a wrong one, and quietly discarding it would store an object the
 * user believes carries a value it does not. This is the same choice the strict discriminated
 * union makes about a stray section 4.2 block.
 *
 * Returns every failure rather than the first, so a form fills in all its messages at once.
 */
export function validateAttributeValues(
  defs: readonly ObjectTypeAttributeDto[],
  values: Readonly<Record<string, unknown>>,
): AttributeIssue[] {
  const issues: AttributeIssue[] = [];
  const declared = new Set(defs.map((def) => def.key));

  for (const key of Object.keys(values)) {
    if (declared.has(key)) continue;
    issues.push({
      field: attributeFieldPath(key),
      message: `"${key}" үзүүлэлт энэ төрөлд тодорхойлогдоогүй байна.`,
    });
  }

  for (const def of defs) {
    const value = values[def.key];

    if (!isAttributeFilled(value)) {
      if (def.required) {
        issues.push({
          field: attributeFieldPath(def.key),
          message: `"${def.label}" заавал бөглөнө.`,
        });
      }
      continue;
    }

    switch (def.type) {
      case 'SELECT':
        if (typeof value !== 'string' || !def.options.some((option) => option.value === value)) {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}"-д ${optionLabels(def)} гэсэн сонголтын аль нэгийг сонгоно.`,
          });
        }
        break;

      case 'TEXT':
        if (typeof value !== 'string') {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}" бичвэр байна.`,
          });
        } else if (value.trim().length > MAX_ATTRIBUTE_TEXT_LENGTH) {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}" ${MAX_ATTRIBUTE_TEXT_LENGTH} тэмдэгтээс урт байж болохгүй.`,
          });
        }
        break;

      case 'NUMBER':
        // `isAttributeFilled` has already refused a blank, so a non-number here is a client
        // that sent the raw text of its input box rather than parsing it.
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}" тоо байна.`,
          });
        } else if (Math.abs(value) > MAX_ATTRIBUTE_NUMBER) {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}" хэт том утга байна.`,
          });
        }
        break;

      case 'BOOLEAN':
        if (typeof value !== 'boolean') {
          issues.push({
            field: attributeFieldPath(def.key),
            message: `"${def.label}" тийм эсвэл үгүй байна.`,
          });
        }
        break;
    }
  }

  return issues;
}

/**
 * The values as they should be stored, given what is already stored and what was sent.
 *
 * Two rules, and the second is the whole reason this is not a plain object spread:
 *
 *   - A DECLARED ATTRIBUTE IS FULLY CONTROLLED BY THE PAYLOAD. Sending it sets it; leaving it
 *     blank clears it. Merging instead would make "clear this field" inexpressible, because
 *     an absent key and a cleared one look identical on the wire.
 *
 *   - AN UNDECLARED KEY ALREADY IN STORAGE IS KEPT UNTOUCHED. When an administrator removes an
 *     attribute from the type, the values recorded against it stay on their objects: they were
 *     entered by somebody who was there, the definition may well come back, and re-adding it
 *     then restores what was recorded rather than presenting an empty field. Editing an
 *     unrelated part of the object must not be what silently destroys them.
 *
 * That second rule is also what makes it safe for two different forms to write this bag: the
 * assessment drawer knows only about the definitions in force today, and anything it has
 * never heard of survives it.
 *
 * Call it with an empty `stored` on create, where there is nothing to preserve.
 *
 * Assumes `validateAttributeValues` has already passed — it rejects undeclared keys in the
 * *payload*, which is why the only undeclared keys this can meet come from storage.
 */
export function mergeAttributeValues(
  defs: readonly ObjectTypeAttributeDto[],
  stored: Readonly<Record<string, unknown>>,
  incoming: Readonly<Record<string, unknown>>,
): Record<string, ObjectAttributeValue> {
  const declared = new Set(defs.map((def) => def.key));
  const next: Record<string, ObjectAttributeValue> = {};

  for (const [key, value] of Object.entries(stored)) {
    if (declared.has(key)) continue;
    if (isAttributeFilled(value)) next[key] = value;
  }

  for (const def of defs) {
    const value = incoming[def.key];
    if (!isAttributeFilled(value)) continue;
    next[def.key] = typeof value === 'string' ? value.trim() : value;
  }

  return next;
}

/**
 * How an attribute reads on a screen, or null when it has no value.
 *
 * Null rather than a dash or an empty string so the caller decides how an unanswered
 * attribute looks — one screen says "Бөглөөгүй", a table cell says nothing at all.
 */
export function formatAttributeValue(
  def: ObjectTypeAttributeDto,
  value: unknown,
): string | null {
  if (!isAttributeFilled(value)) return null;

  switch (def.type) {
    case 'SELECT': {
      const option = def.options.find((candidate) => candidate.value === value);
      // Falls back to the raw value rather than hiding it: a value whose option was deleted
      // is still what was recorded, and showing the key beats showing nothing.
      return option?.label ?? String(value);
    }
    case 'BOOLEAN':
      return value === true ? 'Тийм' : 'Үгүй';
    default:
      return String(value);
  }
}

/**
 * The declared attributes an object has not answered.
 *
 * Read-time only, and never an error: enforcement happens on write, so every object created
 * before an attribute existed is legitimately incomplete against it. This is what lets a
 * screen mark the gap without anything having gone wrong.
 */
export function missingRequiredAttributes(
  defs: readonly ObjectTypeAttributeDto[],
  values: Readonly<Record<string, unknown>>,
): ObjectTypeAttributeDto[] {
  return defs.filter((def) => def.required && !isAttributeFilled(values[def.key]));
}
