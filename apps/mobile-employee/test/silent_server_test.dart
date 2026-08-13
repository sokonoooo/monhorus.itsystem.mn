// What each figure does when the server has not answered, or answered without it.
//
// Every case here is a screen that used to turn silence into a number: a summary that
// had not arrived drawn as four zeroes, a missing `progressPercent` printed as
// "Явц 0%", a missing `remainingQuantity` reconstructed on the device. A zero and a
// dash look similar and mean opposite things — one is a fact about the floor, the
// other is the absence of one — and nothing in the suite could tell them apart.
import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/core/util/format.dart';
import 'package:monhorus_employee/features/employee/home/data/models/work_models.dart'
    as home;
import 'package:monhorus_employee/features/employee/home/presentation/providers/home_providers.dart';
import 'package:monhorus_employee/features/employee/project/data/models/inspection_models.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/floor_reports_screen.dart';
import 'package:monhorus_employee/features/employee/work/data/models/planned_work_model.dart';

const String _floorId = 'f1';

/// The floor's report screen, with both of its reads under the test's control.
Widget _floorReports({
  required Future<InspectionSummaryModel> Function() summary,
}) {
  return ProviderScope(
    overrides: <Override>[
      floorReportSummaryProvider(_floorId).overrideWith((Ref ref) => summary()),
      floorReportsProvider(const FloorReportQuery(floorId: _floorId))
          .overrideWith((Ref ref) async => const <InspectionListItemModel>[]),
    ],
    child: const MaterialApp(
      home: FloorReportsScreen(
        floorId: _floorId,
        floorName: '2-р давхар',
        buildingName: 'Төв байр',
      ),
    ),
  );
}

/// A floor that genuinely holds nothing: every counter zero, straight from the API.
final InspectionSummaryModel _emptyFloor =
    InspectionSummaryModel.fromJson(<String, dynamic>{
  'totalObjects': 0,
  'assessedObjects': 0,
  'unassessedObjects': 0,
  'counts': <Map<String, dynamic>>[],
  'repairRequiredCount': 0,
  'revisitRequiredCount': 0,
});

void main() {
  group('floor reports — the summary is not answered with zeroes', () {
    testWidgets('while it is still in flight the four cards are not drawn',
        (WidgetTester tester) async {
      final Completer<InspectionSummaryModel> pending =
          Completer<InspectionSummaryModel>();

      await tester.pumpWidget(_floorReports(summary: () => pending.future));
      await tester.pump();

      // The card labels themselves are absent, so there is nothing on screen a
      // technician could read a count off. This is the assertion the old code failed:
      // it drew "ҮНЭЛГЭЭТЭЙ 0" and "Нийт 0 төхөөрөмж" before the request landed.
      expect(find.text('ҮНЭЛГЭЭТЭЙ'), findsNothing);
      expect(find.text('Нийт 0 төхөөрөмж'), findsNothing);
      expect(find.byType(CircularProgressIndicator), findsWidgets);

      pending.complete(_emptyFloor);
      await tester.pumpAndSettle();
    });

    testWidgets('a failed summary explains itself instead of reading zero',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        _floorReports(
          summary: () async => throw const ServerFailure(
            'Энэ үйлдлийг хийх эрх байхгүй байна.',
            code: 'FORBIDDEN',
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Энэ үйлдлийг хийх эрх байхгүй байна.'), findsOneWidget);
      expect(find.text('ҮНЭЛГЭЭТЭЙ'), findsNothing);
      expect(find.text('Нийт 0 төхөөрөмж'), findsNothing);
    });

    testWidgets('a floor that really is empty still shows its zeroes',
        (WidgetTester tester) async {
      await tester.pumpWidget(_floorReports(summary: () async => _emptyFloor));
      await tester.pumpAndSettle();

      // The point is the distinction, not the suppression: when the server says the
      // floor holds nothing, the screen says so.
      expect(find.text('ҮНЭЛГЭЭТЭЙ'), findsOneWidget);
      expect(find.text('Нийт 0 төхөөрөмж'), findsOneWidget);
    });
  });

  group('progressPercent — no figure, no "Явц"', () {
    test('an answer without progressPercent leaves the model null', () {
      final home.PlannedWorkListItemModel work =
          home.PlannedWorkListItemModel.fromJson(<String, dynamic>{
        'id': 'pw1',
        'workNumber': 'PW-0001',
        'title': 'Улирлын үзлэг',
        'taskCount': 3,
      });

      expect(work.progressPercent, isNull);
      expect(formatPercent(work.progressPercent), kNoValue);
    });

    test('the Нүүр row drops the Явц segment rather than printing 0%', () {
      final HomeUrgentItem silent = HomeUrgentItem.fromPlannedWork(
        home.PlannedWorkListItemModel.fromJson(<String, dynamic>{
          'id': 'pw1',
          'workNumber': 'PW-0001',
          'title': 'Улирлын үзлэг',
          'taskCount': 3,
        }),
      );

      expect(silent.detail, isNot(contains('Явц')));
      expect(silent.detail, contains('3 task'));

      final HomeUrgentItem stated = HomeUrgentItem.fromPlannedWork(
        home.PlannedWorkListItemModel.fromJson(<String, dynamic>{
          'id': 'pw2',
          'workNumber': 'PW-0002',
          'title': 'Улирлын үзлэг',
          'taskCount': 3,
          'progressPercent': 40,
        }),
      );

      expect(stated.detail, contains('Явц 40%'));
    });

    test('a stated zero is still printed — it is an answer', () {
      final home.PlannedWorkListItemModel work =
          home.PlannedWorkListItemModel.fromJson(<String, dynamic>{
        'id': 'pw3',
        'workNumber': 'PW-0003',
        'title': 'Улирлын үзлэг',
        'taskCount': 1,
        'progressPercent': 0,
      });

      expect(work.progressPercent, 0);
      expect(HomeUrgentItem.fromPlannedWork(work).detail, contains('Явц 0%'));
    });

    test('the Ажил tab models carry the same silence through', () {
      final PlannedWorkTaskModel task =
          PlannedWorkTaskModel.fromJson(<String, dynamic>{
        'id': 't1',
        'plannedWorkId': 'pw1',
        'title': 'Самбар цэвэрлэх',
        'totalQuantity': 20,
        'completedQuantity': 8,
      });
      expect(task.progressPercent, isNull);

      final PlannedWorkFloorProgressModel floor =
          PlannedWorkFloorProgressModel.fromJson(<String, dynamic>{
        'floorId': 'f1',
        'floorName': '2-р давхар',
      });
      expect(floor.progressPercent, isNull);

      final PlannedWorkListItemModel work =
          PlannedWorkListItemModel.fromJson(<String, dynamic>{
        'id': 'pw1',
        'workNumber': 'PW-0001',
      });
      expect(work.progressPercent, isNull);

      final PlannedWorkReportTaskLineModel line =
          PlannedWorkReportTaskLineModel.fromJson(<String, dynamic>{'id': 't1'});
      expect(line.progressPercent, isNull);

      final PlannedWorkReportPreviewModel preview =
          PlannedWorkReportPreviewModel.fromJson(<String, dynamic>{
        'workNumber': 'PW-0001',
      });
      expect(preview.progressPercent, isNull);
    });
  });

  group('remainingQuantity is the server\'s figure or nothing', () {
    test('it is not reconstructed from total minus completed', () {
      final PlannedWorkTaskModel task =
          PlannedWorkTaskModel.fromJson(<String, dynamic>{
        'id': 't1',
        'plannedWorkId': 'pw1',
        'title': 'Самбар цэвэрлэх',
        'totalQuantity': 20,
        'completedQuantity': 8,
      });

      // 12 is what the subtraction would have produced, and it is exactly the answer
      // this file's header forbids: "Nothing is recalculated on the device."
      expect(task.remainingQuantity, isNull);
    });

    test('a stated remainder is kept exactly as sent', () {
      final PlannedWorkTaskModel task =
          PlannedWorkTaskModel.fromJson(<String, dynamic>{
        'id': 't1',
        'plannedWorkId': 'pw1',
        'title': 'Самбар цэвэрлэх',
        'totalQuantity': 20,
        'completedQuantity': 8,
        // Deliberately disagrees with 20 - 8: the server's figure wins, because it is
        // the one the evidence gate and the dashboard are computed from.
        'remainingQuantity': 9,
      });

      expect(task.remainingQuantity, 9);
    });
  });
}
