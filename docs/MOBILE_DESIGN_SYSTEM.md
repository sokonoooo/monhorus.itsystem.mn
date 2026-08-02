# Monhorus mobile design system

The contract both Flutter apps follow: `apps/mobile` (customer) and `apps/mobile-employee`
(technician). The two apps do **not** share code — they were deliberately kept separate —
so this document is the only thing holding them in alignment. Change it here first, then
apply the change to both apps in the same commit.

Visual direction: **field instrument.** White surfaces on a cool graphite canvas, a 1px
keyline plus a whisper of shadow (never a floating card), one brand accent spent
narrowly, generous whitespace, a disciplined type scale. It should read like precision
equipment built to be scanned at a glance on a job site — not a printed document, and
not a glossy consumer app.

*(Revision note: this direction replaces an earlier "refined flat / document" pass —
ink-on-paper, hairline-only, no accent, no shadow. That version is retired; every hex
and shape value below is current.)*

---

## 1. Palette

These hexes are already identical in both apps. They are the whole palette; nothing else
may be introduced at a call site.

### Neutrals

| Token | Hex | Use |
|---|---|---|
| `bg` | `#E4E7EC` | Screen canvas — a cool graphite tint so white cards visibly lift off it |
| `paper` | `#F6F7F9` | Inset/recessed blocks inside a card |
| `white` | `#FFFFFF` | Card and sheet surfaces |
| `ink` | `#12151B` | Primary text |
| `inkPressed` | `#262A33` | Pressed state of an ink-foreground control (outline/text buttons) |
| `ink2` | `#3D434E` | Secondary text |
| `muted` | `#6B7280` | Captions, labels, disabled text |
| `line` | `#D7DBE2` | The signature 1px keyline — card borders, dividers |
| `lineStrong` | `#B7BEC9` | Stronger keyline — outline-button borders, emphasis dividers |
| `faint` | `#E7E9ED` | Weaker divider |
| `soft` | `#E9EBEF` | Neutral chip fill, progress-track background |
| `soft2` | `#F3F4F6` | Subtle zebra/hover fill |

Every card is `white` fill, a **1px `line` keyline**, and a whisper of shadow (see
`cardShadow` in §3) — never a bare hairline, never a floating shadow with no border.
`#2563EB` survives only as `materialSeed`, inside `ColorScheme.fromSeed`, to keep
Material's own focus/selection affordances sane — it must never be painted directly.
The colour actually painted on the product surface is `accent`:

| Token | Hex | Use |
|---|---|---|
| `accent` | `#1D4ED8` | The one brand colour: primary buttons, the active tab, links, in-progress/active emphasis — nowhere else |
| `accentPressed` | `#17399E` | Pressed state of an accent-filled control |
| `accentBg` | `#E4EAFB` | A tint of `accent` — selected-chip fills only, never a full-card background |

### Risk band colours

One triad per band. `fg` is the strong colour, `bg` the tint, `border` the outline.
Deepened from the previous pass so every band reads at higher contrast and so the solid-
fill chip can take white label text with no exception (see the contrast rule below).

| Band | fg | bg | border |
|---|---|---|---|
| `NORMAL` | `#157A41` | `#E6F2EA` | `#BCDAC8` |
| `ATTENTION` | `#A8670A` | `#FAF0DD` | `#E8CD97` |
| `SCHEDULE_REPAIR` | `#C2410C` | `#FBE9DE` | `#EABB98` |
| `CRITICAL` | `#B91C1C` | `#FAE4E2` | `#EAB5AE` |
| `OUT_OF_SERVICE` | `#1C1917` | `#E6E4E1` | `#B7B2AC` |
| _unassessed_ | `#6B7280` | `#E9EBEF` | `#B7BEC9` |

### Non-risk status accents

Risk is not the only thing with a state. Service-request statuses (14), SLA states (6),
object statuses (3) and notification severities (3) all need colour, and rule 5 forbids
them from borrowing the risk triads. They draw from this separate set:

| Token | fg | bg | border | Use |
|---|---|---|---|---|
| `blue` | `#1D4ED8` (= `accent`) | `#E4EAFB` | `#B0C4F5` | In-flight / informational states |
| `purple` | `#7B3FE4` | `#F0E9FF` | `#C4A9FF` | Scheduled / awaiting states |
| `neutral` | `#6B7280` | `#E9EBEF` | `#B7BEC9` | Inert, draft, cancelled |
| `ink` | `#12151B` | `#E9EBEF` | `#D7DBE2` | Selected / emphasis |

`blue` is deliberately the same hex as `accent`: "in-flight/informational" status is the
same idea as "active", just expressed as a status chip rather than a piece of chrome.

These must never read as a risk band. A status chip and a risk pill should be
distinguishable at a glance — which is what the risk glyphs buy: **only risk carries a
glyph.** A chip with no glyph is not a risk.

Unavoidable overlap: a handful of non-risk enums legitimately want green ("completed"),
red ("breached", "critical notification") or black ("decommissioned"). That is allowed —
those are shared *semantics*, not a borrowed band — but such a chip must never carry a
risk glyph, and must never appear inside a risk legend, count strip or score ring.

**Contrast rule.** `ATTENTION` (`#A8670A`) and `SCHEDULE_REPAIR` (`#C2410C`) do not reach
4.5:1 on white. They are permitted for **glyphs, swatches, borders, rings and solid-fill
chips only** — never for body text on a white surface. Risk text on a white surface is
`ink`; the band identity is carried by the glyph and the swatch beside it. On a solid
band-filled chip, the label colour is **white for every band, including `ATTENTION`** —
the previous pass's dark-text exception (`#451A03`) is retired now that `ATTENTION` was
deepened specifically so white reaches sufficient contrast on it too.

---

## 2. Type scale

System font, no bundled family. Every text style comes from the token file — a literal
`fontSize:` at a call site is a defect.

| Token | Size | Weight | Notes |
|---|---|---|---|
| `display` | 26 | w900 | Splash wordmark only |
| `screenTitle` | 19 | w900 | Screen heading |
| `headerTitle` | 17 | w800 | Nav bar title |
| `cardTitle` | 15 | w800 | Card heading |
| `rowTitle` | 13 | w600 | List row primary |
| `body` | 13 | w400 | Paragraph text, `ink2` |
| `rowSub` | 11 | w400 | List row secondary, `muted` |
| `sectionLabel` | 10 | w700 | UPPERCASE, letter-spacing `0.8`, `muted` |
| `pillLabel` | 10 | w700 | Pill/chip text |
| `navLabel` | 9 | w600 | Bottom nav |
| `emptyText` | 13 | w400 | Empty state, `muted` |
| `mono*` | see below | w700 | Platform monospace, fallbacks Menlo / Roboto Mono / Courier New. Scores and counts only |

Monospace reuses the sizes already in the scale — it introduces no new number:
`monoDisplay` 26, `monoFigure` 19, `monoRow` 13, `monoSub` 11, `monoLabel` 10.

Every token style carries an explicit `height`. Do not remap Material's `textTheme` slots
to these styles: a `height` leaking through `DefaultTextStyle` overflows the bottom nav.

`sectionLabel` is **w700** in both apps. (The customer app previously used w800; it is
corrected to w700.)

---

## 3. Shape and spacing

| Token | Value |
|---|---|
| `hairline` | `1` — the signature border width |
| `radiusInput` | 8 |
| `radiusRow` | 10 |
| `radiusCard` | 12 |
| `radiusHomeCard` | 12 — unified with `radiusCard`; no reason for the two to differ |
| `radiusSheet` | 14 |
| `radiusPill` | 6 — a small rounded-rect tag, deliberately **not** a full stadium/capsule: status pills read as technical labels, not marketing badges |
| `gutter` | 14 — card padding |
| `labelGutter` | 18 — screen-edge padding for labels |
| `scrollBottomSpacer` | 84 — clearance above the bottom nav |
| `cardShadow` | `BoxShadow(color: #0F10131A, blurRadius: 3, offset: (0, 1))` — a whisper, never the primary source of definition |

A card is: `white` fill, `1px line` border, `radiusCard`, `cardShadow`. The border does
the work of separating a card from its neighbours; the shadow only lifts it a hair off
the canvas. A card with a shadow and no border, or a border with no shadow, is a defect.

---

## 4. Risk levels — the single most important contract

The backend is the authority. `packages/shared/src/constants/service-request.ts:162`
defines exactly five levels, best-first:

```
NORMAL → ATTENTION → SCHEDULE_REPAIR → CRITICAL → OUT_OF_SERVICE
```

Plus a sixth **display** state, `unassessed`, for a null `riskLevel` — the object exists
but has never been scored. It is not a band and must never be rendered as one.

### Labels

Use the backend's `RISK_LEVEL_LABELS` verbatim. These strings are the contract:

| Wire value | Mongolian label |
|---|---|
| `NORMAL` | Хэвийн |
| `ATTENTION` | Анхаарах шаардлагатай |
| `SCHEDULE_REPAIR` | Ойрын хугацаанд засварлах |
| `CRITICAL` | Ноцтой эрсдэлтэй |
| `OUT_OF_SERVICE` | Ашиглах боломжгүй |
| _null_ | Үнэлгээгүй |

Where a full label will not fit, use these abbreviations. **Never** label a band by its
colour name — "Улаан", "Шар", "Ногоон" and friends are banned. They repeat the colour,
carry no meaning, and are useless to a colour-blind user.

| Wire value | Short label |
|---|---|
| `NORMAL` | Хэвийн |
| `ATTENTION` | Анхаарах |
| `SCHEDULE_REPAIR` | Засварлах |
| `CRITICAL` | Ноцтой |
| `OUT_OF_SERVICE` | Боломжгүй |
| _null_ | Үнэлгээгүй |

### Glyphs

Every band carries a distinct silhouette so risk survives colour-blindness, greyscale
printing and direct sunlight on a job site. Drawn with `CustomPainter` — never as a Unicode
character, which would depend on system font coverage.

| Band | Shape | Rationale |
|---|---|---|
| `NORMAL` | filled circle | Calm, closed, complete |
| `ATTENTION` | half-filled circle | Same circle, partly drained — "slipping" |
| `SCHEDULE_REPAIR` | filled diamond | Distinct silhouette; deliberately **not** a mirrored half-circle |
| `CRITICAL` | filled triangle | Universal hazard shape |
| `OUT_OF_SERVICE` | filled square | Terminal, blocked, "stopped" |
| _unassessed_ | hollow circle, dashed/thin outline | Absence of data, not a low score |

Escalation reads as: closed → draining → turned → hazard → stopped.

### Rules that must hold everywhere

1. **All five bands are always visually distinct.** Collapsing `ATTENTION` with
   `SCHEDULE_REPAIR`, or `CRITICAL` with `OUT_OF_SERVICE`, is a defect. There is exactly
   one `RiskLevel` enum per app.
2. **Never print the numeric score bands** (`81-100%`, `21-40%`, …). Those thresholds are
   runtime-configurable server-side (`riskBandsOf`, `settings.ts:286`) and neither mobile
   role can read `GET /settings` (403 — `SETTINGS_VIEW` is admin/management/finance only),
   so any printed range can silently contradict the server. Show the band name and the
   object's own score; never the scale.
3. **Never compute a band from a score on the client** when the server sent one. The
   backend always sends `riskLevel`. `fromScore` is a last-resort fallback for legacy
   payloads only and must not drive the legend.
4. **`unassessed` is never green.** A never-scored object is not a healthy object.
5. **Risk colours are reserved for risk.** SLA states (`AT_RISK`), notification severities
   (`CRITICAL`) and diagram node statuses are different concepts and must not borrow the
   band palette, even where they share a token name.
6. **Every risk indicator carries a `Semantics` label** with the full band name, so a
   screen reader announces meaning rather than a colour.

---

## 5. Component contract

Each app has exactly one of each. Duplicates are defects.

- **`RiskGlyph`** — the `CustomPainter` shape, sized to a caller-given edge.
- **`RiskPill`** — glyph + short label (+ optional score). Never colour-name text.
- **`RiskLegend`** — all five bands plus unassessed; glyph, colour, full label. No ranges.
- **`ScoreRing`** — the object's own 0–100 score in `mono`, ringed in the band colour.
- **One tone class per app** holding the `{fg, bg, border}` triad. Not two, not three.
- **One pill widget family.** The employee app previously had five near-duplicates
  (`HomePill`, `WorkPill`, `ProjectPill`, and two `StatusPill`s) across three different
  tone parameter types; they converge.
- **One card-decoration helper per app** — `CustomerTokens.card({fill, border, radius})`
  / `EmployeeTokens.card({fill, border, radius})` — returning `white` fill, the `line`
  keyline, and `cardShadow`. Every card-shaped surface calls it rather than hand-rolling
  its own `BoxDecoration`. A card-shaped `BoxDecoration` built by hand anywhere else is a
  defect, on the same grounds as a second pill family.

---

## 6. Known deviations to fix

Recorded so they are not reintroduced.

- Backend: `SCHEDULE_REPAIR` has two different Mongolian labels — `RISK_LEVEL_LABELS`
  says "Ойрын хугацаанд засварлах", `OVERALL_SAFETY_LABELS` says "Засвар шаардлагатай".
  Mobile follows `RISK_LEVEL_LABELS`.
- Backend: `project-graph.service.ts:45` maps five risk levels onto four diagram statuses,
  collapsing `ATTENTION` and `SCHEDULE_REPAIR`. Diagram-only; does not reach mobile.
- Backend: `RISK_BANDS` / `riskLevelFromScore` in shared are frozen defaults the backend
  never consults. Do not treat them as live values.
