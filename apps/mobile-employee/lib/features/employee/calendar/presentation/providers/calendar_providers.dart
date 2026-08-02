import 'package:equatable/equatable.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../../../core/error/failure.dart';
import '../../../../../core/network/api_result.dart';
import '../../../../auth/domain/entities/app_user.dart';
import '../../../../auth/presentation/providers/auth_provider.dart';
import '../../../identity/employee_self.dart';
import '../../../identity/employee_self_provider.dart';
import '../../data/datasources/calendar_remote_data_source.dart';
import '../../data/models/calendar_event_model.dart';
import '../../data/models/employee_lookup_model.dart';
import '../../data/repositories/calendar_repository_impl.dart';
import '../../domain/entities/calendar_month.dart';
import '../../domain/entities/calendar_source.dart';
import '../../domain/entities/employee_identity.dart';
import '../../domain/repositories/calendar_repository.dart';

// -- Dependency graph --------------------------------------------------------

/// Built on the app's single [DioClient], reached through `dioClientProvider` in
/// features/auth. There is deliberately no second Dio here: the token attachment
/// and the 401-refresh-and-replay live on that one instance.
final Provider<CalendarRepository> calendarRepositoryProvider =
    Provider<CalendarRepository>((Ref ref) {
  return CalendarRepositoryImpl(
    CalendarRemoteDataSource(ref.watch(dioClientProvider)),
  );
});

/// Whether `GET /calendar` would even be accepted.
///
/// The route is `requireAnyPermission(planned_work.view, service_request.view)` and
/// each source is then filtered by its own key, so an account holding one of them
/// gets a one-source calendar rather than a 403.
///
/// Reads false until the first `GET /auth/me`, because the login response is a bare
/// `UserDto` with no permission list. The screen therefore treats "no permissions
/// known yet" as a loading state and not as a refusal.
final Provider<bool> canReadCalendarProvider = Provider<bool>((Ref ref) {
  final AppUser? user = ref.watch(currentUserProvider);
  if (user == null) return false;
  return user.has(PermissionKeys.plannedWorkView) ||
      user.has(PermissionKeys.serviceRequestView);
});

// -- Identity ----------------------------------------------------------------

/// Which employee record the signed-in account is, if it can be worked out.
///
/// One `GET /employees/me` per session, in [employeeSelfProvider], shared with the
/// other tabs that need the same id; this provider maps its result into the terms
/// this screen explains itself in.
final FutureProvider<EmployeeIdentity> employeeIdentityProvider =
    FutureProvider<EmployeeIdentity>((Ref ref) async {
  final EmployeeSelf self = await ref.watch(employeeSelfProvider.future);

  return switch (self) {
    EmployeeSelfResolved(:final Map<String, dynamic> record) => () {
        final EmployeeDetailModel employee = EmployeeDetailModel.fromJson(record);
        return ResolvedEmployeeIdentity(
          employeeId: employee.id,
          displayName: employee.displayName,
          employeeCode: employee.employeeCode,
        );
      }(),
    EmployeeSelfUnavailable(:final EmployeeSelfProblem problem) =>
      switch (problem) {
        EmployeeSelfProblem.noSession => UnresolvedEmployeeIdentity.noSession,
        EmployeeSelfProblem.notLinked => UnresolvedEmployeeIdentity.notFound,
        EmployeeSelfProblem.lookupFailed =>
          UnresolvedEmployeeIdentity.lookupFailed,
      },
  };
});

// -- View state --------------------------------------------------------------

/// What the user has chosen: which month, which day, whose work, which source.
class CalendarViewState extends Equatable {
  const CalendarViewState({
    required this.month,
    required this.selectedDay,
    required this.onlyMine,
    this.source,
  });

  final CalendarMonth month;

  /// Normalised to midnight, so day comparisons are equality.
  final DateTime selectedDay;

  /// Whether to narrow `GET /calendar` to the resolved employee. Ignored while the
  /// identity is unresolved — there is no id to narrow by.
  final bool onlyMine;

  /// Null means both sources.
  final CalendarSource? source;

  CalendarViewState copyWith({
    CalendarMonth? month,
    DateTime? selectedDay,
    bool? onlyMine,
    CalendarSource? source,
    bool clearSource = false,
  }) {
    return CalendarViewState(
      month: month ?? this.month,
      selectedDay: selectedDay ?? this.selectedDay,
      onlyMine: onlyMine ?? this.onlyMine,
      source: clearSource ? null : (source ?? this.source),
    );
  }

  @override
  List<Object?> get props => <Object?>[month, selectedDay, onlyMine, source];
}

class CalendarViewController extends Notifier<CalendarViewState> {
  @override
  CalendarViewState build() {
    final DateTime today = dayOf(DateTime.now());
    return CalendarViewState(
      month: CalendarMonth.of(today),
      selectedDay: today,
      // Defaults to the employee's own schedule, which is what the tab is for. It
      // falls back to the full list on its own when no identity could be resolved.
      onlyMine: true,
    );
  }

  /// `mcalMove(±1)`.
  ///
  /// The selection follows the month rather than being dropped: landing on today
  /// when the new month contains it, and on the 1st otherwise, so the agenda below
  /// the grid is never empty for want of a chosen day.
  void moveMonth(int delta) {
    CalendarMonth next = state.month;
    for (int i = 0; i < delta.abs(); i++) {
      next = delta > 0 ? next.next : next.previous;
    }

    final DateTime today = dayOf(DateTime.now());
    state = state.copyWith(
      month: next,
      selectedDay: next.contains(today) ? today : next.firstDay,
    );
  }

  /// `mcalPick(dateKey)`.
  void selectDay(DateTime day) {
    final DateTime normalised = dayOf(day);
    state = state.copyWith(
      selectedDay: normalised,
      month: CalendarMonth.of(normalised),
    );
  }

  /// Jumps back to today, month and selection together.
  void goToToday() {
    final DateTime today = dayOf(DateTime.now());
    state = state.copyWith(month: CalendarMonth.of(today), selectedDay: today);
  }

  void setOnlyMine({required bool value}) {
    if (state.onlyMine == value) return;
    state = state.copyWith(onlyMine: value);
  }

  void setSource(CalendarSource? value) {
    if (state.source == value) return;
    state = value == null
        ? state.copyWith(clearSource: true)
        : state.copyWith(source: value);
  }
}

final NotifierProvider<CalendarViewController, CalendarViewState>
    calendarViewProvider =
    NotifierProvider<CalendarViewController, CalendarViewState>(
  CalendarViewController.new,
);

// -- The month's events ------------------------------------------------------

/// One month of `GET /calendar`, already narrowed by the current view state.
///
/// Re-runs whenever the month, the source filter or the scope changes, because it
/// watches [calendarViewProvider]. The identity is awaited rather than watched
/// synchronously so the first frame does not fire an unscoped request that a second
/// frame would immediately replace.
final FutureProvider<CalendarMonthResult> calendarEventsProvider =
    FutureProvider<CalendarMonthResult>((Ref ref) async {
  final CalendarViewState view = ref.watch(calendarViewProvider);
  final EmployeeIdentity identity =
      await ref.watch(employeeIdentityProvider.future);

  final String? employeeId = view.onlyMine && identity is ResolvedEmployeeIdentity
      ? identity.employeeId
      : null;

  final ApiResult<CalendarResultModel> result =
      await ref.watch(calendarRepositoryProvider).getCalendar(
            from: view.month.windowStart,
            to: view.month.windowEnd,
            employeeId: employeeId,
            sources: view.source == null
                ? null
                : <CalendarSource>{view.source!},
          );

  final CalendarResultModel data = result.when(
    success: (CalendarResultModel value) => value,
    // Thrown so it lands in `AsyncValue.error` with the backend's own Mongolian
    // message intact; the view renders that rather than an exception string.
    failure: (Failure failure) => throw failure,
  );

  return CalendarMonthResult(
    events: data.events,
    timezone: data.timezone,
    identity: identity,
    scopedToEmployee: employeeId != null,
  );
});

/// What the screen renders: the month's events plus the facts needed to describe
/// them honestly — whose schedule this is, and whether it is anyone's in particular.
class CalendarMonthResult {
  const CalendarMonthResult({
    required this.events,
    required this.timezone,
    required this.identity,
    required this.scopedToEmployee,
  });

  final List<CalendarEventModel> events;
  final String timezone;
  final EmployeeIdentity identity;

  /// False when the list is the whole organisation's schedule, either because the
  /// user asked for it or because no employee id could be resolved.
  final bool scopedToEmployee;

  /// Events touching [day], worst band first, then earliest start.
  List<CalendarEventModel> eventsOn(DateTime day) {
    final List<CalendarEventModel> matches = events
        .where((CalendarEventModel event) => event.coversDay(day))
        .toList();
    matches.sort((CalendarEventModel a, CalendarEventModel b) {
      final int bySeverity = a.level.severity.compareTo(b.level.severity);
      if (bySeverity != 0) return bySeverity;
      return a.start.compareTo(b.start);
    });
    return matches;
  }
}
