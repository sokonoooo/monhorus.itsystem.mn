import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/push/push_messaging.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../domain/entities/customer_scope.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/create_request_sheet.dart';
import '../widgets/customer_ui.dart';
import 'building_list_screen.dart';
import 'customer_home_screen.dart';
import 'customer_profile_screen.dart';
import 'service_request_detail_screen.dart';
import 'service_request_list_screen.dart';

/// Host for the customer flow: four tabs behind a bottom bar, matching the
/// prototype's Нүүр / Барилга / Хүсэлт / Профайл.
///
/// The prototype also puts a central "+" FAB between the second and third tab. It is
/// shown only when the signed-in account holds `service_request.create`, because the
/// API refuses the call otherwise and a button that always fails is worse than no
/// button.
class CustomerShellScreen extends ConsumerStatefulWidget {
  const CustomerShellScreen({super.key, this.initialIndex = 0});

  final int initialIndex;

  @override
  ConsumerState<CustomerShellScreen> createState() => _CustomerShellScreenState();
}

class _CustomerShellScreenState extends ConsumerState<CustomerShellScreen>
    with WidgetsBindingObserver {
  late int _index = widget.initialIndex;

  VoidCallback? _stopListeningForPush;

  /*
   * The badge is fetched once and never again on its own: there is no polling here and no
   * socket. That leaves it stale in the two cases a user actually notices - coming back to
   * the app after a while, and a push landing while the app is open, which is precisely
   * when the count just changed.
   *
   * Both are handled by re-asking the server rather than adjusting a local number.
   */
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _stopListeningForPush = PushMessaging.onPushArrived(_refreshNotifications);
    // The login response carries no permission list, so the effective set is only
    // known after an /auth/me. Asking once here keeps the create control honest.
    Future<void>.microtask(
      () => ref.read(authControllerProvider.notifier).refreshCurrentUser(),
    );
  }

  @override
  void dispose() {
    _stopListeningForPush?.call();
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) _refreshNotifications();
  }

  void _refreshNotifications() {
    if (!mounted) return;
    ref
      ..invalidate(unreadNotificationCountProvider)
      ..invalidate(customerNotificationsProvider);
  }

  @override
  Widget build(BuildContext context) {
    final bool canCreate = ref.watch(canCreateServiceRequestProvider);
    final CustomerScope scope = ref.watch(customerScopeProvider);
    final bool fabVisible = canCreate && scope is ResolvedCustomerScope;

    return Scaffold(
      backgroundColor: CustomerTokens.bg,
      body: IndexedStack(
        index: _index,
        children: <Widget>[
          CustomerHomeScreen(onOpenTab: _select),
          const BuildingListScreen(),
          const ServiceRequestListScreen(),
          const CustomerProfileScreen(),
        ],
      ),
      floatingActionButton: fabVisible
          ? FloatingActionButton(
              onPressed: () => _openCreateSheet(scope),
              backgroundColor: CustomerTokens.ink,
              foregroundColor: CustomerTokens.white,
              shape: const CircleBorder(),
              tooltip: 'Дуудлага илгээх',
              child: const Icon(Icons.add, size: 26),
            )
          : null,
      floatingActionButtonLocation: FloatingActionButtonLocation.centerDocked,
      bottomNavigationBar: _BottomNav(
        index: _index,
        onSelected: _select,
        notched: fabVisible,
      ),
    );
  }

  void _select(int index) => setState(() => _index = index);

  Future<void> _openCreateSheet(ResolvedCustomerScope scope) async {
    final String? createdId =
        await CreateRequestSheet.show(context, scope: scope);
    if (createdId == null || !mounted) return;

    _select(2);
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => ServiceRequestDetailScreen(requestId: createdId),
      ),
    );
  }
}

class _BottomNav extends StatelessWidget {
  const _BottomNav({
    required this.index,
    required this.onSelected,
    required this.notched,
  });

  final int index;
  final ValueChanged<int> onSelected;
  final bool notched;

  static const List<_NavSpec> _items = <_NavSpec>[
    _NavSpec('Нүүр', Icons.home_outlined, Icons.home),
    _NavSpec('Барилга', Icons.apartment_outlined, Icons.apartment),
    _NavSpec('Хүсэлт', Icons.assignment_outlined, Icons.assignment),
    _NavSpec('Профайл', Icons.person_outline, Icons.person),
  ];

  @override
  Widget build(BuildContext context) {
    return BottomAppBar(
      color: CustomerTokens.white,
      elevation: 0,
      height: 62,
      padding: EdgeInsets.zero,
      shape: notched ? const CircularNotchedRectangle() : null,
      notchMargin: 7,
      child: DecoratedBox(
        decoration: const BoxDecoration(
          border: Border(top: CustomerTokens.hairlineSide),
        ),
        child: Row(
          children: <Widget>[
            _tab(0),
            _tab(1),
            if (notched) const SizedBox(width: 64),
            _tab(2),
            _tab(3),
          ],
        ),
      ),
    );
  }

  Widget _tab(int slot) {
    final _NavSpec spec = _items[slot];
    final bool active = index == slot;
    final Color color = active ? CustomerTokens.ink : CustomerTokens.muted;

    return Expanded(
      child: InkWell(
        onTap: () => onSelected(slot),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(active ? spec.activeIcon : spec.icon, size: 21, color: color),
            const SizedBox(height: 3),
            Text(
              spec.label,
              style: CustomerTokens.navLabel.copyWith(color: color),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavSpec {
  const _NavSpec(this.label, this.icon, this.activeIcon);

  final String label;
  final IconData icon;
  final IconData activeIcon;
}

/// The `.tnav` bell with its unread badge, shared by the tab screens.
class NotificationBell extends ConsumerWidget {
  const NotificationBell({super.key, required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<int> unread = ref.watch(unreadNotificationCountProvider);
    final int count = unread.valueOrNull ?? 0;

    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        NavChip(
          icon: Icons.notifications_none,
          onTap: onTap,
          tooltip: 'Мэдэгдэл',
          iconSize: 18,
        ),
        if (count > 0)
          Positioned(
            top: -4,
            right: -4,
            child: Container(
              width: 17,
              height: 17,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: CustomerTokens.red,
                shape: BoxShape.circle,
                border: Border.all(color: CustomerTokens.bg, width: 2),
              ),
              child: Text(
                count > 9 ? '9+' : '$count',
                style: CustomerTokens.navLabel.copyWith(
                  fontWeight: FontWeight.w800,
                  color: CustomerTokens.white,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

/// The plain page background used by every screen in this flow.
class CustomerScaffold extends StatelessWidget {
  const CustomerScaffold({
    super.key,
    required this.navBar,
    required this.body,
    this.bottomAction,
  });

  final CustomerNavBar navBar;
  final Widget body;
  final Widget? bottomAction;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: CustomerTokens.bg,
      body: Column(
        children: <Widget>[
          navBar,
          Expanded(child: body),
          if (bottomAction != null) bottomAction!,
        ],
      ),
    );
  }
}
