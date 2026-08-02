import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../../../presentation/widgets/employee_top_bar.dart';
import '../../data/models/calendar_event_model.dart';
import '../../domain/entities/calendar_month.dart';
import '../../domain/entities/calendar_source.dart';
import '../../domain/entities/employee_identity.dart';
import '../../domain/entities/event_level.dart';
import '../calendar_format.dart';
import '../providers/calendar_providers.dart';
import '../widgets/agenda_card.dart';
import '../widgets/calendar_ui.dart';
import '../widgets/event_detail_sheet.dart';
import '../widgets/month_grid.dart';

/// "Хуанли" — pushed from the calendar button in every tab's `.hdr-actions`.
///
/// Not a bottom-nav tab. The prototype's nav is five items with no Хуанли among them
/// (`navItems`, `electro-employee-app.html` L2113-2119); the schedule is reached from
/// the top bar instead, which is why this screen carries a back button and is opened
/// through [route].
///
/// A month grid over a per-day agenda of scheduled work, wired to `GET /calendar`.
/// The prototype's `renderMcal` / `renderMcalAgenda`, with its demo `schedule` map
/// replaced by the live feed and its inconsistent demo clock normalised to the
/// device's today.
///
/// Two things the backend does not do, which this screen is built around rather
/// than around a pretence that it does:
///
///   * `GET /calendar` performs no server-side self-scoping. Narrowing to the
///     signed-in employee is a client-supplied `employeeId` filter, and the id has
///     to be worked out first (see [employeeIdentityProvider]). When it cannot be,
///     the screen says so and shows the full schedule rather than an empty month.
///   * A calendar entry cannot be opened for work here. Recording progress and
///     writing a report belong to the Ажил tab; tapping a row opens a read-only
///     sheet built from the event itself.
class CalendarTabScreen extends ConsumerWidget {
  const CalendarTabScreen({super.key});

  /// The route the top bar's calendar button pushes.
  ///
  /// Exposed here rather than assembled at each of the four call sites so the four
  /// headers cannot disagree about how the schedule opens.
  static Route<void> route() {
    return MaterialPageRoute<void>(
      builder: (BuildContext _) => const CalendarTabScreen(),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);

    return Scaffold(
      backgroundColor: EmployeeTokens.bg,
      body: SafeArea(
        bottom: false,
        child: user == null
            ? const _SignedOutView()
            : const _CalendarBody(),
      ),
    );
  }
}

/// Only reachable if the screen is opened without a session, which the auth gate
/// prevents. Present so the widget has no unhandled branch.
///
/// It carries the back chip too. This used to be a bottom-nav tab, where a dead end
/// was merely unhelpful; as a pushed route it would trap the user on a screen with no
/// way out.
class _SignedOutView extends StatelessWidget {
  const _SignedOutView();

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: <Widget>[
        _BackRow(),
        Expanded(
          child: Center(
            child: CalendarEmptyState(
              icon: Icons.lock_outline,
              message: 'Нэвтэрсэн хэрэглэгч олдсонгүй.',
            ),
          ),
        ),
      ],
    );
  }
}

/// The back chip on its own line, for the branch that has no title row.
class _BackRow extends StatelessWidget {
  const _BackRow();

  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          EmployeeTokens.labelGutter,
          14,
          EmployeeTokens.labelGutter,
          12,
        ),
        child: EmployeeHeaderButton(
          icon: Icons.chevron_left,
          tooltip: 'Буцах',
          onTap: () => Navigator.of(context).maybePop(),
        ),
      ),
    );
  }
}

class _CalendarBody extends ConsumerWidget {
  const _CalendarBody();

  /// Re-resolves the identity as well as the month.
  ///
  /// An administrator may have linked the account to an employee record since the
  /// tab was first opened, and a pull-to-refresh is the natural moment to notice.
  /// The awaited future is allowed to fail quietly: the error is already being
  /// rendered by the body, and letting it escape here would only add an unhandled
  /// rejection on top of a message the user can already see.
  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(employeeIdentityProvider);
    ref.invalidate(calendarEventsProvider);
    try {
      await ref.read(calendarEventsProvider.future);
    } catch (_) {
      // Surfaced by the AsyncValue error branch below.
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CalendarViewState view = ref.watch(calendarViewProvider);
    final AsyncValue<CalendarMonthResult> events =
        ref.watch(calendarEventsProvider);
    final DateTime today = dayOf(DateTime.now());

    return RefreshIndicator(
      color: EmployeeTokens.ink,
      onRefresh: () => _refresh(ref),
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: EdgeInsets.zero,
        children: <Widget>[
          _Header(
            busy: events.isLoading,
            onRefresh: () {
              ref.invalidate(employeeIdentityProvider);
              ref.invalidate(calendarEventsProvider);
            },
          ),
          const _ScopeSelector(),
          const _SourceSelector(),
          _MonthCard(
            view: view,
            today: today,
            events: events,
          ),
          ...switch (events) {
            AsyncData<CalendarMonthResult>(value: final CalendarMonthResult data) =>
              _agendaSections(context, ref, view, data, today),
            AsyncError<CalendarMonthResult>(error: final Object error) =>
              <Widget>[_ErrorPanel(error: error, onRetry: () => _retry(ref))],
            _ => const <Widget>[_AgendaSkeleton()],
          },
          const SizedBox(height: EmployeeTokens.scrollBottomSpacer),
        ],
      ),
    );
  }

  void _retry(WidgetRef ref) {
    ref.invalidate(employeeIdentityProvider);
    ref.invalidate(calendarEventsProvider);
  }

  List<Widget> _agendaSections(
    BuildContext context,
    WidgetRef ref,
    CalendarViewState view,
    CalendarMonthResult data,
    DateTime today,
  ) {
    final List<CalendarEventModel> dayEvents =
        data.eventsOn(view.selectedDay);
    final bool isToday = view.selectedDay == today;

    return <Widget>[
      _IdentityNotice(result: data, onlyMine: view.onlyMine),
      AgendaHeading(
        // `#mcal-agenda-title`: ('Өнөөдөр · ' when the day is today) + the date +
        // ' — ' + the count + ' ажил'.
        '${isToday ? 'Өнөөдөр · ' : ''}'
        '${formatDate(view.selectedDay)} — ${dayEvents.length} ажил',
      ),
      if (dayEvents.isEmpty)
        CalendarEmptyState(
          icon: Icons.event_available_outlined,
          message: view.onlyMine && data.scopedToEmployee
              ? 'Энэ өдөр танд төлөвлөгөөт ажил алга.'
              : 'Энэ өдөр төлөвлөгөөт ажил алга.',
        )
      else
        for (final CalendarEventModel event in dayEvents)
          AgendaCard(
            event: event,
            onTap: () => showCalendarEventSheet(context, event),
          ),
    ];
  }
}

/// The title row: back, title, refresh.
///
/// This screen deliberately does NOT carry [EmployeeHeaderActions]. Its calendar
/// button would push this very screen on top of itself, and the bell is one tap away
/// behind the back chip.
class _Header extends StatelessWidget {
  const _Header({required this.busy, required this.onRefresh});

  final bool busy;
  final VoidCallback onRefresh;

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
          EmployeeHeaderButton(
            icon: Icons.chevron_left,
            tooltip: 'Буцах',
            onTap: () => Navigator.of(context).maybePop(),
          ),
          const SizedBox(width: 10),
          const Expanded(
            child: Text('Хуанли', style: EmployeeTokens.screenTitle),
          ),
          EmployeeHeaderButton(
            icon: Icons.refresh,
            onTap: onRefresh,
            tooltip: 'Дахин ачаалах',
            busy: busy,
          ),
        ],
      ),
    );
  }
}

/// `Миний` / `Бүгд`.
///
/// `Миний` stays disabled until an employee id is resolved, because without one
/// there is nothing to narrow by and the two options would return the same list
/// while claiming to be different.
class _ScopeSelector extends ConsumerWidget {
  const _ScopeSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CalendarViewState view = ref.watch(calendarViewProvider);
    final AsyncValue<EmployeeIdentity> identity =
        ref.watch(employeeIdentityProvider);

    final bool canScope =
        identity.valueOrNull is ResolvedEmployeeIdentity;

    return SegmentedRow(
      labels: const <String>['Миний', 'Бүгд'],
      selectedIndex: view.onlyMine && canScope ? 0 : 1,
      enabled: <bool>[canScope, true],
      onSelected: (int index) => ref
          .read(calendarViewProvider.notifier)
          .setOnlyMine(value: index == 0),
    );
  }
}

/// `Бүгд` / `Төлөвлөгөөт` / `Хүсэлт` — the `sources` query parameter.
class _SourceSelector extends ConsumerWidget {
  const _SourceSelector();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CalendarSource? current = ref.watch(calendarViewProvider).source;
    final int index = switch (current) {
      null => 0,
      CalendarSource.plannedWork => 1,
      CalendarSource.serviceRequest => 2,
    };

    return SegmentedRow(
      labels: <String>[
        'Бүгд',
        CalendarSource.plannedWork.shortLabel,
        CalendarSource.serviceRequest.shortLabel,
      ],
      selectedIndex: index,
      onSelected: (int next) {
        final CalendarSource? source = switch (next) {
          1 => CalendarSource.plannedWork,
          2 => CalendarSource.serviceRequest,
          _ => null,
        };
        ref.read(calendarViewProvider.notifier).setSource(source);
      },
    );
  }
}

/// The month switcher, the grid and its legend, in one card.
///
/// The grid stays on screen through a load and through an error: the month can still
/// be changed while the request for it is in flight, which is what makes paging
/// through months feel like a calendar rather than like a series of page loads.
class _MonthCard extends ConsumerWidget {
  const _MonthCard({
    required this.view,
    required this.today,
    required this.events,
  });

  final CalendarViewState view;
  final DateTime today;
  final AsyncValue<CalendarMonthResult> events;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final CalendarViewController controller =
        ref.read(calendarViewProvider.notifier);

    final CalendarMonthResult? data = events.valueOrNull;
    final Map<DateTime, List<EventLevel>> levels =
        data == null ? const <DateTime, List<EventLevel>>{} : _levelsByDay(data);

    return PanelCard(
      padding: const EdgeInsets.fromLTRB(12, 12, 12, 12),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          MonthSwitcher(
            month: view.month,
            onPrevious: () => controller.moveMonth(-1),
            onNext: () => controller.moveMonth(1),
            onToday: view.month.contains(today) && view.selectedDay == today
                ? null
                : controller.goToToday,
          ),
          const SizedBox(height: 10),
          MonthGrid(
            month: view.month,
            selectedDay: view.selectedDay,
            today: today,
            levelsByDay: levels,
            onSelectDay: controller.selectDay,
          ),
          const SizedBox(height: 10),
          if (events.isLoading)
            const _GridLoadingLine()
          else
            const GridLegend(),
        ],
      ),
    );
  }

  /// Day -> the bands present on it, worst first and de-duplicated.
  ///
  /// Every day the event's span touches is marked, not only its start: a planned
  /// work that runs Monday to Friday is owed on all five days.
  Map<DateTime, List<EventLevel>> _levelsByDay(CalendarMonthResult data) {
    final Map<DateTime, Set<EventLevel>> collected =
        <DateTime, Set<EventLevel>>{};

    for (final CalendarEventModel event in data.events) {
      DateTime cursor = dayOf(event.start);
      final DateTime last = dayOf(event.end);

      // Guard against a pathological span turning the loop into a hang; a month is
      // all that can be shown anyway.
      int guard = 0;
      while (!cursor.isAfter(last) && guard < 400) {
        collected.putIfAbsent(cursor, () => <EventLevel>{}).add(event.level);
        cursor = DateTime(cursor.year, cursor.month, cursor.day + 1);
        guard++;
      }
    }

    return collected.map(
      (DateTime day, Set<EventLevel> bands) {
        final List<EventLevel> sorted = bands.toList()
          ..sort(
            (EventLevel a, EventLevel b) => a.severity.compareTo(b.severity),
          );
        return MapEntry<DateTime, List<EventLevel>>(day, sorted);
      },
    );
  }
}

class _GridLoadingLine extends StatelessWidget {
  const _GridLoadingLine();

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      height: 3,
      child: LinearProgressIndicator(
        minHeight: 3,
        backgroundColor: EmployeeTokens.soft,
        valueColor: AlwaysStoppedAnimation<Color>(EmployeeTokens.ink),
      ),
    );
  }
}

/// Explains whose schedule is on screen whenever it is not straightforwardly the
/// signed-in employee's.
class _IdentityNotice extends StatelessWidget {
  const _IdentityNotice({required this.result, required this.onlyMine});

  final CalendarMonthResult result;
  final bool onlyMine;

  @override
  Widget build(BuildContext context) {
    final EmployeeIdentity identity = result.identity;

    if (identity is UnresolvedEmployeeIdentity) {
      return NoticeBanner.warning(text: identity.detail);
    }

    // A resolved identity needs no disclaimer: `GET /employees/me` returns the
    // caller's own record, so there is no "we matched you by e-mail" caveat left to
    // print. Only the deliberate organisation-wide view is worth a line.
    if (identity is ResolvedEmployeeIdentity && !onlyMine) {
      return const NoticeBanner.info(
        text: 'Байгууллагын бүх хуваарь харагдаж байна. Зөвхөн өөрийн ажлаа '
            'харахын тулд "Миний" сонголтыг ашиглана уу.',
      );
    }

    return const SizedBox.shrink();
  }
}

/// The three-state error branch, with the backend's own Mongolian message when
/// there is one. A raw exception is never shown.
class _ErrorPanel extends StatelessWidget {
  const _ErrorPanel({required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final Object failure = error;
    final bool denied = failure is AuthFailure;
    final String message =
        failure is Failure ? failure.message : 'Хуваарь ачаалж чадсангүй.';

    return CalendarEmptyState(
      icon: denied ? Icons.lock_outline : Icons.cloud_off_outlined,
      message: denied
          ? '$message\n\nХуанли харахад "Төлөвлөгөөт ажил" эсвэл '
              '"Үйлчилгээний хүсэлт" харах эрх шаардлагатай.'
          : message,
      actionLabel: 'Дахин оролдох',
      onAction: onRetry,
    );
  }
}

/// The loading branch: three muted placeholder rows, so the agenda keeps its height
/// and the grid above it does not jump when the data lands.
class _AgendaSkeleton extends StatelessWidget {
  const _AgendaSkeleton();

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        const SectionHeading('Ачаалж байна…', topPadding: 4),
        for (int i = 0; i < 3; i++)
          Container(
            height: 66,
            margin: const EdgeInsets.fromLTRB(
              EmployeeTokens.gutter,
              0,
              EmployeeTokens.gutter,
              8,
            ),
            decoration: BoxDecoration(
              color: EmployeeTokens.white,
              borderRadius: BorderRadius.circular(EmployeeTokens.radiusCard),
              border: Border.all(
                color: EmployeeTokens.faint,
                width: EmployeeTokens.hairline,
              ),
            ),
          ),
      ],
    );
  }
}
