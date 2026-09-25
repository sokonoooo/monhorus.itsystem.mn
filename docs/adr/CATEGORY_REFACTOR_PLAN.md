# Category → Object Type → Asset — implementation plan

**Status:** proposed, awaiting decisions in §12. No code written **for the category work**.

> **One decision has since been taken and shipped: §12 Q3, answered "per-type".**
>
> An object TYPE now carries its own `attributes: FieldDef[]`, and an object carries the
> matching `attributeValues`. See `packages/shared/src/constants/object-type-attribute.ts` for
> the rules and `apps/web/src/features/object-master/ObjectTypeAttributesEditor.tsx` for the
> admin editor.
>
> **It changes nothing else in this document.** `OBJECT_CATEGORIES` is still a fixed tuple,
> the discriminated union in `schemas/object-master.schema.ts` is intact, the three section 4.2
> blocks are untouched, and no backend code reads an attribute — so the whole of §5 and the
> §10.1 golden fixture still apply unchanged when the category work is picked up.
**Supersedes the sequencing in:** `docs/adr/ASSET_MODEL_FLEXIBILITY.md` §9–§12.
**Keeps from it:** the candidate analysis (§6–§8) and the recommendation of Candidate C.

The ADR asked *which shape*. This asks *how to get there without breaking the running
system*. Read the ADR's §8 first if you want the reasoning behind the target; this document
assumes it.

---

## 0. What changed since the ADR was written

The ADR was measured against the codebase as it stood before the icon upload, quick-place
and per-floor-naming work. Five facts moved, and three of them change the plan.

| | ADR said | Actually now | Effect on the plan |
|---|---|---|---|
| Objects | 35 | **140** (128 EQUIPMENT, 7 PANEL, 5 CIRCUIT) | Migration still small. No change. |
| Object types | 8 | **9** | None. |
| Relationship edges | 19 | **19** (5 `circuit.panel`, 13 `equipment.circuit`, 1 `equipment.panel`, 0 start/end) | Connections migration is genuinely tiny. |
| Audit rows carrying a frozen `category` literal | not counted | **137** | **New constraint — see §6.4.** |
| Inspection flow | listed as a *capability* | **provably generic already** | **Removes an axis from §3.** |

Two corrections to the ADR's design, both from evidence rather than preference:

**Inspection is not a capability.** `IObjectAssessment` carries score, risk level, assessor,
photos, conclusion, recommendation, action taken, repair/revisit flags and source — none of
it electrical. `appendAssessmentHistory` is the single writer for all four producers. Risk
bands are a configurable setting. `rollup.service.ts` is purely floor-and-score shaped. All
nine report types and the 17-column inspection CSV contain **zero** electrical columns.

Exactly five things intrude electrically on that generic flow:
1. `IObjectAssessment.measuredLoadKw` (`object-master.models.ts:376`)
2. `IObjectAssessment.measurements` — the `ILoadMeasurement[]` (`:378`)
3. `ReportItem.measuredLoadKw` (`report-record/report-record.model.ts:179`)
4. `recordAssessment` writing `object.measuredLoadKw` (`object-master.service.ts:1650`)
5. The `MEASUREMENT` timeline kind (`object-master.service.ts:1850`)

A plumbing valve inspected today would work end to end, leaving those five null or empty.
So inspection stays a **base feature of every asset**, gated as it already is by the
per-type `generatesConclusion` flag. What becomes a capability is only the *electrical
measurement block inside* an assessment.

**The three attribute sub-documents are the real electrical boundary**, together with
`measuredLoadKw`, the measurement list, and `ObjectCategory` itself. Everything else on
`IObject` — code, name, type, customer, floor, plan position, status, description, notes,
photos, latest assessment, audit, timeline, icons, quick-place — is already asset-generic.

---

## 1. Database / schema changes

### 1.1 New collection: `categories`

```
{
  _id, code, name, description,
  capabilities: string[],        // from the backend-owned registry, §3
  fieldDefs: FieldDef[],         // Tier 2, §4.2
  icon, colour,                  // display, mirrors ObjectType.icon
  isProtected: boolean,          // true for the three seeds
  isActive: boolean,
  createdBy, createdAt, updatedAt
}
```

**`code` is the join key, not `_id`.** `IObjectType.category` and `IObject.category` stay
**string code** fields, not `ObjectId` references. This is the single most important
schema decision in the plan, and it buys four things:

- Every existing index keeps working unchanged: `objecttypes.{category,isActive,name}`,
  `objects.{floor,category,code}`, `objects.{customer,floor,category}`, and the two plain
  `category_1` indexes.
- Every wire value stays the literal `PANEL` / `CIRCUIT` / `EQUIPMENT`, so **both Flutter
  apps keep parsing successfully with no release**.
- The 137 frozen audit literals remain joinable to a live category row (§6.4).
- No `populate` is added to the hottest read path in the system (`toObjectListItemDto`
  already runs per row).

The cost is that a category code can never be renamed. That is the right trade — see §12 Q4.

Indexes: `{code: 1}` unique, `{isActive: 1, name: 1}`.

### 1.2 Changes to `objecttypes`

- `category`: drop the `enum: OBJECT_CATEGORIES` constraint (`object-master.models.ts:66`),
  keep `type: String, required, index`. Validation moves to the service, which checks the
  code exists in `categories` and is active.
- Add `fieldDefs: FieldDef[]` **only if** §12 Q3 says custom fields are per-type as well as
  per-category.

`updateObjectTypeSchema` already forbids changing a type's category — that rule survives and
becomes more important, not less.

### 1.3 Changes to `objects`

- `category`: same enum-drop as above.
- Add `attributes: Mixed` — the sparse bag, default `{}`.
- Add `connections: [{ role: String, target: ObjectId }]`, index
  `{'connections.target': 1, 'connections.role': 1}`.
- **Keep** `panel` / `circuit` / `equipment` and the five reference fields throughout the
  dual-write window (§6.3). They are dropped only in the final phase, and only under §12 Q5.

### 1.4 Sort-order regression to fix deliberately

`object-type.service.ts:126` sorts the registry by `{category: 1, name: 1}`. Today that
yields `CIRCUIT < EQUIPMENT < PANEL` by string luck. Once categories are user-created the
order becomes arbitrary. Add an explicit `sortOrder: number` to the category document and
sort on that, or the admin list silently reshuffles on the day of migration.

---

## 2. Category and Object Type management

### 2.1 Ownership

Categories are **global**, matching object types, which have no `customer` field today. A
per-customer category would introduce a new tenant-isolation boundary that rules 16.2/17.2
do not currently contemplate at this level, and it would fork the capability registry per
tenant. See §12 Q2 — this needs your decision, and it is cheaper to decide now than later.

Permission: reuse `object_type.manage`, or add `category.manage`. Recommend a new key,
because "may edit the shared vocabulary of the whole system" is a bigger grant than "may add
an equipment type". **Note the RBAC trap:** `seedRbac` is prune-only for non-SYSTEM_ADMIN
system roles, so a new permission key never reaches existing role documents. It requires
`npm run migrate:system-role-permissions -- --apply` — which has still not been run for the
previous batch.

### 2.2 Guard rails

- A category in use (any type or object references its code) cannot be deleted — mirror the
  existing type-delete guard, which tells the user to deactivate instead.
- A protected category (`isProtected: true`) cannot be deleted at all, and its **code** can
  never change. Its display name, description, icon, colour, `fieldDefs` and — subject to
  §12 Q1 — its capability set remain editable.
- A capability cannot be removed from a category while an object of that category holds a
  connection or a Tier-1 field that the capability owns. Otherwise a load figure silently
  becomes unreachable.

### 2.3 Object types

Unchanged in shape. A type belongs to exactly one category by code, its category is
immutable after creation, and it keeps `showOnPlan`, `insidePanel`, `generatesConclusion`,
`icon` and the custom SVG `iconFile`. Custom names and icons are already delivered.

---

## 3. Capability model

A capability is **backend-owned**: a named constant with typed behaviour attached. Admins
choose which capabilities a category has; they cannot invent one, because a capability is
code. This is what stops an administrator from breaking load arithmetic with a text field.

### 3.1 The registry

Derived from what the code actually branches on — not invented:

| Capability | Meaning | Owns (Tier 1) | Replaces the branch at |
|---|---|---|---|
| `LOAD_SOURCE` | Supplies power; has a capacity | `capacityKw` | `load.service.ts:101-120`, `capacityOf:125` |
| `LOAD_CONDUCTOR` | Carries power; has a permitted capacity | `permittedCapacityKw` | `load.service.ts:89-98`, `capacityOf:126` |
| `LOAD_CONSUMER` | Draws power | `ratedPowerKw`, `quantity`, `usageCoefficient` | `load.service.ts:87`, `equipmentLoad:50` |
| `ELECTRICAL_MEASUREMENT` | Assessments may carry `ILoadMeasurement[]` and `measuredLoadKw` | — | the 5 intrusions listed in §0 |
| `PLAN_PLACEABLE` | May be pinned to a floor plan | — | already exists as per-type `showOnPlan` |

`PANEL` → `LOAD_SOURCE` + `ELECTRICAL_MEASUREMENT`.
`CIRCUIT` → `LOAD_CONDUCTOR` + `ELECTRICAL_MEASUREMENT`.
`EQUIPMENT` → `LOAD_CONSUMER` + `ELECTRICAL_MEASUREMENT`.

There is **no `INSPECTION` capability** — see §0. Every asset can be inspected.

### 3.2 Connection roles

```
connections: [{ role, target }]
role ∈ SUPPLIED_BY | MOUNTED_IN | STARTS_AT | ENDS_AT
```

| Legacy field | Role | Target must have |
|---|---|---|
| `equipment.circuit` | `SUPPLIED_BY` | `LOAD_CONDUCTOR` |
| `circuit.panel` | `SUPPLIED_BY` | `LOAD_SOURCE` |
| `equipment.panel` | `MOUNTED_IN` | `LOAD_SOURCE` |
| `circuit.startPointObject` | `STARTS_AT` | `LOAD_SOURCE` |
| `circuit.endPointObject` | `ENDS_AT` | `LOAD_CONSUMER` |

The five hardcoded category literals in `assertRelatedObject` become capability assertions.

**The rule that must not be lost:** load reaches a device only through `SUPPLIED_BY`, never
through `MOUNTED_IN`. Today that is 16 lines of comment at `load.service.ts:68-84` plus a
test. In the new model it becomes structural — `MOUNTED_IN` is simply not a role the load
walk traverses — which is a genuine improvement in expressiveness, not just a port.

### 3.3 Aggregate arithmetic is the open risk

The registry above hardcodes a kW formula. If Plumbing needs flow-rate rollups or HVAC needs
airflow, `equipmentLoadKw` must become a named, unit-carrying formula selected by the
capability. That is materially more work than this plan sizes. **This is §12 Q1 and it is
the highest-leverage question in the document.**

---

## 4. Asset model

### 4.1 Tier 1 — capability fields

Contributed by a capability, typed in TypeScript, **not renameable or deletable by an
admin**. Exactly the four keys backend code reads: `capacityKw`, `permittedCapacityKw`,
`ratedPowerKw`, `quantity`, `usageCoefficient`.

### 4.2 Tier 2 — custom fields

A `FieldDef[]` on the category for everything the backend does *not* reason about:

```
FieldDef = { key, label, type: TEXT|NUMBER|BOOLEAN|DATE|SELECT,
             options?, required, unit?, group?, sortOrder }
```

Note which side of the line the existing electrical fields fall on: `location`,
`protection`, `breakerRating`, `cableType`, `cableSectionMm2`, `cableLengthM`, `installedAt`,
`warrantyUntil` are all **Tier 2**, because no backend code reads them. That is the test of
whether the split is drawn correctly, and it passes.

Both tiers store into one `attributes` bag. The tier distinction lives in the definitions,
not in the document.

### 4.3 The validation contract changes shape

`createObjectSchema` is a `z.discriminatedUnion('category', […])` with `.strict()` on every
branch. It cannot survive user-created categories: a payload whose category has no branch
fails discriminator resolution *before any field is examined*, producing
`invalid_union_discriminator` rather than field errors.

It is replaced by: parse the generic envelope with zod, resolve the category, then validate
`attributes` against Tier 1 + Tier 2 definitions at runtime. **This converts a compile-time
guarantee into a runtime check** — the single biggest loss in the whole plan, and the reason
§10 insists on a contract test per field type.

---

## 5. Electrical backward compatibility

The bar: **all 140 objects' load figures byte-identical before and after.** Not "equivalent" —
identical, asserted by a golden fixture captured before any code changes (§10.1).

| Behaviour | Today | After | Risk |
|---|---|---|---|
| Equipment load = rated × qty × coefficient | `constants:169` | unchanged arithmetic | none |
| Circuit = Σ its equipment | `load.service.ts:89` | `SUPPLIED_BY` traversal | **high** |
| Panel = Σ circuits' equipment (2 hops) | `:101` | same walk, capability predicate | **high** |
| Mount edge carries no load | `:68-84` + test | structural (§3.2) | medium |
| Capacity per category | `capacityOf:124` | Tier-1 key per capability | medium |
| Incomplete poisons the sum | `sumLoads:189` | unchanged | none |
| Decommissioned = 0 and *complete* | `countsTowardLoad:49` | unchanged | none |
| Floor total = Σ panels only | `:185` | Σ `LOAD_SOURCE` | medium |
| Unattached = no circuit and no mount | `:199` | no `SUPPLIED_BY` and no `MOUNTED_IN` | low |
| Delete blockers | `:476`, 6 rules | one `connections.target` query + assessments + service request | **improves** — catches roles added later |
| Same-building soft check | `:328` | verbatim unchanged | none |
| Diagram edges | `project-graph:252` | already presence-based, not category-based | low |

Two latent defects to decide on rather than silently carry across:

- **`MISSING_PERMITTED_CAPACITY` is dead.** Declared, labelled in Mongolian, mirrored into
  both Flutter enums — and emitted by nothing. A circuit missing its permitted capacity gets
  `MISSING_CAPACITY` instead. Either wire it up or delete it; do not port it as-is.
- **The `ServiceRequest.device` delete blocker can never fire.** It compares an
  `ObjectRecord` id against a field declared `ref: 'ObjectNode'`
  (`service-request.model.ts:129`) — two different id spaces. It has never blocked anything.

---

## 6. Migration strategy

### 6.1 Shape

Idempotent, resumable, `--dry-run` by default with an explicit `--apply`, following the
existing `backfill-*.ts` precedents. One transaction per object. **Requires a replica set** —
the dev box runs standalone `mongod`, so this must be arranged before Phase 2.

### 6.2 Steps

1. **Seed three categories** from the constants, `isProtected: true`, codes unchanged,
   capabilities per §3.1, `fieldDefs` populated with the eight Tier-2 electrical fields.
2. **Object types** — no writes. All 9 rows keep their category string.
3. **Objects (140)** — for each, copy the non-null block's scalars into `attributes` under
   the same key names (no renaming; keys are already unique across the three blocks), drop
   nulls so the bag stays sparse, and translate the five reference fields into `connections`
   entries. Only **19 objects** have any edge, so this is 19 rows of real work.
4. **Verify** — recompute every load figure and diff against the golden fixture. Any
   difference aborts the run.

### 6.3 The dual-write window

Phases 2–3 write both the legacy blocks and the new shape. This is the riskiest period in
the plan and it is a *process* risk, not a code risk: a path that updates one and not the
other is invisible until the legacy fields are dropped. Mitigate with a **consistency
assertion in the test suite** that fails when the two representations disagree — not a
comment, not a code review convention.

### 6.4 What cannot be migrated

**137 audit documents carry frozen `category` literals** in `newValue`/`oldValue`, written by
five call sites. The audit log is append-only and immutable by policy, so these can never be
rewritten. Any audit reader must therefore tolerate a legacy literal alongside whatever
replaces it, **permanently**. This is not a migration step; it is a constraint on every
future reader, and it should be stated in the audit module's own documentation.

Also outside the DB: three browser-localStorage column-preference keys
(`object-child-circuits`, `object-child-equipment`, `object-panel-equipment` at
`ObjectDetailPage.tsx:199-201`) are category-shaped identifiers that no migration reaches.
They degrade harmlessly to default column layouts.

### 6.5 Grep hazard

**Three separate enums contain the string `PANEL`:** the object category,
`OBJECT_NODE_KINDS` on the location tree (`object.types.ts:11`, where the third member is
`DEVICE`, not `EQUIPMENT`), and `DIAGRAM_ASSET_KINDS` (`constants/diagram.ts:12`). A
repo-wide find-and-replace corrupts two of them. `MATERIAL_CATEGORIES` is a fourth,
unrelated `category` field.

---

## 7. Backend / API changes

**New:** `GET/POST/PATCH/DELETE /api/v1/categories`, `GET /api/v1/capabilities` (the
read-only registry, so the web can render the picker without hardcoding it).

**Changed:**
- `createObjectSchema` — discriminated union → envelope + runtime attribute validation (§4.3).
- `objectListQuerySchema.category`, `objectTypeListQuerySchema.category` — drop the enum,
  accept any active code.
- `assertRelatedObject` — category literal parameter becomes a capability.
- `deleteBlockersOf` — three category-gated counts collapse to one `connections.target` query.
- `load.service.ts` — every `category ===` becomes a capability predicate.
- `suggestObjectCode` — anchored on `category: 'PANEL'`; becomes anchored on `LOAD_SOURCE`.
- `quickPlaceObject` — its three-way branch currently has an `else` that silently treats an
  unknown category as EQUIPMENT. Must become explicit.
- `updateObject` — its three `if (object.category === X && input.X)` guards currently
  **silently drop** attributes for an unmatched category and return 200. Must error.
- `project-graph.service.ts` — `CATEGORY_TO_KIND` needs an explicit fallback; today an
  unmapped value yields `assetKind: undefined` and draws nothing.

**DTO additions (all additive, no removals until the final phase):** `attributes`,
`connections`, `fieldDefs`, and the category object alongside the existing `category` string.

**API versioning reality:** there is none beyond the `/api/v1` path mount. No content
negotiation, no deprecation mechanism, no client-version adaptation. `X-Client-Version` is
allow-listed in CORS and read by nothing. So every change here is simultaneous for all three
clients, which is why the legacy fields stay for the whole sequence.

---

## 8. Web changes

| Area | Work |
|---|---|
| Category admin | New CRUD page: capabilities picker, `FieldDef[]` editor, icon/colour. The `FieldDef` editor is the largest single new component. |
| `ObjectFormPage.tsx` (1,135 lines) | Rewrite the attribute half as a definition-driven renderer. Must reproduce: 16 hand-rolled `useState`s, per-category code suggestion, two hardcoded picker queries, dotted field-error keys, and the collapse-on-error logic just added. |
| `ObjectDetailPage.tsx` | Attribute card becomes definition-driven; three hardcoded section headers become role-driven. |
| `ObjectBadges.tsx` | `CATEGORY_STYLES` is an exhaustive `Record` — needs a fallback and a colour from the category document. |
| `ObjectTypesPage.tsx` | Category select fed from the API; unchecked `as ObjectCategory` cast from the URL must be validated. |
| `FloorObjectPicker.tsx`, `FloorDetailPage.tsx` | Category filter and badge from the API. |
| `AssetNode.tsx` | `switch (kind)` needs a default glyph. |
| `FloorDetailPage.tsx:507` | `panelCount`/`circuitCount`/`equipmentCount` are three named `<dd>`s — become a per-category list. |

**Every exhaustive `Record<ObjectCategory, …>` in the web app stops being a compile-time
guarantee the moment the union opens up.** There are four. Missing one is a runtime
`undefined`, and one of them (`ELECTRICAL_ERROR_PREFIXES`) would throw
`key.startsWith(undefined)` during render.

---

## 9. Mobile impact

**The good news is unusually good.** Neither app caches object data — no sqlite, hive or
shared_preferences, only tokens in secure storage. Every launch refetches. There is no stale
cache problem at all. Neither app has a category filter, tab, sort control or form; both are
label-only and read-only on objects (the one write is the employee assessment POST).

**Unknown categories degrade softly, not fatally.** Every `fromWire` is a linear scan
returning `null` on a miss. A new `PLUMBING` category renders as `'—'`, a new icon key as a
generic grey box. Nothing throws, nothing drops a record.

**But there is no way to retire an old client.** The backend URL *including* `/api/v1` is
baked in at compile time via `String.fromEnvironment`; neither app reads or sends its own
version; both sit at `0.1.0+1`; there is no forced-update check, minimum-version gate or kill
switch. A shipped handset degrades quietly forever with nothing signalling staleness. **This
is why §12 Q5 cannot be answered with a date.**

**Three real hazards, none about categories:**
1. Every `fromJson` does an unguarded `json['id'] as String`. If the asset reshape ever
   renames or nests the identifier, every factory throws — and `parseList` has no per-item
   guard, so one bad row takes down a whole screen, not one row.
2. The customer app's `parseInt`/`parseDouble` (`json_utils.dart:12-14`) are bare casts.
   Any numeric field that becomes a string or a `{value, unit}` object throws. The employee
   app's equivalents are `is num` guarded. **The two apps are not equally tolerant.**
3. The customer app renders the load block **unconditionally**. A non-electrical asset would
   show six meaningless electrical readouts presented as real. The employee app guards and
   collapses correctly. This must be fixed in the customer app *before* the first
   non-electrical category ships, and it is a small, independent change that can be done now.

Recommended mobile work, in order: fix (3), then (2), then (1). All three are worth doing
regardless of this refactor.

---

## 10. Testing strategy

### 10.1 The golden fixture — build this first, before any code

Capture every load figure for all 140 objects and every floor summary, as JSON committed to
the repo. Every phase asserts byte-identical output against it. This is the single highest-
value artefact in the plan: `calculatedLoadOf` is 36 lines guarded by 24 lines of comment
explaining a rule that took real thought to get right, and every regression lands there.

### 10.2 Migration tests

Run the migration against a copy of the dev data, assert: 140 objects have `attributes`,
19 have `connections` totalling 19 edges, no object lost a field, load figures unchanged,
and the script is idempotent (running twice changes nothing).

### 10.3 Dual-write consistency

An assertion that fails when the legacy blocks and the new shape disagree — running in the
suite, not left to review.

### 10.4 Contract tests per field type

Because §4.3 converts a compile-time guarantee into a runtime check, each `FieldDef` type
needs explicit coverage for accept, reject, and the error-path shape the web form keys on.

### 10.5 Capability tests

A category with no load capability produces no load figures and no `MISSING_*` reasons; a
connection to a target lacking the required capability is refused; a capability cannot be
removed while in use.

### 10.6 Existing surface

**~150 assertions across 23 files** will need updating. The heaviest: `object-master.api.test.ts`
(98 hits, 2,539 lines), `ObjectFormPage.test.tsx` (13), `quick-place.api.test.ts` (7),
`ObjectDetailPage.test.tsx` (7), plus `apps/web/src/test/fixtures.ts` (one edit, wide blast
radius) and three Dart test files.

Current baselines to hold: **backend 1059, web 561, mobile 110, mobile-employee 183.**

---

## 11. Phases and effort

Engineer-days, for someone already familiar with this codebase, tests included.

| Phase | Scope | Ships alone | Client impact | Est. |
|---|---|---|---|---|
| **0** | Golden fixture (§10.1). Fix the customer app's unconditional load block (§9.3). | Yes | Mobile fix only | **2** |
| **1** | `categories` collection, seeded, read-only in the UI. Enum constraints dropped. `OBJECT_CATEGORIES` becomes a cached read. Every exhaustive `Record` gains a fallback. | Yes | None | **4** |
| **2** | Capability registry. Load, `assertRelatedObject`, `deleteBlockersOf`, graph re-expressed as capability queries. Golden fixture must be byte-identical. | Yes | None | **6** |
| **3** | `connections` array, dual-written. Read path switches. Delete blockers collapse to one query. | Yes | None | **6** |
| **4** | `FieldDef[]` + `attributes`, dual-written. Tier 1 locked. Discriminated union replaced. | No — needs 5 | Additive | **9** |
| **5** | Web: category admin CRUD, definition-driven form and detail renderers. | No — needs 4 | Web only | **7** |
| **6** | First non-electrical category end to end. **Recommend Security** — icons exist, needs no arithmetic. | Yes | Web only | **2.5** |
| **7** | Drop legacy blocks, five reference fields, three DTO interfaces. Update both Flutter apps. | **Only per §12 Q5** | Both apps | **7** |

**Total ≈ 43.5 days.** Phases 0–3 (**18 days**) are invisible to every client and can be
stopped at any point without leaving the system half-migrated.

**Phases 4 and 5 must land together** — a field definition with no renderer is invisible; a
generic renderer with no definitions is an empty form.

**Phase 6 is the acceptance test of the whole design.** If shipping Security requires
touching backend code, the capability registry is wrong and Phases 2–5 need revisiting
before Plumbing — which, per §12 Q1, may need arithmetic.

Two sequencing notes: `mongod` must be a replica set before Phase 3, and
`migrate:system-role-permissions -- --apply` must be run before any new permission key
reaches a live role.

---

## 12. Decisions that require your approval

Ordered by how much they change the plan.

**Q1 — Does any non-electrical category need its own aggregate arithmetic?**
Plumbing has flow rate; HVAC has airflow. If yes, the load capability cannot stay a hardcoded
kW formula — it becomes a named, unit-carrying formula selected by the capability, and Phase 2
grows materially. If the answer is "electrical is the only discipline with arithmetic; the
rest are inspect-and-record", the plan stands as sized. **Highest leverage question here.**

**Q2 — Can one asset belong to two categories?**
A pump is an electrical consumer *and* a plumbing device. `IObject.category` is single-valued
today. If an asset needs two, capabilities must attach to the **object** rather than to its
category, and Tier 1 becomes a union of several capabilities' contracts. Must be answered
before Phase 2, not after.

**Q3 — Are custom fields per-category, per-type, or both?** — **ANSWERED: per-type. Shipped.**
Your brief says "each category can have its own capabilities and properties", but the existing
flags are split across both levels — `insidePanel` and `generatesConclusion` are per *type*
while the attribute blocks are per *category*. Concretely: does `MCB` need a field that a
generic `EQUIPMENT` does not? If yes, `FieldDef[]` lives on both levels and merges, roughly
doubling Phase 4's validation work.

It does. `MCB` needs a Хайлмал that a generic `EQUIPMENT` has no use for, so definitions live
on the TYPE and are implemented there: `ObjectType.attributes` with `SELECT`/`TEXT`/`NUMBER`/
`BOOLEAN`, ordered by array position, validated on both ends by one shared function, values
stored in `Object.attributeValues`.

Deliberately narrow, and the edges are worth knowing before extending it:

- **Asked on the Үнэлгээ бүртгэх form**, which is where somebody is standing in front of the
  equipment and can look, and on the registration form when equipment is first recorded. Both
  write to `Object.attributeValues` — these are facts about the kit, true between visits, so no
  copy is kept per assessment. `POST /objects-master/:id/assessments` therefore accepts
  `attributeValues` and applies them to the object, the same route `measuredLoadKw` already
  took. The equipment DETAIL page deliberately does not show them.
- **Enforced on write, never on read.** Objects registered before a definition existed stay
  valid and readable; the requirement bites the next time a human creates, edits or reports on
  one. That is why it needed no migration and no backfill.
- **Absent means "not asked", never "the answer is nothing".** A payload omitting
  `attributeValues` enforces nothing and clears nothing — which is the whole reason the employee
  mobile app needed no change and no release.
- **Removing a definition does not erase its values.** They stay on the objects and reappear if
  the definition does — see `mergeAttributeValues`. This is also what makes it safe for two
  different forms to write the same bag.
- **Quick-place is exempt** and writes an empty bag, because a tap on a plan has no form to
  carry an answer.

Still open: whether a CATEGORY should carry definitions too. If it should, the two lists merge
and the doubling above applies to the category half.

Removed in the same change: the "Бусад хэмжилт (А, В)" per-phase amps/volts editor, from the
web assessment drawer and the employee app's assessment sheet together. `ILoadMeasurement`,
`ObjectAssessmentDto.measurements` and the API that accepts them are untouched — the assessment
collection is append-only, readings already recorded still display, and nothing was migrated.
This does not resolve §5's note that `MISSING_PERMITTED_CAPACITY` is dead.

**Q4 — Confirm: category codes frozen, names editable, deletion refused while in use.**
Renaming a display name is safe. Changing a *code* is not — it is the join key for 137
immutable audit rows and both Flutter apps' `fromWire`. Recommend: name editable, code
permanently frozen, deletion refused while any type or object references it, the three seeds
undeletable.

**Q5 — When may the legacy attribute blocks be dropped (Phase 7)?**
There is no mechanism to detect, warn, or block a stale mobile client, and the API URL is
compile-time baked. So "after mobile has rolled" has no observable completion. Options:
(a) never — carry both forever, every future writer updates two places; (b) pick a calendar
date and accept that handsets which have not updated lose the attribute display; (c) build
version signalling first (`X-Client-Version` is already allow-listed in CORS and read by
nothing) and gate the drop on telemetry. Recommend (c), sized separately.

**Q6 — Are categories global or per-customer?**
Global matches object types today and keeps the capability registry single. Per-customer
introduces a tenant-isolation boundary the current rules do not contemplate at this level.
Recommend global.

**Q7 — Fix the `generatesConclusion` asymmetry now?**
`recordAssessment` refuses a manual assessment on a type flagged `generatesConclusion: false`,
while `applyReportToEquipment` writes one anyway from the planned-work and service-request
paths. All 9 live types are currently `true`, so fixing it today changes no observable
behaviour — which makes now the cheapest possible moment.

**Q8 — Three dead things: delete, fix, or carry?**
(a) `insidePanel` — stored, editable in the UI, read by **zero** behavioural code.
(b) `MISSING_PERMITTED_CAPACITY` — declared, labelled, mirrored into both Flutter apps, emitted by nothing.
(c) The `ServiceRequest.device` delete blocker — compares an `ObjectRecord` id to an `ObjectNode` reference, so it can never fire.
Each is cheap to resolve now and becomes a permanent fixture if carried through the refactor.

**Q9 — `showOnPlan` is not enforced server-side.**
`quickPlaceObject` and `updateObjectPosition` will happily store a `planPosition` on a type
whose registry entry says it does not belong on a plan; the three clients then refuse to draw
it. Enforce server-side as part of this work, or leave as a client-only convention?
