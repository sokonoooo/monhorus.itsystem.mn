import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/dashboard_summary_model.dart';
import '../../data/models/work_models.dart';
import '../../domain/entities/employee_identity.dart';
import '../format.dart';
import '../providers/home_providers.dart';
import '../theme/home_tones.dart';
import '../widgets/blueprint_ui.dart';
import '../widgets/home_async_view.dart';
import '../widgets/home_cards.dart';
import '../widgets/home_ui.dart';
import '../../../work/presentation/screens/service_request_detail_screen.dart';

/// Tab 1 — "Нүүр", in the steel blueprint direction.
///
/// Three things, in the same order they have always been in: what is on this
/// technician's plate, what their day looks like, and what has been sent to them.
/// What changed is only how they are drawn — the dark [SteelHero] band replaces the
/// white hero card and the four pastel mini tiles, and the day's figures are now the
/// stair inside it. Nothing about which figure is shown, or where it comes from,
/// moved with it.
///
/// Every figure comes from the API. The prototype's static demo numbers are not
/// reproduced, and neither are the two blocks behind them that no endpoint supports:
/// there is no month-scoped completion count anywhere in the contract, and
/// `/dashboard/summary` is organisation-wide with no self-scoping, so it is only
/// ever labelled as such.
///
/// The screen turns on one question — which employee record this account is.
/// `GET /employees/me` answers it directly, resolving the `Employee.systemUser` link
/// from the session, and the list endpoints now scope themselves to the caller's own
/// and their team's work for anybody without an oversight permission. So "Миний ажил"
/// is no longer a client-supplied filter that the app could get wrong.
///
/// The identity is still the pivot, for a different reason: an account with no employee
/// card gets no personal figures, and that must be SAID rather than shown as an empty
/// week. When the link cannot be established the personal blocks are withheld and
/// explained rather than filled with everyone's work.
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
    final AsyncValue<HomeOverview> overview = ref.watch(homeOverviewProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      // Deliberately no top SafeArea: the hero band runs under the status bar and
      // pads itself past it. Wrapping it would put a strip of page ground above the
      // one dark surface in the app.
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          _HomeHero(user: user, overview: overview),
          Expanded(
            child: RefreshIndicator(
              onRefresh: _refresh,
              color: EmployeeTokens.ink,
              child: HomeAsyncView<HomeOverview>(
                value: overview,
                onRetry: () => ref.invalidate(homeOverviewProvider),
                builder: (BuildContext ctx, HomeOverview data) =>
                    _HomeBody(overview: data),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// The dark band: the greeting, the date, the one sentence that says what today is,
/// and the stair of the day's figures.
///
/// It reads the overview directly rather than sitting inside [HomeAsyncView],
/// because it is pinned above the scrolling body and must draw before the body has
/// anything to show. Until the request lands there are no figures, so it draws no
/// stair — four zeroes would be a claim the screen cannot make yet.
class _HomeHero extends StatelessWidget {
  const _HomeHero({required this.user, required this.overview});

  final AppUser? user;
  final AsyncValue<HomeOverview> overview;

  @override
  Widget build(BuildContext context) {
    final String name = user?.fullName ?? '';
    final DateTime now = DateTime.now();
    final HomeOverview? data = overview.valueOrNull;

    return SteelHero(
      title: name.isEmpty ? 'Өдрийн мэнд' : 'Өдрийн мэнд, ${givenNameOf(name)}',
      subtitle: formatDateWithWeekday(now).toUpperCase(),
      headline: _headline(data),
      stair: _stair(data),
      action: const HeroHeaderActions(),
    );
  }

  /// One sentence naming the state of the day.
  ///
  /// Scoped, it is about the reader. Unscoped, it names the organisation out loud,
  /// because the figures underneath it are everybody's and a personal phrasing over
  /// them would be the one dishonest thing this screen could say.
  String _headline(HomeOverview? data) {
    if (data == null) {
      return overview.hasError
          ? 'Мэдээлэл ачаалж чадсангүй'
          : 'Өнөөдрийн ачааллыг ачаалж байна';
    }
    if (!data.isScoped) return 'Байгууллагын өнөөдрийн ачаалал';
    if (data.overdueCount > 0) {
      return '${data.overdueCount} ажил хугацаа хэтэрсэн';
    }
    if (data.activeCount > 0) {
      return '${data.activeCount} идэвхтэй ажил хүлээгдэж байна';
    }
    return 'Хүлээгдэж буй ажил алга байна';
  }

  /// The four figures, banded by the risk ramp so urgency is legible before a single
  /// number is read.
  List<SteelStairBand> _stair(HomeOverview? data) {
    if (data == null) return const <SteelStairBand>[];

    if (data.isScoped) {
      return <SteelStairBand>[
        (
          band: EmployeeTokens.accent,
          count: '${data.activeCount}',
          label: 'ИДЭВХТЭЙ',
        ),
        (
          band: EmployeeTokens.orange,
          count: '${data.inProgressCount}',
          label: 'ХИЙГДЭЖ БУЙ',
        ),
        (
          band: EmployeeTokens.red,
          count: '${data.overdueCount}',
          label: 'ХУГАЦАА ХЭТЭРСЭН',
        ),
        (
          band: EmployeeTokens.green,
          // A dash, not a zero: the figure lives on the employee record and its
          // absence means "not reported", which is a different fact from "none".
          count: data.completedTotal == null ? '—' : '${data.completedTotal}',
          label: 'НИЙТ ХИЙСЭН',
        ),
      ];
    }

    final DashboardTodaySummaryModel? today = data.dashboard?.today;
    if (today == null) return const <SteelStairBand>[];

    return <SteelStairBand>[
      (
        band: EmployeeTokens.accent,
        count: '${today.dueCount}',
        label: 'ХҮЛЭЭГДЭЖ БУЙ',
      ),
      (
        band: EmployeeTokens.red,
        count: '${today.overdueCount}',
        label: 'ХУГАЦАА ХЭТЭРСЭН',
      ),
      (
        band: EmployeeTokens.orange,
        count: '${today.urgentCount}',
        label: 'ЯАРАЛТАЙ',
      ),
      (
        band: EmployeeTokens.green,
        count: '${today.completedCount}',
        label: 'ДУУССАН',
      ),
    ];
  }
}

class _HomeBody extends StatelessWidget {
  const _HomeBody({required this.overview});

  final HomeOverview overview;

  @override
  Widget build(BuildContext context) {
    final EmployeeIdentity identity = overview.identity;

    final List<Widget> notices = <Widget>[
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
    ];

    return ListView(
      // Always scrollable, so pull-to-refresh works even when the body is short.
      physics: const AlwaysScrollableScrollPhysics(),
      padding: EdgeInsets.zero,
      children: <Widget>[
        // The notices carry no top padding of their own and the hero is flush above
        // them, so the gap is opened here rather than inside a widget four other
        // screens draw.
        if (notices.isNotEmpty) ...<Widget>[
          const SizedBox(height: 16),
          ...notices,
        ],
        if (overview.isScoped)
          ..._personalBlocks(context)
        else
          ..._organisationBlocks(context),
        _AgendaSection(overview: overview),
        // No calendar CTA under the agenda. It was a third way to the same screen —
        // the header's calendar button is on every tab and the agenda itself is right
        // above it — and the reader asked for it gone.
        const SizedBox(height: EmployeeTokens.scrollBottomSpacer),
      ],
    );
  }

  // -- Scoped to the reader ---------------------------------------------------

  List<Widget> _personalBlocks(BuildContext context) {
    final List<HomeUrgentItem> urgent =
        overview.urgentItems.take(4).toList(growable: false);

    return <Widget>[
      const SectionHead(kicker: 'ЯАРАЛТАЙ АНХААРАХ'),
      if (urgent.isEmpty)
        const HomeEmptyState(
          icon: Icons.verified_outlined,
          message: 'Яаралтай анхаарах ажил алга байна.',
          compact: true,
        )
      else
        BlueprintRowList(
          rows: <Widget>[
            for (final HomeUrgentItem item in urgent)
              BlueprintRow(
                band: severityTone(item.band).foreground,
                name: item.title,
                subtitle: item.location.isEmpty
                    ? (item.buildingName ?? '')
                    : item.location,
                stateLabel: item.statusLabel,
                metaLabel: 'ЛАВЛАХ',
                metaValue: item.reference,
                // Only a service-request row opens: the planned-work screen is the
                // Ажил tab's and reaching it from here would be a second way in with
                // its own back stack.
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
          ],
        ),
    ];
  }

  // -- Not scoped: organisation figures, labelled as such ---------------------

  List<Widget> _organisationBlocks(BuildContext context) {
    final DashboardTodaySummaryModel? today = overview.dashboard?.today;
    if (today == null) {
      return <Widget>[
        const SectionHead(kicker: 'МИНИЙ АЖИЛ'),
        const HomeEmptyState(
          icon: Icons.badge_outlined,
          message: 'Танд оногдсон ажлыг харуулах боломжгүй байна. '
              'Дээрх тайлбарыг уншина уу.',
          compact: true,
        ),
      ];
    }

    return <Widget>[
      const SectionHead(kicker: 'БАЙГУУЛЛАГЫН ӨНӨӨДӨР'),
      BlueprintFrame(
        margin: const EdgeInsets.fromLTRB(
          EmployeeTokens.gutter - 6,
          14 - 6,
          EmployeeTokens.gutter - 6,
          0,
        ),
        child: OrganisationTodayCard(
          due: today.dueCount,
          overdue: today.overdueCount,
          urgent: today.urgentCount,
          completed: today.completedCount,
          padding: const EdgeInsets.all(14),
        ),
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
        SectionHead(
          kicker: overview.agendaScoped
              ? 'ӨНӨӨДРИЙН ХУВААРЬ'
              : 'ӨНӨӨДРИЙН ХУВААРЬ · БҮХ АЖИЛТАН',
        ),
        if (events.isEmpty)
          const HomeEmptyState(
            icon: Icons.event_available_outlined,
            message: 'Өнөөдөр хуваарьт ажил алга байна.',
            compact: true,
          )
        else ...<Widget>[
          const SizedBox(height: 12),
          for (final CalendarEventModel event in events)
            AgendaEventCard(event: event),
        ],
      ],
    );
  }
}
