import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../providers/user_management_provider.dart';
import '../widgets/reset_passcode_sheet.dart';
import '../widgets/user_card.dart';
import 'create_user_screen.dart';

/// Admin user-management list. Reachable only by admin and head_admin; the backend
/// RBAC middleware is the real boundary, this screen simply does not render for others.
class UsersScreen extends ConsumerWidget {
  const UsersScreen({super.key});

  Future<void> _confirmToggle(
    BuildContext context,
    WidgetRef ref,
    AppUser target,
  ) async {
    final bool suspending = target.status != AccountStatus.suspended;

    final bool? confirmed = await showDialog<bool>(
      context: context,
      builder: (BuildContext ctx) => AlertDialog(
        title: Text(suspending ? 'Бүртгэл түр хаах' : 'Бүртгэл идэвхжүүлэх'),
        content: Text(
          suspending
              ? '${target.fullName}-ийн бүртгэлийг түр хааж, бүх идэвхтэй сессийг '
                  'цуцлах уу?'
              : '${target.fullName}-ийн бүртгэлийг дахин идэвхжүүлэх үү?',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Цуцлах'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            style: suspending
                ? FilledButton.styleFrom(backgroundColor: CustomerTokens.red)
                : null,
            child: Text(suspending ? 'Түр хаах' : 'Идэвхжүүлэх'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    await ref.read(userListControllerProvider.notifier).toggleSuspension(target);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final UserListState state = ref.watch(userListControllerProvider);
    final AppUser? actor = ref.watch(currentUserProvider);
    final UserListController controller = ref.read(userListControllerProvider.notifier);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Хэрэглэгчид'),
        actions: <Widget>[
          IconButton(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            tooltip: 'Гарах',
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => Navigator.of(context).push(
          MaterialPageRoute<void>(builder: (_) => const CreateUserScreen()),
        ),
        icon: const Icon(Icons.person_add_alt_1),
        label: const Text('Нэмэх'),
      ),
      body: SafeArea(
        child: Column(
          children: <Widget>[
            // Filters
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
              child: Column(
                children: <Widget>[
                  TextField(
                    decoration: const InputDecoration(
                      hintText: 'Нэр, имэйл, утсаар хайх',
                      prefixIcon: Icon(Icons.search),
                    ),
                    onSubmitted: (String value) => controller.applyFilter(
                      state.filter.copyWith(search: value.trim()),
                    ),
                  ),
                  const SizedBox(height: 10),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: <Widget>[
                        _FilterChip(
                          label: 'Бүх эрх',
                          selected: state.filter.role == null,
                          onTap: () => controller.applyFilter(
                            state.filter.copyWith(clearRole: true),
                          ),
                        ),
                        for (final UserRole role in UserRole.values)
                          _FilterChip(
                            label: role.label,
                            selected: state.filter.role == role,
                            onTap: () => controller.applyFilter(
                              state.filter.copyWith(role: role),
                            ),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),

            Expanded(
              child: Builder(
                builder: (BuildContext ctx) {
                  if (state.loading) {
                    return const Center(child: CircularProgressIndicator());
                  }

                  if (state.failure != null && state.data.items.isEmpty) {
                    return _EmptyState(
                      icon: Icons.cloud_off_outlined,
                      title: 'Ачаалж чадсангүй',
                      message: state.failure!.message,
                      actionLabel: 'Дахин оролдох',
                      onAction: controller.load,
                    );
                  }

                  if (state.data.items.isEmpty) {
                    return const _EmptyState(
                      icon: Icons.people_outline,
                      title: 'Хэрэглэгч олдсонгүй',
                      message: 'Шүүлтүүрээ өөрчилж үзнэ үү.',
                    );
                  }

                  return RefreshIndicator(
                    onRefresh: controller.load,
                    child: ListView.separated(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 96),
                      itemCount: state.data.items.length,
                      separatorBuilder: (_, __) => const SizedBox(height: 10),
                      itemBuilder: (BuildContext ctx, int index) {
                        final AppUser user = state.data.items[index];
                        final bool isSelf = actor?.id == user.id;

                        return UserCard(
                          user: user,
                          isSelf: isSelf,
                          manageable: actor?.canManage(user) ?? false,
                          onResetPasscode: () => ResetPasscodeSheet.show(ctx, user),
                          onToggleSuspension: () => _confirmToggle(ctx, ref, user),
                        );
                      },
                    ),
                  );
                },
              ),
            ),

            if (state.data.totalPages > 1)
              Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: CustomerTokens.labelGutter,
                  vertical: 8,
                ),
                decoration: const BoxDecoration(
                  color: CustomerTokens.white,
                  border: Border(top: CustomerTokens.hairlineFaintSide),
                ),
                child: Row(
                  children: <Widget>[
                    Text(
                      'Нийт ${state.data.total}, хуудас '
                      '${state.data.page}/${state.data.totalPages}',
                      style: CustomerTokens.rowSub,
                    ),
                    const Spacer(),
                    IconButton(
                      onPressed: state.data.page > 1
                          ? () => controller.goToPage(state.data.page - 1)
                          : null,
                      icon: const Icon(Icons.chevron_left),
                    ),
                    IconButton(
                      onPressed: state.data.page < state.data.totalPages
                          ? () => controller.goToPage(state.data.page + 1)
                          : null,
                      icon: const Icon(Icons.chevron_right),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _FilterChip extends StatelessWidget {
  const _FilterChip({
    required this.label,
    required this.selected,
    required this.onTap,
  });

  final String label;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ChoiceChip(
        label: Text(label),
        selected: selected,
        onSelected: (_) => onTap(),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.message,
    this.actionLabel,
    this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String? actionLabel;
  final Future<void> Function()? onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(icon, size: 48, color: CustomerTokens.line),
            const SizedBox(height: 14),
            Text(title, style: CustomerTokens.cardTitle),
            const SizedBox(height: 6),
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
      ),
    );
  }
}
