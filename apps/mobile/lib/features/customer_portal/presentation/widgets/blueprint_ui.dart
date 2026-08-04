import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../theme/customer_tokens.dart';

/// The "steel" blueprint primitives: the dark hero band, the section kicker, the
/// hairline building row and the registration-marked frame.
///
/// Everything here is square, hairline-bordered and flat — the rules the mock states
/// and [CustomerTokens] encodes. No value in this file is a literal hex, font size or
/// radius; each one reads from the token scale.

/// One step of the hero's risk stair: a band colour, the figure and its caption.
typedef RiskStairStep = ({Color band, int count, String label});

/// The dark navy band at the top of the home screen.
///
/// It sits flush under the status bar and pays for its own top inset out of
/// [MediaQuery.paddingOf], so the screen must not wrap it in a top `SafeArea`.
class SteelHero extends StatelessWidget {
  const SteelHero({
    super.key,
    required this.title,
    required this.subtitle,
    required this.headline,
    this.stair = const <RiskStairStep>[],
    this.action,
  });

  final String title;
  final String subtitle;
  final String headline;

  /// The five bands, best-first. Empty while the summary is still in flight — a
  /// stair of zeroes would be a figure the API never sent.
  final List<RiskStairStep> stair;

  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      color: CustomerTokens.hero,
      padding: EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        MediaQuery.paddingOf(context).top + 18,
        CustomerTokens.gutter,
        22,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
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
                      style: CustomerTokens.display.copyWith(
                        color: CustomerTokens.onHero,
                      ),
                    ),
                    const SizedBox(height: 5),
                    Text(
                      subtitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: CustomerTokens.rowSub.copyWith(
                        color: CustomerTokens.onHeroMuted,
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
            style: CustomerTokens.screenTitle.copyWith(
              color: CustomerTokens.onHero,
            ),
          ),
          if (stair.isNotEmpty) ...<Widget>[
            const SizedBox(height: 22),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                for (int i = 0; i < stair.length; i++) ...<Widget>[
                  if (i > 0) const SizedBox(width: 6),
                  Expanded(child: _StairColumn(step: stair[i])),
                ],
              ],
            ),
          ],
        ],
      ),
    );
  }
}

class _StairColumn extends StatelessWidget {
  const _StairColumn({required this.step});

  final RiskStairStep step;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '${step.label} ${step.count}',
      excludeSemantics: true,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          // Width is explicit: a Column hands its children loose constraints, so a
          // bare height-only Container would measure zero wide.
          Container(width: double.infinity, height: 5, color: step.band),
          const SizedBox(height: 9),
          Text(
            '${step.count}',
            style: CustomerTokens.monoDisplay.copyWith(
              color: CustomerTokens.onHero,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            step.label.toUpperCase(),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: CustomerTokens.navLabel.copyWith(
              color: CustomerTokens.onHeroFaint,
            ),
          ),
        ],
      ),
    );
  }
}

/// The square outlined control that reads on the dark hero.
class HeroIconButton extends StatelessWidget {
  const HeroIconButton({
    super.key,
    required this.icon,
    required this.onTap,
    this.tooltip,
  });

  final IconData icon;
  final VoidCallback onTap;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    // A transparency Material so the ink lands above the hero fill rather than on
    // the page Material underneath it, where it would be invisible.
    final Widget button = Material(
      type: MaterialType.transparency,
      child: InkWell(
        onTap: onTap,
        highlightColor: CustomerTokens.heroWash,
        splashColor: CustomerTokens.heroWash,
        child: Container(
          width: 40,
          height: 40,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            border: Border.all(
              color: CustomerTokens.heroLine,
              width: CustomerTokens.hairline,
            ),
          ),
          child: Icon(icon, size: 19, color: CustomerTokens.onHero),
        ),
      ),
    );

    final String? message = tooltip;
    return message == null ? button : Tooltip(message: message, child: button);
  }
}

/// The uppercase kicker above a group, with an optional text action opposite it.
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

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.labelGutter,
        30,
        CustomerTokens.labelGutter,
        0,
      ),
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
              style: CustomerTokens.sectionLabel,
            ),
          ),
          if (label != null && onAction != null)
            InkWell(
              onTap: onAction,
              highlightColor: CustomerTokens.accentWashStrong,
              splashColor: CustomerTokens.accentWash,
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 4),
                child: Text(
                  label,
                  style: CustomerTokens.rowSub.copyWith(
                    color: CustomerTokens.accentText,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// A building line: a band rail, two lines of text, the band's own name, and one
/// piece of trailing metadata.
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
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      highlightColor: CustomerTokens.accentWashStrong,
      splashColor: CustomerTokens.accentWash,
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 15, horizontal: 2),
        decoration: const BoxDecoration(
          border: Border(bottom: CustomerTokens.hairlineSide),
        ),
        child: Row(
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
                    style: CustomerTokens.cardTitle,
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: CustomerTokens.rowSub,
                  ),
                  const SizedBox(height: 7),
                  Text(
                    stateLabel,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: CustomerTokens.pillLabel.copyWith(color: band),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(metaLabel.toUpperCase(), style: CustomerTokens.navLabel),
                const SizedBox(height: 2),
                Text(metaValue, style: CustomerTokens.rowSub),
              ],
            ),
            const SizedBox(width: 8),
            const Icon(
              Icons.chevron_right,
              size: 18,
              color: CustomerTokens.chevron,
            ),
          ],
        ),
      ),
    );
  }
}

/// The hairline-topped stack a set of [BlueprintRow]s lives in.
class BlueprintRowList extends StatelessWidget {
  const BlueprintRowList({super.key, required this.rows});

  final List<Widget> rows;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        14,
        CustomerTokens.gutter,
        0,
      ),
      decoration: const BoxDecoration(
        border: Border(top: CustomerTokens.hairlineSide),
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }
}

/// A white panel carrying the mock's four registration corner marks.
///
/// [margin] is measured to the panel's own edge; the corner marks bleed [_bleed]
/// beyond it and the frame pays for that bleed out of the margin, so a panel asked
/// to sit at the 20px gutter still lands there.
class BlueprintFrame extends StatelessWidget {
  const BlueprintFrame({
    super.key,
    required this.child,
    this.margin = EdgeInsets.zero,
    this.padding = EdgeInsets.zero,
  });

  final Widget child;
  final EdgeInsets margin;
  final EdgeInsets padding;

  /// How far a corner mark reaches outside the panel.
  static const double _bleed = 6;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        math.max(0, margin.left - _bleed),
        math.max(0, margin.top - _bleed),
        math.max(0, margin.right - _bleed),
        math.max(0, margin.bottom - _bleed),
      ),
      child: Padding(
        padding: const EdgeInsets.all(_bleed),
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            Container(
              width: double.infinity,
              padding: padding,
              decoration: const BoxDecoration(
                color: CustomerTokens.white,
                border: Border.fromBorderSide(CustomerTokens.hairlineSide),
              ),
              child: child,
            ),
            const Positioned(top: -_bleed, left: -_bleed, child: _CornerMark()),
            const Positioned(top: -_bleed, right: -_bleed, child: _CornerMark()),
            const Positioned(
              bottom: -_bleed,
              left: -_bleed,
              child: _CornerMark(),
            ),
            const Positioned(
              bottom: -_bleed,
              right: -_bleed,
              child: _CornerMark(),
            ),
          ],
        ),
      ),
    );
  }
}

/// One registration crosshair.
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
            width: CustomerTokens.hairline,
            child: ColoredBox(color: CustomerTokens.muted),
          ),
          Positioned(
            top: 5,
            left: 0,
            right: 0,
            height: CustomerTokens.hairline,
            child: ColoredBox(color: CustomerTokens.muted),
          ),
        ],
      ),
    );
  }
}

/// The framed call to action at the foot of a list.
class BlueprintCta extends StatelessWidget {
  const BlueprintCta({
    super.key,
    required this.title,
    required this.subtitle,
    required this.onTap,
  });

  final String title;
  final String subtitle;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return BlueprintFrame(
      margin: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        22,
        CustomerTokens.gutter,
        0,
      ),
      // A transparency Material so the ink lands above the panel's white fill.
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          onTap: onTap,
          highlightColor: CustomerTokens.accentWashStrong,
          splashColor: CustomerTokens.accentWash,
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
                      Text(title, style: CustomerTokens.cardTitle),
                      const SizedBox(height: 2),
                      Text(subtitle, style: CustomerTokens.rowSub),
                    ],
                  ),
                ),
                const Icon(
                  Icons.chevron_right,
                  size: 18,
                  color: CustomerTokens.accent,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
