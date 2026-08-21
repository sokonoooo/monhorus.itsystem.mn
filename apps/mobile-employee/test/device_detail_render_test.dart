// The device screen's three replaced sections: reports, location and panel contents.
//
// Each of them removed something the screen used to draw, so every group below asserts
// BOTH halves — the new thing is present AND the old thing is gone. A test that only
// checked the new section would still pass if the old one had been left underneath it,
// which for the photo strip and the event timeline is exactly the failure that matters:
// the point was to stop showing them.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/project/data/models/object_models.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/project/data/models/report_record_models.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/authenticated_image.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/floor_plan_markers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/report_record_sheet.dart';

const String _objectId = 'o1';
const String _floorId = 'f1';
const String _planFileId = '6f0000000000000000000009';

/// A plan four times wider than it is tall, so a letterboxed box could not pass the
/// geometry assertion by coincidence.
const int _planWidth = 400;
const int _planHeight = 100;

Future<Uint8List> _planBytes() async {
  final ui.PictureRecorder recorder = ui.PictureRecorder();
  final Canvas canvas = Canvas(recorder);
  canvas.drawRect(
    Rect.fromLTWH(0, 0, _planWidth.toDouble(), _planHeight.toDouble()),
    Paint()..color = const Color(0xFFE8EDF2),
  );
  final ui.Picture picture = recorder.endRecording();
  final ui.Image image = await picture.toImage(_planWidth, _planHeight);
  final ByteData? data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return data!.buffer.asUint8List();
}

Map<String, dynamic> _childJson({
  required String id,
  required String code,
  required String name,
  String category = 'EQUIPMENT',
}) =>
    <String, dynamic>{
      'id': id,
      'code': code,
      'name': name,
      'category': category,
      'objectType': <String, dynamic>{
        'id': 'ot2',
        'code': 'EQ',
        'name': 'Тоноглол',
        'icon': 'BREAKER',
        'showOnPlan': true,
      },
      'customerId': 'c1',
      'floorId': _floorId,
      'floorName': '2-р давхар',
      'buildingName': 'Төв байр',
      'status': 'ACTIVE',
      'calculatedLoad': <String, dynamic>{
        'valueKw': 1.0,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'loadVariance': <String, dynamic>{
        'valueKw': null,
        'complete': false,
        'reasons': <dynamic>[],
      },
    };

Map<String, dynamic> _device({
  Map<String, dynamic>? planPosition,
  Object? floorId = _floorId,
  List<Map<String, dynamic>> childCircuits = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> mountedEquipment = const <Map<String, dynamic>>[],
  List<Map<String, dynamic>> photos = const <Map<String, dynamic>>[],
}) =>
    <String, dynamic>{
      'id': _objectId,
      'code': 'CT-LDB-1',
      'name': 'Гэрэлтүүлгийн самбар',
      'category': 'PANEL',
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'code': 'DB',
        'name': 'Хуваарилах самбар',
        'icon': 'PANEL',
        'showOnPlan': true,
      },
      'customerId': 'c1',
      'floorId': floorId,
      'floorName': '2-р давхар',
      'buildingName': 'Төв байр',
      'planPosition': planPosition,
      'status': 'ACTIVE',
      'latestAssessment': <String, dynamic>{
        'id': 'a1',
        'score': 72,
        'riskLevel': 'ATTENTION',
        'assessedAt': '2026-07-20T02:00:00.000Z',
        'assessedByName': 'Дорж',
      },
      'calculatedLoad': <String, dynamic>{
        'valueKw': 18.5,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'loadVariance': <String, dynamic>{
        'valueKw': null,
        'complete': false,
        'reasons': <dynamic>[],
      },
      'loadPercent': <String, dynamic>{
        'valueKw': 74.0,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'reserveKw': <String, dynamic>{
        'valueKw': 6.5,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'createdAt': '2026-01-04T02:00:00.000Z',
      'updatedAt': '2026-07-20T02:00:00.000Z',
      'photos': photos,
      'childCircuits': childCircuits,
      'childEquipment': <dynamic>[],
      'mountedEquipment': mountedEquipment,
      'canAssess': true,
    };

Map<String, dynamic> _planJson({String mimeType = 'image/png'}) => <String, dynamic>{
      'id': '6f0000000000000000000001',
      'floorId': _floorId,
      'fileId': _planFileId,
      'fileName': mimeType == 'application/pdf' ? 'plan.pdf' : 'plan.png',
      'downloadUrl': '/api/v1/files/$_planFileId',
      'mimeType': mimeType,
      'sizeBytes': 4096,
      'title': '2-р давхрын план',
      'uploadedByName': 'Админ',
      'uploadedAt': '2026-07-01T02:00:00.000Z',
    };

Map<String, dynamic> _reportJson({
  required String id,
  required String number,
  String type = 'OBJECT_ASSESSMENT',
  String status = 'APPROVED',
  int? overallScore = 72,
  List<Map<String, dynamic>> items = const <Map<String, dynamic>>[],
}) =>
    <String, dynamic>{
      'id': id,
      'reportNumber': number,
      'type': type,
      'status': status,
      'title': 'Үзлэгийн тайлан',
      'conclusion': 'Ерөнхий дүгнэлт.',
      'recommendation': null,
      'overallScore': overallScore,
      'riskLevel': 'ATTENTION',
      'itemCount': items.length,
      'createdByName': 'Дорж',
      'approvedByName': 'Бат',
      'approvedAt': '2026-08-05T02:00:00.000Z',
      'occurredAt': '2026-08-04T02:00:00.000Z',
      'items': items,
    };

AppUser _technician() => const AppUser(
      id: 'u1',
      fullName: 'Дорж Ganbold',
      email: 'd.ganbold@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: <String>{'object.view', 'object_master.view'},
    );

// Section headings are asserted in UPPER CASE: `SectionHeading` uppercases what it is
// given. Matching the mixed-case source string would silently match a DetailRow label
// instead — 'Байршил' is both a heading and a row label on this screen — and the test
// would pass while the section it names was missing.
void main() {
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Widget screen({
    required Map<String, dynamic> device,
    List<Map<String, dynamic>> reports = const <Map<String, dynamic>>[],
    Map<String, dynamic>? plan,
    Uint8List? bytes,
    Map<String, dynamic>? reportDetail,
    List<String>? planReads,
  }) {
    return ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_technician()),
        objectDetailProvider(_objectId).overrideWith(
          (Ref ref) async => ObjectDetailModel.fromJson(device),
        ),
        objectReportsProvider(_objectId).overrideWith(
          (Ref ref) async =>
              reports.map(ReportRecordModel.fromJson).toList(growable: false),
        ),
        if (reportDetail != null)
          reportRecordProvider(reportDetail['id'] as String).overrideWith(
            (Ref ref) async => ReportRecordDetailModel.fromJson(reportDetail),
          ),
        floorPlanProvider(_floorId).overrideWith((Ref ref) async {
          planReads?.add(_floorId);
          return plan == null ? null : FloorPlanModel.fromJson(plan);
        }),
        if (bytes != null)
          projectFileBytesProvider(_planFileId).overrideWith((Ref ref) async => bytes),
      ],
      child: const MaterialApp(
        home: DeviceDetailScreen(
          objectId: _objectId,
          fallbackTitle: 'CT-LDB-1',
          fallbackSubtitle: 'Гэрэлтүүлгийн самбар',
          floorName: '2-р давхар',
          buildingName: 'Төв байр',
          projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
        ),
      ),
    );
  }

  /// Pumps in a real async zone, so the plan image actually decodes.
  Future<void> pumpScreen(WidgetTester tester, Widget Function() build) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.runAsync(() async {
      final Completer<void> done = Completer<void>();
      unawaited(runZonedGuarded<Future<void>>(
        () async {
          await tester.pumpWidget(build());
          for (int frame = 0; frame < 8; frame++) {
            await Future<void>.delayed(const Duration(milliseconds: 20));
            await tester.pump();
          }
          if (!done.isCompleted) done.complete();
        },
        (Object error, StackTrace stack) {
          if (error.toString().contains('font')) return;
          if (!done.isCompleted) done.completeError(error, stack);
        },
      ));
      await done.future;
    });
  }

  /// Scrolls the page until [target] is built, or gives up.
  Future<void> scrollTo(WidgetTester tester, Finder target) async {
    for (int attempt = 0; attempt < 25 && target.evaluate().isEmpty; attempt++) {
      await tester.drag(find.byType(Scrollable).first, const Offset(0, -220));
      await tester.pump();
    }
  }

  group('reports', () {
    testWidgets('lists the reports for this equipment and drops the event timeline',
        (WidgetTester tester) async {
      await pumpScreen(
        tester,
        () => screen(
          device: _device(),
          reports: <Map<String, dynamic>>[
            _reportJson(id: 'r1', number: 'RPT-202608-0007'),
            _reportJson(
              id: 'r2',
              number: 'RPT-202607-0031',
              type: 'SERVICE_REQUEST',
            ),
          ],
        ),
      );

      await scrollTo(tester, find.text('ТАЙЛАНГУУД'));
      expect(find.text('ТАЙЛАНГУУД'), findsOneWidget);
      await scrollTo(tester, find.textContaining('RPT-202608-0007'));
      expect(find.textContaining('RPT-202608-0007'), findsOneWidget);
      expect(find.textContaining('RPT-202607-0031'), findsOneWidget);

      // The heading the mixed audit/measurement timeline used to carry. Its absence is
      // half the requirement — the report log is not to be shown.
      expect(find.text('ТАЙЛАНГИЙН БҮХ ТҮҮХ'), findsNothing);
    });

    testWidgets('says so plainly when the equipment has no reports',
        (WidgetTester tester) async {
      await pumpScreen(tester, () => screen(device: _device()));

      await scrollTo(tester, find.textContaining('бүртгэгдсэн тайлан алга'));
      expect(find.textContaining('бүртгэгдсэн тайлан алга'), findsOneWidget);
    });

    testWidgets('opens the report, showing this equipment own finding',
        (WidgetTester tester) async {
      final Map<String, dynamic> detail = _reportJson(
        id: 'r1',
        number: 'RPT-202608-0007',
        items: <Map<String, dynamic>>[
          <String, dynamic>{
            'id': 'i1',
            'reportId': 'r1',
            'objectId': _objectId,
            'objectCode': 'CT-LDB-1',
            'score': 38,
            'riskLevel': 'CRITICAL',
            'conclusion': 'Энэ самбарын тухай дүгнэлт.',
            'recommendation': 'Яаралтай засварлана.',
            'evidenceAttachments': <dynamic>[],
          },
          // Another device's finding in the same report. It must not be shown here.
          <String, dynamic>{
            'id': 'i2',
            'reportId': 'r1',
            'objectId': 'other',
            'objectCode': 'CT-LDB-9',
            'score': 90,
            'riskLevel': 'NORMAL',
            'conclusion': 'Өөр төхөөрөмжийн дүгнэлт.',
            'evidenceAttachments': <dynamic>[],
          },
        ],
      );

      await pumpScreen(
        tester,
        () => screen(
          device: _device(),
          reports: <Map<String, dynamic>>[
            _reportJson(id: 'r1', number: 'RPT-202608-0007'),
          ],
          reportDetail: detail,
        ),
      );

      await scrollTo(tester, find.textContaining('RPT-202608-0007'));
      await tester.tap(find.textContaining('RPT-202608-0007').first);
      for (int frame = 0; frame < 6; frame++) {
        await tester.pump(const Duration(milliseconds: 40));
      }

      expect(find.byType(ReportRecordSheet), findsOneWidget);
      expect(find.text('Энэ самбарын тухай дүгнэлт.'), findsOneWidget);
      // A report covers a visit; the reader asked about one device.
      expect(find.text('Өөр төхөөрөмжийн дүгнэлт.'), findsNothing);
    });
  });

  group('location', () {
    testWidgets('draws the equipment marker on its floor plan, in place of photos',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpScreen(
        tester,
        () => screen(
          device: _device(
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.25},
            photos: <Map<String, dynamic>>[
              <String, dynamic>{
                'id': 'p1',
                'name': 'a.png',
                'downloadUrl': '/api/v1/files/p1',
                'mimeType': 'image/png',
                'sizeBytes': 10,
              },
            ],
          ),
          plan: _planJson(),
          bytes: bytes,
        ),
      );

      await scrollTo(tester, find.text('БАЙРШИЛ'));
      expect(find.text('БАЙРШИЛ'), findsOneWidget);
      expect(find.byType(FloorPlanMarkerLayer), findsOneWidget);
      expect(find.byType(PlanMarker), findsOneWidget);

      // The picture strip is gone even though the object CARRIES photos — proving the
      // section was removed rather than merely rendering empty.
      expect(find.text('ЗУРАГ'), findsNothing);

      // The marker sits on its recorded fraction of the painted drawing, which is the
      // only thing that makes this a location rather than a decoration.
      final Rect plan = tester.getRect(
        find.descendant(
          of: find.byType(AuthenticatedImage),
          matching: find.byType(Image),
        ),
      );
      expect(plan.width / plan.height, closeTo(_planWidth / _planHeight, 0.02));
      final Rect marker = tester.getRect(find.byType(PlanMarker));
      expect(marker.center.dx, closeTo(plan.left + plan.width * 0.5, 0.6));
      expect(marker.center.dy, closeTo(plan.top + plan.height * 0.25, 0.6));
    });

    testWidgets('an unplaced device says so and never asks for a plan',
        (WidgetTester tester) async {
      final List<String> planReads = <String>[];

      await pumpScreen(
        tester,
        () => screen(device: _device(), plan: _planJson(), planReads: planReads),
      );

      await scrollTo(tester, find.textContaining('план дээр байрлуулаагүй'));
      expect(find.textContaining('план дээр байрлуулаагүй'), findsOneWidget);
      expect(find.byType(FloorPlanMarkerLayer), findsNothing);
      // Refused before the request: there is nothing to draw on a plan we would only
      // fetch to leave blank.
      expect(planReads, isEmpty);
    });

    testWidgets('a floor with no plan imported says that instead',
        (WidgetTester tester) async {
      await pumpScreen(
        tester,
        () => screen(
          device: _device(planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5}),
        ),
      );

      await scrollTo(tester, find.textContaining('импортлогдоогүй'));
      expect(find.textContaining('импортлогдоогүй'), findsOneWidget);
      expect(find.byType(PlanMarker), findsNothing);
    });
  });

  group('panel contents', () {
    testWidgets('lists the circuits it feeds and the equipment inside it',
        (WidgetTester tester) async {
      await pumpScreen(
        tester,
        () => screen(
          device: _device(
            childCircuits: <Map<String, dynamic>>[
              _childJson(
                id: 'c1',
                code: 'C-201',
                name: 'Гэрэлтүүлэг',
                category: 'CIRCUIT',
              ),
              _childJson(
                id: 'c2',
                code: 'C-202',
                name: 'Залгуур',
                category: 'CIRCUIT',
              ),
            ],
            mountedEquipment: <Map<String, dynamic>>[
              _childJson(id: 'e1', code: 'RCD-1', name: 'Хамгаалалт'),
            ],
          ),
        ),
      );

      // Counted in the heading, because "is that all of them" is the question a
      // technician standing at an open enclosure is actually asking.
      await scrollTo(tester, find.text('ХЭЛХЭЭ (2)'));
      expect(find.text('ХЭЛХЭЭ (2)'), findsOneWidget);
      expect(find.textContaining('C-201'), findsOneWidget);
      expect(find.textContaining('C-202'), findsOneWidget);

      await scrollTo(tester, find.text('САМБАРТ БАЙРЛАХ ТОНОГЛОЛ (1)'));
      expect(find.text('САМБАРТ БАЙРЛАХ ТОНОГЛОЛ (1)'), findsOneWidget);
      expect(find.textContaining('RCD-1'), findsOneWidget);
    });

    testWidgets('a panel with nothing in it draws neither heading',
        (WidgetTester tester) async {
      await pumpScreen(tester, () => screen(device: _device()));

      // Absent rather than an empty card: a panel with no children recorded has nothing
      // to say, and two empty sections would read as a loading failure.
      expect(find.textContaining('ХЭЛХЭЭ ('), findsNothing);
      expect(find.textContaining('САМБАРТ БАЙРЛАХ ТОНОГЛОЛ ('), findsNothing);
    });

    testWidgets('mountedEquipment is read off the wire at all',
        (WidgetTester tester) async {
      // The field the model did not parse before this change. Asserted at the model so a
      // rendering test cannot be the only thing standing between a silent drop and a
      // regression.
      final ObjectDetailModel parsed = ObjectDetailModel.fromJson(
        _device(
          mountedEquipment: <Map<String, dynamic>>[
            _childJson(id: 'e1', code: 'RCD-1', name: 'Хамгаалалт'),
          ],
        ),
      );

      expect(parsed.mountedEquipment, hasLength(1));
      expect(parsed.mountedEquipment.single.code, 'RCD-1');
      // An older server that does not send the field leaves an empty list, not a crash.
      expect(ObjectDetailModel.fromJson(_device()).mountedEquipment, isEmpty);
    });
  });
}
