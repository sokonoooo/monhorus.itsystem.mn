import 'package:flutter/material.dart';

/// The single source of visual truth for this app.
///
/// Transcribed from `docs/MOBILE_DESIGN_SYSTEM.md`, which both Flutter apps follow.
/// Every colour, size, weight, radius and spacing value in the product surface comes
/// from here; a literal `fontSize:`, hex or `BorderRadius.circular(<number>)` at a
/// call site is a defect.
///
/// `AppTheme` is a thin `ThemeData` layered on top of these values so Material's own
/// widgets agree with them. It never contradicts this file.
///
/// Visual direction: field instrument. White surfaces on a cool graphite canvas, a 1px
/// keyline plus a whisper of shadow (never a floating card), one spent-sparingly brand
/// accent, and a disciplined type scale. It should read like precision equipment built
/// to be scanned at a glance on a job site, not a printed document and not a glossy
/// consumer app.
class CustomerTokens {
  const CustomerTokens._();

  // ---------------------------------------------------------------------------
  // 1. Neutrals
  // ---------------------------------------------------------------------------

  /// Screen canvas.
  static const Color bg = Color(0xFFE4E7EC);

  /// Inset / recessed blocks inside a card.
  static const Color paper = Color(0xFFF6F7F9);

  /// Card and sheet surfaces.
  static const Color white = Color(0xFFFFFFFF);

  /// Primary text.
  static const Color ink = Color(0xFF12151B);

  /// Pressed state of an ink-foreground control (outline/text buttons).
  static const Color inkPressed = Color(0xFF262A33);

  /// Secondary text.
  static const Color ink2 = Color(0xFF3D434E);

  /// Captions, labels, disabled text.
  static const Color muted = Color(0xFF6B7280);

  /// The signature 1px keyline - card borders, dividers, hairlines.
  static const Color line = Color(0xFFD7DBE2);

  /// A stronger keyline - outline-button borders, emphasis dividers.
  static const Color lineStrong = Color(0xFFB7BEC9);

  /// Weaker divider.
  static const Color faint = Color(0xFFE7E9ED);

  /// Neutral chip fill, progress-track background.
  static const Color soft = Color(0xFFE9EBEF);

  /// Subtle zebra / hover fill.
  static const Color soft2 = Color(0xFFF3F4F6);

  /// The Material seed. Present so `ColorScheme.fromSeed` can keep Material's own
  /// focus, selection and cursor affordances sane. **Never painted directly** - use
  /// [accent] for anything that actually needs to render in the brand colour.
  static const Color materialSeed = Color(0xFF2563EB);

  /// The one brand accent, spent narrowly: the active tab, primary buttons, links,
  /// and in-progress/active-state emphasis. Never a background tint by itself.
  static const Color accent = Color(0xFF1D4ED8);

  /// Pressed state of an accent-filled control.
  static const Color accentPressed = Color(0xFF17399E);

  /// A tint of [accent] - selected-chip fills only, never a full-card background.
  static const Color accentBg = Color(0xFFE4EAFB);

  // ---------------------------------------------------------------------------
  // 2. Risk band colours - one triad per band
  // ---------------------------------------------------------------------------
  //
  // `fg` is the strong colour, `bg` the tint, `border` the outline.
  //
  // All five bands - plus the non-risk `blue`/`purple` accents below - now use white
  // label text on a solid-fill chip. The `ATTENTION` band was deepened specifically so
  // this holds without a dark-text exception; see rule change in
  // `MOBILE_DESIGN_SYSTEM.md` §1.

  static const Color green = Color(0xFF157A41);
  static const Color greenBg = Color(0xFFE6F2EA);
  static const Color greenBorder = Color(0xFFBCDAC8);

  static const Color yellow = Color(0xFFA8670A);
  static const Color yellowBg = Color(0xFFFAF0DD);
  static const Color yellowBorder = Color(0xFFE8CD97);

  static const Color orange = Color(0xFFC2410C);
  static const Color orangeBg = Color(0xFFFBE9DE);
  static const Color orangeBorder = Color(0xFFEABB98);

  static const Color red = Color(0xFFB91C1C);
  static const Color redBg = Color(0xFFFAE4E2);
  static const Color redBorder = Color(0xFFEAB5AE);

  static const Color black = Color(0xFF1C1917);
  static const Color blackBg = Color(0xFFE6E4E1);
  static const Color blackBorder = Color(0xFFB7B2AC);

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

  /// Shares its strong colour with [accent] by design - "in-flight / informational"
  /// status is the same idea as "active", just expressed as a status chip rather than
  /// a piece of chrome.
  static const Color blue = accent;
  static const Color blueBg = Color(0xFFE4EAFB);
  static const Color blueBorder = Color(0xFFB0C4F5);

  static const Color purple = Color(0xFF7B3FE4);
  static const Color purpleBg = Color(0xFFF0E9FF);
  static const Color purpleBorder = Color(0xFFC4A9FF);

  // ---------------------------------------------------------------------------
  // 3. Shape and spacing
  // ---------------------------------------------------------------------------

  /// The signature border width.
  static const double hairline = 1;

  static const double radiusInput = 8;
  static const double radiusRow = 10;
  static const double radiusCard = 12;
  static const double radiusHomeCard = 12;
  static const double radiusSheet = 14;

  /// A small rounded-rect tag radius - status pills and chips are technical labels,
  /// not marketing badges, so this is deliberately not a full stadium/capsule.
  static const double radiusPill = 6;

  /// Card padding.
  static const double gutter = 14;

  /// Screen-edge padding for labels.
  static const double labelGutter = 18;

  /// Clearance above the bottom nav.
  static const double scrollBottomSpacer = 84;

  static const BorderSide hairlineSide =
      BorderSide(color: line, width: hairline);
  static const BorderSide hairlineFaintSide =
      BorderSide(color: faint, width: hairline);

  /// The whisper of shadow every card carries - definition comes from the 1px
  /// keyline first, this is only ever a faint lift off the canvas.
  static const List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x0F10131A), blurRadius: 3, offset: Offset(0, 1)),
  ];

  /// `ink` at low alpha - `shadowColor` for Material widgets (`Card`, `Dialog`,
  /// bottom sheet) whose elevation shadow can't be painted via [cardShadow].
  static const Color shadowTint = Color(0x2912151B);

  /// A card: `white` fill, 1px `line` border, `radiusCard`, [cardShadow].
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
  //
  // System font, no bundled family.

  /// 26 / w900 - splash wordmark only.
  static const TextStyle display = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w900,
    height: 1.15,
    color: ink,
  );

  /// 19 / w900 - screen heading.
  static const TextStyle screenTitle = TextStyle(
    fontSize: 19,
    fontWeight: FontWeight.w900,
    height: 1.2,
    color: ink,
  );

  /// 17 / w800 - nav bar title.
  static const TextStyle headerTitle = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w800,
    height: 1.25,
    color: ink,
  );

  /// 15 / w800 - card heading.
  static const TextStyle cardTitle = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w800,
    height: 1.3,
    color: ink,
  );

  /// 13 / w600 - list row primary.
  static const TextStyle rowTitle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    height: 1.35,
    color: ink,
  );

  /// 13 / w400 - paragraph text.
  static const TextStyle body = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.55,
    color: ink2,
  );

  /// 11 / w400 - list row secondary.
  static const TextStyle rowSub = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    height: 1.35,
    color: muted,
  );

  /// 10 / w700, UPPERCASE, tracking 0.8 - section caption.
  static const TextStyle sectionLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.8,
    height: 1.3,
    color: muted,
  );

  /// 10 / w700 - pill and chip text.
  static const TextStyle pillLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.4,
    height: 1.3,
    color: ink,
  );

  /// 9 / w600 - bottom nav, and micro-captions inside a ring.
  static const TextStyle navLabel = TextStyle(
    fontSize: 9,
    fontWeight: FontWeight.w600,
    height: 1.3,
    color: muted,
  );

  /// 13 / w400 - empty state.
  static const TextStyle emptyText = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.6,
    color: muted,
  );

  /// Platform monospace, w700. Scores and counts only.
  ///
  /// No size of its own: pair it with one of the sized variants below so a figure
  /// still lands on the scale.
  static const TextStyle mono = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontWeight: FontWeight.w700,
    height: 1.2,
    color: ink,
  );

  /// `mono` at `display` size - a ringed score or a KPI figure.
  static const TextStyle monoDisplay = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontSize: 26,
    fontWeight: FontWeight.w700,
    height: 1,
    color: ink,
  );

  /// `mono` at `screenTitle` size - a metric card figure.
  static const TextStyle monoFigure = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontSize: 19,
    fontWeight: FontWeight.w700,
    height: 1,
    color: ink,
  );

  /// `mono` at `rowTitle` size.
  static const TextStyle monoRow = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontSize: 13,
    fontWeight: FontWeight.w700,
    height: 1.2,
    color: ink,
  );

  /// `mono` at `rowSub` size.
  static const TextStyle monoSub = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontSize: 11,
    fontWeight: FontWeight.w700,
    height: 1.2,
    color: ink,
  );

  /// `mono` at `pillLabel` size.
  static const TextStyle monoLabel = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontSize: 10,
    fontWeight: FontWeight.w700,
    height: 1.2,
    color: muted,
  );
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
