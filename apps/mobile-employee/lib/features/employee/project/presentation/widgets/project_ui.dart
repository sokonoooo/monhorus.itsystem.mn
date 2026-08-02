import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/risk_glyph.dart';
import '../../domain/entities/risk_level.dart';
import '../../../presentation/widgets/employee_ui.dart';

export '../../../presentation/widgets/employee_ui.dart'
    show EmployeePill, SectionHeading;

/// The prototype's primitives, one widget per CSS class, so the screens read as
/// layout rather than styling. Names follow the prototype's class names.
///
/// `EmployeeTokens` is owned by the shell and is read-only here; everything below is
/// composed from it plus [Tone].

/// The band chip beside a device: glyph, band abbreviation, and the device's own
/// score when it has one.
///
/// The prototype printed "Улаан 38" — the colour, then the number. The colour name
/// was the whole label, which repeated what the eye could already see, meant nothing
/// to a colour-blind reader and nothing at all in greyscale. It now reads "◆ Ноцтой
/// 38": a silhouette that survives any of those, the band's *meaning*, and the score.
///
/// An object with no assessment gets "Үнэлгээгүй" over a hollow ring in a grey chip,
/// and never a zero: an unassessed device is an unknown, not a failing one.
class RiskPill extends StatelessWidget {
  const RiskPill({super.key, required this.score, required this.level});

  final int? score;
  final RiskLevel? level;

  @override
  Widget build(BuildContext context) {
    final int? value = score;
    final RiskLevel? band = level;
    final bool assessed = value != null && band != null;

    return EmployeePill(
      label: assessed ? '${band.shortLabel} $value' : unassessedLabel,
      tone: riskTone(assessed ? band : null),
      showGlyph: true,
      glyphLevel: assessed ? band : null,
      semanticLabel: assessed ? '${band.label}, оноо $value' : unassessedLabel,
    );
  }
}

/// `.card` — a bordered white panel with an optional 3px accent along the top edge.
class ProjectCard extends StatelessWidget {
  const ProjectCard({
    super.key,
    required this.child,
    this.accent,
    this.padding = const EdgeInsets.all(14),
    this.margin = const EdgeInsets.fromLTRB(
      EmployeeTokens.gutter,
      0,
      EmployeeTokens.gutter,
      10,
    ),
    this.radius = EmployeeTokens.radiusCard,
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
      decoration: EmployeeTokens.card(radius: radius),
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

/// `.row-icon` — a 40px square tile carrying a short code, a score or an icon, with
/// the band silhouette pinned to its corner.
class RowTile extends StatelessWidget {
  const RowTile({
    super.key,
    required this.tone,
    this.text,
    this.icon,
    this.size = 40,
    this.level,
    this.showGlyph = false,
  });

  final Tone tone;
  final String? text;
  final IconData? icon;
  final double size;

  /// The band the tile is tinted for. Only read when [showGlyph] is set.
  final RiskLevel? level;

  /// Draws the band mark in the tile's top-right corner. The tile's fill already
  /// carries the band as colour; the glyph is what carries it in greyscale, in
  /// sunlight, and to a reader who cannot separate the orange band from the yellow
  /// one. Pass it even when [level] is null — the hollow ring is the correct mark
  /// for an object that has never been scored.
  final bool showGlyph;

  @override
  Widget build(BuildContext context) {
    final Widget face = Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 2),
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(size / 4),
        border: Border.all(color: tone.border, width: EmployeeTokens.hairline),
      ),
      child: icon != null
          ? Icon(icon, size: size * 0.48, color: tone.foreground)
          : FittedBox(
              child: Text(
                text ?? '',
                maxLines: 1,
                style: EmployeeTokens.rowSub
                    .merge(EmployeeTokens.mono)
                    .copyWith(
                        fontWeight: FontWeight.w800, color: tone.foreground),
              ),
            ),
    );

    if (!showGlyph) return face;

    return Semantics(
      label: riskSemanticLabel(level),
      child: SizedBox(
        width: size,
        height: size,
        child: Stack(
          clipBehavior: Clip.none,
          children: <Widget>[
            face,
            Positioned(
              top: -2,
              right: -2,
              child: Container(
                padding: const EdgeInsets.all(1.5),
                decoration: const BoxDecoration(
                  color: EmployeeTokens.white,
                  shape: BoxShape.circle,
                ),
                child: RiskGlyph(level: level, size: size * 0.22),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `.row` — the list primitive: a leading tile, two lines of text, a trailing pill
/// above a chevron.
class ProjectRow extends StatelessWidget {
  const ProjectRow({
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
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        7,
      ),
      child: Material(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          splashFactory: NoSplash.splashFactory,
          highlightColor: EmployeeTokens.soft2,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              border: Border.all(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
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
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.rowTitle,
                      ),
                      if (subtitle.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          subtitle,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: EmployeeTokens.rowSub,
                        ),
                      ],
                    ],
                  ),
                ),
                const SizedBox(width: 10),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (trailing != null) trailing!,
                    if (onTap != null) ...<Widget>[
                      if (trailing != null) const SizedBox(height: 4),
                      const Icon(
                        Icons.chevron_right,
                        size: 15,
                        color: EmployeeTokens.line,
                      ),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `.mcard` — a labelled figure with an optional note beneath.
class MetricCard extends StatelessWidget {
  const MetricCard({
    super.key,
    required this.label,
    required this.value,
    this.note,
    this.valueColor = EmployeeTokens.ink,
  });

  final String label;
  final String value;
  final String? note;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
      decoration: BoxDecoration(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        border: Border.all(
          color: EmployeeTokens.line,
          width: EmployeeTokens.hairline,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Text(
            label.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.microLabel,
          ),
          const SizedBox(height: 5),
          FittedBox(
            fit: BoxFit.scaleDown,
            alignment: Alignment.centerLeft,
            child: Text(
              value,
              style: EmployeeTokens.metricValue.copyWith(color: valueColor),
            ),
          ),
          if (note != null) ...<Widget>[
            const SizedBox(height: 3),
            Text(
              note!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.microNote,
            ),
          ],
        ],
      ),
    );
  }
}

/// `.mgrid` — two columns of [MetricCard], padded to the card gutter.
class MetricGrid extends StatelessWidget {
  const MetricGrid({super.key, required this.cards});

  final List<Widget> cards;

  @override
  Widget build(BuildContext context) {
    final List<Widget> rows = <Widget>[];
    for (int i = 0; i < cards.length; i += 2) {
      rows.add(
        Padding(
          padding: EdgeInsets.only(top: i == 0 ? 0 : 7),
          // IntrinsicHeight so the pair shares the taller one's height. A bare
          // stretch cannot do it inside a scroll view, where the Row is unbounded.
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Expanded(child: cards[i]),
                const SizedBox(width: 7),
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
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
      child: Column(mainAxisSize: MainAxisSize.min, children: rows),
    );
  }
}

/// `.info-item` — the three-up compact metric strip on a project card.
class InfoStrip extends StatelessWidget {
  const InfoStrip({super.key, required this.items});

  final List<InfoStripItem> items;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: EmployeeTokens.soft2,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        border: Border.all(color: EmployeeTokens.faint),
      ),
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (int i = 0; i < items.length; i++) ...<Widget>[
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
                        items[i].value,
                        style: EmployeeTokens.metricValue
                            .copyWith(color: items[i].valueColor),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      items[i].label.toUpperCase(),
                      textAlign: TextAlign.center,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.microLabel,
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

@immutable
class InfoStripItem {
  const InfoStripItem({
    required this.value,
    required this.label,
    this.valueColor = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color valueColor;
}

/// `.info-banner` / `.alert-banner`.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.text,
    required this.tone,
    required this.icon,
    this.title,
  });

  const NoticeBanner.info({super.key, required this.text, this.title})
      : tone = Tone.yellow,
        icon = Icons.info_outline;

  const NoticeBanner.alert({super.key, required this.text, this.title})
      : tone = Tone.red,
        icon = Icons.error_outline;

  const NoticeBanner.neutral({super.key, required this.text, this.title})
      : tone = Tone.neutral,
        icon = Icons.info_outline;

  final String text;
  final String? title;
  final Tone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
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
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Icon(icon, size: 16, color: tone.foreground),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      if (title != null) ...<Widget>[
                        Text(
                          title!,
                          style: EmployeeTokens.noticeTitle
                              .copyWith(color: tone.foreground),
                        ),
                        const SizedBox(height: 3),
                      ],
                      Text(
                        text,
                        // Ink, not the tone: `yellow` and `orange` do not reach 4.5:1,
                        // and the banner's tint plus its icon already carry the tone.
                        style: EmployeeTokens.noticeBody
                            .copyWith(color: EmployeeTokens.ink),
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

/// `.breadcrumb` — the Project › Building › Floor › Device trail.
class Breadcrumb extends StatelessWidget {
  const Breadcrumb({super.key, required this.parts});

  final List<String> parts;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.labelGutter,
        0,
        EmployeeTokens.labelGutter,
        10,
      ),
      child: Wrap(
        spacing: 5,
        runSpacing: 2,
        crossAxisAlignment: WrapCrossAlignment.center,
        children: <Widget>[
          for (int i = 0; i < parts.length; i++) ...<Widget>[
            if (i > 0)
              const Text(
                '›',
                style: EmployeeTokens.rowSub,
              ),
            Text(
              parts[i],
              style: EmployeeTokens.rowSub.copyWith(
                fontWeight: FontWeight.w800,
                color: i == parts.length - 1
                    ? EmployeeTokens.ink
                    : EmployeeTokens.muted,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// One key/value line inside a card, as the prototype's info rows print them.
class DetailRow extends StatelessWidget {
  const DetailRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor = EmployeeTokens.ink,
    this.mono = false,
    this.isLast = false,
  });

  final String label;
  final String value;
  final Color valueColor;
  final bool mono;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final TextStyle valueStyle = mono
        ? EmployeeTokens.detailValue
            .merge(EmployeeTokens.mono)
            .copyWith(color: valueColor)
        : EmployeeTokens.detailValue.copyWith(color: valueColor);

    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: EmployeeTokens.faint)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            label,
            style: EmployeeTokens.rowSub,
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(value, textAlign: TextAlign.right, style: valueStyle),
          ),
        ],
      ),
    );
  }
}

/// `.titem` — one entry in a `.tline` timeline.
class TimelineEntry extends StatelessWidget {
  const TimelineEntry({
    super.key,
    required this.title,
    required this.meta,
    required this.tone,
    required this.icon,
    this.excerpt,
    this.trailing,
    this.isLast = false,
    this.onTap,
  });

  final String title;
  final String meta;
  final Tone tone;
  final IconData icon;

  /// `.history-more` — the grey excerpt box under a report entry.
  final String? excerpt;
  final Widget? trailing;
  final bool isLast;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final Widget content = Container(
      padding: const EdgeInsets.symmetric(vertical: 11),
      decoration: BoxDecoration(
        border: isLast
            ? null
            : const Border(bottom: BorderSide(color: EmployeeTokens.faint)),
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
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(
                color: tone.border,
                width: EmployeeTokens.hairline,
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
                  style: EmployeeTokens.detailValue,
                ),
                const SizedBox(height: 2),
                Text(
                  meta,
                  style: EmployeeTokens.microNote.merge(EmployeeTokens.mono),
                ),
                if (excerpt != null && excerpt!.isNotEmpty) ...<Widget>[
                  const SizedBox(height: 7),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 9,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      color: EmployeeTokens.soft2,
                      borderRadius: BorderRadius.circular(
                        EmployeeTokens.radiusInput,
                      ),
                      border: Border.all(color: EmployeeTokens.faint),
                    ),
                    child: Text(
                      excerpt!,
                      style: EmployeeTokens.rowSub,
                    ),
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
    );

    if (onTap == null) return content;
    return InkWell(
      onTap: onTap,
      splashFactory: NoSplash.splashFactory,
      highlightColor: EmployeeTokens.soft2,
      child: content,
    );
  }
}

/// `.score-wrap` — the 86px ringed score beside a short identity block.
class ScoreRing extends StatelessWidget {
  const ScoreRing(
      {super.key, required this.score, required this.level, this.size = 86});

  final int? score;
  final RiskLevel? level;
  final double size;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = level;
    final Tone tone = riskTone(band);

    return Semantics(
      // The full band name, not "38": a screen reader announcing a bare number tells
      // the listener nothing about whether the device is safe to energise.
      label: score == null
          ? riskSemanticLabel(band)
          : 'Оноо $score, ${riskSemanticLabel(band)}',
      excludeSemantics: true,
      child: Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: tone.background,
          border: Border.all(color: tone.foreground, width: 3),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            // The band's silhouette above the figure, so the ring reads as a band and
            // not only as a number in a coloured circle.
            RiskGlyph(level: band, size: size * 0.13),
            const SizedBox(height: 3),
            Text(
              score == null ? '—' : '$score',
              style: EmployeeTokens.scoreValue,
            ),
            const SizedBox(height: 1),
            Text(
              score == null ? 'ҮНЭЛГЭЭГҮЙ' : '/100',
              style: EmployeeTokens.microLabel,
            ),
          ],
        ),
      ),
    );
  }
}

/// `.tab-row` — segmented chips; the selected one is filled ink.
class ChipRow extends StatelessWidget {
  const ChipRow({
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
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 5),
            Expanded(
              child: Material(
                color: i == selectedIndex
                    ? EmployeeTokens.ink
                    : EmployeeTokens.white,
                borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
                child: InkWell(
                  onTap: () => onSelected(i),
                  borderRadius:
                      BorderRadius.circular(EmployeeTokens.radiusInput),
                  splashFactory: NoSplash.splashFactory,
                  highlightColor: EmployeeTokens.soft2,
                  child: Container(
                    alignment: Alignment.center,
                    padding: const EdgeInsets.symmetric(
                      horizontal: 4,
                      vertical: 8,
                    ),
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(
                        EmployeeTokens.radiusInput,
                      ),
                      border: Border.all(
                        color: i == selectedIndex
                            ? EmployeeTokens.ink
                            : EmployeeTokens.line,
                        width: EmployeeTokens.hairline,
                      ),
                    ),
                    child: Text(
                      labels[i].toUpperCase(),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.pillLabel.copyWith(
                        color: i == selectedIndex
                            ? EmployeeTokens.white
                            : EmployeeTokens.muted,
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

/// `.btn-full` — the full-width ink call to action.
class FullWidthButton extends StatelessWidget {
  const FullWidthButton({
    super.key,
    required this.label,
    required this.icon,
    this.onPressed,
    this.secondary = false,
  });

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool secondary;

  @override
  Widget build(BuildContext context) {
    final bool enabled = onPressed != null;
    final Color background = secondary
        ? EmployeeTokens.white
        : (enabled ? EmployeeTokens.ink : EmployeeTokens.soft);
    final Color foreground = secondary
        ? EmployeeTokens.ink
        : (enabled ? EmployeeTokens.white : EmployeeTokens.muted);

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        4,
        EmployeeTokens.gutter,
        10,
      ),
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: InkWell(
          onTap: onPressed,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              border: Border.all(
                color: secondary ? EmployeeTokens.line : background,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                Icon(icon, size: 16, color: foreground),
                const SizedBox(width: 8),
                Text(
                  label,
                  style: EmployeeTokens.buttonLabel.copyWith(color: foreground),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// `.empty-state` — a 38px icon at 35% opacity over a muted caption.
class ProjectEmptyState extends StatelessWidget {
  const ProjectEmptyState({
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
    return EmployeeEmptyState(
      icon: icon,
      message: message,
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
                  borderRadius: BorderRadius.circular(
                    EmployeeTokens.radiusInput,
                  ),
                ),
              ),
              child: Text(
                actionLabel!,
                style: EmployeeTokens.noticeTitle,
              ),
            )
          : null,
    );
  }
}

/// The `.tnav` header every pushed screen carries: a back chip, a title and a caption.
class ProjectNavBar extends StatelessWidget {
  const ProjectNavBar({
    super.key,
    required this.title,
    this.subtitle,
    this.action,
  });

  final String title;
  final String? subtitle;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      bottom: false,
      child: Container(
        padding: const EdgeInsets.fromLTRB(
          EmployeeTokens.labelGutter,
          10,
          EmployeeTokens.labelGutter,
          10,
        ),
        color: EmployeeTokens.bg,
        child: Row(
          children: <Widget>[
            _NavChip(
              icon: Icons.chevron_left,
              tooltip: 'Буцах',
              onTap: () => Navigator.of(context).maybePop(),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisAlignment: MainAxisAlignment.center,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Text(
                    title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.headerTitle,
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty)
                    Text(
                      subtitle!,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: EmployeeTokens.rowSub,
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

class _NavChip extends StatelessWidget {
  const _NavChip({required this.icon, required this.onTap, this.tooltip});

  final IconData icon;
  final VoidCallback onTap;
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip ?? '',
      child: Material(
        color: EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            width: 34,
            height: 34,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Icon(icon, size: 19, color: EmployeeTokens.ink),
          ),
        ),
      ),
    );
  }
}

/// The page frame every pushed screen in this tab uses.
class ProjectScaffold extends StatelessWidget {
  const ProjectScaffold({super.key, required this.navBar, required this.body});

  final ProjectNavBar navBar;
  final Widget body;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: Column(children: <Widget>[navBar, Expanded(child: body)]),
    );
  }
}
