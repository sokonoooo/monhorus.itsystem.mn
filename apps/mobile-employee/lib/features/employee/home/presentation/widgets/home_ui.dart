import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_ui.dart';

export '../../../presentation/widgets/employee_ui.dart'
    show EmployeePill, ProgressRail, SectionHeading;

/// The prototype's home-screen primitives, one widget per CSS class, so the screen
/// reads as layout rather than as styling.
///
/// The home tab keeps its own 16px gutter, which is deliberate in the prototype. Its
/// card treatment is the same as every other card in the app: [EmployeeTokens.card].

/// The home tab's horizontal rhythm: 10px wrapper plus 6px card margin.
const double kHomeGutter = 16;

/// `.home-hero` / `.home-card` — [EmployeeTokens.card] at `radiusHomeCard`.
class HomeCard extends StatelessWidget {
  const HomeCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.margin = const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 10),
    this.radius = EmployeeTokens.radiusHomeCard,
    this.accent,
    this.onTap,
  });

  final Widget child;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final double radius;

  /// `.card-accent` — a 3px status bar pinned to the top edge.
  final Color? accent;

  /// Opt-in, and null by default.
  ///
  /// These cards were flatly untappable, because the prototype pushed detail screens that
  /// this app did not have and a card that looks tappable and goes nowhere is worse than
  /// one that does not. A service-request row now HAS somewhere to go, so the tap is
  /// offered per row rather than for the card type: a planned-work row still passes null.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Widget body = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // The accent is a child stripe under a clip, never a non-uniform border: Flutter
        // refuses to paint a rounded box whose sides differ.
        if (accent != null) Container(height: 3, color: accent),
        Padding(padding: padding, child: child),
      ],
    );

    return Container(
      margin: margin,
      decoration: EmployeeTokens.card(radius: radius),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? body
          : Material(
              color: Colors.transparent,
              child: InkWell(onTap: onTap, child: body),
            ),
    );
  }
}

// `HomeHeroCard` — the white card carrying one big figure — lived here. The Нүүр
// tab drew it and nothing else did, and the steel direction replaced it with the
// dark `SteelHero` band in `blueprint_ui.dart`, whose stair carries that figure and
// three more. It is deleted rather than left behind: a second, unreachable home hero
// is exactly how two home screens start to disagree.

/// `.home-mini` — a pastel icon tile over a figure and a caption.
class HomeMiniCard extends StatelessWidget {
  const HomeMiniCard({
    super.key,
    required this.icon,
    required this.tone,
    required this.value,
    required this.label,
  });

  final IconData icon;
  final Tone tone;

  /// A dash when the figure is not available.
  final String value;

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      decoration: EmployeeTokens.card(radius: EmployeeTokens.radiusRow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.background,
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(color: tone.border),
            ),
            child: Icon(icon, size: 15, color: tone.foreground),
          ),
          const SizedBox(height: 9),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: EmployeeTokens.metricValue,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            label,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style:
                EmployeeTokens.microNote.copyWith(fontWeight: FontWeight.w600),
          ),
        ],
      ),
    );
  }
}

/// A two-column grid of [HomeMiniCard], 12px apart as the home tab spaces them.
class HomeMiniGrid extends StatelessWidget {
  const HomeMiniGrid({
    super.key,
    required this.cards,
    this.padding = const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 10),
  });

  final List<Widget> cards;

  /// The page-level inset. Overridable because the grid is also drawn inside a
  /// `BlueprintFrame`, which supplies the gutter itself and wants the grid to pad
  /// evenly within it rather than to the page edge.
  final EdgeInsets padding;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < cards.length; i += 2) {
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: i == 0 ? 0 : 12),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: cards[i]),
                const SizedBox(width: 12),
                Expanded(
                  child: i + 1 < cards.length
                      ? cards[i + 1]
                      : const SizedBox.shrink(),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: padding,
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }
}

/// `.sum-strip` — three figures across one card, separated by hairlines.
class HomeSummaryStrip extends StatelessWidget {
  const HomeSummaryStrip({super.key, required this.entries, this.margin});

  final List<HomeSummaryEntry> entries;

  /// Null keeps [HomeCard]'s own page-level margin. Zero is what a strip drawn
  /// inside a `BlueprintFrame` passes, so the frame's keyline and the card's fall on
  /// the same pixel instead of nesting two boxes.
  final EdgeInsets? margin;

  @override
  Widget build(BuildContext context) {
    return HomeCard(
      margin: margin ??
          const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 10),
      padding: const EdgeInsets.symmetric(vertical: 13),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int i = 0; i < entries.length; i++) ...<Widget>[
              if (i > 0)
                const VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: EmployeeTokens.faint,
                  indent: 2,
                  endIndent: 2,
                ),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    FittedBox(
                      child: Text(
                        entries[i].value,
                        style: EmployeeTokens.kpiValue
                            .merge(EmployeeTokens.mono)
                            .copyWith(color: entries[i].color),
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      entries[i].label,
                      textAlign: TextAlign.center,
                      style: EmployeeTokens.microNote
                          .copyWith(fontWeight: FontWeight.w600),
                    ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class HomeSummaryEntry {
  const HomeSummaryEntry({
    required this.value,
    required this.label,
    this.color = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color color;
}

/// `.info-banner` — a tinted notice with an icon.
class HomeNotice extends StatelessWidget {
  const HomeNotice({
    super.key,
    required this.title,
    required this.body,
    required this.tone,
    required this.icon,
  });

  final String title;
  final String body;
  final Tone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(kHomeGutter, 0, kHomeGutter, 10),
      child: Container(
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          // Uniform, and it must stay so: Flutter refuses to paint a rounded box whose
          // sides differ ("A borderRadius can only be given on borders with uniform
          // colors"). The tone accent that used to be a 3px left side is a child stripe.
          border:
              Border.all(color: tone.border, width: EmployeeTokens.hairline),
          boxShadow: EmployeeTokens.cardShadow,
        ),
        clipBehavior: Clip.antiAlias,
        // IntrinsicHeight so the accent stripe matches the notice height; `stretch` alone
        // asks for infinite height inside a scrolling column.
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Container(width: 3, color: tone.foreground),
              const SizedBox(width: 12),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 11),
                child: Icon(icon, size: 16, color: tone.foreground),
              ),
              const SizedBox(width: 9),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 11, 12, 11),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        title,
                        style: EmployeeTokens.noticeTitle
                            .copyWith(color: tone.foreground),
                      ),
                      const SizedBox(height: 3),
                      Text(
                        body,
                        style: EmployeeTokens.rowSub.copyWith(
                          color: EmployeeTokens.ink2,
                          height: 1.6,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// `.empty-state` — a 38px icon at 35% opacity over a muted caption.
class HomeEmptyState extends StatelessWidget {
  const HomeEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
    this.compact = false,
  });

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  /// Tighter padding, for an empty section inside a populated screen.
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return EmployeeEmptyState(
      icon: icon,
      message: message,
      padding:
          EdgeInsets.symmetric(horizontal: 20, vertical: compact ? 22 : 40),
      action: actionLabel != null && onAction != null
          ? OutlinedButton(
              onPressed: onAction,
              style: OutlinedButton.styleFrom(
                foregroundColor: EmployeeTokens.ink,
                side: const BorderSide(
                  color: EmployeeTokens.line,
                  width: EmployeeTokens.hairline,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
                ),
                textStyle: EmployeeTokens.noticeTitle,
              ),
              child: Text(actionLabel!),
            )
          : null,
    );
  }
}

// The `.hdr-btn` square with the bell's `.hdr-badge` lived here as
// `HomeHeaderButton`. It is now `EmployeeHeaderButton` in
// `presentation/widgets/employee_top_bar.dart`, because the prototype puts the same
// two buttons on every tab and this tab is no longer the only one that draws them.
