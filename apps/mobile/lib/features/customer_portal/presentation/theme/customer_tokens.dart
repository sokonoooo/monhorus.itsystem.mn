import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// The single source of visual truth for this app.
///
/// Transcribed from the `soko` home mock (`Soko Customer Home.html`), direction 1b
/// — "steel". Every colour, size, weight, radius and spacing value in the product
/// surface comes from here; a literal `fontSize:`, hex or
/// `BorderRadius.circular(<number>)` at a call site is a defect.
///
/// `AppTheme` is a thin `ThemeData` layered on top of these values so Material's own
/// widgets agree with them. It never contradicts this file.
///
/// Visual direction: **blueprint**. A warm paper ground that is deliberately not
/// grey, a dark navy hero band anchoring the top of the screen, square corners
/// everywhere, 1px hairlines instead of shadows, condensed headings against a
/// humanist body face, and uppercase letter-spaced kickers. It should read like a
/// technical drawing of the building stock, not a consumer dashboard.
///
/// Two rules carried over from the mock and worth stating plainly:
///
/// * **Nothing is rounded.** The mock overrides its own radius tokens to `0` on
///   every component. [radiusCard] and friends are kept as named zeros so call
///   sites keep reading from the scale rather than hardcoding it.
/// * **Nothing floats.** Definition comes from the hairline. [cardShadow] is
///   deliberately empty; the one shadow in the system is [fabShadow].
class CustomerTokens {
  const CustomerTokens._();

  // ---------------------------------------------------------------------------
  // 0. Type faces
  // ---------------------------------------------------------------------------
  //
  // Fira Sans and Fira Sans Condensed, fetched by `google_fonts` and cached to
  // disk. `main()` awaits `GoogleFonts.pendingFonts` before the first frame so text
  // does not land in the system face and reflow.
  //
  // NOT Barlow, which is what the HTML mock uses. Barlow and Barlow Condensed carry
  // no Cyrillic at all — 0 of the 64 basic letters, and none of Mongolian's Ө/ө/Ү/ү
  // — so every string in this app would have silently fallen back to the system
  // face and only the digits and the wordmark would have been the intended face.
  // Fira Sans is the same idea drawn with full Cyrillic: a humanist UI sans with a
  // true condensed sibling, so the mock's body/condensed-heading pairing survives.
  //
  // The styles below are `static final`, not `static const`: google_fonts registers
  // a distinct family per weight (`FiraSans_regular`, `FiraSansCondensed_600`, ...),
  // so the family name is only knowable at runtime and a const `fontFamily:` string
  // would silently fall back to the system face.

  /// Body copy, labels, figures inside a sentence.
  static TextStyle _body({
    required double size,
    FontWeight weight = FontWeight.w400,
    double? tracking,
    double height = 1.4,
    Color color = ink,
  }) {
    return GoogleFonts.firaSans(
      fontSize: size,
      fontWeight: weight,
      letterSpacing: tracking,
      height: height,
      color: color,
    );
  }

  /// Headings and every standalone figure. Condensed, so a long Cyrillic heading
  /// still fits a phone column.
  static TextStyle _heading({
    required double size,
    FontWeight weight = FontWeight.w600,
    double? tracking,
    double height = 1.2,
    Color color = ink,
  }) {
    return GoogleFonts.firaSansCondensed(
      fontSize: size,
      fontWeight: weight,
      letterSpacing: tracking,
      height: height,
      color: color,
    );
  }

  /// Awaited in `main()` so both faces are resolved before the first frame.
  static Future<void> preload() {
    return GoogleFonts.pendingFonts(<TextStyle>[
      GoogleFonts.firaSans(),
      GoogleFonts.firaSans(fontWeight: FontWeight.w500),
      GoogleFonts.firaSansCondensed(fontWeight: FontWeight.w600),
      GoogleFonts.firaSansCondensed(fontWeight: FontWeight.w700),
    ]);
  }

  // ---------------------------------------------------------------------------
  // 1. Neutrals
  // ---------------------------------------------------------------------------

  /// Screen canvas. The mock's `--home-paper-alt` — warm, not grey.
  static const Color bg = Color(0xFFFDFDFB);

  /// The slightly warmer paper used for recessed blocks and the tab bar.
  static const Color paper = Color(0xFFFBFAF7);

  /// Card and sheet surfaces.
  static const Color white = Color(0xFFFFFFFF);

  /// Primary text.
  static const Color ink = Color(0xFF1D1F20);

  /// Pressed state of an ink-foreground control (outline/text buttons).
  static const Color inkPressed = Color(0xFF2B2B2D);

  /// Secondary text — `ink` at 70%.
  static const Color ink2 = Color(0xB31D1F20);

  /// Captions, labels, disabled text — `ink` at 55%.
  static const Color muted = Color(0x8C1D1F20);

  /// The softest label tint — `ink` at 45%. Section kickers, inactive tabs.
  static const Color mutedSoft = Color(0x731D1F20);

  /// Chevrons and other passive affordances — `ink` at 35%.
  static const Color chevron = Color(0x591D1F20);

  /// The signature 1px keyline — every card border, divider and hairline.
  /// `ink` at 16%, exactly the mock's `--color-divider`.
  static const Color line = Color(0x291D1F20);

  /// A stronger keyline — outline-button borders, emphasis dividers.
  static const Color lineStrong = Color(0x591D1F20);

  /// Weaker divider.
  static const Color faint = Color(0x141D1F20);

  /// Neutral chip fill, progress-track background.
  static const Color soft = Color(0xFFE7E7EA);

  /// Subtle zebra / hover fill.
  static const Color soft2 = Color(0xFFF5F5F8);

  /// The Material seed. Present so `ColorScheme.fromSeed` can keep Material's own
  /// focus, selection and cursor affordances sane. **Never painted directly** — use
  /// [accent] for anything that actually needs to render in the brand colour.
  static const Color materialSeed = Color(0xFF5980A6);

  /// The one brand accent, spent narrowly: the FAB, primary buttons, focus rings,
  /// and in-progress/active-state emphasis. Never a background tint by itself.
  static const Color accent = Color(0xFF5980A6);

  /// Pressed state of an accent-filled control.
  static const Color accentPressed = Color(0xFF416180);

  /// Links and kickers that need to read as accent against paper — accent-700.
  /// [accent] itself is too light for text at 11px.
  static const Color accentText = Color(0xFF416180);

  /// The active bottom-nav tab — accent-800.
  static const Color accentStrong = Color(0xFF2C455D);

  /// A tint of [accent] — selected-chip fills only, never a full-card background.
  static const Color accentBg = Color(0xFFEEF6FF);

  /// Row hover / pressed wash — `accent` at 6% / 10%.
  static const Color accentWash = Color(0x0F5980A6);
  static const Color accentWashStrong = Color(0x1A5980A6);

  // ---------------------------------------------------------------------------
  // 1b. The hero band
  // ---------------------------------------------------------------------------
  //
  // Direction 1b's defining move: a dark navy block behind the greeting and the
  // risk stair. It is the only dark surface in the system.

  /// The hero background — accent-900.
  static const Color hero = Color(0xFF1D2D3D);

  /// Primary text on [hero].
  static const Color onHero = Color(0xFFFFFFFF);

  /// The date line and other secondary text on [hero] — white at 60%.
  static const Color onHeroMuted = Color(0x99FFFFFF);

  /// Stair labels on [hero] — white at 62%.
  static const Color onHeroFaint = Color(0x9EFFFFFF);

  /// Hairlines and button borders on [hero] — white at 30%.
  static const Color heroLine = Color(0x4DFFFFFF);

  /// Pressed wash for a control on [hero] — white at 12%.
  static const Color heroWash = Color(0x1FFFFFFF);

  // ---------------------------------------------------------------------------
  // 2. Risk band colours — one triad per band
  // ---------------------------------------------------------------------------
  //
  // `fg` is the strong colour, `bg` the tint, `border` the outline.
  //
  // The mock's risk ramp runs green → deep maroon across five steps and is the one
  // place saturated colour is allowed. The `bg`/`border` tints are each `fg` mixed
  // toward the paper ground at 12% and 38%, so a chip stays legible on paper
  // without introducing a hue the ramp does not already contain.
  //
  // All five bands — plus the non-risk `blue`/`purple` accents below — use white
  // label text on a solid-fill chip.

  static const Color green = Color(0xFF4C7A52);
  static const Color greenBg = Color(0xFFE6EBE3);
  static const Color greenBorder = Color(0xFFB9C9B8);

  static const Color yellow = Color(0xFF9A8226);
  static const Color yellowBg = Color(0xFFEFECDE);
  static const Color yellowBorder = Color(0xFFD6CCA8);

  static const Color orange = Color(0xFFC0722C);
  static const Color orangeBg = Color(0xFFF4EADF);
  static const Color orangeBorder = Color(0xFFE4C6AA);

  static const Color red = Color(0xFFB0413A);
  static const Color redBg = Color(0xFFF2E4E0);
  static const Color redBorder = Color(0xFFDEB4AF);

  static const Color black = Color(0xFF7A2B26);
  static const Color blackBg = Color(0xFFECE1DE);
  static const Color blackBorder = Color(0xFFCAABA8);

  /// The label colour on a solid band-filled chip. Kept as a named token rather than
  /// hardcoding `white` at call sites, in case a future band needs the exception this
  /// one used to be.
  static const Color onAttention = Color(0xFFFFFFFF);

  // ---------------------------------------------------------------------------
  // 2b. Non-risk status accents
  // ---------------------------------------------------------------------------
  //
  // Deliberately kept apart from the band triads above. The workflow has fourteen
  // service-request statuses and six SLA states, and the design system defines no
  // hue for them, so these two remain as the neutral-plus-two set the flow already
  // used. They must never be read as a risk band.

  /// Shares its strong colour with [accentText] by design — "in-flight /
  /// informational" status is the same idea as "active", just expressed as a status
  /// chip rather than a piece of chrome. Uses the darker accent-700 so 11px chip
  /// text stays legible.
  static const Color blue = accentText;
  static const Color blueBg = Color(0xFFEEF6FF);
  static const Color blueBorder = Color(0xFFB5D9FD);

  /// The mock has no purple. This is a desaturated slate-violet chosen to sit in the
  /// same tonal family as the steel accent rather than the Tailwind violet it
  /// replaces, which read as a different product next to the blueprint palette.
  static const Color purple = Color(0xFF5F5386);
  static const Color purpleBg = Color(0xFFE8E6E9);
  static const Color purpleBorder = Color(0xFFC0BBCC);

  // ---------------------------------------------------------------------------
  // 3. Shape and spacing
  // ---------------------------------------------------------------------------

  /// The signature border width.
  static const double hairline = 1;

  // Every radius is zero. They stay named so a call site still reads from the
  // scale, and so that softening one surface later is a one-line change here
  // rather than a hunt through the widgets.
  static const double radiusInput = 0;
  static const double radiusRow = 0;
  static const double radiusCard = 0;
  static const double radiusHomeCard = 0;
  static const double radiusSheet = 0;
  static const double radiusPill = 0;

  /// Card padding, and the mock's page inset.
  static const double gutter = 20;

  /// Screen-edge padding for labels. The blueprint keeps one gutter, not two.
  static const double labelGutter = 20;

  /// Clearance above the bottom nav — the mock's `.home__spacer`.
  static const double scrollBottomSpacer = 130;

  static const BorderSide hairlineSide =
      BorderSide(color: line, width: hairline);
  static const BorderSide hairlineFaintSide =
      BorderSide(color: faint, width: hairline);

  /// Deliberately empty. In this system a card is defined by its 1px keyline, never
  /// by lift off the canvas. Kept as a token so the many call sites that spread it
  /// into a `BoxDecoration` keep compiling and keep reading from one place.
  static const List<BoxShadow> cardShadow = <BoxShadow>[];

  /// The one shadow in the system: the square bottom-nav FAB, the only element that
  /// sits above the page rather than on it. The mock's `--shadow-md`.
  static const List<BoxShadow> fabShadow = <BoxShadow>[
    BoxShadow(color: Color(0x292B2B2D), blurRadius: 10, offset: Offset(0, 3)),
  ];

  /// `ink` at low alpha — `shadowColor` for Material widgets (`Card`, `Dialog`,
  /// bottom sheet) whose elevation shadow can't be painted via [cardShadow].
  static const Color shadowTint = Color(0x292B2B2D);

  /// A card: `white` fill, 1px `line` border, square, flat.
  static BoxDecoration card({
    Color fill = white,
    Color border = line,
    double radius = radiusCard,
  }) {
    return BoxDecoration(
      color: fill,
      borderRadius: BorderRadius.circular(radius),
      border: Border.all(color: border, width: hairline),
      boxShadow: cardShadow,
    );
  }

  // ---------------------------------------------------------------------------
  // 4. Type scale
  // ---------------------------------------------------------------------------

  /// 30 / w700 Condensed — the `soko` wordmark.
  static final TextStyle display = _heading(
    size: 30,
    weight: FontWeight.w700,
    tracking: 0.3,
    height: 1,
  );

  /// 25 / w600 Condensed — screen heading and the hero headline.
  static final TextStyle screenTitle = _heading(size: 25, height: 1.2);

  /// 20 / w600 Condensed — nav bar title.
  static final TextStyle headerTitle = _heading(size: 20, height: 1.25);

  /// 17 / w600 Condensed — card heading, building name.
  static final TextStyle cardTitle = _heading(size: 17, height: 1.2);

  /// 14.5 / w500 — list row primary.
  static final TextStyle rowTitle =
      _body(size: 14.5, weight: FontWeight.w500, height: 1.3);

  /// 13.5 / w400 — paragraph text.
  static final TextStyle body = _body(size: 13.5, height: 1.5, color: ink2);

  /// 12.5 / w400 — list row secondary.
  static final TextStyle rowSub = _body(size: 12.5, height: 1.35, color: muted);

  /// 11 / tracked 0.14em — the section kicker. The most characteristic label in the
  /// system: uppercase, widely tracked, and never bold.
  static final TextStyle sectionLabel =
      _body(size: 11, tracking: 1.54, height: 1.3, color: mutedSoft);

  /// 11 / tracked 0.06em — pill and chip text.
  static final TextStyle pillLabel =
      _body(size: 11, tracking: 0.66, height: 1.3);

  /// 10.5 / tracked 0.04em — bottom nav.
  static final TextStyle navLabel =
      _body(size: 10.5, tracking: 0.42, height: 1.3, color: mutedSoft);

  /// 13 / w400 — empty state.
  static final TextStyle emptyText = _body(size: 13, height: 1.6, color: muted);

  // -- Figures ----------------------------------------------------------------
  //
  // The mock sets every standalone number in Barlow Condensed w600, not in a
  // monospace face. The `mono*` names are kept because ~40 call sites across both
  // apps read from them, but they now resolve to the condensed figure face; there
  // is no monospace in this design system.

  /// A figure, unsized — pair with one of the sized variants below.
  static final TextStyle mono = _heading(size: 14, height: 1.2);

  /// A ringed score or a hero KPI figure.
  static final TextStyle monoDisplay = _heading(size: 24, height: 1);

  /// A metric card figure.
  static final TextStyle monoFigure = _heading(size: 20, height: 1);

  /// A figure at row scale.
  static final TextStyle monoRow = _heading(size: 14, height: 1.2);

  /// A figure at caption scale.
  static final TextStyle monoSub = _heading(size: 14, height: 1.2);

  /// A small tracked figure label.
  static final TextStyle monoLabel =
      _heading(size: 12, height: 1.2, color: muted);
}

/// The one tone class: a `{fg, bg, border}` triad, so a badge, chip or icon tile can
/// be styled from a single value.
class AccentTone {
  const AccentTone({
    required this.foreground,
    required this.background,
    required this.border,
  });

  final Color foreground;
  final Color background;
  final Color border;

  // --- Risk band triads -----------------------------------------------------

  static const AccentTone green = AccentTone(
    foreground: CustomerTokens.green,
    background: CustomerTokens.greenBg,
    border: CustomerTokens.greenBorder,
  );
  static const AccentTone yellow = AccentTone(
    foreground: CustomerTokens.yellow,
    background: CustomerTokens.yellowBg,
    border: CustomerTokens.yellowBorder,
  );
  static const AccentTone orange = AccentTone(
    foreground: CustomerTokens.orange,
    background: CustomerTokens.orangeBg,
    border: CustomerTokens.orangeBorder,
  );
  static const AccentTone red = AccentTone(
    foreground: CustomerTokens.red,
    background: CustomerTokens.redBg,
    border: CustomerTokens.redBorder,
  );
  static const AccentTone black = AccentTone(
    foreground: CustomerTokens.black,
    background: CustomerTokens.blackBg,
    border: CustomerTokens.blackBorder,
  );

  /// The `unassessed` display state, and the neutral chip fill.
  static const AccentTone neutral = AccentTone(
    foreground: CustomerTokens.muted,
    background: CustomerTokens.soft,
    border: CustomerTokens.lineStrong,
  );

  // --- Non-risk status accents ----------------------------------------------

  static const AccentTone blue = AccentTone(
    foreground: CustomerTokens.blue,
    background: CustomerTokens.blueBg,
    border: CustomerTokens.blueBorder,
  );
  static const AccentTone purple = AccentTone(
    foreground: CustomerTokens.purple,
    background: CustomerTokens.purpleBg,
    border: CustomerTokens.purpleBorder,
  );
}
