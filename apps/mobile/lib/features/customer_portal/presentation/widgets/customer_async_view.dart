import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../domain/entities/customer_scope.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import 'customer_ui.dart';

/// Renders the three states of an [AsyncValue] the same way everywhere.
///
/// The error branch prints the backend's own Mongolian message when there is one,
/// because "Энэ үйлдлийг хийх эрх байхгүй байна." tells the user far more than a
/// generic failure line would.
class CustomerAsyncView<T> extends StatelessWidget {
  const CustomerAsyncView({
    super.key,
    required this.value,
    required this.builder,
    this.onRetry,
    this.loading,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) builder;
  final VoidCallback? onRetry;
  final Widget? loading;

  @override
  Widget build(BuildContext context) {
    return value.when(
      data: (T data) => builder(context, data),
      loading: () =>
          loading ??
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(child: CircularProgressIndicator()),
          ),
      error: (Object error, StackTrace _) {
        final String message = error is Failure
            ? error.message
            : 'Мэдээлэл ачаалж чадсангүй.';
        return CustomerEmptyState(
          icon: Icons.cloud_off_outlined,
          message: message,
          actionLabel: onRetry == null ? null : 'Дахин оролдох',
          onAction: onRetry,
        );
      },
    );
  }
}

/// What the customer sees when the session carries no customer to scope to.
///
/// Reached when `GET /auth/me` reported no `customerId`, which means an administrator
/// has not linked the account to an organisation yet. It is deliberately an
/// explanation rather than a data screen with a customer picker: the tenant is a
/// property of the account, the server resolves it from the account and discards any
/// id the client sends, so offering a choice here would be offering a control that
/// decides nothing while looking like it decides everything.
class CustomerScopeUnavailableView extends ConsumerWidget {
  const CustomerScopeUnavailableView({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CustomerScope scope = ref.watch(customerScopeProvider);
    if (scope is! UnavailableCustomerScope) {
      return const SizedBox.shrink();
    }

    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 32),
      children: <Widget>[
        PanelCard(
          accent: CustomerTokens.yellow,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Row(
                children: <Widget>[
                  const RowTile(tone: AccentTone.yellow, icon: Icons.lock_outline),
                  const SizedBox(width: 11),
                  Expanded(
                    child: Text(
                      scope.reason,
                      style: CustomerTokens.cardTitle.copyWith(height: 1.3),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 12),
              Text(
                scope.detail,
                style: CustomerTokens.body.copyWith(height: 1.7),
              ),
            ],
          ),
        ),
        const SectionCaption('Мэдэгдэл'),
        const NoticeBanner.info(
          text: 'Мэдэгдлийн жагсаалт нь хүлээн авагчаар шүүгддэг тул энэ хэсэг '
              'хэвийн ажиллана.',
        ),
      ],
    );
  }
}
