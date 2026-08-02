import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../../../customer_portal/presentation/widgets/customer_ui.dart';
import '../../domain/entities/app_user.dart';
import '../providers/auth_provider.dart';

/// Landing screen for a signed-in non-admin user.
///
/// Customers and technicians authenticate through the same flow but have no
/// user-management rights, so they get a profile view. The feature screens from the
/// wider requirements document (my work, calls, visualisation) attach here in later
/// steps; authentication is what this step delivers.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);

    if (user == null) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Профайл'),
        actions: <Widget>[
          IconButton(
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
            icon: const Icon(Icons.logout),
            tooltip: 'Гарах',
          ),
        ],
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: <Widget>[
            Card(
              child: Padding(
                padding: const EdgeInsets.all(18),
                child: Row(
                  children: <Widget>[
                    CircleAvatar(
                      radius: 26,
                      child: Text(
                        user.fullName.isNotEmpty
                            ? user.fullName.substring(0, 1).toUpperCase()
                            : '?',
                        style: CustomerTokens.screenTitle,
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Text(user.fullName, style: CustomerTokens.headerTitle),
                          const SizedBox(height: 2),
                          Text(user.role.label, style: CustomerTokens.rowSub),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 14),
            Card(
              child: Column(
                children: <Widget>[
                  _InfoRow(label: 'Имэйл', value: user.email),
                  _InfoRow(label: 'Утас', value: user.phone ?? 'Бүртгээгүй'),
                  _InfoRow(label: 'Төлөв', value: user.status.label),
                  _InfoRow(
                    label: 'Сүүлд нэвтэрсэн',
                    value: user.lastLoginAt == null
                        ? 'Мэдээлэл байхгүй'
                        : user.lastLoginAt!.toLocal().toString().split('.').first,
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

/// One account line, forwarded to the shared [DetailRow].
class _InfoRow extends StatelessWidget {
  const _InfoRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => DetailRow(label: label, value: value);
}
