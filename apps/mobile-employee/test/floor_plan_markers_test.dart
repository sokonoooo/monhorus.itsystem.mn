// The floor plan's device markers, asserted as geometry rather than as presence.
//
// A test that only checked "a marker exists" would have passed against the bug this
// file was written for. `AuthenticatedImage` used to paint into a fixed-height box with
// `BoxFit.contain`, so the drawing was letterboxed inside the widget: a 400x100 plan in
// a 210-tall box left ~56px bars above and below it. A marker placed at `y * boxHeight`
// then landed tens of pixels off the plan it was supposed to point at, and looked
// perfectly plausible. So the assertions below pin the painted rectangle's own aspect
// ratio and then the marker's centre against that rectangle.
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
import 'package:monhorus_employee/features/employee/project/domain/entities/object_enums.dart';
import 'package:monhorus_employee/features/employee/project/domain/entities/risk_level.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_employee/features/employee/project/presentation/screens/floor_detail_screen.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/authenticated_image.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/floor_plan_markers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/project_ui.dart';

const String _floorId = '6d0000000000000000000002';
const String _planFileId = '6f0000000000000000000009';

/// A plan four times wider than it is tall.
///
/// Deliberately nothing like the shape of the box it is drawn into: a widget sized by a
/// fixed height would have an obviously different ratio, so the assertion on the painted
/// rectangle cannot pass by coincidence.
const int _planWidth = 400;
const int _planHeight = 100;

/// Real PNG bytes, so the decoder — and therefore the intrinsic size the layout is built
/// from — is genuinely exercised. Must be built inside [WidgetTester.runAsync]: encoding
/// an image goes through the engine, which the fake-async test clock does not drive.
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

Map<String, dynamic> _floorJson() => <String, dynamic>{
      'id': _floorId,
      'code': 'F2',
      'name': '2-р давхар',
      'buildingId': '6b0000000000000000000001',
      'buildingName': 'Төв байр',
      'projectId': '6c0000000000000000000001',
      'projectName': 'Урьдчилан сэргийлэх үйлчилгээ',
      'customerId': '6a67013e11b34f68bfc4037f',
      'floorNumber': 2,
      'areaSqm': 640.5,
      'purpose': 'Оффис',
      'description': null,
      'isActive': true,
      'hasPlanImage': true,
      'objectCount': 3,
      'riskSummary': <String, dynamic>{
        'counts': <Map<String, dynamic>>[
          <String, dynamic>{'level': 'CRITICAL', 'count': 1},
        ],
        'unassessedCount': 1,
        'hasCritical': true,
        'lastAssessedAt': '2026-07-20T04:12:00.000Z',
      },
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
      'description': null,
      'uploadedByName': 'Админ',
      'uploadedAt': '2026-07-01T02:00:00.000Z',
    };

Map<String, dynamic> objectJson({
  required String id,
  required String code,
  Map<String, dynamic>? planPosition,
  Object? showOnPlan = true,
  String? riskLevel = 'CRITICAL',
  String? icon = 'PANEL',
}) =>
    <String, dynamic>{
      'id': id,
      'code': code,
      'name': 'Гэрэлтүүлгийн самбар',
      'category': 'PANEL',
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'code': 'DB',
        'name': 'Хуваарилах самбар',
        'icon': icon,
        'showOnPlan': showOnPlan,
      },
      'customerId': '6a67013e11b34f68bfc4037f',
      'customerName': 'Central Tower ХХК',
      'floorId': _floorId,
      'floorName': '2-р давхар',
      'buildingName': 'Төв байр',
      'planPosition': planPosition,
      'status': 'ACTIVE',
      'latestAssessment': riskLevel == null
          ? null
          : <String, dynamic>{
              'id': 'a1',
              'score': 38,
              'riskLevel': riskLevel,
              'assessedAt': '2026-07-20T02:00:00.000Z',
              'assessedByName': 'Дорж',
              'conclusion': null,
              'recommendation': null,
              'repairRequired': false,
              'revisitRequired': false,
              'revisitDate': null,
            },
      'calculatedLoad': <String, dynamic>{
        'valueKw': 18.5,
        'complete': true,
        'reasons': <dynamic>[],
      },
      'measuredLoadKw': null,
      'loadVariance': <String, dynamic>{
        'valueKw': null,
        'complete': false,
        'reasons': <dynamic>[],
      },
      'createdAt': '2026-01-04T00:00:00.000Z',
    };

/// The marker for one device code.
Finder _marker(String code) => find.byWidgetPredicate(
      (Widget widget) => widget is PlanMarker && widget.object.code == code,
    );

AppUser _technician() => const AppUser(
      id: 'u1',
      fullName: 'Дорж Ganbold',
      email: 'd.ganbold@monhorus.mn',
      role: UserRole.technician,
      status: AccountStatus.active,
      permissions: <String>{
        PermissionKeys.objectView,
        PermissionKeys.objectMasterView,
      },
    );

void main() {
  // The pumps below run in a real async zone (the image decoder needs one), which is
  // also the only condition under which google_fonts reaches for the network. It is
  // told not to: a test must not depend on fonts.gstatic.com being reachable.
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  Widget screen({
    required Uint8List bytes,
    required List<Map<String, dynamic>> objects,
    String mimeType = 'image/png',
  }) {
    return ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_technician()),
        floorDetailProvider(_floorId).overrideWith(
          (Ref ref) async => FloorModel.fromJson(_floorJson()),
        ),
        floorPlanProvider(_floorId).overrideWith(
          (Ref ref) async => FloorPlanModel.fromJson(_planJson(mimeType: mimeType)),
        ),
        floorObjectsProvider(_floorId).overrideWith(
          (Ref ref) async =>
              objects.map(ObjectListItemModel.fromJson).toList(growable: false),
        ),
        projectFileBytesProvider(_planFileId).overrideWith((Ref ref) async => bytes),
      ],
      child: const MaterialApp(
        home: FloorDetailScreen(
          floorId: _floorId,
          floorName: '2-р давхар',
          buildingName: 'Төв байр',
          projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
        ),
      ),
    );
  }

  /// Pumps in a real async zone and gives the image decoder time to land.
  ///
  /// `pumpAndSettle` is unavailable inside [WidgetTester.runAsync], and the decode is
  /// engine work the fake clock would never complete, so the frames are pumped by hand
  /// with a real delay between them. The tree is built inside the guarded zone as well,
  /// so the theme's font futures belong to it too.
  Future<void> pumpPlan(WidgetTester tester, Widget Function() build) async {
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
          // google_fonts cannot load a typeface offline and throws. The typeface has no
          // bearing on where a dot lands; anything else is rethrown.
          if (error.toString().contains('font')) return;
          if (!done.isCompleted) done.completeError(error, stack);
        },
      ));
      await done.future;
    });
  }

  /// The rectangle the plan is actually painted into.
  Rect paintedPlan(WidgetTester tester) => tester.getRect(
        find.descendant(
          of: find.byType(AuthenticatedImage),
          matching: find.byType(Image),
        ),
      );

  testWidgets('the plan is painted at its own aspect ratio, with no letterbox',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.25},
          ),
        ],
      ),
    );

    final Rect plan = paintedPlan(tester);
    // The box the marker layer is measured against IS the drawing. Were the plan still
    // letterboxed inside a 210-tall box, this ratio would read about 1.9.
    expect(
      plan.width / plan.height,
      closeTo(_planWidth / _planHeight, 0.02),
      reason: 'the widget box must coincide with the painted image',
    );
  });

  testWidgets('a marker is centred on its fraction of the painted plan',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.25},
          ),
          objectJson(
            id: 'o2',
            code: 'LDB-2',
            planPosition: <String, dynamic>{'x': 0.0, 'y': 1.0},
            riskLevel: null,
          ),
        ],
      ),
    );

    final Rect plan = paintedPlan(tester);
    // Restated here, because everything below measures against this rectangle: if the
    // box were not the drawing, the offsets would agree with each other and with
    // nothing on the plan.
    expect(plan.width / plan.height, closeTo(_planWidth / _planHeight, 0.02));
    expect(find.byType(PlanMarker), findsNWidgets(2));

    final Rect middle = tester.getRect(_marker('LDB-1'));
    expect(middle.center.dx, closeTo(plan.left + plan.width * 0.5, 0.5));
    expect(middle.center.dy, closeTo(plan.top + plan.height * 0.25, 0.5));
    // A dot, not a pill: the marker is as wide as it is tall.
    expect(middle.width, closeTo(kPlanMarkerDiameter, 0.01));
    expect(middle.height, closeTo(kPlanMarkerDiameter, 0.01));

    // The corner case: 0,1 is the bottom-left of the drawing, and the marker straddles
    // it rather than being tucked inside the edge.
    final Rect corner = tester.getRect(_marker('LDB-2'));
    expect(corner.center.dx, closeTo(plan.left, 0.5));
    expect(corner.center.dy, closeTo(plan.bottom, 0.5));
  });

  testWidgets('tapping a marker opens the device detail',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-2F-02',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    expect(find.byType(DeviceDetailScreen), findsNothing);
    await tester.tap(_marker('LDB-2F-02'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.byType(DeviceDetailScreen), findsOneWidget);
  });

  testWidgets('an unplaced device, and a type not shown on the plan, draw nothing',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          // Placed, but its type is not meant to appear on a drawing.
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            showOnPlan: false,
          ),
          // Shown on the plan, but never placed.
          objectJson(id: 'o2', code: 'LDB-2'),
          // Placed out of range, which is not a position at all.
          objectJson(
            id: 'o3',
            code: 'LDB-3',
            planPosition: <String, dynamic>{'x': 1.4, 'y': 0.5},
          ),
        ],
      ),
    );

    // The plan itself is up — so this is not passing merely because nothing rendered.
    expect(find.byType(AuthenticatedImage), findsOneWidget);
    expect(paintedPlan(tester).width, greaterThan(0));
    expect(find.byType(PlanMarker), findsNothing);

    // Two of the three belong on the plan and are not on it, and the caption says so.
    expect(find.textContaining('Планд байрлуулаагүй 2 төхөөрөмж'), findsOneWidget);
  });

  testWidgets('a PDF plan keeps its notice and draws no markers',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        mimeType: 'application/pdf',
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    expect(find.textContaining('зураг биш файл'), findsOneWidget);
    expect(find.byType(PlanMarker), findsNothing);
    expect(find.byType(AuthenticatedImage), findsNothing);
  });

  /// The [IconData] a marker actually draws.
  IconData? glyphOf(WidgetTester tester, String code) => tester
      .widget<Icon>(
        find.descendant(of: _marker(code), matching: find.byType(Icon)),
      )
      .icon;

  /// Pinches the plan about its centre by [factor], and leaves the fingers down.
  ///
  /// Two pointers rather than one: a magnification is a two-finger gesture, and driving
  /// it with a synthesised scale on the controller would test the arithmetic without
  /// testing that a pinch reaches it at all.
  ///
  /// The realised scale is a little under [factor] — the gesture recogniser eats the
  /// first few pixels of separation as slop before it starts reporting one — so the
  /// assertions below compare the plan and its markers against each other rather than
  /// against a number predicted here.
  Future<List<TestGesture>> pinch(
    WidgetTester tester, {
    required double factor,
  }) async {
    final Offset centre = paintedPlan(tester).center;
    const double reach = 30;
    final TestGesture left =
        await tester.startGesture(centre - const Offset(reach, 0));
    final TestGesture right =
        await tester.startGesture(centre + const Offset(reach, 0));
    // Moved in steps: the recogniser needs more than one sample to establish a span,
    // and a single teleporting move is not a pinch anyone can perform.
    for (int step = 1; step <= 4; step++) {
      final double span = reach * (1 + (factor - 1) * step / 4);
      await left.moveTo(centre - Offset(span, 0));
      await right.moveTo(centre + Offset(span, 0));
      await tester.pump();
    }
    return <TestGesture>[left, right];
  }

  Future<void> release(WidgetTester tester, List<TestGesture> fingers) async {
    for (final TestGesture finger in fingers) {
      await finger.up();
    }
    await tester.pump();
  }

  testWidgets('a pinch magnifies the plan and its markers together',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.25},
          ),
        ],
      ),
    );

    final Rect planBefore = paintedPlan(tester);
    final Rect markerBefore = tester.getRect(_marker('LDB-1'));
    expect(markerBefore.width, closeTo(kPlanMarkerDiameter, 0.01));

    final List<TestGesture> fingers = await pinch(tester, factor: 2.5);
    final Rect planAfter = paintedPlan(tester);
    final Rect markerAfter = tester.getRect(_marker('LDB-1'));
    await release(tester, fingers);

    // The drawing genuinely grew. Loose, because the slop the recogniser eats is not
    // this test's business — what matters is that a pinch magnifies at all.
    final double grewBy = planAfter.width / planBefore.width;
    expect(grewBy, greaterThan(1.4));

    // And the marker grew by exactly as much. This is the whole claim of drawing the
    // overlay inside the transform rather than beside it: a marker that scaled by some
    // other factor would drift off its point the further in the reader zoomed.
    expect(
      markerAfter.width / markerBefore.width,
      closeTo(grewBy, 0.01),
      reason: 'a marker must magnify with the drawing it sits on',
    );

    // The point it names is still the point it names. Measured against the magnified
    // rectangle, so this fails if the marker is left behind by the pan the pinch
    // applied as well as if it is mis-scaled.
    expect(markerAfter.center.dx, closeTo(planAfter.left + planAfter.width * 0.5, 0.6));
    expect(markerAfter.center.dy, closeTo(planAfter.top + planAfter.height * 0.25, 0.6));
  });

  testWidgets('the plan cannot be pinched smaller than the box it fits',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    final Rect before = paintedPlan(tester);
    final List<TestGesture> fingers = await pinch(tester, factor: 0.2);
    final Rect after = paintedPlan(tester);
    await release(tester, fingers);

    // A plan shrunk inside its own frame is a drawing floating in empty space, and
    // `minScale` is what refuses it. Equal, not merely "not much smaller".
    expect(after.width, closeTo(before.width, 0.01));
    expect(after.left, closeTo(before.left, 0.01));
  });

  testWidgets('a magnified marker still opens its device',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-2F-02',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    final List<TestGesture> fingers = await pinch(tester, factor: 2.5);
    await release(tester, fingers);

    // Hit testing through the viewer's matrix, not around it: a transform that moved
    // the paint but not the touch target would leave every marker on a zoomed plan
    // opening the wrong device, or nothing at all.
    expect(find.byType(DeviceDetailScreen), findsNothing);
    await tester.tap(_marker('LDB-2F-02'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.byType(DeviceDetailScreen), findsOneWidget);
  });

  testWidgets('the page still scrolls when the drag starts on the plan',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    // A page with room to scroll. One placed device and a dozen unplaced ones: the
    // rows make the list longer than the window, without putting a dozen markers on a
    // 100px-tall drawing. With a short page the scroll runs out after a few dozen
    // pixels and any drag looks equally absorbed, which would make this test agree with
    // itself no matter what the viewer did.
    final List<Map<String, dynamic>> objects = <Map<String, dynamic>>[
      objectJson(
        id: 'o1',
        code: 'LDB-1',
        planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
      ),
      for (int i = 2; i <= 13; i++) objectJson(id: 'o$i', code: 'LDB-$i'),
    ];

    await pumpPlan(tester, () => screen(bytes: bytes, objects: objects));

    /// How far the page scrolls when a drag of [by] starts on [target].
    Future<double> scrolledBy(Finder target, double by) async {
      final double before = tester.getTopLeft(find.byType(AuthenticatedImage)).dy;
      await tester.drag(target, Offset(0, by));
      await tester.pump();
      return before - tester.getTopLeft(find.byType(AuthenticatedImage)).dy;
    }

    final double overPlan = await scrolledBy(find.byType(AuthenticatedImage), -140);
    // Back to the top, so the control drag below starts from the same place.
    await scrolledBy(find.byType(SectionHeading).first, 400);
    final double overList = await scrolledBy(find.byType(SectionHeading).first, -140);

    // The plan is as tall as its card and sits in the middle of a scrolling page, so a
    // viewer that swallowed every vertical drag would leave a dead stripe a reader has
    // to flick around to get past. It does not: the list's drag recogniser reaches its
    // 18px slop before the viewer's scale recogniser reaches the wider pan slop, and so
    // wins an unambiguously vertical one-finger drag. A pinch is unaffected — two
    // fingers are not a drag, and nothing in the list competes for them.
    expect(overPlan, greaterThan(100));

    // Not quite pixel-for-pixel with a drag that starts anywhere else, and the gap is
    // bounded rather than asserted away: over the plan the two recognisers are in a
    // live arena, and the pixels travelled before it resolves are not scrolled. Over
    // the list nothing is contesting, so the scroll starts immediately. One drag slop
    // is the whole of the difference — a real reader flicking a page does not see it,
    // and a regression that handed the drag to the viewer instead would blow straight
    // through this bound rather than trimming a slop off it.
    expect(
      overList - overPlan,
      inInclusiveRange(0, kDragSlopDefault),
      reason: 'the plan must not scroll materially differently from the page',
    );
  });

  testWidgets('each marker draws its own object type, and the types differ',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'PNL-1',
            icon: 'PANEL',
            planPosition: <String, dynamic>{'x': 0.2, 'y': 0.5},
          ),
          objectJson(
            id: 'o2',
            code: 'LMP-1',
            icon: 'LIGHT',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
          objectJson(
            id: 'o3',
            code: 'CAM-1',
            icon: 'CAMERA',
            planPosition: <String, dynamic>{'x': 0.8, 'y': 0.5},
          ),
          // A type key this build has never heard of. It must draw the catch-all rather
          // than an empty circle or a crash: the registry is administrator-editable and
          // will outgrow this enum.
          objectJson(
            id: 'o4',
            code: 'NEW-1',
            icon: 'FLUX_CAPACITOR',
            planPosition: <String, dynamic>{'x': 0.9, 'y': 0.9},
          ),
        ],
      ),
    );

    expect(glyphOf(tester, 'PNL-1'), ObjectIcon.panel.glyph);
    expect(glyphOf(tester, 'LMP-1'), ObjectIcon.light.glyph);
    expect(glyphOf(tester, 'CAM-1'), ObjectIcon.camera.glyph);
    expect(glyphOf(tester, 'NEW-1'), ObjectIcon.other.glyph);

    // The point of the whole change: three types, three different symbols. Asserting
    // each glyph individually would still pass if the enum mapped every value to the
    // same picture, which is exactly the failure a reader would report.
    expect(
      <IconData?>{
        glyphOf(tester, 'PNL-1'),
        glyphOf(tester, 'LMP-1'),
        glyphOf(tester, 'CAM-1'),
      },
      hasLength(3),
      reason: 'objects of different types must be told apart on the plan',
    );
  });

  testWidgets('a marker names its type and its band to a screen reader',
      (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LMP-1',
            icon: 'LIGHT',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    // Colour is now the band's only visual channel on the plan, so the words matter
    // more than they did: the label has to carry what the picture stopped saying.
    expect(
      find.bySemanticsLabel(
        RegExp('LMP-1.*${ObjectIcon.light.label}.*${RiskLevel.critical.label}'),
      ),
      findsOneWidget,
    );
    handle.dispose();
  });

  /// A magnified plan pans on both axes, and the vertical half of that is the whole
  /// reason [kPlanZoomedTouchSlop] exists.
  ///
  /// Nothing in the app arbitrates this: it falls out of the gesture arena, and by
  /// default the enclosing list wins a vertical drag because its recogniser resolves at
  /// an 18px slop while the viewer's needs 36. Halving the slop inside the plan's
  /// subtree while it is magnified reverses that. Asserted on both axes because the two
  /// are decided by entirely different things — sideways the list never competes at
  /// all, so it would keep working even if the slop override were deleted.
  testWidgets('a magnified plan pans in both directions', (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;
    await pumpPlan(
      tester,
      () => screen(bytes: bytes, objects: <Map<String, dynamic>>[
        objectJson(
          id: 'o1',
          code: 'LDB-1',
          planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
        ),
        for (int i = 2; i <= 13; i++) objectJson(id: 'o$i', code: 'LDB-$i'),
      ]),
    );

    final List<TestGesture> fingers = await pinch(tester, factor: 3);
    await release(tester, fingers);

    /// The viewer's current pan, as (x, y). Read off the matrix rather than inferred
    /// from the painted rectangle, so a page scroll that moves the whole card cannot be
    /// mistaken for the plan panning inside it — which is the exact confusion this test
    /// exists to resolve.
    (double, double) pan() {
      final Matrix4 matrix = tester
          .widget<InteractiveViewer>(find.byType(InteractiveViewer))
          .transformationController!
          .value;
      return (matrix.getTranslation().x, matrix.getTranslation().y);
    }

    final Rect magnified = paintedPlan(tester);
    expect(magnified.width, greaterThan(tester.getSize(find.byType(AuthenticatedImage)).width));

    // Sideways: the drawing moves under the finger. Started off the marker sitting at
    // 0.5/0.5 — a drag beginning on a marker is a different gesture negotiation, and
    // this test is about the plan, not about that.
    final double sidewaysBefore = pan().$1;
    final Offset from = magnified.center + const Offset(0, -20);
    final TestGesture drag = await tester.startGesture(from);
    for (int step = 1; step <= 6; step++) {
      await drag.moveTo(from + Offset(-15.0 * step, 0));
      await tester.pump();
    }
    await drag.up();
    await tester.pump();
    expect(
      pan().$1,
      lessThan(sidewaysBefore - 20),
      reason: 'a sideways drag on a magnified plan must pan it',
    );

    // Vertically: the drawing slides inside a frame that stays where it is. Both halves
    // are asserted, because "the plan panned" and "the page did not scroll" are
    // different claims and the failure that matters — the page scrolling and carrying
    // the plan along with it — reads as movement on any test that only checks one.
    final double upBefore = pan().$2;
    final double pageBefore = tester.getTopLeft(find.byType(AuthenticatedImage)).dy;
    final Offset downFrom = paintedPlan(tester).center + const Offset(40, 0);
    final TestGesture up = await tester.startGesture(downFrom);
    for (int step = 1; step <= 6; step++) {
      await up.moveTo(downFrom + Offset(0, -10.0 * step));
      await tester.pump();
    }
    await up.up();
    await tester.pump();

    expect(
      pan().$2,
      lessThan(upBefore - 10),
      reason: 'an upward drag on a magnified plan must pan it upward',
    );
    expect(
      tester.getTopLeft(find.byType(AuthenticatedImage)).dy,
      closeTo(pageBefore, 0.01),
      reason: 'the plan took the drag, so the page did not scroll',
    );
  });

  testWidgets('the floor plan is the only surface that got a zoom',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    // One viewer, and exactly one, so this is a real assertion about which surface got
    // it rather than a count of nothing.
    expect(find.byType(InteractiveViewer), findsOneWidget);
    // `zoomable` defaults off, which is what keeps every other picture in the app —
    // device photographs, and the read-only fault plan on a service request — exactly
    // as it was. The default is the thing that must not drift.
    expect(
      const AuthenticatedImage.sizedToImage(fileId: 'f1').zoomable,
      isFalse,
    );
  });

  group('planPosition', () {
    test('parses the normalised fraction the plan editor stored', () {
      final ObjectListItemModel object = ObjectListItemModel.fromJson(
        objectJson(
          id: 'o1',
          code: 'LDB-1',
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
      );

      expect(object.planPosition, const PlanPositionModel(x: 0.25, y: 0.75));
      expect(object.objectType!.showOnPlan, isTrue);
    });

    test('accepts the exact corners, which are legal positions', () {
      expect(
        PlanPositionModel.fromJson(<String, dynamic>{'x': 0, 'y': 1}),
        const PlanPositionModel(x: 0, y: 1),
      );
    });

    test('rejects a malformed or out-of-range coordinate instead of crashing', () {
      // Each of these is a value the app must survive: it costs one unplaced marker.
      const List<Object?> refused = <Object?>[
        null,
        'nowhere',
        <String, dynamic>{'x': 0.5},
        <String, dynamic>{'x': '0.5', 'y': '0.5'},
        <String, dynamic>{'x': 1.4, 'y': 0.5},
        <String, dynamic>{'x': -0.01, 'y': 0.5},
        <String, dynamic>{'x': double.nan, 'y': 0.5},
        <String, dynamic>{'x': double.infinity, 'y': 0.5},
      ];

      for (final Object? value in refused) {
        expect(
          ObjectListItemModel.fromJson(
            objectJson(
              id: 'o1',
              code: 'LDB-1',
              planPosition: value is Map<String, dynamic> ? value : null,
            ),
          ).planPosition,
          isNull,
          reason: 'expected $value to be refused',
        );
        expect(PlanPositionModel.fromJson(value), isNull);
      }
    });

    test('showOnPlan reads false when the server did not send it', () {
      final ObjectListItemModel object = ObjectListItemModel.fromJson(
        objectJson(
          id: 'o1',
          code: 'LDB-1',
          planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          showOnPlan: null,
        ),
      );

      // An older server means "not on the plan", never "draw it anyway".
      expect(object.objectType!.showOnPlan, isFalse);
    });

    test('planMarkersOf paints the worst band last, so it lands on top', () {
      final List<ObjectListItemModel> objects = <Map<String, dynamic>>[
        objectJson(
          id: 'o1',
          code: 'WORST',
          planPosition: <String, dynamic>{'x': 0.1, 'y': 0.1},
          riskLevel: 'OUT_OF_SERVICE',
        ),
        objectJson(
          id: 'o2',
          code: 'NONE',
          planPosition: <String, dynamic>{'x': 0.2, 'y': 0.2},
          riskLevel: null,
        ),
        objectJson(
          id: 'o3',
          code: 'FINE',
          planPosition: <String, dynamic>{'x': 0.3, 'y': 0.3},
          riskLevel: 'NORMAL',
        ),
      ].map(ObjectListItemModel.fromJson).toList();

      expect(
        planMarkersOf(objects).map((ObjectListItemModel o) => o.code),
        <String>['NONE', 'FINE', 'WORST'],
      );
      expect(unplacedOnPlanCount(objects), 0);
    });
  });
}
