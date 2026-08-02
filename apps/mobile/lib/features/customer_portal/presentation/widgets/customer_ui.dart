import 'package:flutter/material.dart';

import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';
import 'risk_glyph.dart';

/// The flow's primitives, one widget per element of the design system, so the
/// screens read as layout rather than styling. Every value comes from
/// [CustomerTokens]; nothing here carries a literal size, hex or radius.

/// A small uppercase caption above a group.
class SectionCaption extends StatelessWidget {
  const SectionCaption(this.text, {super.key, this.topPadding = 18});

  final String text;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        CustomerTokens.labelGutter,
        topPadding,
        CustomerTokens.labelGutter,
        8,
      ),
      child: Text(text.toUpperCase(), style: CustomerTokens.sectionLabel),
    );
  }
}

/// A small rounded status chip.
///
/// Non-risk statuses only take a coloured label; a risk band uses [RiskPill], which
/// carries a glyph so the band survives greyscale and colour-blindness.
class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    required this.tone,
    this.showDot = false,
    this.flexibleText = false,
  });

  final String label;
  final AccentTone tone;
  final bool showDot;

  /// Lets a long label ellipsise instead of overflowing.
  ///
  /// Opt-in rather than always on: a flex child needs a bounded main axis, and this
  /// pill is also used inside a [Wrap], which hands its children unbounded width.
  final bool flexibleText;

  @override
  Widget build(BuildContext context) {
    final Widget text = Text(
      label.toUpperCase(),
      maxLines: 1,
      overflow: TextOverflow.ellipsis,
      style: CustomerTokens.pillLabel.copyWith(color: tone.foreground),
    );

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
        border: Border.all(color: tone.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (showDot) ...<Widget>[
            Container(
              width: 5,
              height: 5,
              decoration: BoxDecoration(
                color: tone.foreground,
                shape: BoxShape.circle,
              ),
            ),
            const SizedBox(width: 4),
          ],
          if (flexibleText) Flexible(child: text) else text,
        ],
      ),
    );
  }
}

/// The үнэлгээ as a percent in its band colour.
///
/// A transcription of `ScorePercent` in
/// apps/web/src/features/projects/objects/ObjectBadges.tsx: one figure, one element.
/// The band is carried by the glyph beside the figure as well as by the fill, so it
/// reads in greyscale. A missing score renders as "Үнэлгээгүй" and never as a zero,
/// because an unassessed object is not a failing one.
class ScorePercentBadge extends StatelessWidget {
  const ScorePercentBadge({
    super.key,
    required this.score,
    required this.level,
    this.showLabel = false,
  });

  final int? score;
  final RiskLevel? level;
  final bool showLabel;

  @override
  Widget build(BuildContext context) {
    final int? value = score;
    final RiskLevel? band = level;

    if (value == null || band == null) {
      return Semantics(
        label: unassessedLabel,
        excludeSemantics: true,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: CustomerTokens.soft,
            borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
            border: Border.all(color: CustomerTokens.faint),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              RiskGlyph(level: null, size: 9),
              SizedBox(width: 5),
              Text(unassessedLabel, style: CustomerTokens.rowSub),
            ],
          ),
        ),
      );
    }

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Semantics(
          label: '${band.label} $value%',
          excludeSemantics: true,
          child: Container(
            constraints: const BoxConstraints(minWidth: 46),
            alignment: Alignment.center,
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
            decoration: BoxDecoration(
              color: band.solidBackground,
              borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
            ),
            child: Text(
              '$value%',
              style: CustomerTokens.monoRow.copyWith(color: band.solidForeground),
            ),
          ),
        ),
        if (showLabel) ...<Widget>[
          const SizedBox(width: 8),
          Flexible(
            child: Text(
              band.label,
              style: CustomerTokens.rowSub.copyWith(color: CustomerTokens.ink2),
            ),
          ),
        ],
      ],
    );
  }
}

/// A bordered white panel with an optional 3px accent along the top. No shadow.
class PanelCard extends StatelessWidget {
  const PanelCard({
    super.key,
    required this.child,
    this.accent,
    this.padding = const EdgeInsets.all(CustomerTokens.gutter),
    this.margin = const EdgeInsets.fromLTRB(CustomerTokens.gutter, 0, CustomerTokens.gutter, 10),
    this.radius = CustomerTokens.radiusCard,
  });

  final Widget child;
  final Color? accent;
  final EdgeInsets padding;
  final EdgeInsets margin;
  final double radius;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      decoration: CustomerTokens.card(radius: radius),
      clipBehavior: Clip.antiAlias,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (accent != null) Container(height: 3, color: accent),
          Padding(padding: padding, child: child),
        ],
      ),
    );
  }
}

/// A tappable line with a leading tile, two lines of text and a trailing column.
class TappableRow extends StatelessWidget {
  const TappableRow({
    super.key,
    required this.leading,
    required this.title,
    required this.subtitle,
    this.trailing,
    this.onTap,
  });

  final Widget leading;
  final String title;
  final String subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        0,
        CustomerTokens.gutter,
        7,
      ),
      child: Material(
        color: CustomerTokens.white,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
              border: Border.all(
                color: CustomerTokens.line,
                width: CustomerTokens.hairline,
              ),
              boxShadow: CustomerTokens.cardShadow,
            ),
            child: Row(
              children: <Widget>[
                leading,
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        title,
                        style: CustomerTokens.rowTitle.copyWith(height: 1.3),
                      ),
                      if (subtitle.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: CustomerTokens.rowSub,
                        ),
                      ],
                    ],
                  ),
                ),
                if (trailing != null) ...<Widget>[
                  const SizedBox(width: 10),
                  trailing!,
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A square tile carrying two or three characters, or an icon.
class RowTile extends StatelessWidget {
  const RowTile({
    super.key,
    required this.tone,
    this.text,
    this.icon,
    this.size = 40,
    this.semanticsLabel,
  });

  final AccentTone tone;
  final String? text;
  final IconData? icon;
  final double size;

  /// Required whenever [tone] is a risk band: the tile is then tinted by band, and
  /// a colour alone announces nothing to a screen reader.
  final String? semanticsLabel;

  @override
  Widget build(BuildContext context) {
    final Widget tile = _tile();
    final String? label = semanticsLabel;
    return label == null
        ? tile
        : Semantics(label: label, excludeSemantics: true, child: tile);
  }

  Widget _tile() {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
        border: Border.all(color: tone.border, width: CustomerTokens.hairline),
        boxShadow: CustomerTokens.cardShadow,
      ),
      child: icon != null
          ? Icon(icon, size: size * 0.5, color: tone.foreground)
          : Text(
              text ?? '',
              maxLines: 1,
              overflow: TextOverflow.clip,
              style: CustomerTokens.monoSub.copyWith(color: tone.foreground),
            ),
    );
  }
}

/// One figure with a caption beneath it.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.value,
    required this.label,
    this.valueColor = CustomerTokens.ink,
    this.level,
  });

  final String value;
  final String label;
  final Color valueColor;

  /// When the figure counts a risk band, the band's glyph sits beside the caption so
  /// the tile is not carried by colour alone.
  final RiskLevel? level;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 10),
      decoration: CustomerTokens.card(radius: CustomerTokens.radiusRow),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          FittedBox(
            child: Text(
              value,
              style: CustomerTokens.monoDisplay.copyWith(color: valueColor),
            ),
          ),
          const SizedBox(height: 4),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (level != null) ...<Widget>[
                RiskGlyph(level: level, size: 8),
                const SizedBox(width: 4),
              ],
              Flexible(
                child: Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  textAlign: TextAlign.center,
                  style: CustomerTokens.navLabel.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Four tiles across.
class KpiStrip extends StatelessWidget {
  const KpiStrip({super.key, required this.tiles, this.padded = true});

  final List<KpiTile> tiles;
  final bool padded;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padded
          ? const EdgeInsets.fromLTRB(
              CustomerTokens.gutter, 0, CustomerTokens.gutter, 12)
          : EdgeInsets.zero,
      // IntrinsicHeight so the tiles share the tallest one's height. A bare
      // CrossAxisAlignment.stretch cannot do it inside a scroll view, where the
      // Row's own height is unbounded.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int i = 0; i < tiles.length; i++) ...<Widget>[
              if (i > 0) const SizedBox(width: 7),
              Expanded(child: tiles[i]),
            ],
          ],
        ),
      ),
    );
  }
}

/// A labelled figure with a note beneath.
class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    this.unit,
    this.note,
    this.valueColor = CustomerTokens.ink,
  });

  final String label;
  final String value;
  final String? unit;
  final String? note;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: CustomerTokens.card(radius: CustomerTokens.radiusRow),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(label.toUpperCase(), style: CustomerTokens.sectionLabel),
          const SizedBox(height: 5),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.baseline,
              textBaseline: TextBaseline.alphabetic,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  value,
                  style: CustomerTokens.monoFigure.copyWith(color: valueColor),
                ),
                if (unit != null)
                  Text(unit!, style: CustomerTokens.rowSub),
              ],
            ),
          ),
          if (note != null) ...<Widget>[
            const SizedBox(height: 3),
            Text(note!, style: CustomerTokens.rowSub),
          ],
        ],
      ),
    );
  }
}

/// Two columns of [MetricCard].
class MetricGrid extends StatelessWidget {
  const MetricGrid({super.key, required this.cards, this.padded = true});

  final List<Widget> cards;
  final bool padded;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < cards.length; i += 2) {
      final Widget left = cards[i];
      final Widget? right = i + 1 < cards.length ? cards[i + 1] : null;
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: i == 0 ? 0 : 7),
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: left),
                const SizedBox(width: 7),
                Expanded(child: right ?? const SizedBox.shrink()),
              ],
            ),
          ),
        ),
      );
    }

    return Padding(
      padding: padded
          ? const EdgeInsets.fromLTRB(
              CustomerTokens.gutter, 0, CustomerTokens.gutter, 10)
          : EdgeInsets.zero,
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }
}

/// An informational or alerting banner.
///
/// The text is `ink`: the tone is carried by the icon and the border, so the copy
/// stays readable on the amber and orange tints as well as on the red one.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.text,
    required this.tone,
    required this.icon,
    this.onTap,
  });

  const NoticeBanner.info({super.key, required this.text, this.onTap})
      : tone = AccentTone.blue,
        icon = Icons.info_outline;

  const NoticeBanner.alert({super.key, required this.text, this.onTap})
      : tone = AccentTone.red,
        icon = Icons.error_outline;

  final String text;
  final AccentTone tone;
  final IconData icon;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        0,
        CustomerTokens.gutter,
        10,
      ),
      child: Material(
        color: tone.background,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
          child: Container(
            // The accent stripe is a clipped child rather than a thicker left
            // BorderSide: `Border.paint` asserts that every side shares one colour
            // once a borderRadius is set, so a 3px tinted left edge on an otherwise
            // hairline rounded box threw on every paint. Drawing the stripe inside
            // an antialiased clip is the same idiom PanelCard uses for its top
            // accent, and it keeps the rounded corners.
            clipBehavior: Clip.antiAlias,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
              border: Border.all(
                color: tone.border,
                width: CustomerTokens.hairline,
              ),
              boxShadow: CustomerTokens.cardShadow,
            ),
            child: Stack(
              children: <Widget>[
                Padding(
                  // Left inset absorbs the 3px stripe so the icon sits where the
                  // old left border used to put it.
                  padding: const EdgeInsets.fromLTRB(15, 10, 12, 10),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Icon(icon, size: 16, color: tone.foreground),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          text,
                          style: CustomerTokens.body.copyWith(
                            color: CustomerTokens.ink,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                // Positioned rather than a Row child so it spans the banner's full
                // height without the Stack having to be measured twice.
                Positioned(
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: 3,
                  child: ColoredBox(color: tone.foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Segmented filter buttons; the selected one is filled ink.
class TabRow extends StatelessWidget {
  const TabRow({
    super.key,
    required this.labels,
    required this.selectedIndex,
    required this.onSelected,
  });

  final List<String> labels;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        0,
        CustomerTokens.gutter,
        12,
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 5),
            Expanded(
              child: Material(
                color: i == selectedIndex
                    ? CustomerTokens.ink
                    : CustomerTokens.white,
                borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
                child: InkWell(
                  onTap: () => onSelected(i),
                  borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
                  child: Container(
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
                    decoration: BoxDecoration(
                      borderRadius:
                          BorderRadius.circular(CustomerTokens.radiusInput),
                      border: Border.all(
                        color: i == selectedIndex
                            ? CustomerTokens.ink
                            : CustomerTokens.line,
                        width: CustomerTokens.hairline,
                      ),
                    ),
                    child: Text(
                      labels[i].toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: CustomerTokens.pillLabel.copyWith(
                        color: i == selectedIndex
                            ? CustomerTokens.white
                            : CustomerTokens.muted,
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// The Project -> Building -> Floor -> Device trail.
class Breadcrumb extends StatelessWidget {
  const Breadcrumb({super.key, required this.parts});

  final List<String> parts;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.labelGutter,
        0,
        CustomerTokens.labelGutter,
        8,
      ),
      child: Wrap(
        spacing: 5,
        runSpacing: 2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          for (int i = 0; i < parts.length; i++) ...<Widget>[
            if (i > 0)
              const Text('→', style: CustomerTokens.sectionLabel),
            Text(
              parts[i],
              style: CustomerTokens.rowSub.copyWith(
                fontWeight: FontWeight.w700,
                color: CustomerTokens.ink,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One entry in a [Timeline].
class TimelineEntry extends StatelessWidget {
  const TimelineEntry({
    super.key,
    required this.title,
    required this.meta,
    required this.tone,
    required this.icon,
    this.isLast = false,
  });

  final String title;
  final String meta;
  final AccentTone tone;
  final IconData icon;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: CustomerTokens.faint)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: tone.background,
              borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
              border: Border.all(
                color: tone.border,
                width: CustomerTokens.hairline,
              ),
            ),
            child: Icon(icon, size: 14, color: tone.foreground),
          ),
          const SizedBox(width: 11),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  title,
                  style: CustomerTokens.rowTitle.copyWith(height: 1.4),
                ),
                const SizedBox(height: 2),
                Text(
                  meta,
                  style: CustomerTokens.monoLabel.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// The timeline container.
class Timeline extends StatelessWidget {
  const Timeline({super.key, required this.entries});

  final List<TimelineEntry> entries;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: CustomerTokens.gutter),
      child: Column(mainAxisSize: MainAxisSize.min, children: entries),
    );
  }
}

/// The empty state.
class CustomerEmptyState extends StatelessWidget {
  const CustomerEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String message;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 40),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(icon, size: 38, color: CustomerTokens.line),
          const SizedBox(height: 10),
          Text(
            message,
            textAlign: TextAlign.center,
            style: CustomerTokens.emptyText,
          ),
          if (actionLabel != null && onAction != null) ...<Widget>[
            const SizedBox(height: 18),
            OutlinedButton(onPressed: onAction, child: Text(actionLabel!)),
          ],
        ],
      ),
    );
  }
}

/// The thin progress rail on a request card.
class ProgressRail extends StatelessWidget {
  const ProgressRail({super.key, required this.fraction, required this.color});

  final double fraction;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
      child: LinearProgressIndicator(
        value: fraction.clamp(0, 1),
        minHeight: 4,
        backgroundColor: CustomerTokens.soft,
        valueColor: AlwaysStoppedAnimation<Color>(color),
      ),
    );
  }
}

/// The sticky bottom action.
class StickyAction extends StatelessWidget {
  const StickyAction({
    super.key,
    required this.label,
    required this.icon,
    this.onPressed,
    this.danger = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null;
    return Container(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        10,
        CustomerTokens.gutter,
        10,
      ),
      decoration: const BoxDecoration(
        color: CustomerTokens.bg,
        border: Border(top: CustomerTokens.hairlineFaintSide),
      ),
      child: SafeArea(
        top: false,
        child: FilledButton.icon(
          onPressed: onPressed,
          icon: Icon(icon, size: 16),
          label: Text(label),
          style: FilledButton.styleFrom(
            backgroundColor: !enabled
                ? CustomerTokens.soft
                : (danger ? CustomerTokens.red : CustomerTokens.ink),
            foregroundColor: CustomerTokens.white,
            disabledBackgroundColor: CustomerTokens.soft,
            disabledForegroundColor: CustomerTokens.muted,
            minimumSize: const Size.fromHeight(50),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
            ),
            textStyle: CustomerTokens.cardTitle,
          ),
        ),
      ),
    );
  }
}

/// The pill that confirms an action.
void showCustomerToast(BuildContext context, String message) {
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(
          message,
          textAlign: TextAlign.center,
          style: CustomerTokens.rowTitle.copyWith(
            fontWeight: FontWeight.w800,
            color: CustomerTokens.white,
          ),
        ),
        backgroundColor: CustomerTokens.ink,
        behavior: SnackBarBehavior.floating,
        shape: const StadiumBorder(),
        duration: const Duration(milliseconds: 1800),
      ),
    );
}

/// The header used by every pushed screen: a back chip, a title and a caption.
class CustomerNavBar extends StatelessWidget implements PreferredSizeWidget {
  const CustomerNavBar({
    super.key,
    required this.title,
    this.subtitle,
    this.showBack = true,
    this.action,
  });

  final String title;
  final String? subtitle;
  final bool showBack;
  final Widget? action;

  @override
  Size get preferredSize => const Size.fromHeight(58);

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Container(
        height: 58,
        padding: const EdgeInsets.fromLTRB(
          CustomerTokens.labelGutter,
          8,
          CustomerTokens.labelGutter,
          8,
        ),
        color: CustomerTokens.bg,
        child: Row(
          children: <Widget>[
            if (showBack) ...<Widget>[
              NavChip(
                icon: Icons.chevron_left,
                onTap: () => Navigator.of(context).maybePop(),
                tooltip: 'Буцах',
              ),
              const SizedBox(width: 10),
            ],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: CustomerTokens.headerTitle,
                  ),
                  if (subtitle != null)
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: CustomerTokens.rowSub,
                    ),
                ],
              ),
            ),
            if (action != null) ...<Widget>[const SizedBox(width: 10), action!],
          ],
        ),
      ),
    );
  }
}

/// The square outlined button used in the nav bar.
class NavChip extends StatelessWidget {
  const NavChip({
    super.key,
    required this.icon,
    required this.onTap,
    this.tooltip,
    this.iconSize = 19,
  });

  final IconData icon;
  final VoidCallback onTap;
  final String? tooltip;
  final double iconSize;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip ?? '',
      child: Material(
        color: CustomerTokens.white,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
          child: Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusInput),
              border: Border.all(
                color: CustomerTokens.line,
                width: CustomerTokens.hairline,
              ),
              boxShadow: CustomerTokens.cardShadow,
            ),
            child: Icon(icon, size: iconSize, color: CustomerTokens.ink),
          ),
        ),
      ),
    );
  }
}

/// A grab handle at the top of a bottom sheet.
class SheetHandle extends StatelessWidget {
  const SheetHandle({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 4,
      margin: const EdgeInsets.only(top: 11),
      decoration: BoxDecoration(
        color: CustomerTokens.faint,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
      ),
    );
  }
}

/// A caption above a form field.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text.toUpperCase(), style: CustomerTokens.sectionLabel),
    );
  }
}

/// A label / value line inside a card, divided by a hairline.
class DetailRow extends StatelessWidget {
  const DetailRow({
    super.key,
    required this.label,
    required this.value,
    this.labelWidth,
  });

  final String label;
  final String value;
  final double? labelWidth;

  @override
  Widget build(BuildContext context) {
    final Widget labelText = Text(label, style: CustomerTokens.rowSub);

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: CustomerTokens.gutter,
        vertical: 11,
      ),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: CustomerTokens.faint)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          if (labelWidth != null)
            SizedBox(width: labelWidth, child: labelText)
          else
            labelText,
          if (labelWidth == null) const Spacer(),
          if (labelWidth != null)
            Expanded(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: CustomerTokens.rowTitle.copyWith(height: 1.4),
              ),
            )
          else
            Flexible(
              child: Text(
                value,
                textAlign: TextAlign.right,
                style: CustomerTokens.rowTitle,
              ),
            ),
        ],
      ),
    );
  }
}
