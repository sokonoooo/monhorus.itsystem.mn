/// The prototype's visual primitives, as used by the Профайл tab.
///
/// Transcribed from `electro-employee-app.html`: `.sec`, `.card`, `.pill`, `.mcard`,
/// `.kpi`, `.row`, `.info-banner` and the empty state. They live inside this feature
/// because a tab agent owns only its own directory; if these later move to a shared
/// `employee/presentation/widgets`, this file should be deleted in favour of that.
///
/// The design language's "blue" variant is deliberately not reproduced: the
/// prototype defines it as white text on a white background over a faint grey border,
/// which renders invisible. Anything that would have used it is a neutral outline
/// chip with ink text instead.
library;

import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_ui.dart';

export '../../../presentation/widgets/employee_ui.dart'
    show EmployeePill, SectionHeading;

/// `.card` — a bordered white panel with an optional 3px accent along the top edge.
class ProfileCard extends StatelessWidget {
  const ProfileCard({
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
  });

  final Widget child;
  final Color? accent;
  final EdgeInsets padding;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: margin,
      decoration: EmployeeTokens.card(),
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

/// A label/value line inside an inset panel, separated from the next by a hairline.
class InfoRow extends StatelessWidget {
  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.mono = false,
    this.valueColor,
    this.last = false,
  });

  final String label;
  final String value;

  /// Codes, ids and timestamps read as data rather than prose. The prototype sets
  /// them in JetBrains Mono; no font asset is bundled in this project, so the
  /// distinction is carried by weight and letter-spacing instead of a face.
  final bool mono;

  final Color? valueColor;
  final bool last;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        border: last
            ? null
            : const Border(bottom: BorderSide(color: EmployeeTokens.faint)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Flexible(
            child: Text(
              label,
              style: EmployeeTokens.rowSub,
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 2,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: EmployeeTokens.detailValue.copyWith(
                letterSpacing: mono ? 0.4 : 0,
                color: valueColor ?? EmployeeTokens.ink,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// `.kpi` — one figure over its caption, in an equal-width column.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.value,
    required this.label,
    this.valueColor = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color valueColor;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          value,
          maxLines: 1,
          style: EmployeeTokens.kpiValue.copyWith(
            letterSpacing: 0.4,
            color: valueColor,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          maxLines: 2,
          textAlign: TextAlign.center,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.microNote.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// `.kpi` strip — equal columns divided by hairlines, inside one card.
class KpiStrip extends StatelessWidget {
  const KpiStrip({super.key, required this.tiles});

  final List<KpiTile> tiles;

  @override
  Widget build(BuildContext context) {
    return ProfileCard(
      padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          for (int i = 0; i < tiles.length; i++) ...<Widget>[
            if (i > 0)
              Container(width: 1, height: 34, color: EmployeeTokens.faint),
            Expanded(child: tiles[i]),
          ],
        ],
      ),
    );
  }
}

/// `.info-banner` — a tinted explanatory block, used where the app must say what it
/// cannot show and why.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.text,
    this.title,
    this.tone = Tone.yellow,
    this.icon = Icons.info_outline,
  });

  final String text;
  final String? title;
  final Tone tone;
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    return Container(
      margin: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        10,
      ),
      // No padding here: the accent stripe below has to reach the rounded edge, so the
      // inset is applied to the content instead.
      decoration: BoxDecoration(
        color: tone.background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        // Uniform, and it has to stay that way. Flutter refuses to paint a rounded box
        // whose sides differ — "A borderRadius can only be given on borders with uniform
        // colors" — and this decoration used to carry a 3px left side in the tone's
        // foreground colour, which threw the moment the banner was built. The accent is
        // drawn as a child stripe instead, which is what the design wanted anyway.
        border: Border.all(color: tone.border, width: EmployeeTokens.hairline),
        boxShadow: EmployeeTokens.cardShadow,
      ),
      // Clipped so the stripe takes the container's corner radius rather than squaring it.
      clipBehavior: Clip.antiAlias,
      // IntrinsicHeight so the stripe can stretch to the banner's height. `stretch` alone
      // asks for infinite height here — the banner sits in a scrolling column, so the Row
      // has no bound of its own to stretch to.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Container(width: 3, color: tone.foreground),
            const SizedBox(width: 10),
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 13),
              child: Icon(icon, size: 17, color: tone.foreground),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 13, 13, 13),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (title != null) ...<Widget>[
                      Text(
                        title!,
                        style: EmployeeTokens.noticeTitle.copyWith(
                          color: tone == Tone.neutral
                              ? EmployeeTokens.ink
                              : tone.foreground,
                        ),
                      ),
                      const SizedBox(height: 4),
                    ],
                    Text(
                      text,
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
    );
  }
}

/// `.row` — a tappable line with a leading tile, a title, a subtitle and a chevron.
class TappableRow extends StatelessWidget {
  const TappableRow({
    super.key,
    required this.icon,
    required this.title,
    this.subtitle,
    this.tone = Tone.neutral,
    this.onTap,
    this.showChevron = true,
    this.enabled = true,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final Tone tone;
  final VoidCallback? onTap;
  final bool showChevron;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final Color titleColour =
        enabled ? EmployeeTokens.ink : EmployeeTokens.muted;

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
          onTap: enabled ? onTap : null,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          splashFactory: NoSplash.splashFactory,
          highlightColor: EmployeeTokens.soft2,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 11),
            decoration: EmployeeTokens.card(radius: EmployeeTokens.radiusRow),
            child: Row(
              children: <Widget>[
                Container(
                  width: 40,
                  height: 40,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius:
                        BorderRadius.circular(EmployeeTokens.radiusRow),
                    border: Border.all(
                      color: tone.border,
                      width: EmployeeTokens.hairline,
                    ),
                  ),
                  child: Icon(
                    icon,
                    size: 19,
                    color: tone == Tone.neutral
                        ? EmployeeTokens.ink2
                        : tone.foreground,
                  ),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        title,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: EmployeeTokens.rowTitle.copyWith(
                          fontWeight: FontWeight.w700,
                          color: titleColour,
                        ),
                      ),
                      if (subtitle != null && subtitle!.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(
                          subtitle!,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: EmployeeTokens.rowSub,
                        ),
                      ],
                    ],
                  ),
                ),
                if (showChevron) ...<Widget>[
                  const SizedBox(width: 8),
                  const Icon(
                    Icons.chevron_right,
                    size: 17,
                    color: EmployeeTokens.line,
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// A wrapped list of neutral outline chips — skills, permitted job types, roles.
class ChipWrap extends StatelessWidget {
  const ChipWrap({super.key, required this.labels});

  final List<String> labels;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: 6,
      runSpacing: 6,
      children: <Widget>[
        for (final String label in labels)
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 5),
            decoration: BoxDecoration(
              color: EmployeeTokens.soft2,
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(color: EmployeeTokens.faint),
            ),
            child: Text(
              label,
              style: EmployeeTokens.rowSub.copyWith(
                fontWeight: FontWeight.w600,
                color: EmployeeTokens.ink2,
              ),
            ),
          ),
      ],
    );
  }
}

/// The prototype's empty state: a 38px stroked icon at 35% opacity over a 13px
/// muted caption.
class ProfileEmptyState extends StatelessWidget {
  const ProfileEmptyState({
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
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 34),
      gap: 12,
      actionGap: 14,
      action: actionLabel != null && onAction != null
          ? OutlinedButton(
              onPressed: onAction,
              style: OutlinedButton.styleFrom(
                foregroundColor: EmployeeTokens.ink,
                backgroundColor: EmployeeTokens.white,
                side: const BorderSide(
                  color: EmployeeTokens.line,
                  width: EmployeeTokens.hairline,
                ),
                shape: RoundedRectangleBorder(
                  borderRadius:
                      BorderRadius.circular(EmployeeTokens.radiusInput),
                ),
                textStyle: EmployeeTokens.noticeTitle,
              ),
              child: Text(actionLabel!),
            )
          : null,
    );
  }
}
