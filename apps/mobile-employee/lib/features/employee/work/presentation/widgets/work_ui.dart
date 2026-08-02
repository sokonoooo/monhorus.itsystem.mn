/// The prototype's component vocabulary, as widgets.
///
/// Everything here is presentation only: no widget in this file fetches, decides
/// what a user may do, or recomputes a figure the server sent. Colour carries one
/// meaning throughout — risk — so a tone argument is always a status colour from
/// [EmployeeTokens] and never a decorative choice.
library;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_ui.dart';

export '../../../presentation/widgets/employee_ui.dart'
    show EmployeePill, ProgressRail, SectionHeading;

/// `.card` — white, a 1px keyline, radius 12, a whisper of shadow, optionally with
/// the 3px status accent pinned to its top edge.
class WorkCard extends StatelessWidget {
  const WorkCard({
    super.key,
    required this.child,
    this.accent,
    this.onTap,
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
  final VoidCallback? onTap;
  final EdgeInsets padding;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    final Widget body = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        if (accent != null) Container(height: 3, color: accent),
        Padding(padding: padding, child: child),
      ],
    );

    return Container(
      margin: margin,
      decoration: EmployeeTokens.card(),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? body
          : Material(
              color: Colors.transparent,
              child: InkWell(
                onTap: onTap,
                splashFactory: NoSplash.splashFactory,
                highlightColor: EmployeeTokens.soft2,
                child: body,
              ),
            ),
    );
  }
}

/// One cell of the `.kpi` strip: a big mono number over a small caption.
class KpiTile extends StatelessWidget {
  const KpiTile({
    super.key,
    required this.value,
    required this.label,
    this.tone = EmployeeTokens.ink,
  });

  final String value;
  final String label;
  final Color tone;

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        Text(
          value,
          style: EmployeeTokens.kpiValue.copyWith(color: tone),
        ),
        const SizedBox(height: 3),
        Text(
          label,
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: EmployeeTokens.microNote.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// A three-up KPI strip inside one card, divided by hairlines.
class KpiStrip extends StatelessWidget {
  const KpiStrip({super.key, required this.tiles});

  final List<KpiTile> tiles;

  @override
  Widget build(BuildContext context) {
    return WorkCard(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < tiles.length; i++) ...<Widget>[
            if (i > 0)
              const SizedBox(
                height: 34,
                child: VerticalDivider(
                  width: 1,
                  thickness: 1,
                  color: EmployeeTokens.faint,
                ),
              ),
            Expanded(child: tiles[i]),
          ],
        ],
      ),
    );
  }
}

/// A label/value row inside an information card: muted label left, ink value right.
class InfoRow extends StatelessWidget {
  const InfoRow({
    super.key,
    required this.label,
    required this.value,
    this.tone = EmployeeTokens.ink,
    this.divider = true,
  });

  final String label;
  final String value;
  final Color tone;
  final bool divider;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(vertical: 9),
      decoration: divider
          ? const BoxDecoration(
              border: Border(
                bottom: BorderSide(color: EmployeeTokens.faint),
              ),
            )
          : null,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Expanded(
            flex: 4,
            child: Text(
              label,
              style:
                  EmployeeTokens.rowSub.copyWith(fontWeight: FontWeight.w500),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            flex: 6,
            child: Text(
              value,
              textAlign: TextAlign.right,
              style: EmployeeTokens.detailValue.copyWith(color: tone),
            ),
          ),
        ],
      ),
    );
  }
}

/// The tinted explanation block the prototype uses for a warning or a note.
class NoticeBanner extends StatelessWidget {
  const NoticeBanner({
    super.key,
    required this.text,
    required this.tone,
    this.title,
    this.icon,
    this.margin = const EdgeInsets.fromLTRB(
      EmployeeTokens.gutter,
      0,
      EmployeeTokens.gutter,
      10,
    ),
  });

  final String text;
  final String? title;
  final Color tone;
  final IconData? icon;
  final EdgeInsets margin;

  @override
  Widget build(BuildContext context) {
    Color wash = EmployeeTokens.soft2;
    Color edge = EmployeeTokens.faint;
    if (tone == EmployeeTokens.yellow) {
      wash = EmployeeTokens.yellowBg;
      edge = EmployeeTokens.yellowBorder;
    } else if (tone == EmployeeTokens.red) {
      wash = EmployeeTokens.redBg;
      edge = EmployeeTokens.redBorder;
    } else if (tone == EmployeeTokens.green) {
      wash = EmployeeTokens.greenBg;
      edge = EmployeeTokens.greenBorder;
    }

    return Container(
      margin: margin,
      decoration: BoxDecoration(
        color: wash,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        // Uniform, and it must stay so: Flutter refuses to paint a rounded box whose
        // sides differ ("A borderRadius can only be given on borders with uniform
        // colors"), and this carried a 3px left side in the tone colour, which threw
        // during paint every time a notice was shown. The accent is a child stripe now.
        border: Border.all(color: edge, width: EmployeeTokens.hairline),
        boxShadow: EmployeeTokens.cardShadow,
      ),
      clipBehavior: Clip.antiAlias,
      // IntrinsicHeight so the stripe matches the notice's height; `stretch` on its own
      // asks for infinite height inside a scrolling column.
      child: IntrinsicHeight(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Container(width: 3, color: tone),
            const SizedBox(width: 12),
            if (icon != null) ...<Widget>[
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Icon(icon, size: 16, color: tone),
              ),
              const SizedBox(width: 9),
            ],
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(0, 12, 12, 12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (title != null) ...<Widget>[
                      Text(
                        title!,
                        style: EmployeeTokens.noticeTitle.copyWith(
                          color: tone == EmployeeTokens.muted
                              ? EmployeeTokens.ink
                              : tone,
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

/// `.btn-full` — a full-width ink pill, or its white outline variant.
class WorkButton extends StatelessWidget {
  const WorkButton({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.tone,
  }) : _secondary = false;

  const WorkButton.secondary({
    super.key,
    required this.label,
    required this.onPressed,
    this.icon,
    this.busy = false,
    this.tone,
  }) : _secondary = true;

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool busy;

  /// Overrides the ink accent, for a destructive action.
  final Color? tone;
  final bool _secondary;

  @override
  Widget build(BuildContext context) {
    final Color accent = tone ?? EmployeeTokens.ink;
    final bool enabled = onPressed != null && !busy;

    final Color background = _secondary
        ? EmployeeTokens.white
        : (enabled ? accent : EmployeeTokens.soft);
    final Color foreground = _secondary
        ? (enabled ? accent : EmployeeTokens.muted)
        : (enabled ? EmployeeTokens.white : EmployeeTokens.muted);

    return Opacity(
      opacity: enabled ? 1 : 0.75,
      child: Material(
        color: background,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: InkWell(
          onTap: enabled ? onPressed : null,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 13, horizontal: 14),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              border: _secondary
                  ? Border.all(
                      color:
                          enabled ? EmployeeTokens.line : EmployeeTokens.faint,
                      width: EmployeeTokens.hairline,
                    )
                  : null,
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: <Widget>[
                if (busy)
                  SizedBox(
                    width: 15,
                    height: 15,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      valueColor: AlwaysStoppedAnimation<Color>(foreground),
                    ),
                  )
                else if (icon != null)
                  Icon(icon, size: 16, color: foreground),
                if (busy || icon != null) const SizedBox(width: 8),
                Flexible(
                  child: Text(
                    label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.rowTitle.copyWith(
                      fontWeight: FontWeight.w800,
                      color: foreground,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

// -- Bottom-sheet primitives -------------------------------------------------
//
// These four live here rather than inside one sheet because this tab now has three
// authoring sheets — the task progress entry, the consolidated report editor and the
// inspection-report editor — and each copy of the same field decoration is a place for
// them to drift apart. They were lifted out of `task_progress_sheet.dart`, which is why
// [SheetFooter] takes its save label as an argument: the shape is shared, the wording
// belongs to the sheet.

/// The 36x4 grab handle every sheet opens with.
class SheetHandle extends StatelessWidget {
  const SheetHandle({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 4,
      margin: const EdgeInsets.symmetric(vertical: 10),
      decoration: BoxDecoration(
        color: EmployeeTokens.line,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

/// The 10px uppercase caption above a sheet field.
class FieldLabel extends StatelessWidget {
  const FieldLabel(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(
        text.toUpperCase(),
        style: EmployeeTokens.sectionLabel,
      ),
    );
  }
}

/// A sheet text field, with the server's per-field refusal printed under it.
///
/// [error] is fed from `ServerFailure.fieldErrors`, so the message a user reads is the
/// backend's own for the exact field it named.
class SheetField extends StatelessWidget {
  const SheetField({
    super.key,
    required this.controller,
    required this.hint,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
    this.error,
    this.enabled = true,
  });

  final TextEditingController controller;
  final String hint;
  final int maxLines;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final String? error;
  final bool enabled;

  @override
  Widget build(BuildContext context) {
    final bool hasError = error != null;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        TextField(
          controller: controller,
          enabled: enabled,
          maxLines: maxLines,
          keyboardType: keyboardType,
          inputFormatters: inputFormatters,
          style: EmployeeTokens.body.copyWith(color: EmployeeTokens.ink),
          decoration: InputDecoration(
            hintText: hint,
            hintStyle:
                EmployeeTokens.body.copyWith(color: EmployeeTokens.muted),
            filled: true,
            fillColor: hasError ? EmployeeTokens.redBg : EmployeeTokens.white,
            contentPadding:
                const EdgeInsets.symmetric(horizontal: 12, vertical: 11),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: const BorderSide(
                color: EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            enabledBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              borderSide: BorderSide(
                color: hasError ? EmployeeTokens.red : EmployeeTokens.ink,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
        ),
        if (hasError)
          Padding(
            padding: const EdgeInsets.only(top: 5),
            child: Text(
              error!,
              style: EmployeeTokens.rowSub.copyWith(
                fontWeight: FontWeight.w600,
                color: EmployeeTokens.red,
              ),
            ),
          ),
      ],
    );
  }
}

/// The 1fr : 2fr footer the prototype uses on every sheet.
class SheetFooter extends StatelessWidget {
  const SheetFooter({
    super.key,
    required this.busy,
    required this.saveLabel,
    required this.onCancel,
    required this.onSave,
  });

  final bool busy;
  final String saveLabel;
  final VoidCallback? onCancel;
  final VoidCallback onSave;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: EdgeInsets.fromLTRB(
        16,
        12,
        16,
        12 + MediaQuery.viewPaddingOf(context).bottom,
      ),
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: WorkButton.secondary(label: 'Болих', onPressed: onCancel),
          ),
          const SizedBox(width: 10),
          Expanded(
            flex: 2,
            child: WorkButton(
              label: saveLabel,
              icon: Icons.check,
              busy: busy,
              onPressed: busy ? null : onSave,
            ),
          ),
        ],
      ),
    );
  }
}

/// A circular avatar chip carrying initials.
class InitialsAvatar extends StatelessWidget {
  const InitialsAvatar({super.key, required this.initials, this.size = 30});

  final String initials;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: size,
      height: size,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: EmployeeTokens.white,
        shape: BoxShape.circle,
        border: Border.all(
          color: EmployeeTokens.line,
          width: EmployeeTokens.hairline,
        ),
      ),
      child: Text(
        initials,
        style: TextStyle(
          fontSize: size * 0.36,
          fontWeight: FontWeight.w800,
          color: EmployeeTokens.ink,
        ),
      ),
    );
  }
}

/// `.tab-row` — equal-width outline chips; the active one fills with ink.
class SegmentedTabs extends StatelessWidget {
  const SegmentedTabs({
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
            if (i > 0) const SizedBox(width: 7),
            Expanded(
              child: _TabChip(
                label: labels[i],
                selected: i == selectedIndex,
                onTap: () => onSelected(i),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _TabChip extends StatelessWidget {
  const _TabChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      selected: selected,
      child: Material(
        color: selected ? EmployeeTokens.ink : EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
          child: Container(
            padding: const EdgeInsets.symmetric(vertical: 9),
            alignment: Alignment.center,
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
              border: Border.all(
                color: selected ? EmployeeTokens.ink : EmployeeTokens.line,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Text(
              label.toUpperCase(),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.pillLabel.copyWith(
                color: selected ? EmployeeTokens.white : EmployeeTokens.muted,
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The centred empty state: a 38px stroked icon at 35% opacity over a muted caption.
class WorkEmptyState extends StatelessWidget {
  const WorkEmptyState({
    super.key,
    required this.icon,
    required this.message,
    this.title,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String message;
  final String? title;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    return EmployeeEmptyState(
      icon: icon,
      message: message,
      title: title,
      padding: const EdgeInsets.symmetric(horizontal: 32, vertical: 44),
      gap: 12,
      action: actionLabel != null && onAction != null
          ? SizedBox(
              width: 200,
              child: WorkButton.secondary(
                label: actionLabel!,
                onPressed: onAction,
              ),
            )
          : null,
    );
  }
}

/// This tab's name for the shell's toast. Kept as a thin alias so the many call
/// sites here read in the tab's own vocabulary while there is only one SnackBar.
void showWorkToast(
  BuildContext context, {
  required String message,
  required Color tone,
  IconData icon = Icons.check,
}) {
  showEmployeeToast(context, message: message, tone: tone, icon: icon);
}
