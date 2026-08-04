/// The "steel" blueprint primitives — the Нүүр tab's transcription of direction 1b
/// of the `soko` home mock, and the employee app's sibling of the customer app's
/// home.
///
/// Everything here obeys three rules the direction is built on, and each of them is
/// a rule rather than a preference:
///
///   * **Square.** Every corner is radius 0, read from [EmployeeTokens] rather than
///     written as a number, so softening the system later is one edit in the token
///     file.
///   * **Hairline, not shadow.** Definition comes from a 1px [EmployeeTokens.line]
///     keyline. Nothing in this file casts a shadow.
///   * **One dark surface.** [EmployeeTokens.hero] is the only dark block in the
///     app, and the `onHero*` ramp is the only text allowed on it.
///
/// No colour, size or radius literal appears below. A `fontSize:` or a hex at a call
/// site is a defect, here as anywhere else.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../calendar/presentation/screens/calendar_tab_screen.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../providers/home_providers.dart';
import 'notifications_sheet.dart';

/// The 1px keyline every blueprint edge is drawn with.
///
/// `EmployeeTokens` names the colour and the width but not the [BorderSide] the two
/// combine into, and four widgets here need exactly that side. It is declared once
/// rather than spelled out per call site.
const BorderSide kBlueprintSide = BorderSide(
  color: EmployeeTokens.line,
  width: EmployeeTokens.hairline,
);

/// One column of a [SteelHero]'s stair: a band of the risk ramp, a figure, and the
/// caption under it.
///
/// A record rather than a class because it carries no behaviour, and named fields
/// rather than positional ones because `(accent, '4', 'ИДЭВХТЭЙ')` at a call site
/// does not say which string is which.
typedef SteelStairBand = ({Color band, String count, String label});

/// The dark band at the top of the screen: the greeting, the date, one sentence
/// naming the day's state, and the stair of figures behind it.
///
/// It sits flush under the status bar and pads itself past it via
/// `MediaQuery.paddingOf`, so the screen that draws it must NOT wrap it in a top
/// [SafeArea] — doing so would paint a strip of page ground above the block and
/// break the one thing this direction is built around.
class SteelHero extends StatelessWidget {
  const SteelHero({
    super.key,
    required this.title,
    required this.subtitle,
    required this.headline,
    required this.stair,
    this.action,
  });

  /// The greeting. [EmployeeTokens.display] is a large condensed face, so this is
  /// held to one line and ellipsised rather than allowed to wrap into the date.
  final String title;

  final String subtitle;

  /// The single sentence that says what today is.
  final String headline;

  /// The figures, left to right. Empty draws no stair at all — which is what a
  /// screen with nothing honest to put there must pass, rather than four zeroes.
  final List<SteelStairBand> stair;

  /// The header controls, drawn on the dark ground.
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: EmployeeTokens.hero,
      padding: EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        MediaQuery.paddingOf(context).top + 18,
        EmployeeTokens.gutter,
        22,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.display
                          .copyWith(color: EmployeeTokens.onHero),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.rowSub.copyWith(
                        color: EmployeeTokens.onHeroMuted,
                        letterSpacing: 0.5,
                      ),
                    ),
                  ],
                ),
              ),
              if (action != null) ...<Widget>[
                const SizedBox(width: 12),
                action!,
              ],
            ],
          ),
          const SizedBox(height: 26),
          Text(
            headline,
            style: EmployeeTokens.screenTitle
                .copyWith(color: EmployeeTokens.onHero),
          ),
          if (stair.isNotEmpty) ...<Widget>[
            const SizedBox(height: 22),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (int i = 0; i < stair.length; i++) ...<Widget>[
                  if (i > 0) const SizedBox(width: 6),
                  Expanded(child: _SteelStairColumn(entry: stair[i])),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _SteelStairColumn extends StatelessWidget {
  const _SteelStairColumn({required this.entry});

  final SteelStairBand entry;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        // `double.infinity` rather than a bare height: the column aligns its
        // children to the start, so an unconstrained band would collapse to nothing.
        Container(height: 5, width: double.infinity, color: entry.band),
        const SizedBox(height: 9),
        Text(
          entry.count,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.metricValue
              .copyWith(color: EmployeeTokens.onHero),
        ),
        const SizedBox(height: 4),
        Text(
          entry.label.toUpperCase(),
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.navLabel
              .copyWith(color: EmployeeTokens.onHeroFaint),
        ),
      ],
    );
  }
}

/// A header control drawn on [EmployeeTokens.hero]: a 40px square outlined in
/// [EmployeeTokens.heroLine], transparent inside, with the white glyph ramp.
///
/// The flat [EmployeeHeaderButton] the other tabs draw is a white square with an ink
/// glyph and would vanish into the dark band; this is that widget's hero variant
/// rather than a change to it, so the other three tabs keep their current look.
class HeroIconButton extends StatelessWidget {
  const HeroIconButton({
    super.key,
    required this.icon,
    required this.onTap,
    required this.tooltip,
    this.badgeCount = 0,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String tooltip;

  /// Hidden at zero, as every unread badge in the app is.
  final int badgeCount;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: badgeCount > 0 ? '$tooltip, $badgeCount шинэ' : tooltip,
        child: Stack(
          // The badge overhangs the square on two sides.
          clipBehavior: Clip.none,
          children: <Widget>[
            Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onTap,
                highlightColor: EmployeeTokens.heroWash,
                splashColor: EmployeeTokens.heroWash,
                child: Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: const BoxDecoration(
                    border: Border.fromBorderSide(
                      BorderSide(
                        color: EmployeeTokens.heroLine,
                        width: EmployeeTokens.hairline,
                      ),
                    ),
                  ),
                  child: Icon(icon, size: 19, color: EmployeeTokens.onHero),
                ),
              ),
            ),
            if (badgeCount > 0)
              Positioned(
                top: -5,
                right: -5,
                child: Container(
                  constraints: const BoxConstraints(minWidth: 16),
                  height: 16,
                  alignment: Alignment.center,
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  decoration: const BoxDecoration(
                    color: EmployeeTokens.red,
                    // Ringed in the hero's own ground, not the page's, so the badge
                    // reads as cut out of the dark band.
                    border: Border.fromBorderSide(
                      BorderSide(color: EmployeeTokens.hero, width: 2),
                    ),
                  ),
                  child: Text(
                    badgeCount > 99 ? '99+' : '$badgeCount',
                    style: EmployeeTokens.microLabel.copyWith(
                      color: EmployeeTokens.white,
                      fontWeight: FontWeight.w700,
                      height: 1,
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// `.hdr-actions` on the dark band — the same two controls, in the same order, off
/// the same unread count.
///
/// A hero-ground sibling of `EmployeeHeaderActions` rather than a flag on it: the
/// other three tabs draw that widget on paper and must keep doing so. What is NOT
/// duplicated is the figure — both widgets watch [unreadNotificationCountProvider],
/// so no two headers can disagree about it.
class HeroHeaderActions extends ConsumerWidget {
  const HeroHeaderActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int unread =
        ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        HeroIconButton(
          icon: Icons.calendar_today_outlined,
          tooltip: 'Миний хуваарь',
          onTap: () =>
              Navigator.of(context).push<void>(CalendarTabScreen.route()),
        ),
        const SizedBox(width: 8),
        HeroIconButton(
          icon: Icons.notifications_none_outlined,
          tooltip: 'Мэдэгдэл',
          badgeCount: unread,
          onTap: () => NotificationsSheet.show(context),
        ),
      ],
    );
  }
}

/// The blueprint's section caption: an uppercase tracked kicker, with an optional
/// link on its right sitting on the same baseline.
class SectionHead extends StatelessWidget {
  const SectionHead({
    super.key,
    required this.kicker,
    this.actionLabel,
    this.onAction,
  });

  final String kicker;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final String? label = actionLabel;
    final VoidCallback? action = onAction;

    return Padding(
      padding: const EdgeInsets.fromLTRB(EmployeeTokens.gutter, 30,
          EmployeeTokens.gutter, 0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        crossAxisAlignment: CrossAxisAlignment.baseline,
        textBaseline: TextBaseline.alphabetic,
        children: <Widget>[
          Flexible(
            child: Text(
              kicker.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.sectionLabel,
            ),
          ),
          if (label != null && action != null)
            InkWell(
              onTap: action,
              highlightColor: EmployeeTokens.accentWashStrong,
              splashColor: EmployeeTokens.accentWash,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(10, 4, 0, 4),
                child: Text(
                  label,
                  style: EmployeeTokens.rowSub
                      .copyWith(color: EmployeeTokens.accentText),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// One line of a blueprint list: a band of the risk ramp, the name and its state on
/// the left, a labelled figure on the right, and a hairline under it.
///
/// It replaces the home tab's boxed `UrgentWorkCard`. Four bordered cards stacked
/// with gaps between them read as four unrelated objects; one ruled list with a
/// coloured band per row reads as a schedule, which is what it is.
class BlueprintRow extends StatelessWidget {
  const BlueprintRow({
    super.key,
    required this.band,
    required this.name,
    required this.subtitle,
    required this.stateLabel,
    required this.metaLabel,
    required this.metaValue,
    this.onTap,
  });

  final Color band;
  final String name;
  final String subtitle;
  final String stateLabel;
  final String metaLabel;
  final String metaValue;

  /// Null for a row with nowhere to go. Such a row loses both its chevron and its
  /// ink, because a row that lights up under a finger and then does nothing is worse
  /// than one that never offered.
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Widget body = Container(
      padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 2),
      decoration: const BoxDecoration(border: Border(bottom: kBlueprintSide)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Container(width: 4, height: 38, color: band),
          const SizedBox(width: 13),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  name,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.cardTitle,
                ),
                const SizedBox(height: 2),
                Text(
                  subtitle,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.rowSub,
                ),
                const SizedBox(height: 7),
                Text(
                  stateLabel,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.pillLabel.copyWith(color: band),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(metaLabel.toUpperCase(), style: EmployeeTokens.navLabel),
              const SizedBox(height: 2),
              Text(
                metaValue,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: EmployeeTokens.rowSub,
              ),
            ],
          ),
          if (onTap != null) ...<Widget>[
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right,
              size: 18,
              color: EmployeeTokens.chevron,
            ),
          ],
        ],
      ),
    );

    if (onTap == null) return body;

    return InkWell(
      onTap: onTap,
      highlightColor: EmployeeTokens.accentWashStrong,
      splashColor: EmployeeTokens.accentWash,
      child: body,
    );
  }
}

/// A run of [BlueprintRow]s, ruled top and bottom.
///
/// The top hairline is the list's; every row carries its own bottom one, so the
/// group closes itself no matter how many rows it holds.
class BlueprintRowList extends StatelessWidget {
  const BlueprintRowList({super.key, required this.rows});

  final List<Widget> rows;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        14,
        EmployeeTokens.gutter,
        0,
      ),
      decoration: const BoxDecoration(border: Border(top: kBlueprintSide)),
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }
}

/// A white panel with the mock's four registration marks at its corners.
///
/// The crosshairs are what make the blueprint read as a drawing rather than as a
/// card, and they sit OUTSIDE the panel's own keyline — hence the 6px padding and
/// the unclipped stack. A caller that wants the panel's visible edge on the page
/// gutter must subtract that 6 from its margin.
class BlueprintFrame extends StatelessWidget {
  const BlueprintFrame({
    super.key,
    required this.child,
    this.margin = EdgeInsets.zero,
  });

  final Widget child;

  /// Measured to the crosshairs, not to the panel edge.
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: margin + const EdgeInsets.all(6),
      child: Stack(
        clipBehavior: Clip.none,
        children: <Widget>[
          Container(
            decoration: const BoxDecoration(
              color: EmployeeTokens.white,
              border: Border.fromBorderSide(kBlueprintSide),
            ),
            child: child,
          ),
          const Positioned(top: -6, left: -6, child: _CornerMark()),
          const Positioned(top: -6, right: -6, child: _CornerMark()),
          const Positioned(bottom: -6, left: -6, child: _CornerMark()),
          const Positioned(bottom: -6, right: -6, child: _CornerMark()),
        ],
      ),
    );
  }
}

/// One registration mark: an 11px crosshair, 1px arms, centred on the panel corner.
class _CornerMark extends StatelessWidget {
  const _CornerMark();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 11,
      height: 11,
      child: Stack(
        children: <Widget>[
          Positioned(
            left: 5,
            top: 0,
            bottom: 0,
            width: 1,
            child: ColoredBox(color: EmployeeTokens.muted),
          ),
          Positioned(
            top: 5,
            left: 0,
            right: 0,
            height: 1,
            child: ColoredBox(color: EmployeeTokens.muted),
          ),
        ],
      ),
    );
  }
}

/// A framed panel that is itself the tap target — the blueprint's one call to
/// action.
class BlueprintCta extends StatelessWidget {
  const BlueprintCta({
    super.key,
    required this.title,
    required this.subtitle,
    required this.onTap,
    this.margin = const EdgeInsets.fromLTRB(
      EmployeeTokens.gutter - 6,
      22 - 6,
      EmployeeTokens.gutter - 6,
      0,
    ),
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;

  /// Already discounted by the frame's 6px crosshair allowance, so the panel's
  /// visible edge lands on [EmployeeTokens.gutter].
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return BlueprintFrame(
      margin: margin,
      // Inside the panel's fill rather than around it: an ink splash is painted by
      // the nearest Material, and one wrapped outside would be hidden by the white
      // container it sits behind.
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          highlightColor: EmployeeTokens.accentWashStrong,
          splashColor: EmployeeTokens.accentWash,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 15),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(title, style: EmployeeTokens.cardTitle),
                      const SizedBox(height: 2),
                      Text(
                        subtitle,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.rowSub,
                      ),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: EmployeeTokens.accent,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
