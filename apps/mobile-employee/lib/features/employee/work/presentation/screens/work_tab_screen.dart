import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../../shared/service_request_models.dart';
import '../../data/models/planned_work_model.dart';
import '../providers/work_providers.dart';
import '../widgets/open_request_card.dart';
import '../widgets/planned_work_card.dart';
import '../widgets/work_async_view.dart';
import '../widgets/work_ui.dart';
import 'planned_work_detail_screen.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';

/// Tab 2 — "Ажил".
///
/// Three segments over two different record types. "Миний" and "Багийн" are the
/// technician's planned-work queue, grouped by the server's `effectiveStatus`: overdue,
/// then in flight, then scheduled, then finished. Nothing here decides what is late — a
/// phone with a skewed clock would otherwise disagree with the dashboard.
///
/// "Нээлттэй" is the unclaimed pool, and it is SERVICE REQUESTS rather than planned
/// work, because that is the only half of the question the API can answer:
/// `GET /service-requests?status=UNASSIGNED` lists requests nobody holds, while
/// `plannedWorkListQuerySchema` has no unassigned filter at all. It used to render a
/// notice claiming no such endpoint existed and made no request whatsoever, which is
/// the bug this segment now fixes. It is read-only: assignment is `dispatch.assign`,
/// a dispatcher's permission.
class WorkTabScreen extends ConsumerWidget {
  const WorkTabScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final WorkScope scope = ref.watch(workScopeProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            const _WorkHeader(),
            SegmentedTabs(
              labels: WorkScope.values
                  .map((WorkScope value) => value.label)
                  .toList(growable: false),
              selectedIndex: WorkScope.values.indexOf(scope),
              onSelected: (int index) => ref
                  .read(workScopeProvider.notifier)
                  .select(WorkScope.values[index]),
            ),
            Expanded(
              child: RefreshIndicator(
                color: EmployeeTokens.ink,
                onRefresh: () => _refresh(ref, scope),
                // Two panes rather than one, because the two segments read different
                // providers over different record types. The pane switch is also what
                // keeps `plannedWorkBoardProvider` unwatched — and therefore unfetched
                // — while the pool is on screen.
                child: scope.isPlannedWork
                    ? _PlannedWorkPane(scope: scope)
                    : const _OpenPoolPane(),
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Pull-to-refresh for whichever pane is showing.
  ///
  /// The planned-work pane refreshes the identity too: it feeds the list's only filter,
  /// and an employee card linked since the last attempt is the likeliest reason an empty
  /// tab would start working. The pool has no identity in it — it is the work nobody is
  /// assigned to — so there is nothing there to re-resolve.
  ///
  /// The future is awaited so the spinner lasts as long as the request, and its error is
  /// swallowed because the view below is already rendering that same failure —
  /// rethrowing here would only produce an unhandled async error.
  Future<void> _refresh(WidgetRef ref, WorkScope scope) async {
    if (!scope.isPlannedWork) {
      ref.invalidate(openRequestPoolProvider);
      try {
        await ref.read(openRequestPoolProvider.future);
      } catch (_) {
        // Rendered by WorkAsyncView.
      }
      return;
    }

    ref.invalidate(workIdentityProvider);
    ref.invalidate(plannedWorkBoardProvider);
    try {
      await ref.read(plannedWorkBoardProvider.future);
    } catch (_) {
      // Rendered by WorkAsyncView.
    }
  }
}

/// The "Миний" and "Багийн" segments.
class _PlannedWorkPane extends ConsumerWidget {
  const _PlannedWorkPane({required this.scope});

  final WorkScope scope;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PlannedWorkBoard> board =
        ref.watch(plannedWorkBoardProvider);

    return WorkAsyncView<PlannedWorkBoard>(
      value: board,
      onRetry: () => ref.invalidate(plannedWorkBoardProvider),
      loading: const _BoardSkeleton(),
      // Offered on both of these segments: when the identity cannot be resolved, the
      // unfiltered system-wide list is the one thing that would still answer something,
      // and it is only ever shown under the banner that says what it is.
      unavailableActionLabel: 'Бүх төлөвлөгөөт ажлыг харах',
      onUnavailableAction: () =>
          ref.read(showUnfilteredWorkProvider.notifier).enable(),
      builder: (BuildContext context, PlannedWorkBoard data) =>
          _Board(board: data, scope: scope),
    );
  }
}

/// The "Нээлттэй" segment.
///
/// No `unavailableActionLabel`: every way this pane can come up empty-handed — a missing
/// `service_request.view`, or an empty pool — is a stable situation with no second thing
/// to offer instead. A refusal here is a permission fact, and the notice names the key.
class _OpenPoolPane extends ConsumerWidget {
  const _OpenPoolPane();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<OpenRequestPool> pool = ref.watch(openRequestPoolProvider);

    return WorkAsyncView<OpenRequestPool>(
      value: pool,
      onRetry: () => ref.invalidate(openRequestPoolProvider),
      loading: const _BoardSkeleton(),
      builder: (BuildContext context, OpenRequestPool data) =>
          _OpenPool(pool: data),
    );
  }
}

/// The unclaimed pool, newest risk first. Always scrollable, so pull-to-refresh works
/// even when the content is short enough not to overflow.
class _OpenPool extends ConsumerWidget {
  const _OpenPool({required this.pool});

  final OpenRequestPool pool;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);
    // Read from the effective set `GET /auth/me` reported, never inferred from the role
    // string: a deployed role can hold strictly less than the shipped default, and a
    // button that always 403s is worse than no button.
    final bool canClaim =
        user?.has(PermissionKeys.serviceRequestClaim) ?? false;
    final ClaimState claim = ref.watch(claimControllerProvider);

    // The outcome of the last claim, shown once and dismissed on the next tap. A lost
    // race is reported here rather than as an error state: it is the concurrency control
    // working, not a fault.
    ref.listen<ClaimState>(claimControllerProvider,
        (ClaimState? _, ClaimState next) {
      final String? message = next.message;
      if (message == null) return;
      ScaffoldMessenger.maybeOf(context)
        ?..hideCurrentSnackBar()
        ..showSnackBar(
          SnackBar(
            content: Text(message),
            backgroundColor:
                next.failed ? EmployeeTokens.red : EmployeeTokens.ink,
          ),
        );
      ref.read(claimControllerProvider.notifier).dismiss();
    });

    if (pool.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: const <Widget>[
          WorkEmptyState(
            icon: Icons.inbox_outlined,
            title: 'Нээлттэй дуудлага алга',
            message: 'Одоогоор хэн нэгэнд хуваарилагдаагүй үйлчилгээний хүсэлт '
                'байхгүй байна. Шинэ дуудлага бүртгэгдмэгц энд харагдана.',
          ),
        ],
      );
    }

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: EmployeeTokens.scrollBottomSpacer),
      children: <Widget>[
        // Two different truths, so two different notices. Without the grant the old
        // sentence still holds and is the honest thing to say; with it, the useful
        // thing to say is what happens after you tap.
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: canClaim
              ? const NoticeBanner(
                  tone: EmployeeTokens.muted,
                  icon: Icons.pan_tool_alt_outlined,
                  title: 'Ажлыг өөртөө авах боломжтой',
                  text:
                      'Эдгээр хүсэлт хэн нэгэнд хуваарилагдаагүй байна. "Өөртөө '
                      'авах" дарвал тухайн ажил шууд танд оногдож, Миний ажил '
                      'жагсаалтад шилжинэ. Нэг ажлыг зөвхөн нэг ажилтан авна.',
                )
              : const NoticeBanner(
                  tone: EmployeeTokens.muted,
                  icon: Icons.info_outline,
                  title: 'Хуваарилалтыг диспетчер хийдэг',
                  text: 'Эдгээр хүсэлт хэн нэгэнд хуваарилагдаагүй байна. Танд '
                      '"service_request.claim" эрх байхгүй тул ажлыг өөрөө авах '
                      'боломжгүй. Танд хуваарилагдмагц Нүүр хэсгийн ажлын '
                      'жагсаалтад харагдана.',
                ),
        ),
        KpiStrip(
          tiles: <KpiTile>[
            KpiTile(value: '${pool.total}', label: 'Эзэнгүй'),
            KpiTile(
              value: '${pool.urgentCount}',
              label: 'Яаралтай',
              tone: pool.urgentCount > 0
                  ? EmployeeTokens.red
                  : EmployeeTokens.ink,
            ),
            KpiTile(
              value: '${pool.slaRiskCount}',
              label: 'SLA эрсдэл',
              tone: pool.slaRiskCount > 0
                  ? EmployeeTokens.yellow
                  : EmployeeTokens.ink,
            ),
          ],
        ),
        SectionHeading(
          'Эзэнгүй дуудлага',
          topPadding: 8,
          trailing: Text(
            '${pool.items.length}',
            style:
                EmployeeTokens.pillLabel.copyWith(color: EmployeeTokens.muted),
          ),
        ),
        for (final ServiceRequestListItemModel request in pool.items)
          OpenRequestCard(
            request: request,
            onClaim: canClaim
                ? () =>
                    ref.read(claimControllerProvider.notifier).claim(request)
                : null,
            claiming: claim.isPending(request.id),
            // One claim at a time: a second tap while the first is settling would race
            // the invalidation and could take two jobs on one intent.
            disabled: claim.pendingId != null,
          ),
      ],
    );
  }
}

/// `.tnav` on `s-planned`: the title and caption on the left, the shared
/// `.hdr-actions` pair (calendar, then bell) on the right.
class _WorkHeader extends StatelessWidget {
  const _WorkHeader();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        EmployeeTokens.labelGutter,
        14,
        EmployeeTokens.labelGutter,
        12,
      ),
      child: Row(
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                const Text('Ажил', style: EmployeeTokens.screenTitle),
                const SizedBox(height: 3),
                Text(
                  'Хуваарийн дагуу давтамжтай үзлэг, үйлчилгээ',
                  style: EmployeeTokens.rowSub.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 10),
          const EmployeeHeaderActions(),
        ],
      ),
    );
  }
}

/// The grouped list. Always scrollable, so pull-to-refresh works even when the
/// content is short enough not to overflow.
class _Board extends ConsumerWidget {
  const _Board({required this.board, required this.scope});

  final PlannedWorkBoard board;
  final WorkScope scope;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (board.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: <Widget>[
          WorkEmptyState(
            icon: Icons.event_available_outlined,
            title: scope == WorkScope.team
                ? 'Багийн ажил алга'
                : 'Танд оноогдсон ажил алга',
            message: scope == WorkScope.team
                ? 'Таны багт одоогоор төлөвлөгөөт ажил бүртгэгдээгүй байна.'
                : 'Одоогоор танд төлөвлөгөөт ажил оноогоогүй байна. Ажил '
                    'хуваарилагдмагц энд харагдана.',
          ),
        ],
      );
    }

    final int dueToday = board.dueTodayCount();

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: EmployeeTokens.scrollBottomSpacer),
      children: <Widget>[
        if (board.isUnfiltered)
          const Padding(
            padding: EdgeInsets.only(top: 4),
            child: NoticeBanner(
              tone: EmployeeTokens.yellow,
              icon: Icons.filter_alt_off_outlined,
              title: 'Шүүгдээгүй жагсаалт',
              text: 'Энэ бол системд бүртгэлтэй бүх төлөвлөгөөт ажил бөгөөд '
                  'зөвхөн танд оноогдсон ажил биш. Гүйцэтгэл бүртгэхдээ ажил '
                  'өөрийнх эсэхийг шалгана уу.',
            ),
          ),
        if (board.isUnfiltered)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              EmployeeTokens.gutter,
              0,
              EmployeeTokens.gutter,
              10,
            ),
            child: WorkButton.secondary(
              label: 'Зөвхөн миний ажлыг харах',
              icon: Icons.person_outline,
              onPressed: () {
                ref.read(showUnfilteredWorkProvider.notifier).disable();
                ref.invalidate(workIdentityProvider);
              },
            ),
          ),
        KpiStrip(
          tiles: <KpiTile>[
            KpiTile(value: '${board.openCount}', label: 'Идэвхтэй'),
            KpiTile(
              value: '$dueToday',
              label: 'Өнөөдөр',
              tone: dueToday > 0 ? EmployeeTokens.yellow : EmployeeTokens.ink,
            ),
            KpiTile(
              value: '${board.overdue.length}',
              label: 'Хэтэрсэн',
              tone: board.overdue.isEmpty
                  ? EmployeeTokens.ink
                  : EmployeeTokens.red,
            ),
          ],
        ),
        _Section(
            title: 'Хугацаа хэтэрсэн', items: board.overdue, topPadding: 8),
        _Section(title: 'Хийгдэж байгаа', items: board.active),
        _Section(
          title: scope == WorkScope.team ? 'Багийн хуваарь' : 'Надад оноогдсон',
          items: board.upcoming,
        ),
        _Section(title: 'Дууссан', items: board.finished),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.items,
    this.topPadding = 18,
  });

  final String title;
  final List<PlannedWorkListItemModel> items;
  final double topPadding;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        SectionHeading(
          title,
          topPadding: topPadding,
          trailing: Text(
            '${items.length}',
            style:
                EmployeeTokens.pillLabel.copyWith(color: EmployeeTokens.muted),
          ),
        ),
        for (final PlannedWorkListItemModel item in items)
          PlannedWorkCard(
            work: item,
            onTap: () => Navigator.of(context).push<void>(
              PlannedWorkDetailScreen.route(
                plannedWorkId: item.id,
                workNumber: item.workNumber,
              ),
            ),
          ),
      ],
    );
  }
}

/// Neutral card outlines while the first page loads, so the layout does not jump
/// when the data lands.
class _BoardSkeleton extends StatelessWidget {
  const _BoardSkeleton();

  @override
  Widget build(BuildContext context) {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(top: 8),
      children: <Widget>[
        for (int i = 0; i < 3; i++)
          Container(
            height: 132,
            margin: const EdgeInsets.fromLTRB(
              EmployeeTokens.gutter,
              0,
              EmployeeTokens.gutter,
              10,
            ),
            decoration: BoxDecoration(
              color: EmployeeTokens.white,
              border: Border.all(
                color: EmployeeTokens.faint,
                width: EmployeeTokens.hairline,
              ),
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
            ),
          ),
        const WorkLoading(height: 60),
      ],
    );
  }
}
