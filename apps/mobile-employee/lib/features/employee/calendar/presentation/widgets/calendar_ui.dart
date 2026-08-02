import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../domain/entities/event_level.dart';
import '../../../presentation/widgets/employee_ui.dart';

export '../../../presentation/widgets/employee_ui.dart'
    show EmployeePill, ProgressRail, SectionHeading;

/// The prototype's primitives, one widget per CSS class, so the screen below reads
/// as layout rather than styling.
///
/// Scoped to the Хуанли screen: `EmployeeTokens` is shell-owned and shared, but these
/// widgets live in this feature's directory because no cross-tab widget library was
/// agreed. Anything here that another tab needs should be hoisted by the integrator
/// rather than copied.

/// `#mcal-agenda-title` — the line above the day's agenda.
///
/// Deliberately not a [SectionHeading]: that primitive upper-cases its text, which
/// is right for a static label and wrong here, where the string carries a date and a
/// count that read worse shouted.
class AgendaHeading extends StatelessWidget {
  const AgendaHeading(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.labelGutter,
        4,
        EmployeeTokens.labelGutter,
        8,
      ),
      child: Text(
        text,
        style: EmployeeTokens.noticeTitle,
      ),
    );
  }
}

/// `.card` — a white panel with the signature 1.5px outline.
class PanelCard extends StatelessWidget {
  const PanelCard({
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

  /// The 3px status bar pinned to the top edge.
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

/// `.tab-row` — segmented chips; the selected one is filled ink.
class SegmentedRow extends StatelessWidget {
  const SegmentedRow({
    super.key,
    required this.labels,
    required this.selectedIndex,
    required this.onSelected,
    this.enabled = const <bool>[],
  });

  final List<String> labels;
  final int selectedIndex;
  final ValueChanged<int> onSelected;

  /// Per-segment enablement. Empty means every segment is enabled. A disabled chip
  /// is rendered greyed rather than hidden, so the control does not change shape
  /// when an identity resolves a moment after the tab opens.
  final List<bool> enabled;

  bool _isEnabled(int index) =>
      enabled.isEmpty || (index < enabled.length && enabled[index]);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.gutter,
        0,
        EmployeeTokens.gutter,
        12,
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < labels.length; i++) ...<Widget>[
            if (i > 0) const SizedBox(width: 5),
            Expanded(
              child: _Segment(
                label: labels[i],
                selected: i == selectedIndex,
                enabled: _isEnabled(i),
                onTap: () => onSelected(i),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _Segment extends StatelessWidget {
  const _Segment({
    required this.label,
    required this.selected,
    required this.enabled,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final bool enabled;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color background = selected
        ? (enabled ? EmployeeTokens.ink : EmployeeTokens.line)
        : EmployeeTokens.white;
    final Color foreground = selected
        ? EmployeeTokens.white
        : (enabled ? EmployeeTokens.muted : EmployeeTokens.line);

    return Material(
      color: background,
      borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
      child: InkWell(
        onTap: enabled ? onTap : null,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: Container(
          alignment: Alignment.center,
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 8),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
            border: Border.all(
              color: selected
                  ? background
                  : (enabled ? EmployeeTokens.line : EmployeeTokens.faint),
              width: EmployeeTokens.hairline,
            ),
          ),
          child: Text(
            label.toUpperCase(),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.pillLabel.copyWith(color: foreground),
          ),
        ),
      ),
    );
  }
}

/// `.info-banner` / `.alert-banner`.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.text,
    required this.level,
    required this.icon,
    this.action,
  });

  const NoticeBanner.info({super.key, required this.text, this.action})
      : level = EventLevel.neutral,
        icon = Icons.info_outline;

  const NoticeBanner.warning({super.key, required this.text, this.action})
      : level = EventLevel.yellow,
        icon = Icons.report_problem_outlined;

  final String text;
  final EventLevel level;
  final IconData icon;
  final Widget? action;

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
          color: level.background,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          // Uniform, and it must stay so: Flutter refuses to paint a rounded box whose
          // sides differ ("A borderRadius can only be given on borders with uniform
          // colors"). The tone accent that used to be a 3px left side is a child stripe.
          border:
              Border.all(color: level.border, width: EmployeeTokens.hairline),
          boxShadow: EmployeeTokens.cardShadow,
        ),
        clipBehavior: Clip.antiAlias,
        // IntrinsicHeight so the accent stripe matches the notice height; `stretch` alone
        // asks for infinite height inside a scrolling column.
        child: IntrinsicHeight(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Container(width: 3, color: level.foreground),
              const SizedBox(width: 12),
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 10),
                child: Icon(icon, size: 16, color: level.foreground),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(0, 10, 12, 10),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        text,
                        // Ink2, never the band colour: `yellow` fails contrast on
                        // this wash and the icon already carries the level.
                        style: EmployeeTokens.noticeBody,
                      ),
                      if (action != null) ...<Widget>[
                        const SizedBox(height: 6),
                        action!,
                      ],
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

/// `.empty-state` — a 38px icon at 35% opacity over a 13px muted caption.
class CalendarEmptyState extends StatelessWidget {
  const CalendarEmptyState({
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
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 34),
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

// `.hdr-btn` lived here as `HeaderIconButton`. It is now
// `EmployeeHeaderButton` in `presentation/widgets/employee_top_bar.dart`: the same
// square appears in all four tab headers as well as this one, and the shared copy
// carries the bell's badge as well as this screen's busy spinner.
