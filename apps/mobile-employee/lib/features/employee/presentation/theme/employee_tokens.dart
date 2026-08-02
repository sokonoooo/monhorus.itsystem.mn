import 'package:flutter/material.dart';

/// Design tokens for the employee app, mirroring `docs/MOBILE_DESIGN_SYSTEM.md`,
/// which both Flutter apps follow.
///
/// Visual direction: field instrument. White surfaces on a cool graphite canvas, a
/// 1px keyline plus a whisper of shadow, one spent-sparingly brand accent ([accent]),
/// and a disciplined type scale. It should read like precision equipment built to be
/// scanned at a glance on a job site — not a printed document, not a glossy consumer
/// app. Colour still encodes risk first: five distinct bands, not three, on pills,
/// score rings, plan dots, progress bars and left bars.
///
/// This is the whole palette and the whole type scale. A colour or a `fontSize:` at a
/// call site is a defect, and so is a second copy of either: `AccentTone`,
/// `ProjectTone`, `HomeTokens.mono`, two `monoStyle` constants and the auth screens'
/// Tailwind slate all used to exist alongside this file, and none of them do now.
/// `lib/core/theme/app_theme.dart` and `lib/features/auth` read from here too.
class EmployeeTokens {
  const EmployeeTokens._();

  // -- Neutrals --------------------------------------------------------------

  /// Screen background.
  static const Color bg = Color(0xFFE4E7EC);
  static const Color paper = Color(0xFFF6F7F9);

  /// Every card.
  static const Color white = Color(0xFFFFFFFF);

  /// Primary text.
  static const Color ink = Color(0xFF12151B);

  /// Pressed state for an ink-foreground control (outline/text buttons).
  static const Color inkPressed = Color(0xFF262A33);

  /// Secondary body text.
  static const Color ink2 = Color(0xFF3D434E);

  /// Labels, subtitles, inactive nav items.
  static const Color muted = Color(0xFF6B7280);

  /// Weaker divider.
  static const Color faint = Color(0xFFE7E9ED);

  /// Neutral chip fill, progress-track background.
  static const Color soft = Color(0xFFE9EBEF);

  /// Inset panels / subtle zebra fill.
  static const Color soft2 = Color(0xFFF3F4F6);

  /// The signature 1px card border.
  static const Color line = Color(0xFFD7DBE2);

  /// A stronger keyline - outline-button borders, emphasis dividers.
  static const Color lineStrong = Color(0xFFB7BEC9);

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

  // -- Status ----------------------------------------------------------------
  //
  // All five bands, plus the non-risk `blue`/`purple` accents below, use white label
  // text on a solid-fill chip; see the contrast-rule change in
  // `MOBILE_DESIGN_SYSTEM.md` §1.

  static const Color green = Color(0xFF157A41);
  static const Color greenBg = Color(0xFFE6F2EA);
  static const Color greenBorder = Color(0xFFBCDAC8);

  static const Color yellow = Color(0xFFA8670A);
  static const Color yellowBg = Color(0xFFFAF0DD);
  static const Color yellowBorder = Color(0xFFE8CD97);

  /// SCHEDULE_REPAIR. Lives here, not in a feature's own tone file: the palette is
  /// one table and a band colour hidden inside a tab is how five bands became three.
  static const Color orange = Color(0xFFC2410C);
  static const Color orangeBg = Color(0xFFFBE9DE);
  static const Color orangeBorder = Color(0xFFEABB98);

  static const Color red = Color(0xFFB91C1C);
  static const Color redBg = Color(0xFFFAE4E2);
  static const Color redBorder = Color(0xFFEAB5AE);

  /// Danger pressed state.
  static const Color redPressed = Color(0xFF8F1515);

  /// OUT_OF_SERVICE.
  static const Color black = Color(0xFF1C1917);
  static const Color blackBg = Color(0xFFE6E4E1);
  static const Color blackBorder = Color(0xFFB7B2AC);

  /// The label colour on a solid band-filled chip.
  static const Color onAttention = Color(0xFFFFFFFF);

  // -- Non-risk status accents -------------------------------------------------
  //
  // Deliberately kept apart from the band triads above. Mirrors `CustomerTokens.blue`
  // / `.purple` for parity between the two apps; see `MOBILE_DESIGN_SYSTEM.md`.

  /// Shares its strong colour with [accent] by design - "in-flight / informational"
  /// status is the same idea as "active", just expressed as a status chip rather than
  /// a piece of chrome.
  static const Color blue = accent;
  static const Color blueBg = Color(0xFFE4EAFB);
  static const Color blueBorder = Color(0xFFB0C4F5);

  static const Color purple = Color(0xFF7B3FE4);
  static const Color purpleBg = Color(0xFFF0E9FF);
  static const Color purpleBorder = Color(0xFFC4A9FF);

  // -- Shape -----------------------------------------------------------------

  /// The signature outline: 1px solid [line] on white.
  static const double hairline = 1;

  static const double radiusInput = 8;
  static const double radiusRow = 10;

  /// Main cards and the floor plan.
  static const double radiusCard = 12;

  /// Home-tab cards.
  static const double radiusHomeCard = 12;

  /// Bottom-sheet top corners and the home hero.
  static const double radiusSheet = 14;

  /// A small rounded-rect tag radius - status pills and chips are technical labels,
  /// not marketing badges, so this is deliberately not a full stadium/capsule.
  static const double radiusPill = 6;

  /// Screen-level cards and rows sit 14px in from the edge; section labels and
  /// breadcrumbs use 18px. The two gutters are deliberately different.
  static const double gutter = 14;
  static const double labelGutter = 18;

  /// Trailing spacer so the last card clears the bottom nav.
  static const double scrollBottomSpacer = 84;

  static Border get cardBorder =>
      Border.all(color: line, width: hairline);

  /// The whisper of shadow every card carries - definition comes from the 1px
  /// keyline first, this is only ever a faint lift off the canvas.
  static const List<BoxShadow> cardShadow = <BoxShadow>[
    BoxShadow(color: Color(0x0F10131A), blurRadius: 3, offset: Offset(0, 1)),
  ];

  /// `ink` at low alpha - `shadowColor` for Material widgets (`Card`, `Dialog`,
  /// bottom sheet) whose elevation shadow can't be painted via [cardShadow].
  static const Color shadowTint = Color(0x2912151B);

  /// A card: white, 1px [line], [cardShadow].
  static BoxDecoration card({
    Color fill = white,
    Color border = line,
    double radius = radiusCard,
  }) {
    return BoxDecoration(
      color: fill,
      border: Border.all(color: border, width: hairline),
      borderRadius: BorderRadius.circular(radius),
      boxShadow: cardShadow,
    );
  }

  // -- Type ------------------------------------------------------------------

  /// Tab-screen title, e.g. "Ажил" / "Төслүүд".
  static const TextStyle screenTitle = TextStyle(
    fontSize: 19,
    fontWeight: FontWeight.w900,
    color: ink,
    height: 1.2,
  );

  /// Detail-header title.
  static const TextStyle headerTitle = TextStyle(
    fontSize: 17,
    fontWeight: FontWeight.w800,
    color: ink,
    height: 1.2,
  );

  /// Card heading.
  static const TextStyle cardTitle = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w800,
    color: ink,
    height: 1.3,
  );

  /// List-row title.
  static const TextStyle rowTitle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    color: ink,
    height: 1.35,
  );

  /// List-row subtitle. Cyrillic runs long, so callers must keep maxLines and
  /// `TextOverflow.ellipsis` on every use.
  static const TextStyle rowSub = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    color: muted,
    height: 1.4,
  );

  /// Section label: 10px, w700, uppercase, tracked out.
  static const TextStyle sectionLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w700,
    color: muted,
    letterSpacing: 0.8,
    height: 1.4,
  );

  /// Pill text: 10px, w700, uppercase.
  static const TextStyle pillLabel = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.4,
    height: 1.3,
  );

  /// Bottom-nav label.
  static const TextStyle navLabel = TextStyle(
    fontSize: 9,
    fontWeight: FontWeight.w600,
    height: 1.2,
  );

  /// Empty-state caption.
  static const TextStyle emptyText = TextStyle(
    fontSize: 13,
    color: muted,
    height: 1.5,
  );

  /// Splash wordmark.
  static const TextStyle display = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w900,
    color: ink,
    height: 1.2,
  );

  /// Paragraph text.
  static const TextStyle body = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    color: ink2,
    height: 1.5,
  );

  /// The prototype's JetBrains Mono runs — codes, scores, counts and timestamps. No
  /// font asset is bundled, so the platform monospace face is asked for by family
  /// name and the fallbacks cover iOS, Android and the test host.
  ///
  /// Lived in `HomeTokens.mono` and again as `monoStyle` in two feature files; there
  /// is one now.
  static const TextStyle mono = TextStyle(
    fontFamily: 'monospace',
    fontFamilyFallback: <String>['Menlo', 'Roboto Mono', 'Courier New'],
    fontWeight: FontWeight.w700,
  );

  // -- Document-scale extensions ---------------------------------------------
  //
  // The five styles below are the scale above applied to the three places the
  // instrument-panel look needs a figure rather than a sentence. They are here
  // rather than at a call site so a `fontSize:` literal stays a defect.

  /// The caption over a metric figure: smaller and more tracked than
  /// [sectionLabel], because it sits inside a 12px-padded tile.
  static const TextStyle microLabel = TextStyle(
    fontSize: 9,
    fontWeight: FontWeight.w700,
    letterSpacing: 0.6,
    color: muted,
    height: 1.3,
  );

  /// The note under a metric figure.
  static const TextStyle microNote = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w400,
    color: muted,
    height: 1.3,
  );

  /// A metric tile's figure.
  static final TextStyle metricValue = mono.copyWith(
    fontSize: 20,
    fontWeight: FontWeight.w900,
    height: 1,
    color: ink,
  );

  /// The one big figure on the home hero.
  static final TextStyle heroValue = mono.copyWith(
    fontSize: 52,
    fontWeight: FontWeight.w900,
    height: 1.1,
    color: ink,
  );

  /// A KPI column's figure.
  static const TextStyle kpiValue = TextStyle(
    fontSize: 22,
    fontWeight: FontWeight.w900,
    height: 1.15,
    color: ink,
  );

  /// The number inside a `ScoreRing`.
  static final TextStyle scoreValue = mono.copyWith(
    fontSize: 24,
    fontWeight: FontWeight.w900,
    height: 1,
    color: ink,
  );

  /// A key/value line inside a card.
  static const TextStyle detailValue = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w700,
    color: ink,
    height: 1.4,
  );

  /// The heading of a tinted notice banner. Callers tint it with the tone's `fg`.
  static const TextStyle noticeTitle = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w800,
    color: ink,
    height: 1.4,
  );

  /// The explanation under a [noticeTitle].
  static const TextStyle noticeBody = TextStyle(
    fontSize: 12,
    fontWeight: FontWeight.w600,
    color: ink2,
    height: 1.5,
  );

  /// A full-width call to action.
  static const TextStyle buttonLabel = TextStyle(
    fontSize: 14,
    fontWeight: FontWeight.w800,
    color: white,
    height: 1.2,
  );
}

/// The `{foreground, background, border}` triad every tinted surface is styled from.
///
/// There is exactly one of these per app. It replaces `Tone` and `Tone`,
/// which were the same three fields under two names, plus the bare `Color` a third
/// family of pills took — three parameter types for one idea.
@immutable
class Tone {
  const Tone({
    required this.foreground,
    required this.background,
    required this.border,
  });

  /// The strong colour: glyphs, swatches, rings, icons.
  final Color foreground;

  /// The tint behind a chip or a banner.
  final Color background;

  /// The outline.
  final Color border;

  static const Tone green = Tone(
    foreground: EmployeeTokens.green,
    background: EmployeeTokens.greenBg,
    border: EmployeeTokens.greenBorder,
  );

  static const Tone yellow = Tone(
    foreground: EmployeeTokens.yellow,
    background: EmployeeTokens.yellowBg,
    border: EmployeeTokens.yellowBorder,
  );

  static const Tone orange = Tone(
    foreground: EmployeeTokens.orange,
    background: EmployeeTokens.orangeBg,
    border: EmployeeTokens.orangeBorder,
  );

  static const Tone red = Tone(
    foreground: EmployeeTokens.red,
    background: EmployeeTokens.redBg,
    border: EmployeeTokens.redBorder,
  );

  static const Tone black = Tone(
    foreground: EmployeeTokens.black,
    background: EmployeeTokens.blackBg,
    border: EmployeeTokens.blackBorder,
  );

  /// A state that carries no severity — and the display tone of an unassessed
  /// object, which is grey rather than green on purpose.
  static const Tone neutral = Tone(
    foreground: EmployeeTokens.muted,
    background: EmployeeTokens.soft,
    border: EmployeeTokens.lineStrong,
  );

  /// Mirrors `AccentTone.blue` in the customer app: in-flight / informational
  /// states.
  static const Tone blue = Tone(
    foreground: EmployeeTokens.blue,
    background: EmployeeTokens.blueBg,
    border: EmployeeTokens.blueBorder,
  );

  /// Mirrors `AccentTone.purple` in the customer app: scheduled / awaiting states.
  static const Tone purple = Tone(
    foreground: EmployeeTokens.purple,
    background: EmployeeTokens.purpleBg,
    border: EmployeeTokens.purpleBorder,
  );

  /// A white chip with a faint border and readable ink text.
  ///
  /// The prototype's `pill-b` is white text on a white chip, which renders as an
  /// invisible label; transcribing that literally would be copying a bug.
  static const Tone outline = Tone(
    foreground: EmployeeTokens.ink,
    background: EmployeeTokens.white,
    border: EmployeeTokens.faint,
  );

  /// A filled ink chip, for the one control that has to out-rank the others.
  static const Tone ink = Tone(
    foreground: EmployeeTokens.white,
    background: EmployeeTokens.ink,
    border: EmployeeTokens.ink,
  );

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Tone &&
          other.foreground == foreground &&
          other.background == background &&
          other.border == border);

  @override
  int get hashCode => Object.hash(foreground, background, border);

  /// The triad that goes with a bare status colour.
  ///
  /// A compatibility shim for the lifecycle enums, whose `tone` is a single [Color]
  /// used for progress rails and button accents as well as for chips. Risk never
  /// takes this path: `RiskLevel.tone` is already a [Tone].
  static Tone ofStatusColor(Color color) {
    if (color == EmployeeTokens.green) return Tone.green;
    if (color == EmployeeTokens.yellow) return Tone.yellow;
    if (color == EmployeeTokens.orange) return Tone.orange;
    if (color == EmployeeTokens.red) return Tone.red;
    if (color == EmployeeTokens.black) return Tone.black;
    return Tone.neutral;
  }
}
