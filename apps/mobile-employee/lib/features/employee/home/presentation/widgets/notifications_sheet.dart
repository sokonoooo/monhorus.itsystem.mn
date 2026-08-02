import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/notification_model.dart';
import '../../domain/entities/work_enums.dart';
import '../format.dart';
import '../providers/home_providers.dart';
import '../theme/home_tones.dart';
import 'home_async_view.dart';
import 'home_ui.dart';

/// `pop-notif` — the inbox behind the bell.
///
/// The prototype anchored this as a `.pop` dropdown below the header. It is a bottom
/// sheet here because the list is unbounded and thumb-reachable beats visually
/// anchored on a phone held one-handed in a plant room; everything else is
/// transcribed: the 34px tinted icon tile, the 6px unread dot, the tinted unread row,
/// the mono timestamp, and the "Бүгдийг уншсан болгох" footer.
///
/// Opened from the bell in `EmployeeHeaderActions`, which every tab carries — so this
/// sheet is reachable from all four tabs rather than from Нүүр alone.
///
/// The prototype's inbox held assignment events only. This one shows whatever the
/// server addressed to this account: recipient resolution happens in the backend, so
/// filtering again on the device would hide a notification somebody deliberately
/// sent. Tapping a row marks it read; it does not navigate, because the Ажил and
/// Төсөл tabs own their detail screens and this tab cannot push into them.
class NotificationsSheet extends ConsumerWidget {
  const NotificationsSheet({super.key});

  static Future<void> show(BuildContext context) {
    return showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      barrierColor: Colors.black.withValues(alpha: 0.45),
      builder: (BuildContext _) => const NotificationsSheet(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<NotificationModel>> notifications =
        ref.watch(homeNotificationsProvider);
    final int unread = ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;

    return SafeArea(
      top: false,
      child: Container(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.86,
        ),
        decoration: const BoxDecoration(
          color: EmployeeTokens.white,
          borderRadius: BorderRadius.vertical(
            top: Radius.circular(EmployeeTokens.radiusSheet),
          ),
          border: Border(
            top: BorderSide(
              color: EmployeeTokens.line,
              width: EmployeeTokens.hairline,
            ),
          ),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const _SheetHandle(),
            _SheetHeader(unread: unread),
            Flexible(
              child: HomeAsyncView<List<NotificationModel>>(
                value: notifications,
                onRetry: () => ref.invalidate(homeNotificationsProvider),
                builder: (BuildContext ctx, List<NotificationModel> items) {
                  if (items.isEmpty) {
                    return const HomeEmptyState(
                      icon: Icons.notifications_none_outlined,
                      message: 'Танд ирсэн мэдэгдэл алга байна.',
                    );
                  }
                  return ListView.builder(
                    padding: const EdgeInsets.fromLTRB(14, 4, 14, 12),
                    shrinkWrap: true,
                    itemCount: items.length,
                    itemBuilder: (BuildContext _, int index) => _NotificationRow(
                      notification: items[index],
                    ),
                  );
                },
              ),
            ),
            _SheetFooter(unread: unread),
          ],
        ),
      ),
    );
  }
}

class _SheetHandle extends StatelessWidget {
  const _SheetHandle();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 36,
      height: 4,
      margin: const EdgeInsets.only(top: 8, bottom: 6),
      decoration: BoxDecoration(
        color: EmployeeTokens.faint,
        borderRadius: BorderRadius.circular(2),
      ),
    );
  }
}

class _SheetHeader extends StatelessWidget {
  const _SheetHeader({required this.unread});

  final int unread;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 6, 10, 8),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Text(
                  'Мэдэгдэл',
                  style: TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w800,
                    color: EmployeeTokens.ink,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  unread > 0 ? '$unread шинэ мэдэгдэл' : 'Шинэ мэдэгдэл алга',
                  style: const TextStyle(
                    fontSize: 10,
                    color: EmployeeTokens.muted,
                  ),
                ),
              ],
            ),
          ),
          IconButton(
            onPressed: () => Navigator.of(context).maybePop(),
            iconSize: 18,
            color: EmployeeTokens.ink2,
            tooltip: 'Хаах',
            icon: const Icon(Icons.close),
          ),
        ],
      ),
    );
  }
}

class _SheetFooter extends ConsumerStatefulWidget {
  const _SheetFooter({required this.unread});

  final int unread;

  @override
  ConsumerState<_SheetFooter> createState() => _SheetFooterState();
}

class _SheetFooterState extends ConsumerState<_SheetFooter> {
  bool _busy = false;

  Future<void> _markAll() async {
    setState(() => _busy = true);
    final Failure? failure = await markAllNotificationsRead(ref);
    if (!mounted) return;
    setState(() => _busy = false);

    if (failure != null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final bool enabled = widget.unread > 0 && !_busy;

    return Container(
      padding: const EdgeInsets.fromLTRB(14, 10, 14, 12),
      decoration: const BoxDecoration(
        border: Border(
          top: BorderSide(
            color: EmployeeTokens.faint,
            width: EmployeeTokens.hairline,
          ),
        ),
      ),
      child: FilledButton(
        onPressed: enabled ? _markAll : null,
        style: FilledButton.styleFrom(
          backgroundColor: EmployeeTokens.ink,
          foregroundColor: EmployeeTokens.white,
          disabledBackgroundColor: EmployeeTokens.soft,
          disabledForegroundColor: EmployeeTokens.muted,
          minimumSize: const Size.fromHeight(46),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          ),
          textStyle: const TextStyle(fontSize: 13, fontWeight: FontWeight.w800),
        ),
        child: Text(_busy ? 'Түр хүлээнэ үү...' : 'Бүгдийг уншсан болгох'),
      ),
    );
  }
}

class _NotificationRow extends ConsumerStatefulWidget {
  const _NotificationRow({required this.notification});

  final NotificationModel notification;

  @override
  ConsumerState<_NotificationRow> createState() => _NotificationRowState();
}

class _NotificationRowState extends ConsumerState<_NotificationRow> {
  bool _busy = false;

  Future<void> _open() async {
    if (!widget.notification.isUnread || _busy) return;
    setState(() => _busy = true);
    final Failure? failure = await markNotificationRead(ref, widget.notification.id);
    if (!mounted) return;
    setState(() => _busy = false);

    if (failure != null) {
      ScaffoldMessenger.of(context)
        ..hideCurrentSnackBar()
        ..showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  /// The prototype used a calendar-check glyph for an assignment and a swap glyph for
  /// a re-assignment. The other sixteen events get an icon chosen from what they are
  /// about, so a row is legible without reading the title.
  IconData get _glyph {
    return switch (widget.notification.event) {
      NotificationEvent.serviceRequestAssigned ||
      NotificationEvent.plannedWorkDueSoon =>
        Icons.event_available_outlined,
      NotificationEvent.serviceRequestReassigned => Icons.swap_horiz,
      NotificationEvent.plannedWorkOverdue ||
      NotificationEvent.slaBreached ||
      NotificationEvent.slaNearBreach =>
        Icons.schedule_outlined,
      NotificationEvent.reportSubmitted ||
      NotificationEvent.reportApproved ||
      NotificationEvent.reportReturned =>
        Icons.description_outlined,
      NotificationEvent.riskAssessmentRaised ||
      NotificationEvent.repairRequired =>
        Icons.warning_amber_outlined,
      NotificationEvent.revisitRequired => Icons.replay_outlined,
      _ => Icons.notifications_none_outlined,
    };
  }

  @override
  Widget build(BuildContext context) {
    final NotificationModel item = widget.notification;
    final Tone tone = severityTone(item.severity.band);
    final bool unread = item.isUnread;

    return Padding(
      padding: const EdgeInsets.only(bottom: 7),
      child: Material(
        color: unread ? EmployeeTokens.paper : EmployeeTokens.white,
        borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
        child: InkWell(
          onTap: unread ? _open : null,
          borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
          child: Container(
            padding: const EdgeInsets.fromLTRB(11, 11, 12, 11),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
              border: Border.all(
                color: EmployeeTokens.faint,
                width: EmployeeTokens.hairline,
              ),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Container(
                  width: 34,
                  height: 34,
                  alignment: Alignment.center,
                  decoration: BoxDecoration(
                    color: tone.background,
                    borderRadius: BorderRadius.circular(EmployeeTokens.radiusRow),
                    border: Border.all(color: tone.border),
                  ),
                  child: Icon(_glyph, size: 16, color: tone.foreground),
                ),
                const SizedBox(width: 11),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        item.title.isEmpty
                            ? (item.event?.label ?? 'Мэдэгдэл')
                            : item.title,
                        style: const TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w700,
                          height: 1.35,
                          color: EmployeeTokens.ink,
                        ),
                      ),
                      if (item.body != null) ...<Widget>[
                        const SizedBox(height: 3),
                        Text(
                          item.body!,
                          style: const TextStyle(
                            fontSize: 11,
                            height: 1.5,
                            color: EmployeeTokens.muted,
                          ),
                        ),
                      ],
                      const SizedBox(height: 5),
                      Text(
                        formatEventStamp(item.createdAt),
                        style: EmployeeTokens.mono.copyWith(
                          fontSize: 9,
                          fontWeight: FontWeight.w500,
                          color: EmployeeTokens.muted,
                        ),
                      ),
                    ],
                  ),
                ),
                if (unread) ...<Widget>[
                  const SizedBox(width: 8),
                  _busy
                      ? const SizedBox(
                          width: 12,
                          height: 12,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : Container(
                          width: 6,
                          height: 6,
                          margin: const EdgeInsets.only(top: 5),
                          decoration: const BoxDecoration(
                            color: EmployeeTokens.red,
                            shape: BoxShape.circle,
                          ),
                        ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
