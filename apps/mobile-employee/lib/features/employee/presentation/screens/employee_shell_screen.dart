import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/presentation/providers/auth_provider.dart';
import '../../home/presentation/screens/home_tab_screen.dart';
import '../../profile/presentation/screens/profile_tab_screen.dart';
import '../../project/presentation/screens/project_tab_screen.dart';
import '../../work/presentation/screens/work_tab_screen.dart';
import '../theme/employee_tokens.dart';

/// Root of the signed-in employee experience: four tabs over a shared bottom nav.
///
/// The tab bodies live in `lib/features/employee/<area>/` and each feature area owns
/// its own directory. This file owns only the frame — the tab order, the labels and
/// the nav chrome — so a feature agent never has to edit it.
///
/// Хуанли is not among the tabs. The prototype's nav is a single source of truth at
/// `electro-employee-app.html` L2113-2119 and holds no calendar entry; the schedule is
/// reached from the calendar button that every tab header carries
/// (`EmployeeHeaderActions`), which pushes it as a route over the shell.
///
/// [IndexedStack] rather than a swapped child, so each tab keeps its scroll offset
/// and any in-flight request when the user moves away and back.
class EmployeeShellScreen extends ConsumerStatefulWidget {
  const EmployeeShellScreen({super.key});

  @override
  ConsumerState<EmployeeShellScreen> createState() => _EmployeeShellScreenState();
}

class _EmployeeShellScreenState extends ConsumerState<EmployeeShellScreen> {
  int _index = 0;

  /// The four tabs, in contract order. Index here is the index in [_tabs].
  static const List<_EmployeeTab> _tabs = <_EmployeeTab>[
    _EmployeeTab(label: 'Нүүр', icon: Icons.home_outlined),
    _EmployeeTab(label: 'Ажил', icon: Icons.assignment_outlined),
    _EmployeeTab(label: 'Төсөл', icon: Icons.folder_outlined),
    _EmployeeTab(label: 'Профайл', icon: Icons.person_outline),
  ];

  void _select(int next) {
    if (next == _index) return;
    setState(() => _index = next);
  }

  @override
  Widget build(BuildContext context) {
    // Losing the session has to unwind whatever a tab pushed on top of the shell.
    // AuthGate swaps the FIRST route, so a pushed detail screen or the change-password
    // form would otherwise stay mounted over the login screen — a dead page the user
    // cannot get past. This lives here rather than in a tab because every tab pushes
    // routes and only one of them should own the cleanup; the Профайл tab carried a
    // private copy of this listener before the tabs were integrated.
    ref.listen<AuthStatus>(
      authControllerProvider.select((AuthState state) => state.status),
      (AuthStatus? previous, AuthStatus next) {
        if (next != AuthStatus.unauthenticated) return;
        final NavigatorState navigator = Navigator.of(context);
        if (navigator.canPop()) {
          navigator.popUntil((Route<dynamic> route) => route.isFirst);
        }
      },
    );

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: IndexedStack(
        index: _index,
        children: const <Widget>[
          HomeTabScreen(),
          WorkTabScreen(),
          ProjectTabScreen(),
          ProfileTabScreen(),
        ],
      ),
      bottomNavigationBar: _EmployeeBottomNav(
        tabs: _tabs,
        currentIndex: _index,
        onSelected: _select,
      ),
    );
  }
}

class _EmployeeTab {
  const _EmployeeTab({required this.label, required this.icon});

  final String label;
  final IconData icon;
}

/// The prototype's `.bnav`: white, a 1.5px top hairline, equal-width columns, a 21px
/// stroked icon over a 9px/600 label. The active item is expressed with colour alone
/// — no pill, no indicator — over a 130ms transition.
class _EmployeeBottomNav extends StatelessWidget {
  const _EmployeeBottomNav({
    required this.tabs,
    required this.currentIndex,
    required this.onSelected,
  });

  final List<_EmployeeTab> tabs;
  final int currentIndex;
  final ValueChanged<int> onSelected;

  @override
  Widget build(BuildContext context) {
    // The bar pads itself rather than wrapping in SafeArea, so the hairline stays
    // flush with the top edge of the bar and the inset only grows the tap targets.
    final double bottomInset = MediaQuery.viewPaddingOf(context).bottom;

    return Container(
      decoration: const BoxDecoration(
        color: EmployeeTokens.white,
        border: Border(
          top: BorderSide(
            color: EmployeeTokens.line,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      padding: EdgeInsets.only(top: 6, bottom: 6 + bottomInset),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < tabs.length; i++)
            Expanded(
              child: _NavItem(
                tab: tabs[i],
                selected: i == currentIndex,
                onTap: () => onSelected(i),
              ),
            ),
        ],
      ),
    );
  }
}

class _NavItem extends StatelessWidget {
  const _NavItem({
    required this.tab,
    required this.selected,
    required this.onTap,
  });

  final _EmployeeTab tab;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final Color target = selected ? EmployeeTokens.ink : EmployeeTokens.muted;

    return Semantics(
      button: true,
      selected: selected,
      label: tab.label,
      child: InkWell(
        onTap: onTap,
        // Colour is the only active affordance in this design language, so the ripple
        // is suppressed and the pressed state is the standard soft2 wash.
        splashFactory: NoSplash.splashFactory,
        highlightColor: EmployeeTokens.soft2,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: TweenAnimationBuilder<Color?>(
            duration: const Duration(milliseconds: 130),
            tween: ColorTween(end: target),
            builder: (BuildContext context, Color? colour, Widget? child) {
              final Color resolved = colour ?? target;
              return Column(
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Icon(tab.icon, size: 21, color: resolved),
                  const SizedBox(height: 3),
                  Text(
                    tab.label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: EmployeeTokens.navLabel.copyWith(color: resolved),
                  ),
                ],
              );
            },
          ),
        ),
      ),
    );
  }
}
