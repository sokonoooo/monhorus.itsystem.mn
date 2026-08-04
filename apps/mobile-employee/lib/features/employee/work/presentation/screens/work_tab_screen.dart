import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../../shared/service_request_models.dart';
import '../../data/models/planned_work_model.dart';
import '../../domain/entities/work_identity.dart';
import '../format.dart';
import '../providers/work_providers.dart';
import '../widgets/open_request_card.dart';
import '../widgets/planned_work_card.dart';
import '../widgets/work_async_view.dart';
import '../widgets/work_ui.dart';
import 'planned_work_detail_screen.dart';
import 'service_request_detail_screen.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';

/// Tab 2 — "Ажил".
///
/// THREE SEGMENTS, ONE PER KIND OF THING TO DO. "Хүсэлт" is the service requests assigned
/// to the reader or to their team; "Төлөвлөгөөт" is their planned work, grouped by the
/// server's `effectiveStatus` — overdue, then in flight, then scheduled, then finished;
/// "Нээлттэй" is the pool nobody holds yet. Nothing here decides what is late; a phone
/// with a skewed clock would otherwise disagree with the dashboard.
///
/// They used to be "Миний" / "Багийн" / "Нээлттэй", split by WHOSE work it was, which
/// made the first segment carry two record types under two headings and forced a
/// technician to scroll past a planned-work board to reach the request they had just been
/// given. "Багийн" is gone rather than moved: both reads are already scoped own-OR-team,
/// so it was a narrowing over rows these segments already contain and could not hold a row
/// they do not. See [WorkScope].
///
/// One pane per segment, and the switch is load-bearing rather than cosmetic: each pane
/// watches only its own provider, so the planned-work read is not even issued while a
/// request segment is on screen, and vice versa.
///
/// "Нээлттэй" is SERVICE REQUESTS rather than both types, because that is the only half of
/// the question the API can answer: `GET /service-requests?status=UNASSIGNED` lists
/// requests nobody holds, while `plannedWorkListQuerySchema` has no unassigned filter at
/// all. It used to render a notice claiming no such endpoint existed and made no request
/// whatsoever, which is the bug that segment now fixes.
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
                child: switch (scope) {
                  WorkScope.requests => const _RequestsPane(),
                  WorkScope.plannedWork => const _PlannedWorkPane(),
                  WorkScope.open => const _OpenPoolPane(),
                },
              ),
            ),
          ],
        ),
      ),
    );
  }

  /// Pull-to-refresh for whichever pane is showing, and only that one.
  ///
  /// The two assigned segments re-resolve the identity as well: it decides whether the
  /// list can be attributed to anybody at all, and an employee card linked since the last
  /// attempt is the likeliest reason an empty tab would start working. The pool has no
  /// identity in it — it is the work nobody is assigned to — so there is nothing there to
  /// re-resolve.
  ///
  /// The future is awaited so the spinner lasts as long as the request, and its error is
  /// swallowed because the view below is already rendering that same failure —
  /// rethrowing here would only produce an unhandled async error.
  Future<void> _refresh(WidgetRef ref, WorkScope scope) async {
    switch (scope) {
      case WorkScope.requests:
        ref
          ..invalidate(workIdentityProvider)
          ..invalidate(assignedRequestsProvider);
      case WorkScope.plannedWork:
        ref
          ..invalidate(workIdentityProvider)
          ..invalidate(plannedWorkBoardProvider);
      case WorkScope.open:
        ref.invalidate(openRequestPoolProvider);
    }

    try {
      await switch (scope) {
        WorkScope.requests => ref.read(assignedRequestsProvider.future),
        WorkScope.plannedWork => ref.read(plannedWorkBoardProvider.future),
        WorkScope.open => ref.read(openRequestPoolProvider.future),
      };
    } catch (_) {
      // Rendered by WorkAsyncView.
    }
  }
}

/// The "Хүсэлт" segment: the service requests this reader, or their team, is carrying.
class _RequestsPane extends ConsumerWidget {
  const _RequestsPane();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<AssignedRequests> requests =
        ref.watch(assignedRequestsProvider);

    return WorkAsyncView<AssignedRequests>(
      value: requests,
      onRetry: () => ref.invalidate(assignedRequestsProvider),
      loading: const _BoardSkeleton(),
      builder: (BuildContext context, AssignedRequests data) =>
          _RequestBoard(requests: data),
    );
  }
}

/// The "Төлөвлөгөөт" segment.
class _PlannedWorkPane extends ConsumerWidget {
  const _PlannedWorkPane();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PlannedWorkBoard> board =
        ref.watch(plannedWorkBoardProvider);

    return WorkAsyncView<PlannedWorkBoard>(
      value: board,
      onRetry: () => ref.invalidate(plannedWorkBoardProvider),
      loading: const _BoardSkeleton(),
      builder: (BuildContext context, PlannedWorkBoard data) =>
          _PlannedBoard(board: data),
    );
  }
}

/// The "Нээлттэй" segment.
///
/// Every way this pane can come up empty-handed — a missing `service_request.view`, or an
/// empty pool — is a stable situation with no second thing to offer instead. A refusal
/// here is a permission fact, and the notice names the key.
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
              // The promise is kept now. It was written before the tab could hold a
              // service request at all, so a claimed request left this pool and showed
              // up in no list whatsoever — the sentence named a destination that did
              // not exist. It names the segment it actually lands in.
              ? const NoticeBanner(
                  tone: EmployeeTokens.muted,
                  icon: Icons.pan_tool_alt_outlined,
                  title: 'Ажлыг өөртөө авах боломжтой',
                  text:
                      'Эдгээр хүсэлт хэн нэгэнд хуваарилагдаагүй байна. "Өөртөө '
                      'авах" дарвал тухайн ажил шууд танд оногдож, "Хүсэлт" '
                      'хэсэгт шилжинэ. Нэг ажлыг зөвхөн нэг ажилтан авна.',
                )
              : const NoticeBanner(
                  tone: EmployeeTokens.muted,
                  icon: Icons.info_outline,
                  title: 'Хуваарилалтыг диспетчер хийдэг',
                  text: 'Эдгээр хүсэлт хэн нэгэнд хуваарилагдаагүй байна. Танд '
                      '"service_request.claim" эрх байхгүй тул ажлыг өөрөө авах '
                      'боломжгүй. Диспетчер танд хуваарилмагц "Хүсэлт" хэсэгт '
                      'харагдана.',
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
            // The same call shape the Нүүр tab's urgent list uses. What travels here is
            // the PLACEHOLDER the detail screen opens with, not everything it shows:
            // that screen reads `GET /service-requests/:id` for the description, the
            // site contact and the attachments, none of which is on a list row.
            onTap: () => Navigator.of(context).push<void>(
              ServiceRequestDetailScreen.route(
                requestId: request.id,
                requestNumber: request.requestNumber,
                subject: request.subjectLabel,
                location: request.locationLabel,
                buildingId: request.building?.id,
                buildingName: request.building?.name,
                statusLabel: request.status?.label,
                slaLabel: formatSlaRemaining(request.slaRemainingMinutes),
              ),
            ),
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
                Text('Ажил', style: EmployeeTokens.screenTitle),
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

/// The "Хүсэлт" segment's list. Always scrollable, so pull-to-refresh works even when
/// the content is short enough not to overflow.
///
/// ONE RECORD TYPE AND THEREFORE NO GROUP HEADING. These rows used to sit under a
/// "ХҮСЭЛТ" caption inside the old "Миний" pane, because a planned-work board sat under a
/// second one directly below them. The segment chip says it now, and a caption repeating
/// the name of the tab the reader just pressed is a heading that says nothing.
///
/// The same card the "Нээлттэй" segment draws, with the same tap: a request opens
/// [ServiceRequestDetailScreen] carrying the row's own facts as that screen's opening
/// placeholder, which it then fills in from the detail read. What it never carries here
/// is "Өөртөө авах" — these rows are already the reader's, and a claim button on them
/// would be an action with nothing to do.
class _RequestBoard extends StatelessWidget {
  const _RequestBoard({required this.requests});

  final AssignedRequests requests;

  @override
  Widget build(BuildContext context) {
    final WorkIdentityProblem? problem = requests.identityProblem;
    final String? notice = requests.notice;

    // Nothing to show and nothing to apologise for. A failed read is excluded here on
    // purpose: an empty list caused by a refusal is not an empty week, and the banner
    // below says which it was.
    if (requests.isEmpty && notice == null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: <Widget>[
          // AN UNLINKED ACCOUNT IS TOLD SO, and this is the case where saying it matters
          // most: the server answers a scoped caller with no employee card the empty
          // list, which is correct and completely indistinguishable from a quiet week.
          // "Танд оногдсон хүсэлт алга" would be a true sentence about the wrong problem
          // — no amount of waiting fixes it, and the person holding the phone cannot fix
          // it either. The Нүүр tab already says this for the same state; the wording is
          // the problem's own, so the two tabs cannot drift apart.
          if (problem != null)
            WorkEmptyState(
              icon: Icons.badge_outlined,
              title: problem.title,
              message: problem.detail,
            )
          else
            const WorkEmptyState(
              icon: Icons.assignment_outlined,
              title: 'Танд оногдсон хүсэлт алга',
              message: 'Одоогоор танд үйлчилгээний хүсэлт оноогоогүй байна. '
                  'Диспетчер хуваарилах эсвэл "Нээлттэй" хэсгээс ажил өөртөө '
                  'авмагц энд харагдана.',
            ),
        ],
      );
    }

    final int dueToday = requests.dueTodayCount;
    final int overdue = requests.overdueCount;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: EmployeeTokens.scrollBottomSpacer),
      children: <Widget>[
        // Rows AND an unresolved card at once: an oversight account with no employee
        // record of its own, or a lookup that failed while the list still answered.
        if (problem != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: NoticeBanner(
              tone: EmployeeTokens.yellow,
              icon: Icons.badge_outlined,
              title: problem.title,
              text: problem.detail,
            ),
          ),
        // The read failed, and it is named rather than left as a silently empty list.
        if (notice != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: NoticeBanner(
              tone: EmployeeTokens.yellow,
              icon: Icons.cloud_off_outlined,
              title: 'Үйлчилгээний хүсэлт ачаалагдсангүй',
              text: notice,
            ),
          ),
        // PER SEGMENT, NOT GLOBAL. The strip used to count both record types together,
        // which was right while both were in one pane; printing that total above a list
        // of two requests would read as "5 идэвхтэй" over five rows the reader cannot
        // see. The combined figure for the whole day is the Нүүр tab's job.
        if (!requests.isEmpty)
          KpiStrip(
            tiles: <KpiTile>[
              KpiTile(value: '${requests.activeCount}', label: 'Идэвхтэй'),
              KpiTile(
                value: '$dueToday',
                label: 'Өнөөдөр',
                tone: dueToday > 0 ? EmployeeTokens.yellow : EmployeeTokens.ink,
              ),
              KpiTile(
                value: '$overdue',
                label: 'Хэтэрсэн',
                tone: overdue == 0 ? EmployeeTokens.ink : EmployeeTokens.red,
              ),
            ],
          ),
        for (final ServiceRequestListItemModel request in requests.items)
          OpenRequestCard(
            request: request,
            onTap: () => Navigator.of(context).push<void>(
              ServiceRequestDetailScreen.route(
                requestId: request.id,
                requestNumber: request.requestNumber,
                subject: request.subjectLabel,
                location: request.locationLabel,
                buildingId: request.building?.id,
                buildingName: request.building?.name,
                statusLabel: request.status?.label,
                slaLabel: formatSlaRemaining(request.slaRemainingMinutes),
              ),
            ),
          ),
      ],
    );
  }
}

/// The "Төлөвлөгөөт" segment's grouped list. Always scrollable, so pull-to-refresh works
/// even when the content is short enough not to overflow.
///
/// Four status groups and no umbrella caption above them: the pane holds one record type
/// now, so "ТӨЛӨВЛӨГӨӨТ АЖИЛ" over "ХУГАЦАА ХЭТЭРСЭН" would be a heading above a heading.
/// The four groups themselves stay — they are the triage order, and they name the
/// server's own `effectiveStatus` bands rather than a re-decision made on the device.
class _PlannedBoard extends StatelessWidget {
  const _PlannedBoard({required this.board});

  final PlannedWorkBoard board;

  @override
  Widget build(BuildContext context) {
    final WorkIdentityProblem? problem = board.identityProblem;

    if (board.isEmpty) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        children: <Widget>[
          if (problem != null)
            WorkEmptyState(
              icon: Icons.badge_outlined,
              title: problem.title,
              message: problem.detail,
            )
          else
            const WorkEmptyState(
              icon: Icons.event_available_outlined,
              title: 'Танд оногдсон төлөвлөгөөт ажил алга',
              message: 'Одоогоор танд ч, таны багт ч төлөвлөгөөт ажил '
                  'бүртгэгдээгүй байна. Хуваарилагдмагц энд харагдана.',
            ),
        ],
      );
    }

    final int dueToday = board.dueTodayCount();
    final int overdue = board.overdue.length;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(bottom: EmployeeTokens.scrollBottomSpacer),
      children: <Widget>[
        if (problem != null)
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: NoticeBanner(
              tone: EmployeeTokens.yellow,
              icon: Icons.badge_outlined,
              title: problem.title,
              text: problem.detail,
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
              value: '$overdue',
              label: 'Хэтэрсэн',
              tone: overdue == 0 ? EmployeeTokens.ink : EmployeeTokens.red,
            ),
          ],
        ),
        _Section(
          title: 'Хугацаа хэтэрсэн',
          items: board.overdue,
          topPadding: 8,
        ),
        _Section(title: 'Хийгдэж байгаа', items: board.active),
        // Named for the reader even though the list is own-OR-team: a work assigned to
        // the team IS assigned to everybody in it, which is precisely why the separate
        // "Багийн" segment had nothing of its own to show.
        _Section(title: 'Надад оноогдсон', items: board.upcoming),
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
