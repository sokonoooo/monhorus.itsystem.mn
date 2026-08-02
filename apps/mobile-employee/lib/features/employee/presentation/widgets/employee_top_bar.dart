/// The prototype's `.hdr-actions` — the calendar and the bell, top-right of every tab.
///
/// Shell-owned, like `employee_ui.dart` next door, for two reasons the tabs cannot
/// solve on their own:
///
///   * `electro-employee-app.html` puts the SAME two buttons on every tab-level
///     screen (`s-home` L844, `s-reqs` L955, `s-projects` L1224, `s-profile` L1571,
///     `s-planned` L1627): calendar first, bell second, badge on the bell only. Four
///     private copies would drift, and the two that already existed
///     (`HomeHeaderButton`, `HeaderIconButton`) had already begun to.
///   * The badge is a cross-tab figure. [EmployeeHeaderActions] is a single
///     [ConsumerWidget] so all four tabs read one `unreadNotificationCountProvider`
///     and can never display two unread counts that disagree.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../calendar/presentation/screens/calendar_tab_screen.dart';
import '../../home/presentation/providers/home_providers.dart';
import '../../home/presentation/widgets/notifications_sheet.dart';
import '../theme/employee_tokens.dart';

/// `.hdr-btn` (prototype L722-738) — a 36×36 white square, radius [EmployeeTokens.radiusRow],
/// 1px [line] border, an 18px stroked glyph, [soft] while pressed. With `.hdr-badge`
/// (L731-737) when [badgeCount] is positive: top -5 / right -5, min-width 16, height
/// 16, radius [EmployeeTokens.radiusInput], [red] behind 9px/800 white digits, ringed
/// 2px in [bg] so it reads against the header.
///
/// One primitive rather than the two near-identical transcriptions this replaces, so
/// [badgeCount] (the bell) and [busy] (the calendar screen's refresh) are options on
/// one widget instead of the axis along which two copies differ.
class EmployeeHeaderButton extends StatelessWidget {
  const EmployeeHeaderButton({
    super.key,
    required this.icon,
    required this.onTap,
    required this.tooltip,
    this.badgeCount = 0,
    this.busy = false,
  });

  final IconData icon;
  final VoidCallback? onTap;
  final String tooltip;

  /// Hidden at zero, exactly as `renderNotifs` hides every badge when nothing is
  /// unread.
  final int badgeCount;

  /// Swaps the glyph for a spinner and refuses taps while a request is in flight, so
  /// the control reports its own state instead of looking inert.
  final bool busy;

  @override
  Widget build(BuildContext context) {
    return Tooltip(
      message: tooltip,
      child: Semantics(
        button: true,
        label: badgeCount > 0 ? '$tooltip, $badgeCount шинэ' : tooltip,
        child: Stack(
          // The badge overhangs the square by 5px on two sides.
          clipBehavior: Clip.none,
          children: <Widget>[
            Material(
              color: EmployeeTokens.white,
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              child: InkWell(
                onTap: busy ? null : onTap,
                borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
                child: Container(
                  width: 36,
                  height: 36,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
                    border: Border.all(
                      color: EmployeeTokens.line,
                      width: EmployeeTokens.hairline,
                    ),
                  ),
                  child: busy
                      ? const SizedBox(
                          width: 15,
                          height: 15,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: EmployeeTokens.muted,
                          ),
                        )
                      : Icon(icon, size: 18, color: EmployeeTokens.ink),
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
                  decoration: BoxDecoration(
                    color: EmployeeTokens.red,
                    borderRadius: BorderRadius.circular(EmployeeTokens.radiusInput),
                    border: Border.all(color: EmployeeTokens.bg, width: 2),
                  ),
                  child: Text(
                    badgeCount > 99 ? '99+' : '$badgeCount',
                    style: const TextStyle(
                      fontSize: 9,
                      fontWeight: FontWeight.w800,
                      height: 1,
                      color: EmployeeTokens.white,
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

/// `.hdr-actions` — the two buttons, in the prototype's order, at its 8px gap.
///
/// Calendar FIRST, bell second. The order is the contract, not a preference: it is
/// identical on all five prototype screens and it is what the app was reported as
/// getting wrong.
///
/// The calendar pushes [CalendarTabScreen] as a full route rather than opening the
/// prototype's anchored popover. That screen is a `RefreshIndicator` over a
/// `ListView`, and nesting a pull-to-refresh inside a drag-to-dismiss modal would
/// give the same vertical drag two owners; a pushed route keeps both gestures
/// unambiguous and costs nothing the popover provided.
class EmployeeHeaderActions extends ConsumerWidget {
  const EmployeeHeaderActions({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final int unread =
        ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        EmployeeHeaderButton(
          icon: Icons.calendar_today_outlined,
          tooltip: 'Миний хуваарь',
          onTap: () =>
              Navigator.of(context).push<void>(CalendarTabScreen.route()),
        ),
        const SizedBox(width: 8),
        EmployeeHeaderButton(
          icon: Icons.notifications_none_outlined,
          tooltip: 'Мэдэгдэл',
          badgeCount: unread,
          onTap: () => NotificationsSheet.show(context),
        ),
      ],
    );
  }
}
