import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../data/models/dashboard_summary_model.dart';
import '../../data/models/work_models.dart';
import '../../domain/entities/employee_identity.dart';
import '../format.dart';
import '../providers/home_providers.dart';
import '../theme/home_tones.dart';
import '../widgets/home_async_view.dart';
import '../widgets/home_cards.dart';
import '../widgets/home_ui.dart';
import '../../../work/presentation/screens/service_request_detail_screen.dart';

/// Tab 1 — "Нүүр": `s-home` in `electro-employee-app.html`.
///
/// Three things, in the prototype's order: what is on this technician's plate, what
/// their day looks like, and what has been sent to them.
///
/// Every figure comes from the API. The prototype's static demo numbers are not
/// reproduced, and neither are the two blocks behind them that no endpoint supports:
/// there is no month-scoped completion count anywhere in the contract, and
/// `/dashboard/summary` is organisation-wide with no self-scoping, so it is only
/// ever labelled as such.
///
/// The screen turns on one question — which employee record this account is. The
/// backend answers it nowhere directly: `/auth/me` reports a user id and a permission
/// set but no `employeeId`, and neither `/planned-work` nor `/service-requests`
/// applies any server-side scoping. "Миний ажил" therefore exists only as a
/// client-supplied filter, and when the link cannot be established the personal
/// blocks are withheld and explained rather than filled with everyone's work.
class HomeTabScreen extends ConsumerStatefulWidget {
  const HomeTabScreen({super.key});

  @override
  ConsumerState<HomeTabScreen> createState() => _HomeTabScreenState();
}

class _HomeTabScreenState extends ConsumerState<HomeTabScreen> {
  @override
  void initState() {
    super.initState();
    // The login response is a bare UserDto with no permission list, so a freshly
    // signed-in account holds an empty set until something asks the server again.
    // Every gate on this tab reads that set, so it is refreshed once on mount rather
    // than gating on stale information.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      unawaited(ref.read(authControllerProvider.notifier).refreshCurrentUser());
    });
  }

  Future<void> _refresh() async {
    ref
      ..invalidate(employeeIdentityProvider)
      ..invalidate(homeOverviewProvider)
      ..invalidate(homeNotificationsProvider)
      ..invalidate(unreadNotificationCountProvider);
    await ref.read(homeOverviewProvider.future);
  }

  @override
  Widget build(BuildContext context) {
    final AppUser? user = ref.watch(currentUserProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            _HomeHeader(user: user),
            Expanded(
              child: RefreshIndicator(
                onRefresh: _refresh,
                color: EmployeeTokens.ink,
                child: HomeAsyncView<HomeOverview>(
                  value: ref.watch(homeOverviewProvider),
                  onRetry: () => ref.invalidate(homeOverviewProvider),
                  builder: (BuildContext ctx, HomeOverview overview) =>
                      _HomeBody(overview: overview),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// `.home-head` — the greeting, the date, and the shared `.hdr-actions` pair.
///
/// The two buttons are not this tab's own: they are [EmployeeHeaderActions], which
/// every tab draws in the same order (calendar, then bell) and which owns the single
/// unread count so no two headers can disagree about it.
class _HomeHeader extends StatelessWidget {
  const _HomeHeader({required this.user});

  final AppUser? user;

  @override
  Widget build(BuildContext context) {
    final String name = user?.fullName ?? '';
    final DateTime now = DateTime.now();

    return Padding(
      padding: const EdgeInsets.fromLTRB(kHomeGutter, 12, kHomeGutter, 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.center,
        children: <Widget>[
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  name.isEmpty
                      ? 'Өдрийн мэнд'
                      : 'Өдрийн мэнд, ${givenNameOf(name)}',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: EmployeeTokens.headerTitle.copyWith(
                    fontWeight: FontWeight.w900,
                  ),
                ),
                const SizedBox(height: 3),
                Text(
                  formatDateWithWeekday(now),
                  style: EmployeeTokens.rowSub
                      .copyWith(fontWeight: FontWeight.w600),
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

class _HomeBody extends StatelessWidget {
  const _HomeBody({required this.overview});

  final HomeOverview overview;

  @override
  Widget build(BuildContext context) {
    final EmployeeIdentity identity = overview.identity;

    return ListView(
      // Always scrollable, so pull-to-refresh works even when the body is short.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.only(top: 2),
      children: <Widget>[
        if (identity is UnresolvedEmployeeIdentity)
          HomeNotice(
            title: identity.reason,
            body: identity.detail,
            tone: Tone.yellow,
            icon: Icons.info_outline,
          ),
        for (final String notice in overview.notices)
          HomeNotice(
            title: 'Зарим мэдээлэл ачаалагдсангүй',
            body: notice,
            tone: Tone.neutral,
            icon: Icons.cloud_off_outlined,
          ),
        if (overview.isScoped)
          ..._personalBlocks(context)
        else
          ..._organisationBlocks(context),
        _AgendaSection(overview: overview),
        const SizedBox(height: EmployeeTokens.scrollBottomSpacer),
      ],
    );
  }

  // -- Scoped to the reader ---------------------------------------------------

  List<Widget> _personalBlocks(BuildContext context) {
    final int active = overview.activeCount;
    final int todayCount = overview.agenda.length;
    final int? completedTotal = overview.completedTotal;

    return <Widget>[
      HomeHeroCard(
        label: 'Идэвхтэй ажил',
        value: '$active',
        note: '$todayCount өнөөдрийн ажил',
        icon: Icons.assignment_outlined,
      ),
      HomeMiniGrid(
        cards: <Widget>[
          HomeMiniCard(
            icon: Icons.play_circle_outline,
            tone: HomeTokens.tileOrange,
            value: '${overview.inProgressCount}',
            label: 'Хийгдэж буй',
          ),
          HomeMiniCard(
            icon: Icons.schedule_outlined,
            tone: HomeTokens.tilePink,
            value: '${overview.overdueCount}',
            label: 'Хугацаа хэтэрсэн',
          ),
          HomeMiniCard(
            icon: Icons.replay_outlined,
            tone: HomeTokens.tilePlain,
            value: '${overview.revisitCount}',
            label: 'Дахин очих',
          ),
          HomeMiniCard(
            icon: Icons.check_circle_outline,
            tone: HomeTokens.tileMint,
            // A dash, not a zero: the figure lives on the employee record and its
            // absence means "not reported", which is a different fact from "none".
            value: completedTotal == null ? '—' : '$completedTotal',
            label: 'Нийт хийсэн',
          ),
        ],
      ),
      if (overview.workload != null) ...<Widget>[
        const SectionHeading('Миний гүйцэтгэл'),
        PerformanceStrip(
          total: overview.workload!.total,
          completed: overview.workload!.completedAssignments,
          active: overview.workload!.activeAssignments,
        ),
      ],
      const SectionHeading('Яаралтай анхаарах'),
      if (overview.urgentItems.isEmpty)
        const HomeEmptyState(
          icon: Icons.verified_outlined,
          message: 'Яаралтай анхаарах ажил алга байна.',
          compact: true,
        )
      else
        for (final HomeUrgentItem item in overview.urgentItems.take(4))
          UrgentWorkCard(
            item: item,
            // Only a service-request row opens: the planned-work screen is the Ажил
            // tab's and reaching it from here would be a second way in with its own
            // back stack.
            onTap: item.serviceRequestId == null
                ? null
                : () => Navigator.of(context).push(
                      ServiceRequestDetailScreen.route(
                        requestId: item.serviceRequestId!,
                        requestNumber: item.reference,
                        subject: item.title,
                        location: item.location,
                        buildingId: item.buildingId,
                        buildingName: item.buildingName,
                        statusLabel: item.statusLabel,
                        slaLabel: item.detail,
                      ),
                    ),
          ),
    ];
  }

  // -- Not scoped: organisation figures, labelled as such ---------------------

  List<Widget> _organisationBlocks(BuildContext context) {
    final DashboardTodaySummaryModel? today = overview.dashboard?.today;
    if (today == null) {
      return <Widget>[
        const SectionHeading('Миний ажил', topPadding: 4),
        const HomeEmptyState(
          icon: Icons.badge_outlined,
          message: 'Танд оногдсон ажлыг харуулах боломжгүй байна. '
              'Дээрх тайлбарыг уншина уу.',
          compact: true,
        ),
      ];
    }

    return <Widget>[
      const SectionHeading('Байгууллагын өнөөдрийн ачаалал', topPadding: 4),
      OrganisationTodayCard(
        due: today.dueCount,
        overdue: today.overdueCount,
        urgent: today.urgentCount,
        completed: today.completedCount,
      ),
    ];
  }
}

/// "Өнөөдрийн хуваарь" — the day feed from `GET /calendar`.
///
/// The heading changes with the scope, because the same list means two different
/// things: the reader's own day when the account is linked, and everybody's day when
/// it is not. Labelling the second one as personal would be the one dishonest thing
/// this screen could do.
class _AgendaSection extends StatelessWidget {
  const _AgendaSection({required this.overview});

  final HomeOverview overview;

  @override
  Widget build(BuildContext context) {
    final List<CalendarEventModel> events = overview.sortedAgenda;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        SectionHeading(
          overview.agendaScoped
              ? 'Өнөөдрийн хуваарь'
              : 'Өнөөдрийн хуваарь · бүх ажилтан',
        ),
        if (events.isEmpty)
          const HomeEmptyState(
            icon: Icons.event_available_outlined,
            message: 'Өнөөдөр хуваарьт ажил алга байна.',
            compact: true,
          )
        else
          for (final CalendarEventModel event in events)
            AgendaEventCard(event: event),
      ],
    );
  }
}
