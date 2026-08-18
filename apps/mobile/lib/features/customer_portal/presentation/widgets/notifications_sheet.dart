import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../core/error/failure.dart';
import '../../../../core/network/api_result.dart';
import '../../data/models/notification_model.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import 'customer_async_view.dart';
import 'customer_ui.dart';

/// The prototype's notification bottom sheet.
///
/// `/notifications` is the one list in this flow the backend already scopes to the
/// caller, filtering on `recipient`, so it works today even though the rest of the
/// portal is waiting on a user-to-customer link.
class NotificationsSheet extends ConsumerWidget {
  const NotificationsSheet({super.key, this.onOpenRequest});

  final void Function(String requestId)? onOpenRequest;

  static Future<void> show(
    BuildContext context, {
    void Function(String requestId)? onOpenRequest,
  }) {
    return showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: CustomerTokens.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(
          top: Radius.circular(CustomerTokens.radiusSheet),
        ),
      ),
      builder: (BuildContext ctx) => NotificationsSheet(onOpenRequest: onOpenRequest),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<NotificationModel>> notifications =
        ref.watch(customerNotificationsProvider);

    return SafeArea(
      top: false,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.of(context).size.height * 0.85,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SheetHandle(),
            Padding(
              padding: const EdgeInsets.fromLTRB(
                CustomerTokens.labelGutter,
                12,
                CustomerTokens.labelGutter,
                0,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Text('Мэдэгдэл', style: CustomerTokens.screenTitle),
                  const SizedBox(height: 4),
                  Text(
                    'Эрсдэл, хүсэлт, тайлангийн шинэчлэл',
                    style: CustomerTokens.rowSub,
                  ),
                ],
              ),
            ),
            Flexible(
              child: SingleChildScrollView(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: CustomerAsyncView<List<NotificationModel>>(
                  value: notifications,
                  onRetry: () => ref.invalidate(customerNotificationsProvider),
                  builder: (BuildContext ctx, List<NotificationModel> items) {
                    if (items.isEmpty) {
                      return const CustomerEmptyState(
                        icon: Icons.notifications_none_outlined,
                        message: 'Одоогоор мэдэгдэл алга байна.',
                      );
                    }
                    return Column(
                      children: <Widget>[
                        for (int i = 0; i < items.length; i++)
                          _NotificationRow(
                            notification: items[i],
                            isLast: i == items.length - 1,
                            onTap: () => _open(ctx, ref, items[i]),
                          ),
                      ],
                    );
                  },
                ),
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(
                CustomerTokens.labelGutter,
                10,
                CustomerTokens.labelGutter,
                10,
              ),
              decoration: const BoxDecoration(
                border: Border(top: CustomerTokens.hairlineFaintSide),
              ),
              child: Row(
                children: <Widget>[
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => _markAllRead(context, ref),
                      child: const Text('Бүгдийг уншсан'),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: FilledButton(
                      onPressed: () => Navigator.of(context).maybePop(),
                      child: const Text('Хаах'),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  /*
   * The result is checked, not discarded.
   *
   * Both of these used to `await` the call and ignore what came back, then invalidate
   * regardless. A refused mark-read was therefore indistinguishable from a successful one:
   * the refetch put the row back exactly as it was, unread, with nothing said. The reader
   * is left believing they cleared something they did not.
   */
  Future<void> _markAllRead(BuildContext context, WidgetRef ref) async {
    final ApiResult<void> result = await ref
        .read(customerPortalRepositoryProvider)
        .markAllNotificationsRead();

    final Failure? failure = result.failureOrNull;
    if (failure != null) {
      if (context.mounted) _sayItFailed(context, failure);
      return;
    }
    ref
      ..invalidate(customerNotificationsProvider)
      ..invalidate(unreadNotificationCountProvider);
  }

  static void _sayItFailed(BuildContext context, Failure failure) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(failure.message)),
    );
  }

  Future<void> _open(
    BuildContext context,
    WidgetRef ref,
    NotificationModel notification,
  ) async {
    if (notification.isUnread) {
      final ApiResult<NotificationModel> result = await ref
          .read(customerPortalRepositoryProvider)
          .markNotificationRead(notification.id);

      final Failure? failure = result.failureOrNull;
      if (failure != null) {
        // Said out loud, but not fatal: the row still opens.
        if (context.mounted) _sayItFailed(context, failure);
      } else {
        ref
          ..invalidate(customerNotificationsProvider)
          ..invalidate(unreadNotificationCountProvider);
      }
    }

    final String? requestId = notification.serviceRequestId;
    if (requestId == null || onOpenRequest == null) return;
    if (!context.mounted) return;
    Navigator.of(context).pop();
    onOpenRequest!(requestId);
  }
}

class _NotificationRow extends StatelessWidget {
  const _NotificationRow({
    required this.notification,
    required this.isLast,
    required this.onTap,
  });

  final NotificationModel notification;
  final bool isLast;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(
          horizontal: CustomerTokens.labelGutter,
        ),
        color: notification.isUnread ? CustomerTokens.soft2 : null,
        child: TimelineEntry(
          title: notification.title,
          meta: <String>[
            formatRelative(notification.createdAt),
            if (notification.event != null) notification.event!.label,
          ].join(' · '),
          tone: notification.severity.tone,
          icon: notification.severity.glyph,
          isLast: isLast,
        ),
      ),
    );
  }
}
