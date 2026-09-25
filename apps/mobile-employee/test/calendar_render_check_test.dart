// Hermetic checks for "Хуанли": no network, fixed payloads.
//
// What is pinned here is the tap. A calendar entry is a projection of a record that
// already exists — `CalendarEventDto` carries the `source` and the `sourceId` of the
// planned work or service request behind it — so a row opens THAT record's screen.
// It used to open a read-only sheet assembled from the event, which showed the reader
// the same facts printed on the row they had just tapped and then told them the record
// lived in another tab.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/network/api_result.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/calendar/data/models/calendar_event_model.dart';
import 'package:monhorus_employee/features/employee/calendar/domain/entities/employee_identity.dart';
import 'package:monhorus_employee/features/employee/calendar/presentation/providers/calendar_providers.dart';
import 'package:monhorus_employee/features/employee/calendar/presentation/screens/calendar_tab_screen.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart'
    show PlannedWorkModel;
import 'package:monhorus_employee/features/employee/work/domain/repositories/work_repository.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/planned_work_detail_screen.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';

const AppUser _user = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{'planned_work.view', 'service_request.view'},
);

const ResolvedEmployeeIdentity _identity = ResolvedEmployeeIdentity(
  employeeId: 'e1',
  displayName: 'Дорж Ganbold',
  employeeCode: 'EMP-0002',
);

/// One entry of `GET /calendar`, dated to the device's today so it lands on the day
/// the screen opens on.
CalendarEventModel _event({
  required String source,
  required String sourceId,
  required String reference,
  required String title,
}) {
  final DateTime today = DateTime.now();
  final DateTime start = DateTime(today.year, today.month, today.day, 9);

  return CalendarEventModel.fromJson(<String, dynamic>{
    'id': '$source:$sourceId',
    'source': source,
    'sourceId': sourceId,
    'reference': reference,
    'title': title,
    'start': start.toIso8601String(),
    'end': start.add(const Duration(hours: 3)).toIso8601String(),
    'status': 'STARTED',
    'statusLabel': 'Хэрэгжиж байна',
    'isOverdue': false,
    'isUrgent': false,
    'assignedNames': <dynamic>['Дорж Ganbold'],
    'customerName': 'Central Tower ХХК',
    'buildingName': 'Төв байр',
  });
}

Future<void> _pumpCalendar(
  WidgetTester tester,
  List<CalendarEventModel> events,
) async {
  await tester.binding.setSurfaceSize(const Size(390, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_user),
        calendarEventsProvider.overrideWith(
          (Ref ref) async => CalendarMonthResult(
            events: events,
            timezone: 'Asia/Ulaanbaatar',
            identity: _identity,
            scopedToEmployee: true,
          ),
        ),
        workRepositoryProvider.overrideWithValue(_DetailRepository()),
      ],
      child: const MaterialApp(home: CalendarTabScreen()),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('a planned-work row opens the planned work', (
    WidgetTester tester,
  ) async {
    await _pumpCalendar(tester, <CalendarEventModel>[
      _event(
        source: 'PLANNED_WORK',
        sourceId: 'w1',
        reference: 'PW-202607-0001',
        title: 'Цахилгаан самбарын сарын үзлэг',
      ),
    ]);

    await tester.tap(find.text('Цахилгаан самбарын сарын үзлэг'));
    await tester.pumpAndSettle();

    expect(find.byType(PlannedWorkDetailScreen), findsOneWidget);
    // The sheet the row used to open instead.
    expect(find.byType(BottomSheet), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a service-request row opens the request', (
    WidgetTester tester,
  ) async {
    await _pumpCalendar(tester, <CalendarEventModel>[
      _event(
        source: 'SERVICE_REQUEST',
        sourceId: 'r1',
        reference: 'SR-202607-0005',
        title: 'Лифт №2 зогссон',
      ),
    ]);

    await tester.tap(find.text('Лифт №2 зогссон'));
    await tester.pumpAndSettle();

    expect(find.byType(ServiceRequestDetailScreen), findsOneWidget);
    expect(find.byType(PlannedWorkDetailScreen), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a row carrying no source id is not tappable', (
    WidgetTester tester,
  ) async {
    await _pumpCalendar(tester, <CalendarEventModel>[
      _event(
        source: 'PLANNED_WORK',
        sourceId: '',
        reference: 'PW-202607-0002',
        title: 'Ямар нэг ажил',
      ),
    ]);

    await tester.tap(find.text('Ямар нэг ажил'));
    await tester.pumpAndSettle();

    // There is nothing to open, so the row offers no ink and swallows no tap; it is
    // still drawn, because the work on it is real.
    expect(find.byType(PlannedWorkDetailScreen), findsNothing);
    expect(find.text('Ямар нэг ажил'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  /// Opening the SAME entry twice, which is not the same test as opening it once.
  ///
  /// A Route is a single-use object: it holds the navigator it was installed in and
  /// completes when its screen is popped. This card used to build its route in `build`
  /// and close over it, so the first tap worked and the second handed the Navigator a
  /// spent instance, which asserts `!_debugLocked`.
  testWidgets('a service-request row opens a second time', (
    WidgetTester tester,
  ) async {
    await _pumpCalendar(tester, <CalendarEventModel>[
      _event(
        source: 'SERVICE_REQUEST',
        sourceId: 'r1',
        reference: 'SR-202607-0005',
        title: 'Лифт №2 зогссон',
      ),
    ]);

    for (int attempt = 1; attempt <= 2; attempt++) {
      await tester.tap(find.text('Лифт №2 зогссон'));
      await tester.pumpAndSettle();

      expect(
        find.byType(ServiceRequestDetailScreen),
        findsOneWidget,
        reason: 'the request did not open on attempt $attempt',
      );
      expect(tester.takeException(), isNull, reason: 'attempt $attempt threw');

      await tester.pageBack();
      await tester.pumpAndSettle();
    }
  });
}

/// Answers every detail read with a network failure — see the twin in
/// test/home_render_check_test.dart. What is under test is which screen the tap lands
/// on, and a detail screen showing its error branch is still that screen.
class _DetailRepository implements WorkRepository {
  @override
  Future<ApiResult<PlannedWorkModel>> getPlannedWork(String plannedWorkId) async =>
      const FailureResult<PlannedWorkModel>(NetworkFailure());

  @override
  Future<ApiResult<ServiceRequestDetailModel?>> getServiceRequestDetail(
    String requestId,
  ) async =>
      const FailureResult<ServiceRequestDetailModel?>(NetworkFailure());

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
