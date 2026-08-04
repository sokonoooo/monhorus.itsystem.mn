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

/// What the user has chosen: which month, which day, which source.
///
/// WHOSE SCHEDULE IS NOT AMONG THEM, and that is the point. This used to carry an
/// `onlyMine` flag behind a `Миний` / `Бүгд` segmented control, because `GET /calendar`
/// scoped nothing server-side and "everybody's" was one tap away — a technician could
/// read every colleague's planned work, with names, customers and buildings. The
/// endpoint enforces the assigned-or-team rule itself now, so the toggle could only
/// ever have been a button that quietly did nothing.
class CalendarViewState extends Equatable {
  const CalendarViewState({
    required this.month,
    required this.selectedDay,
    this.source,
  });

  final CalendarMonth month;

  /// Normalised to midnight, so day comparisons are equality.
  final DateTime selectedDay;

  /// Null means both sources.
  final CalendarSource? source;

  CalendarViewState copyWith({
    CalendarMonth? month,
    DateTime? selectedDay,
    CalendarSource? source,
    bool clearSource = false,
  }) {
    return CalendarViewState(
      month: month ?? this.month,
      selectedDay: selectedDay ?? this.selectedDay,
      source: clearSource ? null : (source ?? this.source),
    );
  }

  @override
  List<Object?> get props => <Object?>[month, selectedDay, source];
}

class CalendarViewController extends Notifier<CalendarViewState> {
  @override
  CalendarViewState build() {
    final DateTime today = dayOf(DateTime.now());
    return CalendarViewState(
      month: CalendarMonth.of(today),
      selectedDay: today,
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
/// Re-runs whenever the month or the source filter changes, because it watches
/// [calendarViewProvider].
///
/// `employeeId` IS NO LONGER THE BOUNDARY, and is still sent. The server bounds both
/// sources by the caller's own assignments, so omitting the parameter can no longer
/// widen anything; what it still does is narrow a caller who happens to hold an
/// oversight key — a dispatcher opening the employee app's "Миний хуваарь" wants their
/// own schedule, not the company's. When no id resolves, the request goes out without
/// it and the server's own scope is what answers.
final FutureProvider<CalendarMonthResult> calendarEventsProvider =
    FutureProvider<CalendarMonthResult>((Ref ref) async {
  final CalendarViewState view = ref.watch(calendarViewProvider);
  final EmployeeIdentity identity =
      await ref.watch(employeeIdentityProvider.future);

  final String? employeeId =
      identity is ResolvedEmployeeIdentity ? identity.employeeId : null;

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
///
/// There is no "the whole organisation" case left to describe: the server refuses it.
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

  /// Whether the request could name the reader. False only when no employee id
  /// resolved, in which case the server's own assignment scope answered instead —
  /// and for an account linked to no employee card that answer is nothing at all,
  /// which is why the screen phrases its empty day generically in that case.
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
