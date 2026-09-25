import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../auth/presentation/screens/change_password_screen.dart';
import '../../data/models/project_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/notifications_sheet.dart';
import 'customer_shell_screen.dart';
import 'service_request_detail_screen.dart';

/// s-profile: the account, its access and the settings the app can honestly offer.
///
/// The prototype's notification toggle is not rendered as a switch. Notification
/// delivery is in-app only and has no per-user preference in the API, so a switch
/// here would either do nothing or imply a setting that does not exist.
class CustomerProfileScreen extends ConsumerWidget {
  const CustomerProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);
    final CustomerScope scope = ref.watch(customerScopeProvider);

    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return CustomerScaffold(
      navBar: const CustomerNavBar(
        title: 'Профайл',
        subtitle: 'Хэрэглэгчийн мэдээлэл',
        showBack: false,
      ),
      body: ListView(
        padding: const EdgeInsets.only(
          top: 8,
          bottom: CustomerTokens.scrollBottomSpacer,
        ),
        children: <Widget>[
          PanelCard(
            accent: CustomerTokens.ink,
            child: Row(
              children: <Widget>[
                RowTile(
                  tone: AccentTone.blue,
                  size: 52,
                  text: _initials(user.fullName),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(user.fullName, style: CustomerTokens.headerTitle),
                      const SizedBox(height: 3),
                      Text(
                        <String>[
                          user.email,
                          if (user.phone != null) user.phone!,
                        ].join(' · '),
                        style: CustomerTokens.rowSub,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SectionCaption('Бүртгэл'),
          PanelCard(
            padding: EdgeInsets.zero,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                _ProfileRow(label: 'Эрх', value: user.role.label),
                _ProfileRow(label: 'Төлөв', value: user.status.label),
                _ProfileRow(
                  label: 'Сүүлд нэвтэрсэн',
                  value: formatDateTime(user.lastLoginAt),
                ),
              ],
            ),
          ),

          const SectionCaption('Хандах эрх'),
          if (scope is ResolvedCustomerScope)
            _AccessSummary(scope: scope)
          else
            const NoticeBanner.info(
              text: 'Байгууллагын хамаарал тодорхойгүй тул барилгын эрхийг '
                  'харуулах боломжгүй байна.',
            ),

          const SectionCaption('Тохиргоо'),
          TappableRow(
            leading: const RowTile(
              tone: AccentTone.neutral,
              icon: Icons.notifications_none,
            ),
            title: 'Мэдэгдэл',
            subtitle: 'Эрсдэл, хүсэлтийн төлөв. Android утсанд push мэдэгдэл очно.',
            trailing: const Icon(
              Icons.chevron_right,
              size: 18,
              color: CustomerTokens.line,
            ),
            onTap: () => NotificationsSheet.show(
              context,
              onOpenRequest: (String requestId) => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ServiceRequestDetailScreen(requestId: requestId),
                ),
              ),
            ),
          ),
          TappableRow(
            leading: const RowTile(
              tone: AccentTone.neutral,
              icon: Icons.lock_outline,
            ),
            title: 'Нууц үг солих',
            subtitle: 'Солисны дараа дахин нэвтэрнэ.',
            trailing: const Icon(
              Icons.chevron_right,
              size: 18,
              color: CustomerTokens.line,
            ),
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => const ChangePasswordScreen(),
              ),
            ),
          ),
          TappableRow(
            leading: const RowTile(tone: AccentTone.red, icon: Icons.logout),
            title: 'Гарах',
            subtitle: 'Энэ төхөөрөмжөөс бүртгэлээс гарна.',
            onTap: () => _confirmLogout(context, ref),
          ),
        ],
      ),
    );
  }

  static String _initials(String fullName) {
    final List<String> parts = fullName
        .split(RegExp(r'\s+'))
        .where((String part) => part.isNotEmpty)
        .toList(growable: false);
    if (parts.isEmpty) return '?';
    if (parts.length == 1) {
      return parts.first.substring(0, 1).toUpperCase();
    }
    return (parts[0].substring(0, 1) + parts[1].substring(0, 1)).toUpperCase();
  }

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: const Text('Гарах'),
        content: const Text('Бүртгэлээс гарах уу?'),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Цуцлах'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: FilledButton.styleFrom(backgroundColor: CustomerTokens.red),
            child: const Text('Гарах'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;
    await ref.read(authControllerProvider.notifier).logout();
  }
}

/// The prototype's "Барилгын эрх" row, filled from the buildings the API returned.
class _AccessSummary extends ConsumerWidget {
  const _AccessSummary({required this.scope});

  final ResolvedCustomerScope scope;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return CustomerAsyncView<List<BuildingModel>>(
      value: ref.watch(customerBuildingsProvider),
      onRetry: () => ref.invalidate(customerBuildingsProvider),
      builder: (BuildContext ctx, List<BuildingModel> buildings) {
        final int floors = buildings.fold(
          0,
          (int sum, BuildingModel building) => sum + building.floorCount,
        );
        final int objects = buildings.fold(
          0,
          (int sum, BuildingModel building) => sum + building.objectCount,
        );

        return TappableRow(
          leading: const RowTile(
            tone: AccentTone.neutral,
            icon: Icons.apartment_outlined,
          ),
          title: scope.customerName ?? 'Барилгын эрх',
          subtitle: '${buildings.length} барилга · $floors давхар · '
              '$objects объект',
        );
      },
    );
  }
}

/// One account line, forwarded to the shared [DetailRow].
class _ProfileRow extends StatelessWidget {
  const _ProfileRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => DetailRow(label: label, value: value);
}
