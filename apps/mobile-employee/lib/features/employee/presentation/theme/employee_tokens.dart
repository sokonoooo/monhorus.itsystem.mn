import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Design tokens for the employee app, mirroring the customer app's
/// `CustomerTokens` value for value.
///
/// Visual direction: **blueprint**, transcribed from the `soko` home mock
/// (`Soko Customer Home.html`), direction 1b — "steel". A warm paper ground that is
/// deliberately not grey, a dark navy hero band anchoring the top of the screen,
/// square corners everywhere, 1px hairlines instead of shadows, condensed headings
/// against a humanist body face, and uppercase letter-spaced kickers. It should
/// read like a technical drawing of the day's work, not a consumer dashboard.
/// Colour still encodes risk first: five distinct bands, not three, on pills, score
/// rings, plan dots, progress bars and left bars.
///
/// Two rules carried over from the mock and worth stating plainly:
///
/// * **Nothing is rounded.** The mock overrides its own radius tokens to `0` on
///   every component. [radiusCard] and friends are kept as named zeros so call
///   sites keep reading from the scale rather than hardcoding it.
/// * **Nothing floats.** Definition comes from the hairline. [cardShadow] is
///   deliberately empty; the one shadow in the system is [fabShadow].
///
/// This is the whole palette and the whole type scale. A colour or a `fontSize:` at
/// a call site is a defect, and so is a second copy of either.
/// `lib/core/theme/app_theme.dart` and `lib/features/auth` read from here too.
class EmployeeTokens {
  const EmployeeTokens._();

  // -- Type faces --------------------------------------------------------------
  //
  // Fira Sans and Fira Sans Condensed, fetched by `google_fonts` and cached to
  // disk. `main()` awaits `GoogleFonts.pendingFonts` before the first frame so text
  // does not land in the system face and reflow.
  //
  // NOT Barlow, which is what the HTML mock uses. Barlow and Barlow Condensed carry
  // no Cyrillic at all — 0 of the 64 basic letters, and none of Mongolian's Ө/ө/Ү/ү
  // — so every string in this app would have silently fallen back to the system
  // face and only the digits would have been the intended face. Fira Sans is the
  // same idea drawn with full Cyrillic: a humanist UI sans with a true condensed
  // sibling, so the mock's body/condensed-heading pairing survives.
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

  // -- Neutrals --------------------------------------------------------------

  /// Screen background. The mock's `--home-paper-alt` — warm, not grey.
  static const Color bg = Color(0xFFFDFDFB);

  /// The slightly warmer paper used for recessed blocks and the tab bar.
  static const Color paper = Color(0xFFFBFAF7);

  /// Every card.
  static const Color white = Color(0xFFFFFFFF);

  /// Primary text.
  static const Color ink = Color(0xFF1D1F20);

  /// Pressed state for an ink-foreground control (outline/text buttons).
  static const Color inkPressed = Color(0xFF2B2B2D);

  /// Secondary body text — `ink` at 70%.
  static const Color ink2 = Color(0xB31D1F20);

  /// Labels, subtitles, inactive nav items — `ink` at 55%.
  static const Color muted = Color(0x8C1D1F20);

  /// The softest label tint — `ink` at 45%. Section kickers, inactive tabs.
  static const Color mutedSoft = Color(0x731D1F20);

  /// Chevrons and other passive affordances — `ink` at 35%.
  static const Color chevron = Color(0x591D1F20);

  /// Weaker divider.
  static const Color faint = Color(0x141D1F20);

  /// Neutral chip fill, progress-track background.
  static const Color soft = Color(0xFFE7E7EA);

  /// Inset panels / subtle zebra fill.
  static const Color soft2 = Color(0xFFF5F5F8);

  /// The signature 1px card border. `ink` at 16%, exactly the mock's
  /// `--color-divider`.
  static const Color line = Color(0x291D1F20);

  /// A stronger keyline - outline-button borders, emphasis dividers.
  static const Color lineStrong = Color(0x591D1F20);

  /// The Material seed. Present so `ColorScheme.fromSeed` can keep Material's own
  /// focus, selection and cursor affordances sane. **Never painted directly** - use
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

  /// A tint of [accent] - selected-chip fills only, never a full-card background.
  static const Color accentBg = Color(0xFFEEF6FF);

  /// Row hover / pressed wash — `accent` at 6% / 10%.
  static const Color accentWash = Color(0x0F5980A6);
  static const Color accentWashStrong = Color(0x1A5980A6);

  // -- The launcher colour ----------------------------------------------------
  //
  // The hue of the app's own icon, used ONLY on the sign-in screen.
  //
  // Deliberately not [accent]: both apps ship the same steel-blue accent because the
  // product surfaces inside them are the same product, and recolouring those would be a
  // rebrand rather than a sign-in screen. What the sign-in screen has to answer is a
  // narrower question — "is this the app I just tapped" — and the only honest answer to
  // that is the colour on the icon the person tapped.
  //
  // Read from the launcher artwork rather than chosen: `Icon-App-1024x1024@1x.png`.

  /// The icon's field colour.
  static const Color brand = Color(0xFFE66237);

  /// The same hue darkened, for the foot of the sign-in gradient and the pressed button.
  static const Color brandDeep = Color(0xFFC24A22);

  // -- The hero band ----------------------------------------------------------
  //
  // Direction 1b's defining move: a dark navy block behind the greeting and the
  // day's figures. It is the only dark surface in the system.

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

  // -- Status ----------------------------------------------------------------
  //
  // The mock's risk ramp runs green → deep maroon across five steps and is the one
  // place saturated colour is allowed. The `Bg`/`Border` tints are each strong
  // colour mixed toward the paper ground at 12% and 38%, so a chip stays legible on
  // paper without introducing a hue the ramp does not already contain.
  //
  // All five bands, plus the non-risk `blue`/`purple` accents below, use white label
  // text on a solid-fill chip.

  static const Color green = Color(0xFF4C7A52);
  static const Color greenBg = Color(0xFFE6EBE3);
  static const Color greenBorder = Color(0xFFB9C9B8);

  static const Color yellow = Color(0xFF9A8226);
  static const Color yellowBg = Color(0xFFEFECDE);
  static const Color yellowBorder = Color(0xFFD6CCA8);

  /// SCHEDULE_REPAIR. Lives here, not in a feature's own tone file: the palette is
  /// one table and a band colour hidden inside a tab is how five bands became three.
  static const Color orange = Color(0xFFC0722C);
  static const Color orangeBg = Color(0xFFF4EADF);
  static const Color orangeBorder = Color(0xFFE4C6AA);

  static const Color red = Color(0xFFB0413A);
  static const Color redBg = Color(0xFFF2E4E0);
  static const Color redBorder = Color(0xFFDEB4AF);

  /// Danger pressed state.
  static const Color redPressed = Color(0xFF8A322C);

  /// OUT_OF_SERVICE.
  static const Color black = Color(0xFF7A2B26);
  static const Color blackBg = Color(0xFFECE1DE);
  static const Color blackBorder = Color(0xFFCAABA8);

  /// The label colour on a solid band-filled chip.
  static const Color onAttention = Color(0xFFFFFFFF);

  // -- Non-risk status accents -------------------------------------------------
  //
  // Deliberately kept apart from the band triads above. Mirrors
  // `CustomerTokens.blue` / `.purple` for parity between the two apps.

  /// Shares its strong colour with [accentText] by design - "in-flight /
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

  // -- Shape -----------------------------------------------------------------

  /// The signature outline: 1px solid [line] on white.
  static const double hairline = 1;

  // Every radius is zero. They stay named so a call site still reads from the
  // scale, and so that softening one surface later is a one-line change here
  // rather than a hunt through the widgets.
  static const double radiusInput = 0;
  static const double radiusRow = 0;

  /// Main cards and the floor plan.
  static const double radiusCard = 0;

  /// Home-tab cards.
  static const double radiusHomeCard = 0;

  /// Bottom-sheet top corners and the home hero.
  static const double radiusSheet = 0;

  /// Status pills and chips.
  static const double radiusPill = 0;

  /// The blueprint keeps one gutter, not two: the mock insets every page-level
  /// element 20px from the edge, labels included.
  static const double gutter = 20;
  static const double labelGutter = 20;

  /// Trailing spacer so the last card clears the bottom nav — the mock's
  /// `.home__spacer`.
  static const double scrollBottomSpacer = 130;

  static Border get cardBorder => Border.all(color: line, width: hairline);

  /// Deliberately empty. In this system a card is defined by its 1px keyline, never
  /// by lift off the canvas. Kept as a token so the many call sites that spread it
  /// into a `BoxDecoration` keep compiling and keep reading from one place.
  static const List<BoxShadow> cardShadow = <BoxShadow>[];

  /// The one shadow in the system: the square bottom-nav FAB, the only element that
  /// sits above the page rather than on it. The mock's `--shadow-md`.
  static const List<BoxShadow> fabShadow = <BoxShadow>[
    BoxShadow(color: Color(0x292B2B2D), blurRadius: 10, offset: Offset(0, 3)),
  ];

  /// `ink` at low alpha - `shadowColor` for Material widgets (`Card`, `Dialog`,
  /// bottom sheet) whose elevation shadow can't be painted via [cardShadow].
  static const Color shadowTint = Color(0x292B2B2D);

  /// A card: white, 1px [line], square, flat.
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
  static final TextStyle screenTitle = _heading(size: 25, height: 1.2);

  /// Detail-header title.
  static final TextStyle headerTitle = _heading(size: 20, height: 1.2);

  /// Card heading.
  static final TextStyle cardTitle = _heading(size: 17, height: 1.2);

  /// List-row title.
  static final TextStyle rowTitle =
      _body(size: 14.5, weight: FontWeight.w500, height: 1.3);

  /// List-row subtitle. Cyrillic runs long, so callers must keep maxLines and
  /// `TextOverflow.ellipsis` on every use.
  static final TextStyle rowSub = _body(size: 12.5, height: 1.4, color: muted);

  /// The section kicker: 11px, tracked 0.14em. The most characteristic label in the
  /// system — uppercase, widely tracked, and never bold.
  static final TextStyle sectionLabel =
      _body(size: 11, tracking: 1.54, height: 1.4, color: mutedSoft);

  /// Pill text: 11px, tracked 0.06em.
  static final TextStyle pillLabel =
      _body(size: 11, tracking: 0.66, height: 1.3);

  /// Bottom-nav label.
  static final TextStyle navLabel =
      _body(size: 10.5, tracking: 0.42, height: 1.3, color: mutedSoft);

  /// Empty-state caption.
  static final TextStyle emptyText = _body(size: 13, height: 1.5, color: muted);

  /// Splash wordmark.
  static final TextStyle display = _heading(
    size: 30,
    weight: FontWeight.w700,
    tracking: 0.3,
    height: 1,
  );

  /// Paragraph text.
  static final TextStyle body = _body(size: 13.5, height: 1.5, color: ink2);

  /// A figure, unsized — pair with one of the sized variants below.
  ///
  /// The mock sets every standalone number in Barlow Condensed w600, not in a
  /// monospace face. The name is kept because call sites across the app read from
  /// it, but there is no monospace in this design system any more.
  static final TextStyle mono = _heading(size: 14, height: 1.2);

  // -- Document-scale extensions ---------------------------------------------
  //
  // The styles below are the scale above applied to the places the blueprint needs
  // a figure rather than a sentence. They are here rather than at a call site so a
  // `fontSize:` literal stays a defect.

  /// The caption over a metric figure: smaller and more tracked than
  /// [sectionLabel], because it sits inside a 12px-padded tile.
  static final TextStyle microLabel =
      _body(size: 9.5, tracking: 0.48, height: 1.3, color: mutedSoft);

  /// The note under a metric figure.
  static final TextStyle microNote =
      _body(size: 10.5, height: 1.3, color: muted);

  /// A metric tile's figure.
  static final TextStyle metricValue = _heading(size: 22, height: 1);

  /// The one big figure on the home hero.
  static final TextStyle heroValue =
      _heading(size: 52, height: 1, color: onHero);

  /// A KPI column's figure.
  static final TextStyle kpiValue = _heading(size: 24, height: 1);

  /// The number inside a `ScoreRing`.
  static final TextStyle scoreValue = _heading(size: 24, height: 1);

  /// A key/value line inside a card.
  static final TextStyle detailValue =
      _body(size: 12.5, weight: FontWeight.w500, height: 1.4);

  /// The heading of a tinted notice banner. Callers tint it with the tone's `fg`.
  static final TextStyle noticeTitle = _heading(size: 15, height: 1.25);

  /// The explanation under a [noticeTitle].
  static final TextStyle noticeBody =
      _body(size: 12.5, height: 1.5, color: ink2);

  /// A full-width call to action.
  static final TextStyle buttonLabel = _body(
    size: 13.5,
    weight: FontWeight.w500,
    tracking: 0.54,
    height: 1.2,
    color: white,
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

  /// The triad for a colour NAME sent by the server, or null for one this palette
  /// has no answer for.
  ///
  /// `GET /vocabulary` names a colour rather than sending a hex, because every client
  /// paints in its own system — Tailwind classes on the web, these triads here — and
  /// neither can build one from an arbitrary runtime string. This is where the two
  /// closed palettes meet ours:
  ///
  /// * `RISK_COLOURS` — green, yellow, orange, red, black, grey, blue, purple.
  /// * `STAGE_COLOURS` — grey, blue, indigo, amber, orange, green, red.
  ///
  /// `amber` folds onto [yellow] and `indigo` onto [purple]: this system has one
  /// warm-signal hue and one violet, and inventing a second of either for a name we
  /// happen not to carry would put a colour on screen that no risk band uses and no
  /// reader could match to anything else.
  ///
  /// Null rather than a default, so the caller keeps the tone it was compiled with
  /// instead of a stage silently going grey because a future palette grew a name.
  static Tone? named(String? colour) {
    return switch (colour) {
      'green' => Tone.green,
      'yellow' || 'amber' => Tone.yellow,
      'orange' => Tone.orange,
      'red' => Tone.red,
      'black' => Tone.black,
      'grey' => Tone.neutral,
      'blue' => Tone.blue,
      'purple' || 'indigo' => Tone.purple,
      _ => null,
    };
  }

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
