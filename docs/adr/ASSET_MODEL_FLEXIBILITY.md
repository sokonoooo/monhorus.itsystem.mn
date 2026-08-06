# Asset model flexibility - category, object type and attributes

Status: **Design only. Deferred by the product owner — nothing here is implemented.**
Written against the tree at commit `2e17308`.
Last updated: 2026-08-06

The brief, in the product owner's words:

> "I don't want the system to be limited to electrical assets only. The current PANEL →
> CIRCUIT → EQUIPMENT structure is too specific for future expansion. In the future we may
> need to manage plumbing, HVAC, security, IT, and other systems. I want a flexible category
> and object type management module. The structure should be: Category (user/admin defined) →
> Object Type (user/admin defined) → Asset/Equipment. Each category can have its own
> capabilities and properties. […] Electrical-specific logic should remain available, but it
> should not define the whole asset system."

Every fact below was read out of this repository or queried from the running
`monhorus_dev` database. Where something could not be settled from the source it is
recorded in section 12 as an open question rather than guessed.

---

## 1. The problem, stated in this codebase

The requested structure — **Category → Object Type → Asset** — already exists. One of its
two levels is already user-defined. The other is welded to the compiler.

`packages/shared/src/constants/object-master.ts:17`:

```ts
export const OBJECT_CATEGORIES = ['PANEL', 'CIRCUIT', 'EQUIPMENT'] as const;
```

The file's own header comment (`:9-13`) states the split precisely, and it is the whole
problem in four lines:

> ```
>   - CATEGORY is structural and fixed. It decides which section 4.2 fields exist at all,
>     and it drives the load formulas in section 11.5.
>   - TYPE is a row in the administrator-managed catalogue of section 4.1, for example
>     MCB or Гэрэл. It carries the plan icon and the "generates a conclusion" flag.
> ```

So `category` is **not a label**. It is a discriminator with three jobs:

1. **It selects which fields exist.** `packages/shared/src/schemas/object-master.schema.ts:182-209`
   is a `z.discriminatedUnion('category', …)` with `.strict()` on every branch. The comment
   at `:184-186` is explicit about the consequence:

   > *"a panel payload carrying an `equipment` block is rejected outright rather than having
   > the stray field quietly stripped"*

   A fourth category has no branch, so `POST /objects-master` rejects it before any service
   code runs.

2. **It selects which storage exists.** `apps/backend/src/modules/object-master/object-master.models.ts:165-167`:

   ```ts
   panel: IPanelAttributes | null;
   circuit: ICircuitAttributes | null;
   equipment: IEquipmentAttributes | null;
   ```

   Three typed Mongoose sub-documents (`:178-214`), three fixed field sets, and
   `category: { type: String, enum: OBJECT_CATEGORIES, … }` at `:246`. A plumbing valve has
   nowhere to record a diameter.

3. **It selects which arithmetic runs.** `load.service.ts:86-121` (`calculatedLoadOf`)
   branches on the literal three, and `capacityOf` (`:124-128`) returns `null` for anything
   that is not `PANEL` or `CIRCUIT`.

Meanwhile the level the product owner believes is fixed — **object type — is already fully
user-defined at runtime** (section 4). The gap between what exists and what was asked for
is therefore narrower than the brief assumes, but it sits exactly where the electrical
behaviour lives.

The literal strings `'PANEL'`, `'CIRCUIT'`, `'EQUIPMENT'` appear **133 times across 40
files** in `apps/` and `packages/` (`grep -o "'PANEL'"` and siblings). That number is the
honest size of the problem, and roughly half of it is test fixtures.

---

## 2. Everything that depends on the discriminator

This is the exhaustive list. It is shorter than the 133-occurrence count suggests, because
most occurrences are literals in tests and fixtures.

### 2.1 Load calculation — section 11.5

| Behaviour | Location | Coupling |
|---|---|---|
| Per-device formula Σ(чадал × тоо × коэффициент) | `packages/shared/src/constants/object-master.ts:152` `equipmentLoadKw` | Reads exactly three field names: `ratedPowerKw`, `quantity`, `usageCoefficient` |
| The panel → circuit → equipment walk | `apps/backend/src/modules/object-master/load.service.ts:86-121` `calculatedLoadOf` | Three-way branch on `object.category`; queries `{category:'EQUIPMENT','equipment.circuit':id}` (`:91-93`) and `{category:'CIRCUIT','circuit.panel':id}` (`:101-104`) |
| Which capacity the ratio is measured against | `load.service.ts:124-128` `capacityOf` | `PANEL → panel.capacityKw`, `CIRCUIT → circuit.permittedCapacityKw`, else `null` |
| Ачааллын хувь | `constants/object-master.ts:197` `loadPercent` | Category-agnostic itself; fed by `capacityOf`, which is not |
| Нөөц чадал | `constants/object-master.ts:208` `reserveKw` | Same |
| Зөрүү (calculated vs measured) | `constants/object-master.ts:222` `loadVarianceKw` | Category-agnostic; reads `measuredLoadKw`, which is a top-level field, not in a block |
| Floor roll-up | `load.service.ts:164-244` `floorLoadSummary` | Partitions by category at `:181-183`; sums **panel loads only** (`:185-186`); "unattached equipment" detection reads `equipment.circuit` and `equipment.panel` (`:199-201`) |

`calculatedLoadOf`'s doc comment (`:68-84`) records a rule that any redesign must not break:

> *"LOAD REACHES A DEVICE ONLY THROUGH ITS CIRCUIT. […] a device that names a panel and no
> circuit contributes NOTHING. A mount is a claim about location, never about consumption"*

### 2.2 Connection validation

| Function | Location | Coupling |
|---|---|---|
| `assertRelatedObject` | `object-master.service.ts:344-373` | Takes `expected: IObject['category']` and refuses on `related.category !== expected` (`:352`). Called with hardcoded literals: `'PANEL'` for `circuit.panelId` (`:724`), `'PANEL'` for `startPointObjectId` (`:733`), `'EQUIPMENT'` for `endPointObjectId` (`:742`), `'CIRCUIT'` for `equipment.circuitId` (`:759`), `'PANEL'` for `equipment.panelId` (`:776`); mirrored on the update path at `:875-923` |
| `assertSameBuilding` | `object-master.service.ts:317-333` | **Contains no category reference at all.** It compares two buildings. This is the one rule that survives any redesign untouched |
| `buildingOfFloor` | `object-master.service.ts:285-297` | Category-free |

The same-building rule's own comment (`:302-306`) is the reason it must be preserved
verbatim:

> *"a cable does not run between two towers. Without this a customer with twelve buildings
> could feed a second-floor socket from a panel across the site"*

### 2.3 Delete blockers

`object-master.service.ts:465-501` `deleteBlockersOf` — three of its five checks are
category-gated:

```ts
if (object.category === 'PANEL') {            // :473
  … countDocuments({ 'circuit.panel': object._id })     // :474
  … countDocuments({ 'equipment.panel': object._id })   // :480
}
if (object.category === 'CIRCUIT') {          // :484
  … countDocuments({ 'equipment.circuit': object._id }) // :485
}
```

The other two — assessment count (`:468`) and `ServiceRequest.device` (`:497`) — are
category-free.

### 2.4 Project graph / single-line diagram

`apps/backend/src/modules/diagram/project-graph.service.ts`:

```ts
const CATEGORY_TO_KIND: Record<ObjectCategory, DiagramAssetKind> = {  // :53-57
  PANEL: 'PANEL', CIRCUIT: 'BREAKER', EQUIPMENT: 'OTHER',
};
```

Consumed once, at `:187`. **The traversal itself is already category-agnostic**: every
object on a floor is emitted as a flat sibling at depth 2 (`:180-190`), and the electrical
edges are keyed off the reference fields, not the category (`:257`, `:262`, `:267`). Because
`CATEGORY_TO_KIND` is an exhaustive `Record<ObjectCategory, …>`, a fourth category is a
**compile error here** — which is a feature, not a defect.

### 2.5 Risk rollups

`apps/backend/src/modules/report-record/rollup.service.ts` — the string `category` does not
appear in the file. It matches on floor alone (`:43`), sorts worst-first and takes
`$first` (`:48-60`).

The consequence is worth writing down, because it is load-bearing for any redesign: a
`CIRCUIT` scoring 30 outranks its parent `PANEL` scoring 80 in deciding a floor's figure.
There is **no de-duplication along the electrical chain** — panel, circuit and lamp are
three equally-weighted rows. Adding a fourth category adds rows to that same flat set,
which is behaviourally correct and needs no change.

### 2.6 Assessment / inspection flow

| Component | Location | Coupling |
|---|---|---|
| `ReportItem` | `report-record.model.ts:166-201` | **Zero category awareness.** Carries `object`, `floor`, `score`, `riskLevel`, `observation`, `conclusion`, `measuredLoadKw`. Unique index `{report, object}` at `:236` |
| `ObjectAssessment` | `object-master.models.ts:318-445` | Category-free. Append-only; every mutation hook blocked at `:422-440` |
| The single history writer | `assessment-history.service.ts:107` `ObjectAssessment.create(…)` | Category-free. Comment at `:11-13`: *"THE writer of the append-only assessment history"* |
| Report → equipment application | `report-record.service.ts:255-343` `applyReportToEquipment` | Category-free. Only skip condition is `item.score === null` (`:274`) |
| The акт (inspection report) | `apps/backend/src/modules/inspection-report/` | **Does not import `ObjectRecord` or `ObjectType` at all.** Built from `PlannedWorkTask` rows grouped by floor (`inspection-report.service.ts:179-213`). `replacementPanels: string[]` (`model.ts:31`) is free text, not object references |
| "Үзлэг ба дүгнэлт" feed | `apps/backend/src/modules/report/inspection.service.ts` | Category-free. Populates `objectType` at `:232` then hardcodes `objectTypeName: null` at `:277` |

**The whole assessment spine is already category-agnostic.** This is the single most
important finding in section 2: an inspection of a plumbing valve needs no new code path.

One asymmetry found while establishing this, which the design must decide about
(open question 8): `object-master.service.ts:1274` refuses a manual assessment when the
type's `generatesConclusion` is false —

```ts
throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR,
  'Энэ төрлийн объектод дүгнэлт бүртгэхээр тохируулагдаагүй байна.');
```

— but `applyReportToEquipment` never consults the flag, so a planned-work or
service-request conclusion writes an assessment onto that same object anyway.

### 2.7 Both Flutter apps

The two apps do not share code; each carries its own hand-maintained copy of the enum.

| App | File:line | Declaration |
|---|---|---|
| Customer | `apps/mobile/lib/features/customer_portal/domain/entities/object_master_enums.dart:7-25` | `enum ObjectCategory { panel('PANEL','Самбар',AccentTone.purple), circuit(…), equipment(…) }` |
| Employee | `apps/mobile-employee/lib/features/employee/project/domain/entities/object_enums.dart:7-24` | Same, without the `tone` |

Both carry the comment *"Mirrors ObjectCategory / OBJECT_CATEGORY_LABELS in
packages/shared/src/constants/object-master.ts"* — hand-maintained duplicates.

Four facts about the mobile clients that materially shape the migration:

1. **An unknown category does not crash either app.** Every parse site goes through a
   tolerant `fromWire` loop that returns `null` (`object_master_enums.dart:18-24`). There
   is no `Enum.values.byName` and no `firstWhere` without `orElse` on any category enum in
   either app.
2. **But the attribute section vanishes silently.** Both apps branch on *which block is
   non-null*, not on the category: customer `device_detail_screen.dart:245-296`
   (`if (panel != null) … else if (circuit != null) … else if (equipment != null)`, no
   `else`), employee `device_detail_screen.dart:301-400` (three independent `if`s). Customer
   `:290` ends with `if (rows.isEmpty) return const <Widget>[];`. A new-shaped object renders
   **no technical section at all** — silent omission, not an error.
3. **Neither app ever writes a category.** There is no create-or-edit-object flow in either
   app. The only writes touching objects are `POST /objects-master/:id/assessments`
   (employee `project_remote_data_source.dart:223`). The category write path lives entirely
   in the web admin.
4. Both apps declare `final ObjectCategory? category` — nullable at all four declaration
   sites (customer `object_master_model.dart:59`, `:371`; employee `object_models.dart:62`,
   `:364`).

Also present and stale: the customer app carries a **third** vocabulary,
`ObjectNodeKind` (`service_request_enums.dart:139-161`), which spells the same concepts
`panel('PANEL')`, `circuit('CIRCUIT')`, `device('DEVICE')` — note `DEVICE`, not
`EQUIPMENT`, and `'Хэлхээ/Шугам'` with a capital Ш against the object enum's
`'Хэлхээ/шугам'`.

### 2.8 The web object form

`apps/web/src/features/projects/objects/ObjectFormPage.tsx` (1135 lines) is the real cost
centre. Three hardcoded `<fieldset>` blocks under the comment *"Only the block belonging to
the chosen category is rendered"* (`:810`):

| Category | Gate | Inputs | Count |
|---|---|---|---|
| `PANEL` | `:811` | `capacityKw`, `location`, `protection` | 3 |
| `CIRCUIT` | `:830` | panel select, `breakerRating`, `permittedCapacityKw`, `cableType`, `cableSectionMm2`, `cableLengthM` | 6 |
| `EQUIPMENT` | `:887` | circuit select, panel select, `ratedPowerKw`, `quantity`, `usageCoefficient`, `installedAt`, `warrantyUntil` | 7 |

Plus: 16 hand-rolled `useState`s grouped by `// Panel` / `// Circuit` / `// Equipment`
comments (`:104-137`); edit-mode hydration reading each block field-by-field (`:194-211`);
two hardcoded parallel list calls for the pickers (`:275-277`); the submit ternary building
the union (`:404-436`); the category select disabled on edit (`:765-778`); and field-error
keys as hardcoded dotted paths (`'panel.capacityKw'`, `'circuit.permittedCapacityKw'`,
`'equipment.ratedPowerKw'`).

Other web coupling: `ObjectDetailPage.tsx:435-484` (three attribute render blocks), `:497`
(hides Ачааллын хувь for EQUIPMENT), `:504` (reserve footnote for PANEL only), `:511/:532/:548`
(three category-shaped child tables); `FloorPlanPanel.tsx:298-304` (quick-create must emit an
empty union stub); `FloorDetailPage.tsx:504-517` (hardcoded three-cell count grid
Самбар/Хэлхээ/Тоноглол); `ObjectBadges.tsx:25-29` (the only per-category colour map).

Load figures are rendered in exactly one file — `ObjectBadges.tsx:231-288` (`LoadValue`,
`VarianceValue`, `LoadPercent`, including the `Бүрэн бус` amber path).

---

## 3. What is already flexible

**Object types are genuinely user-created at runtime.** This is stated plainly because the
brief assumes otherwise.

- Model: `object-master.models.ts:28-66` — a real collection with `code`, `name`,
  `description`, `category`, `showOnPlan`, `insidePanel`, `generatesConclusion`, `icon`,
  `isActive`, `createdBy`.
- API: `object-master.routes.ts:61/77/95/108/127` — full list/create/read/update/delete
  behind `PERMISSIONS.OBJECT_TYPE_MANAGE`.
- UI: `apps/web/src/features/object-master/ObjectTypesPage.tsx` — a real drawer posting to
  the API (`:142` `objectTypeService.create(…)`, `:147` `.update(…)`, `:359` `.remove(…)`).
- Proof from live data: the 8th type, `C1 / Цахилгааны самбар`, does not exist in
  `scripts/seed-dev-data.ts` (which seeds 7). It was created through the API by a user.

**The per-type flags are the seed of exactly the idea in the brief.** `IObjectType` already
carries four "capability"-shaped fields (`object-master.models.ts:38-41`). Their honest
status today:

| Flag | Status | Evidence |
|---|---|---|
| `generatesConclusion` | **Live, on one path only.** Gates the manual assessment endpoint | Throws at `object-master.service.ts:1274`; surfaced as `canAssess` at `:531`. Not consulted by `report-record.service.ts:applyReportToEquipment` |
| `showOnPlan` | Shipped to clients, no backend conditional reads it | Carried into `ObjectListItemDto.objectType.showOnPlan` (`packages/shared/src/types/object-master.types.ts:177`); consumed only client-side |
| `insidePanel` | **Fully inert.** Not even selected into the DTO | Only written (`object-type.service.ts:36,111,148`) or displayed in the type admin (`ObjectTypesPage.tsx:261`) |
| `icon` | Stored, shipped, consumed by web only | `apps/web/src/features/projects/plan-icons.tsx:18` `GLYPHS: Record<ObjectIcon, ReactNode>`. `project-graph.service.ts:82` ignores it and derives its own from the category |

`object-type.service.ts:20-23` says so itself:

> *"`generatesConclusion` is the flag that matters today: it decides whether an object of
> this type may carry an assessment at all. `showOnPlan` and `icon` are stored for the plan
> editor, which section 19.2 leaves unapproved, so nothing reads them yet."*

`OBJECT_ICONS` (`constants/object-master.ts:63-79`) is a 14-key fixed enum that already
reaches beyond electrical: `CAMERA`, `SENSOR`, `UPS`, `SERVER_RACK`, `HVAC`, `PUMP`. The
icon vocabulary anticipated multi-discipline assets; the category vocabulary did not.

---

## 4. The live shape

Queried from `monhorus_dev` on 2026-08-06.

**Object types: 8.**

| Code | Name | Category | Icon | insidePanel | Objects using it |
|---|---|---|---|---|---|
| `DB` | Түгээх самбар | PANEL | PANEL | false | 5 |
| `C1` | Цахилгааны самбар | PANEL | PANEL | false | 2 |
| `LINE` | Хэлхээ/шугам | CIRCUIT | CABLE | false | 5 |
| `LAMP` | Гэрэлтүүлэг | EQUIPMENT | LIGHT | false | 7 |
| `UPS` | UPS | EQUIPMENT | UPS | false | 5 |
| `HVAC` | Агааржуулагч | EQUIPMENT | HVAC | false | 5 |
| `SOCKET` | Залгуур | EQUIPMENT | SOCKET | false | 4 |
| `MCB` | Автомат таслуур | EQUIPMENT | BREAKER | **true** | 2 |

All 8 have `showOnPlan: true`, `generatesConclusion: true`, `isActive: true`. All three
categories are in use.

**Objects: 35.** PANEL 7, CIRCUIT 5, EQUIPMENT 23.

**Attribute blocks are perfectly consistent with the category** — 7 objects carry a
non-null `panel`, 5 a `circuit`, 23 an `equipment`, total 35. No object carries two blocks
and none carries zero. The discriminated union has held.

**How much of each block is actually filled** — this is what a migration would have to move:

| Field | Filled | Of |
|---|---|---|
| `panel.capacityKw` | 4 | 7 panels |
| `panel.location` | 4 | 7 |
| `panel.protection` | 4 | 7 |
| `circuit.permittedCapacityKw` | 4 | 5 circuits |
| `circuit.cableType` | 4 | 5 |
| `equipment.ratedPowerKw` | 16 | 23 equipment |
| `equipment.quantity` | 16 | 23 |
| `equipment.usageCoefficient` | 12 | 23 |
| `measuredLoadKw` (top level) | 4 | 35 |
| `latestAssessment` | 12 | 35 |
| `floor` link | 28 | 35 |
| `planPosition` | 2 | 35 |

**Object-to-object edges: 19 in total.**

| Edge | Count |
|---|---|
| `circuit.panel` | 5 |
| `equipment.circuit` | 13 |
| `equipment.panel` (mount) | 1 |
| `circuit.startPointObject` | 0 |
| `circuit.endPointObject` | 0 |

**Related volumes:** 18 `objectassessments`, 18 `reportitems`, 23 `reports`, 16
`servicerequests`, 6 `plannedworks`, 4 `inspectionreports`, 2 `customers`.

**Hierarchy (`objectnodes`, a different enum):** 3 PROJECT, 4 BUILDING, 18 FLOOR, 4 ROOM.
Only **6 of the 18 floors** actually carry objects, which is the size of the
`floorLoadSummary` regression surface.
No `PANEL`/`CIRCUIT`/`DEVICE` nodes exist despite the kind enum permitting them
(`objects/object.routes.ts:55`) — the legacy deep hierarchy is unused in practice.

The dataset is small enough that **every migration in this document fits comfortably in a
single MongoDB transaction.** The deployment already requires a replica set
(`docs/DEPLOYMENT_UBUNTU.md` §2), so a transaction is available.

---

## 5. What must not regress

These are the behaviours a redesign is allowed to move but never to change the output of.
Each candidate in sections 6-8 is judged against this table.

| # | Behaviour | Anchored at | Observable symptom of a regression |
|---|---|---|---|
| R1 | Σ(нэрлэсэн чадал × тоо × коэффициент), default coefficient 1.0 | `constants/object-master.ts:152` | A device's kW changes |
| R2 | The panel → circuit → equipment walk, and only that walk | `load.service.ts:86-121` | Panel totals change |
| R3 | A device with `equipment.panel` and no circuit contributes **nothing** | `load.service.ts:68-84`, `:104-107` | Panel totals inflate |
| R4 | Ачааллын хувь and Нөөц чадал measured against the right capacity per level | `load.service.ts:124-128` | Percentages against the wrong denominator |
| R5 | An incomplete calculation renders `Бүрэн бус` with a reason, **never zero** (rule 17.18) | `constants:135-149`, `ObjectBadges.tsx:242` | A silent 0 kW appears where data is missing |
| R6 | A `DECOMMISSIONED` object contributes 0 and is not an incompleteness (rule 17.17) | `constants:49`, `:152-158` | Decommissioned kit re-enters the totals |
| R7 | Calculated and measured load stay separate; only the difference is derived (rule 17.16) | `constants:222` | One overwrites the other |
| R8 | Both ends of a connection stand in the same building | `object-master.service.ts:317-333` | Cross-building wiring becomes storable |
| R9 | A connection target must exist, share the customer, and not be decommissioned | `object-master.service.ts:344-373` | Dangling or cross-tenant edges |
| R10 | Deletion is refused while dependants exist | `object-master.service.ts:465-501` | Orphaned references |
| R11 | Floor roll-up counts panels only; unattached equipment reported separately | `load.service.ts:185-202` | Double counting, or a permanent false warning |
| R12 | A device mounted in a panel is **not** "unattached" | `load.service.ts:188-201` | Every RCD raises the Хэлхээнд холбогдоогүй banner forever |
| R13 | Risk rollup: worst-of across every object on a floor, no chain de-duplication | `rollup.service.ts:43-60` | Floor risk figures move |
| R14 | Assessment history is append-only and idempotent per `(report, object)` | `object-master.models.ts:422-440`, `report-record.model.ts:236` | History mutates or duplicates |
| R15 | The акт is built from planned-work tasks grouped by floor, not from objects | `inspection-report.service.ts:179-213` | The акт changes shape |
| R16 | Object codes unique per customer, not globally | `object-master.models.ts:269` | Cross-tenant collisions |

R13, R14 and R15 are preserved by **all three** candidates for the same reason: nothing in
the rollup, the assessment spine or the акт reads `category` (section 2.5, 2.6). They are
listed anyway so a future implementer has a regression checklist that is complete rather
than only the parts that looked risky.

---

## 6. Candidate A — capability flags on a user-defined category

**Shape.** `ObjectCategory` stops being a `const` tuple and becomes a collection, seeded
with the three current values. Each document declares which behaviours it opts into, from a
backend-owned registry:

```
Category { code, name, description, icon, isActive,
           capabilities: CapabilityKey[] }

CapabilityKey = 'LOAD_SOURCE'      // has a capacity; sums its downstream
              | 'LOAD_CONDUCTOR'   // has a permitted capacity; sums its downstream
              | 'LOAD_CONSUMER'    // has rated power × quantity × coefficient
              | 'CONNECTION_GRAPH' // may be an endpoint of an object→object edge
              | 'INSPECTION'       // may carry an ObjectAssessment
              | 'PLAN_MARKER'      // may be pinned on a floor plan
```

Seeds: `PANEL → [LOAD_SOURCE, CONNECTION_GRAPH, INSPECTION, PLAN_MARKER]`,
`CIRCUIT → [LOAD_CONDUCTOR, CONNECTION_GRAPH, INSPECTION, PLAN_MARKER]`,
`EQUIPMENT → [LOAD_CONSUMER, CONNECTION_GRAPH, INSPECTION, PLAN_MARKER]`.

The three attribute sub-documents stay exactly as they are. A category with
`LOAD_CONSUMER` gets the `equipment` block; a category with neither load capability gets
none.

**What it does to the load service.** `calculatedLoadOf` (`load.service.ts:86-121`) stops
comparing `object.category === 'EQUIPMENT'` and starts asking `hasCapability(category,
'LOAD_CONSUMER')`. The queries become `{ category: { $in: consumerCategories }, … }`. The
arithmetic in `constants/object-master.ts:152-235` is untouched.

**What it does to validation.** The discriminated union
(`schemas/object-master.schema.ts:182-209`) must go, because a discriminated union needs a
compile-time list of discriminants. It is replaced by a base object plus a runtime check:
"the payload may carry the `equipment` block iff the category has `LOAD_CONSUMER`". The
`.strict()` guarantee at `:184-186` survives in spirit but moves from zod into the service.
**This is a real loss of type safety and must be written down as such.**
`assertRelatedObject`'s `expected: category` (`:346`) becomes
`expected: CapabilityKey` — "the target must be a LOAD_SOURCE" instead of "the target must
be a PANEL".

**What it does to the DTOs.** `ObjectDetailDto.panel|circuit|equipment`
(`types/object-master.types.ts:191-193`) are unchanged. `ObjectListItemDto.category` becomes
a string with no compile-time union — every `Record<ObjectCategory, …>` becomes a
`Record<string, …>` with a fallback, notably `project-graph.service.ts:53-57` and
`ObjectBadges.tsx:25-29`.

**What it does to the clients.** Web: the three fieldsets in `ObjectFormPage.tsx:811-981`
become three fieldsets gated on capability instead of on the literal — a ~20-line change,
not a rewrite. Mobile: both apps' enums become plain strings, and the attribute sections
(`device_detail_screen.dart:245-296` / `:301-400`) keep working unchanged, because they
already branch on which block is non-null.

**What it does to existing data.** Nothing. Zero object documents change. Three category
documents are inserted. This is the candidate's strongest property.

**Honest trade-off.** It solves *behaviour* and does not solve *properties*. A Plumbing
category created under Candidate A can declare `INSPECTION` and be inspected — which is
genuinely most of the value, since section 2.6 shows the assessment spine is already
category-agnostic — but it still has nowhere to store a pipe diameter. It answers half the
brief. The half it answers is the half that is currently hardest.

---

## 7. Candidate B — typed attribute schemas per category

**Shape.** The category document additionally carries a field definition list, and objects
carry a generic bag:

```
Category { code, name, …, fields: FieldDef[] }
FieldDef { key, label, type, unit, required, min, max, options[], order }
type ∈ NUMBER | TEXT | BOOLEAN | DATE | ENUM | REFERENCE
```

`IObject.panel|circuit|equipment` are replaced by `attributes: Record<string, unknown>`.
The electrical fields become one seeded definition set — `EQUIPMENT` gets
`ratedPowerKw (NUMBER, kW)`, `quantity (NUMBER, ш)`, `usageCoefficient (NUMBER, 0..1)`,
`circuit (REFERENCE)`, `panel (REFERENCE)`, `installedAt (DATE)`, `warrantyUntil (DATE)`.

**What it does to the load service.** `equipmentLoad` (`load.service.ts:50-59`) reads
`object.attributes.ratedPowerKw` instead of `object.equipment.ratedPowerKw` — with no
compile-time guarantee the key exists or is a number. The walk's queries become
`{'attributes.circuit': id}`; index-wise this is equivalent (a sparse index on
`attributes.circuit` behaves like today's `equipment.circuit` index at
`object-master.models.ts:203`), but Mongoose cannot `populate` an untyped `Mixed` path.
`findObjectOrThrow`'s five populate directives (`object-master.service.ts:454-458`) would
need `refPath` or a manual second query.

**The sharp edge.** Nothing stops an administrator from renaming or deleting the
`ratedPowerKw` field definition on the EQUIPMENT category. The next load calculation
silently returns `Бүрэн бус / MISSING_RATED_POWER` for every device in the estate — which
is R5 behaving *correctly* while the underlying cause is a config change nobody connected to
it. Any implementation of Candidate B needs a lock on capability-owned keys, at which point
it has grown Candidate A's registry anyway.

**What it does to validation.** The discriminated union is replaced by a runtime validator
built from the field definitions. `createObjectSchema` becomes a base schema plus
`attributes: z.record(z.unknown())`, validated in a second pass against the category's
definitions. Every field-error path in `ObjectFormPage.tsx` changes from
`'equipment.ratedPowerKw'` to `'attributes.ratedPowerKw'`.

**What it does to the DTOs.** `panel`/`circuit`/`equipment` disappear from
`ObjectDetailDto`, replaced by `attributes` plus the field definitions so a client can
render labels and units. `PanelAttributesDto`, `CircuitAttributesDto`,
`EquipmentAttributesDto` (`types/object-master.types.ts:78-113`) are deleted.

**What it does to the clients.** Web: the 16 hardcoded inputs and 16 `useState`s
(`ObjectFormPage.tsx:104-137`, `:811-981`) collapse into one definition-driven renderer.
That is the biggest single simplification available anywhere in this design — and the
biggest single rewrite. Mobile: **both apps break.** Their attribute sections key off
`panel != null` / `circuit != null` / `equipment != null`, so removing those blocks makes
every device render zero technical rows (`device_detail_screen.dart:290`). Silent, not a
crash — which is worse for a field technician than a crash would be.

**What it does to existing data.** All 35 objects are rewritten. 19 edges move from typed
`ObjectId` sub-fields into the bag. Requires either a client release in lockstep or a
compatibility shim.

**Honest trade-off.** It solves *properties* completely and *behaviour* not at all. A
Plumbing category gets its diameter field on day one, but nothing tells the system that
plumbing does not do load arithmetic — that knowledge moves into "does this category happen
to define a `ratedPowerKw` field", which is inference from data shape rather than a stated
capability. That is the exact mistake the current design already makes, expressed in JSON
instead of TypeScript.

---

## 8. Candidate C (recommended) — capability-declaring category, capability-owned field contracts, and a first-class connection list

Candidates A and B each solve one half and each independently grow toward the other.
Candidate C is what they converge on, stated directly. It has three parts.

### 8.1 The category is a document that declares capabilities

Exactly as Candidate A (§6). Backend owns the capability registry; users own the category
rows.

### 8.2 Fields come in two tiers

**Tier 1 — capability fields.** A capability contributes named, typed, backend-owned field
keys. `LOAD_CONSUMER` contributes precisely the three keys `equipmentLoadKw` reads
(`constants/object-master.ts:128-133`: `ratedPowerKw`, `quantity`, `usageCoefficient`).
`LOAD_SOURCE` contributes `capacityKw`. `LOAD_CONDUCTOR` contributes
`permittedCapacityKw`. These arrive with the capability, are typed in TypeScript, and
**cannot be renamed or deleted by an administrator.** Candidate B's sharp edge is closed by
construction.

**Tier 2 — custom fields.** A `FieldDef[]` on the category, exactly as Candidate B, for
everything the backend does not reason about: `location`, `protection`, `breakerRating`,
`cableType`, `cableSectionMm2`, `cableLengthM`, `installedAt`, `warrantyUntil` — and, for a
new category, pipe diameter, camera resolution, filter size. **Note which side of the line
those eight electrical fields fall on: they are Tier 2, because no backend code reads
them.** That is a useful test of whether the split is drawn correctly.

Storage is one bag, `attributes`, with the tier distinction living in the definitions, not
in the document.

### 8.3 Connections become a first-class list

The five reference fields scattered across two sub-documents
(`circuit.panel`, `circuit.startPointObject`, `circuit.endPointObject`,
`equipment.circuit`, `equipment.panel`) become one typed array on the object:

```
connections: [{ role: ConnectionRole, target: ObjectId }]
ConnectionRole = 'SUPPLIED_BY' | 'MOUNTED_IN' | 'STARTS_AT' | 'ENDS_AT'
```

with a compound index `{ 'connections.target': 1, 'connections.role': 1 }` and each role
declaring which capability its target must have (`SUPPLIED_BY` → target must be
`LOAD_SOURCE` or `LOAD_CONDUCTOR`; `MOUNTED_IN` → target must be `LOAD_SOURCE`).

This is the part neither A nor B provides, and it is the part the brief most needs.
"Plumbing pipe feeds fixture" and "HVAC duct serves diffuser" are the same shape as
"circuit feeds device". Today that shape is expressible only by adding another typed
sub-document field.

It also keeps the edges out of the untyped bag, which is what preserves `populate`
(`object-master.service.ts:454-458`) and keeps `assertRelatedObject` a typed function
rather than a string-keyed lookup.

**Against the regression table.** R1 and R6 are untouched arithmetic. R2 becomes
`connections.role = 'SUPPLIED_BY'` traversal over capability-filtered categories — same
walk, same order, different predicate. **R3 falls out for free and more explicitly than
today**: `MOUNTED_IN` is simply not a role the load walk traverses, which is what
`load.service.ts:68-84` spends sixteen lines of comment explaining. R4 reads the Tier-1
capacity key for whichever load capability the category declares. R8 is verbatim unchanged —
`assertSameBuilding` (`object-master.service.ts:317-333`) never mentions a category. R9
changes only its `expected` parameter from a category literal to a capability. R10's three
category-gated counts collapse into one query: `countDocuments({'connections.target': id})`,
which is *more* correct than today because it catches roles added later without anyone
remembering to extend `deleteBlockersOf`. R11/R12: "unattached" becomes "has no `SUPPLIED_BY`
and no `MOUNTED_IN`", a direct restatement of `load.service.ts:199-201`.

**Cost, honestly.** It is the largest of the three. It rewrites all 35 object documents,
moves 19 edges, deletes three DTO interfaces, and requires the web form rewrite. It is also
the only one of the three that, once done, does not need doing again when the second
non-electrical discipline arrives.

### 8.4 Comparison

| | A: capability flags | B: typed field schemas | C: hybrid + connections |
|---|---|---|---|
| New category can be inspected | Yes | Yes | Yes |
| New category can carry its own fields | **No** | Yes | Yes |
| New category can have its own connection graph | **No** | Partly (untyped refs) | Yes |
| Load arithmetic protected from admin edits | Yes (untouched) | **No** | Yes (Tier 1 locked) |
| Discriminated union `.strict()` survives | No | No | No |
| `populate` survives | Yes | **No** | Yes |
| Object documents rewritten | **0** | 35 | 35 |
| Mobile apps keep working unchanged | Yes | **No** | No (needs the shim, §9) |
| Web form rewritten | No (~20 lines) | Yes | Yes |
| Solves the brief | Half | Half | Yes |

**Recommendation: Candidate C**, sequenced so that Candidate A ships first as its own
phase (§10). A is not a rejected alternative — it is C's first phase, and it is the phase
that delivers the largest fraction of the brief for the smallest fraction of the risk. If
the project runs out of appetite after Phase 1, the system is left in a coherent state where
Security and IT categories can be created and inspected, and only their bespoke fields are
missing.

---

## 9. Migration path

### 9.1 The three seeded categories

The three `const` members become three documents with `isProtected: true`. Their `code`
values stay `PANEL` / `CIRCUIT` / `EQUIPMENT` on the wire, so **every client keeps
receiving the string it already parses**, including both Flutter `fromWire` loops
(`object_master_enums.dart:18`, `object_enums.dart:17`). Only the display name and the
capability set become editable. Whether they may be renamed or deleted is open question 6.

### 9.2 The eight object types

Nothing changes. `IObjectType.category` (`object-master.models.ts:37`) stops being an enum
string and becomes an `ObjectId` reference to the category document — or stays a code
string, which is simpler and keeps `objectTypeSchema.index({category:1,isActive:1,name:1})`
(`:64`) working unchanged. Recommend the code string. All 8 rows keep their current
category value.

`updateObjectTypeSchema` already forbids changing a type's category
(`schemas/object-master.schema.ts:50-51`: *"changing either would silently invalidate every
object already using the type"*) — that rule survives intact.

### 9.3 The thirty-five objects

One transaction, three writes per document, executed by a script in `apps/backend/src/scripts/`
alongside the existing `backfill-*.ts` precedents:

1. **Fold the blocks into `attributes`.** For each object, copy the non-null block's scalar
   fields into `attributes` under the same key names. `panel.capacityKw` → `attributes.capacityKw`;
   `circuit.permittedCapacityKw` → `attributes.permittedCapacityKw`;
   `equipment.ratedPowerKw` → `attributes.ratedPowerKw`. **No key renaming anywhere** — the
   keys are already unique across the three blocks except `panel`, which is a reference and
   is handled in step 2. Nulls are dropped rather than copied, so `attributes` stays sparse
   (per §4, only 4 of 7 panels have a `capacityKw`).

2. **Fold the 19 edges into `connections`.**

   | From | To | Rows |
   |---|---|---|
   | `circuit.panel` | `{role:'SUPPLIED_BY', target}` | 5 |
   | `equipment.circuit` | `{role:'SUPPLIED_BY', target}` | 13 |
   | `equipment.panel` | `{role:'MOUNTED_IN', target}` | 1 |
   | `circuit.startPointObject` | `{role:'STARTS_AT', target}` | 0 |
   | `circuit.endPointObject` | `{role:'ENDS_AT', target}` | 0 |

   Both `circuit.panel` and `equipment.circuit` map to `SUPPLIED_BY` — the distinction they
   currently encode (which *kind* of thing supplies) is recoverable from the target's own
   category, which is what makes the collapse safe. The mount edge stays distinct because
   R3 depends on it.

3. **Leave the legacy blocks in place, unchanged.** Do not `$unset` them. They become the
   compatibility shim of §9.4.

**Verification gate.** Before and after the script, dump the load figures for all 35
objects and all 6 floors that carry objects, and diff. R1-R7 and R11-R12 either produce
byte-identical output or the migration is wrong. With 35 objects this is a sub-second check
and it should be a committed test fixture, not a one-off.

### 9.4 Can it be done without downtime?

**Yes, in four steps, and the reason is specific to this codebase:**

1. **The data migration itself is one transaction** over 35 documents. The deployment
   already mandates a replica set (`docs/DEPLOYMENT_UBUNTU.md` §2), so it is atomic. The
   backend keeps serving throughout.

2. **The API keeps emitting the legacy blocks.** `ObjectDetailDto.panel|circuit|equipment`
   (`types/object-master.types.ts:191-193`) are populated from `attributes` on the way out
   for any category whose code is one of the three seeds. New categories emit `null` for all
   three, plus `attributes` — which is exactly what an old mobile build already tolerates:
   an unknown category parses to `null` (§2.7 fact 1) and an all-null block set renders no
   attribute section (`device_detail_screen.dart:290`). Degraded, never broken.

3. **The web admin is deployed in the same release** as the API, because it is served from
   `dist/` on the same host and has no independent version. It is the only client that
   writes objects (§2.7 fact 3), so the write path needs no dual-version tolerance at all.

4. **The two Flutter apps roll on their own schedule.** They are read-only for objects and
   are built and shipped elsewhere (`docs/DEPLOYMENT_UBUNTU.md` §12). The shim in step 2
   stays until both store builds have rolled — that is Phase 6 in §10, and it is the only
   phase whose timing is outside the team's control.

The one thing that cannot be done without a coordinated release is the **write** path, and
it happens to have exactly one client.

---

## 10. Phased sequence

| Phase | Scope | Ships alone? | Client impact |
|---|---|---|---|
| **0** | Category becomes a seeded collection. Wire values unchanged, UI read-only, no behaviour change. `OBJECT_CATEGORIES` becomes a cached read instead of a `const`. | **Yes** | None |
| **1** | Capability registry. The three seeds declare their capabilities. Every category branch in `load.service.ts`, `object-master.service.ts` and `project-graph.service.ts` is re-expressed as a capability query. Golden test: all 35 load figures byte-identical. | **Yes** | None (backend only) |
| **2** | `connections` array, dual-written alongside the five legacy reference fields. Read path switches to `connections`; `deleteBlockersOf` collapses to one query. | **Yes** | None |
| **3** | `FieldDef[]` on the category + `attributes` bag, dual-written with the legacy blocks. Tier 1 keys locked. DTO gains `attributes` and `fieldDefs` alongside the existing blocks. | No — needs 4 | Additive |
| **4** | Web: category admin CRUD page, and `ObjectFormPage.tsx` rewritten as a definition-driven renderer replacing `:811-981` and the 16 `useState`s. `ObjectDetailPage.tsx:435-484` likewise. | No — needs 3 | Web only |
| **5** | First non-electrical category shipped end to end as the proof. Recommend **Security** (camera/sensor): the icons already exist (`constants:73-74`), it needs `INSPECTION` and no load arithmetic, so it exercises the new machinery without touching R1-R7. | Yes, after 3+4 | Web only |
| **6** | Drop the legacy blocks, the five legacy reference fields, and the three DTO interfaces. Update both Flutter apps. | **Only after both mobile builds have rolled** | Both apps |

**Phases 3 and 4 must land together.** A field definition with no renderer is invisible; a
generic renderer with no definitions is an empty form. Everything else is independent.

**Phases 0, 1 and 2 are independent of each other** and of 3/4 — 1 and 2 can be built in
parallel by different people. All three are invisible to every client, which makes them the
safest place to spend the first chunk of effort.

**Phase 5 is the real acceptance test of the whole design.** If shipping Security requires
touching backend code, the capability registry is wrong and Phases 1-4 need revisiting
before Plumbing (which does need arithmetic — see open question 1).

---

## 11. Sizing

Rough, in engineer-days, for someone already familiar with this codebase. Test counts are
part of the estimate: `object-master.api.test.ts` alone is 2,539 lines and
`load.test.ts` is 146.

| Phase | Backend | Shared | Web | Mobile | Total | Riskiest part |
|---|---|---|---|---|---|---|
| 0 | 2 | 1 | 0.5 | 0 | **~3.5 d** | The `Record<ObjectCategory, …>` exhaustiveness at `project-graph.service.ts:53-57` and `ObjectBadges.tsx:25-29` stops being a compile-time guarantee. Every such map needs an explicit fallback, and missing one is a runtime `undefined` |
| 1 | 4 | 1 | 0.5 | 0 | **~5.5 d** | **`calculatedLoadOf` (`load.service.ts:86-121`).** Every regression in R1-R7 and R11-R12 lands here. Mitigate with the golden-figures fixture from §9.3 before writing any of it |
| 2 | 4 | 1 | 1 | 0 | **~6 d** | Dual-write drift. Two writers of the same fact for a whole release; a path that updates one and not the other is invisible until Phase 6. Mitigate with a consistency assertion in the test suite, not a comment |
| 3 | 5 | 3 | 1 | 0 | **~9 d** | Replacing the discriminated union (`schemas/object-master.schema.ts:182-209`). The `.strict()` rejection at `:184-186` is a real guarantee being converted into a runtime check, and the error-path shape changes for every field |
| 4 | 0 | 0 | 6 | 0 | **~6 d** | `ObjectFormPage.tsx` is 1,135 lines with 16 hand-rolled `useState`s, per-category code suggestion (`:342-343`), two hardcoded picker queries (`:275-277`) and dotted field-error keys. The generic renderer must reproduce all of it |
| 5 | 1 | 0.5 | 1 | 0 | **~2.5 d** | Low. If it is not low, Phases 1-4 are wrong |
| 6 | 2 | 1 | 1 | 3 | **~7 d** | Two separate Flutter apps with no shared code, each carrying a duplicated enum, duplicated attribute models and a duplicated attribute-section widget. Every change must be made twice and kept in step (`docs/MOBILE_DESIGN_SYSTEM.md` states this as the standing constraint) |

**Total ~40 engineer-days**, of which **~15 (Phases 0-2) are invisible to every client** and
can be stopped at any point without leaving the system half-migrated.

The single riskiest artefact in the whole sequence is `load.service.ts:86-121`. It is 36
lines of code guarded by 24 lines of comment explaining a rule (R3) that took real thought
to get right. Any implementer should read `load.service.ts:61-85` in full before touching
it.

The second riskiest is not code at all: it is the **dual-write window in Phases 2-3**, which
is the only period where the same fact lives in two places.

---

## 12. Open questions

These are decisions the product owner must make. Each one changes the design, not just the
implementation.

1. **Does any non-electrical category need its own aggregate arithmetic?** Plumbing has flow
   rate; HVAC has airflow. If yes, the load capability cannot stay a hardcoded kW formula —
   `equipmentLoadKw` (`constants/object-master.ts:152`) would have to become a named,
   unit-carrying formula selected by the capability, which is materially more work than
   Phase 1 as sized. If the answer is "electrical is the only discipline with arithmetic,
   the rest are inspect-and-record", Phase 1 stays as sized. **This is the highest-leverage
   question in the list.**

2. **Can one asset belong to two categories?** A pump is an electrical consumer *and* a
   plumbing device. Today `IObject.category` is single-valued (`object-master.models.ts:145`).
   If an asset needs two, capabilities must attach to the **object** rather than to its
   category, and Candidate C's Tier-1 field contract becomes a union of several
   capabilities' contracts. Worth answering before Phase 1, not after.

3. **Who may create a category — and is it global or per-customer?** `IObjectType` today has
   no `customer` field (`object-master.models.ts:28-46`): the type catalogue is global across
   all tenants, while `IObject` is customer-scoped (`:148`). A per-customer category would
   introduce a new isolation boundary that rule 17.2 and requirement 16.2 currently do not
   contemplate at this level.

4. **Are custom fields per-category or per-type?** The brief says "each category can have its
   own capabilities and properties", but the existing flags are split across both levels —
   `insidePanel` and `generatesConclusion` are per **type** (`object-master.models.ts:39-40`)
   while the attribute blocks are per **category**. Concretely: does the `MCB` type need a
   field that a generic `EQUIPMENT` does not? If yes, `FieldDef[]` must live on both levels
   and merge, which roughly doubles the Phase 3 validation work.

5. **Does the 0-100 score and its risk banding stay universal?** The bands are configurable
   (requirement 16.1) but there is one set for the whole system. Does a plumbing inspection
   score on the same scale as an electrical one, or does each category get its own banding?
   This is the only question that touches `rollup.service.ts`, which is otherwise entirely
   unaffected (§2.5).

6. **May the three seeded categories be renamed or deleted after migration?** Renaming the
   *display name* is safe. Changing the *code* is not: `assertRelatedObject` is called with
   the literals `'PANEL'`, `'CIRCUIT'`, `'EQUIPMENT'` at `object-master.service.ts:724`,
   `:733`, `:742`, `:759`, `:776` (and again at `:875-923`), and both Flutter apps'
   `fromWire` matches on the literal string. Recommend: name editable, code permanently
   frozen, deletion refused while objects exist (mirroring the existing type-delete guard at
   `ObjectTypesPage.tsx:431-441`). Confirm.

7. **Is a coordinated mobile release acceptable, or must the API serve the legacy blocks
   indefinitely?** §9.4 keeps the shim until Phase 6. Indefinitely is survivable but means
   the 35→N objects carry duplicated state forever and every future writer must remember to
   update both. Prefer a date.

8. **Should the `generatesConclusion` asymmetry be fixed as part of this work?** Today
   `object-master.service.ts:1274` refuses a manual assessment on a type flagged
   `generatesConclusion: false`, while `report-record.service.ts:255-343` writes one anyway
   from the planned-work and service-request paths. If `INSPECTION` becomes a category-level
   capability (§8.1) the same asymmetry will be inherited at a second level unless it is
   decided now. Note that all 8 live types currently have `generatesConclusion: true`, so
   fixing it today changes no observable behaviour — which makes now the cheapest possible
   moment.

9. **What happens to the dead `ObjectNodeKind` vocabulary?** `objects/object.routes.ts:55`
   still accepts `'PANEL' | 'CIRCUIT' | 'DEVICE'` as hierarchy node kinds, and the customer
   app mirrors it at `service_request_enums.dart:139-161` — with `DEVICE` where the object
   enum says `EQUIPMENT`, and a different capitalisation of `Хэлхээ/Шугам`. Live data
   contains **zero** nodes of those three kinds (§4). Removing them is out of scope for this
   design but leaving them means a third spelling of the same concept survives the
   refactor. Flag for a separate decision.
