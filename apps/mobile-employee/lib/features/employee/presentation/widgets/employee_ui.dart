/// Primitives shared by more than one tab.
///
/// Shell-owned, like `employee_tokens.dart` next door, because no single feature
/// should own a widget four others draw. Each of the five tabs arrived with its own
/// copy of the two widgets below — the same markup, differing only in a padding value
/// — so they are lifted here once and configured per tab rather than reimplemented
/// per tab.
///
/// A tab's own `*_ui.dart` still owns everything that is genuinely its own: the
/// prototype's tab-specific cards, pills and rows are not forced into a shared
/// vocabulary just because they rhyme.
library;

import 'package:flutter/material.dart';

import '../../project/domain/entities/risk_level.dart';
import '../theme/employee_tokens.dart';
import 'risk_glyph.dart';

/// `.sec` — the small uppercase caption above a group.
///
/// One widget. The five tabs arrived with `SectionLabel`, `SectionCaption` (twice),
/// `HomeSectionLabel` and a bare `Padding`, all of them the same 10px w700 tracked
/// caption on the 16px label gutter.
class SectionHeading extends StatelessWidget {
  const SectionHeading(
    this.text, {
    super.key,
    this.topPadding = 18,
    this.gutter = EmployeeTokens.labelGutter,
    this.trailing,
  });

  final String text;
  final double topPadding;

  /// The home tab lays its cards out on its own 16px rhythm; every other tab uses
  /// [EmployeeTokens.labelGutter], which is the same number for a different reason.
  final double gutter;

  /// An optional control on the caption's right — a count, a filter, a link.
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final Widget label = Text(
      text.toUpperCase(),
      style: EmployeeTokens.sectionLabel,
    );

    return Padding(
      padding: EdgeInsets.fromLTRB(gutter, topPadding, gutter, 8),
      child: trailing == null
          ? label
          : Row(
              children: <Widget>[
                Expanded(child: label),
                trailing!,
              ],
            ),
    );
  }
}

/// `.pill` — the app's one status chip.
///
/// There used to be five of these — `HomePill`, `WorkPill`, `ProjectPill` and two
/// different `StatusPill`s — taking three different tone parameter types between
/// them. They are this widget now. Everything a chip can carry is here: an optional
/// leading dot, an optional risk glyph, and the choice of ellipsising or not.
class EmployeePill extends StatelessWidget {
  const EmployeePill({
    super.key,
    required this.label,
    required this.tone,
    this.showDot = false,
    this.showGlyph = false,
    this.glyphLevel,
    this.flexibleText = false,
    this.semanticLabel,
  });

  /// A neutral white chip with a faint border and ink text.
  const EmployeePill.outline({
    super.key,
    required this.label,
    this.flexibleText = false,
    this.semanticLabel,
  })  : tone = Tone.outline,
        showDot = false,
        showGlyph = false,
        glyphLevel = null;

  /// For a lifecycle enum whose `tone` is a bare [Color] because it also paints a
  /// progress rail and a button accent. Risk never takes this path.
  EmployeePill.status({
    super.key,
    required this.label,
    required Color color,
    this.showDot = false,
    this.flexibleText = false,
    this.semanticLabel,
  })  : tone = Tone.ofStatusColor(color),
        showGlyph = false,
        glyphLevel = null;

  final String label;
  final Tone tone;
  final bool showDot;

  /// Draws the band silhouette ahead of the label.
  ///
  /// Separate from [glyphLevel] because a null band is a glyph — the hollow ring an
  /// unassessed object carries — and a nullable field alone cannot tell "no glyph"
  /// from "the unassessed glyph".
  final bool showGlyph;

  final RiskLevel? glyphLevel;

  /// Lets a long band name ellipsise instead of overflowing.
  ///
  /// Opt-in rather than always on: a [Flexible] child needs a bounded main axis, and
  /// this chip is also used inside a [Wrap], which hands its children unbounded width.
  final bool flexibleText;

  /// What a screen reader announces instead of the abbreviation. Risk indicators
  /// pass the full band name here.
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final Widget text = Text(
      label.toUpperCase(),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: EmployeeTokens.pillLabel.copyWith(color: tone.foreground),
    );

    final Widget chip = Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusPill),
        border: Border.all(color: tone.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (showGlyph) ...<Widget>[
            RiskGlyph(level: glyphLevel, size: 9, color: tone.foreground),
            const SizedBox(width: 5),
          ] else if (showDot) ...<Widget>[
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: tone.foreground,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 5),
          ],
          if (flexibleText) Flexible(child: text) else text,
        ],
      ),
    );

    if (semanticLabel == null) return chip;
    return Semantics(
      label: semanticLabel,
      excludeSemantics: true,
      child: chip,
    );
  }
}

/// The 4px progress rail under a card.
///
/// A zero-length bar reads as a broken widget rather than as "nothing done yet", so
/// the fill has a 2% floor. It is drawn as a clipped `Stack` rather than a
/// `LinearProgressIndicator` because the value is always determinate and the
/// indicator's animation machinery is not wanted here.
class ProgressRail extends StatelessWidget {
  const ProgressRail({
    super.key,
    required this.percent,
    required this.color,
    this.height = 4,
  });

  /// 0–100, as the server sent it. Clamped rather than trusted.
  final double percent;

  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final double fraction = (percent.clamp(0, 100) / 100).toDouble();

    return ClipRRect(
      borderRadius: BorderRadius.circular(height),
      child: SizedBox(
        height: height,
        child: Stack(
          children: <Widget>[
            const Positioned.fill(child: ColoredBox(color: EmployeeTokens.soft)),
            FractionallySizedBox(
              widthFactor: fraction < 0.02 ? 0.02 : fraction,
              child: ColoredBox(color: color),
            ),
          ],
        ),
      ),
    );
  }
}

/// `.empty-state` — a 38px stroked icon at 35% opacity over a muted caption, with an
/// optional action beneath.
///
/// The metrics are parameters because the five tabs each chose slightly different
/// padding for their own screens, and preserving those choices costs one argument
/// where re-deriving the widget cost forty lines.
class EmployeeEmptyState extends StatelessWidget {
  const EmployeeEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.title,
    this.action,
    this.padding = const EdgeInsets.symmetric(horizontal: 24, vertical: 36),
    this.gap = 10,
    this.actionGap = 16,
  });

  final IconData icon;
  final String message;

  /// An optional bold line above [message], for a state that needs a heading as well
  /// as an explanation.
  final String? title;

  /// The tab's own button, so each keeps its shape (outlined chip, full-width, or
  /// none) without this widget having to know about any of them.
  final Widget? action;

  final EdgeInsets padding;
  final double gap;
  final double actionGap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Opacity(
            opacity: 0.35,
            child: Icon(icon, size: 38, color: EmployeeTokens.ink),
          ),
          SizedBox(height: gap),
          if (title != null) ...<Widget>[
            Text(
              title!,
              textAlign: TextAlign.center,
              style: EmployeeTokens.cardTitle,
            ),
            const SizedBox(height: 6),
          ],
          Text(
            message,
            textAlign: TextAlign.center,
            style: EmployeeTokens.emptyText,
          ),
          if (action != null) ...<Widget>[
            SizedBox(height: actionGap),
            action!,
          ],
        ],
      ),
    );
  }
}

/// The prototype's toast, as a SnackBar: white, hairline border, a coloured leading
/// glyph, dismissed after 2.5 seconds.
///
/// Shell-owned for the same reason as the widgets above — the Ажил and Төсөл tabs
/// both report the outcome of a write this way, and two copies would drift.
void showEmployeeToast(
  BuildContext context, {
  required String message,
  required Color tone,
  IconData icon = Icons.check,
}) {
  final ScaffoldMessengerState messenger = ScaffoldMessenger.of(context);
  messenger
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        behavior: SnackBarBehavior.floating,
        backgroundColor: EmployeeTokens.white,
        elevation: 4,
        duration: const Duration(milliseconds: 2500),
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          side: const BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
        content: Row(
          children: <Widget>[
            Icon(icon, size: 17, color: tone),
            const SizedBox(width: 10),
            Expanded(
              child: Text(
                message,
                style: EmployeeTokens.rowTitle.copyWith(fontWeight: FontWeight.w700),
              ),
            ),
          ],
        ),
      ),
    );
}
