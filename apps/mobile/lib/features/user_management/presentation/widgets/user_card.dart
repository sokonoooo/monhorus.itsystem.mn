import 'package:flutter/material.dart';

import '../../../auth/domain/entities/app_user.dart';
import '../../../customer_portal/presentation/theme/customer_tokens.dart';
import '../../../customer_portal/presentation/widgets/customer_ui.dart';

/// One row in the admin user list. Purely presentational: it renders what it is given
/// and reports taps upward.
class UserCard extends StatelessWidget {
  const UserCard({
    required this.user,
    required this.manageable,
    required this.isSelf,
    super.key,
    this.onResetPasscode,
    this.onToggleSuspension,
  });

  final AppUser user;

  /// Whether the signed-in actor is permitted to act on this user.
  final bool manageable;
  final bool isSelf;
  final VoidCallback? onResetPasscode;
  final VoidCallback? onToggleSuspension;

  /// Account state, on the token palette. These are not risk bands - an account is
  /// not an inspected object - but the palette holds no second set of hues, so they
  /// take the neutral-plus-accent tones the rest of the app uses for state.
  static const Map<AccountStatus, AccentTone> _statusTones =
      <AccountStatus, AccentTone>{
    AccountStatus.active: AccentTone.green,
    AccountStatus.suspended: AccentTone.red,
    AccountStatus.mustChangePassword: AccentTone.yellow,
  };

  static const Map<UserRole, AccentTone> _roleTones = <UserRole, AccentTone>{
    UserRole.customer: AccentTone.neutral,
    UserRole.technician: AccentTone.blue,
    UserRole.admin: AccentTone.purple,
    UserRole.headAdmin: AccentTone.purple,
  };

  @override
  Widget build(BuildContext context) {
    final bool suspended = user.status == AccountStatus.suspended;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(user.fullName, style: CustomerTokens.cardTitle),
                      const SizedBox(height: 2),
                      Text(
                        user.email,
                        style: CustomerTokens.body.copyWith(
                          color: CustomerTokens.muted,
                        ),
                      ),
                      if (user.phone != null && user.phone!.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 2),
                        Text(user.phone!, style: CustomerTokens.rowSub),
                      ],
                    ],
                  ),
                ),
                StatusPill(label: user.role.label, tone: _roleTones[user.role]!),
              ],
            ),
            const SizedBox(height: 10),
            Row(
              children: <Widget>[
                StatusPill(
                  label: user.status.label,
                  tone: _statusTones[user.status]!,
                ),
                const Spacer(),
                if (isSelf)
                  const Text('Өөрийн бүртгэл', style: CustomerTokens.rowSub)
                else if (!manageable)
                  const Text('Эрх хүрэлцэхгүй', style: CustomerTokens.rowSub),
              ],
            ),
            if (manageable) ...<Widget>[
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 8),
              Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: onResetPasscode,
                      icon: const Icon(Icons.key_outlined, size: 17),
                      label: const Text('Нууц үг'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: onToggleSuspension,
                      style: OutlinedButton.styleFrom(
                        foregroundColor: suspended
                            ? CustomerTokens.green
                            : CustomerTokens.red,
                      ),
                      icon: Icon(
                        suspended ? Icons.lock_open_outlined : Icons.block_outlined,
                        size: 17,
                      ),
                      label: Text(suspended ? 'Идэвхжүүлэх' : 'Түр хаах'),
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
