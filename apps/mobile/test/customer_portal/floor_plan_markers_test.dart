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
import 'package:monhorus_mobile/features/customer_portal/data/models/object_master_model.dart';
import 'package:monhorus_mobile/features/customer_portal/data/models/project_model.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/object_master_enums.dart';
import 'package:monhorus_mobile/features/customer_portal/domain/entities/risk_level.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/providers/customer_portal_providers.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/device_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/screens/floor_detail_screen.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/authenticated_image.dart';
import 'package:monhorus_mobile/features/customer_portal/presentation/widgets/floor_plan_markers.dart';

import 'fakes.dart';

const String _floorId = '6d0000000000000000000002';
const String _planFileId = '6f0000000000000000000009';

/// A plan four times wider than it is tall.
///
/// Deliberately nothing like the shape of the box it is drawn into: a widget sized by
/// a fixed height would have an obviously different ratio, so the assertion on the
/// painted rectangle cannot pass by coincidence.
const int _planWidth = 400;
const int _planHeight = 100;

/// Real PNG bytes, so the decoder - and therefore the intrinsic size the layout is
/// built from - is genuinely exercised. Must be built inside [WidgetTester.runAsync]:
/// encoding an image goes through the engine, which the fake-async test clock does not
/// drive.
Future<Uint8List> _planBytes({int width = _planWidth, int height = _planHeight}) async {
  final ui.PictureRecorder recorder = ui.PictureRecorder();
  final Canvas canvas = Canvas(recorder);
  canvas.drawRect(
    Rect.fromLTWH(0, 0, width.toDouble(), height.toDouble()),
    Paint()..color = const Color(0xFFE8EDF2),
  );
  final ui.Picture picture = recorder.endRecording();
  final ui.Image image = await picture.toImage(width, height);
  final ByteData? data = await image.toByteData(format: ui.ImageByteFormat.png);
  image.dispose();
  picture.dispose();
  return data!.buffer.asUint8List();
}

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
      'uploadedById': null,
      'uploadedByName': 'Админ',
      'uploadedAt': '2026-07-01T02:00:00.000Z',
      'updatedAt': '2026-07-01T02:00:00.000Z',
    };

Map<String, dynamic> _objectJson({
  required String id,
  required String code,
  Map<String, dynamic>? planPosition,
  bool showOnPlan = true,
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
      'customerId': testCustomerId,
      'customerName': testCustomerName,
      'floorId': _floorId,
      'floorName': '2-р давхар',
      'buildingName': 'Төв цамхаг',
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

/// The marker for one object code.
Finder _marker(String code) => find.byWidgetPredicate(
      (Widget widget) => widget is PlanMarker && widget.object.code == code,
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
    return wrapCustomerScreen(
      const FloorDetailScreen(
        floorId: _floorId,
        buildingId: '6b0000000000000000000001',
        buildingName: 'Төв цамхаг',
        projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
      ),
      repository: FakeCustomerPortalRepository(),
      overrides: <Override>[
        floorProvider(_floorId).overrideWith((Ref ref) async => floorFixture()),
        floorPlanProvider(_floorId).overrideWith(
          (Ref ref) async => FloorPlanModel.fromJson(_planJson(mimeType: mimeType)),
        ),
        floorObjectsProvider(_floorId).overrideWith(
          (Ref ref) async => objects
              .map(ObjectListItemModel.fromJson)
              .toList(growable: false),
        ),
        fileBytesProvider(_planFileId).overrideWith((Ref ref) async => bytes),
      ],
    );
  }

  /// Pumps in a real async zone and gives the image decoder time to land.
  ///
  /// `pumpAndSettle` is unavailable inside [WidgetTester.runAsync], and the decode is
  /// engine work that the fake clock would never complete, so the frames are pumped by
  /// hand with a real delay between them.
  Future<void> pumpPlan(WidgetTester tester, Widget Function() build) async {
    tester.view.physicalSize = const Size(1170, 2532);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await tester.runAsync(() async {
      final Completer<void> done = Completer<void>();
      // Guarded, because a real async zone is also the only condition under which
      // google_fonts reaches for fonts.gstatic.com, and it throws when it cannot. The
      // typeface has no bearing on where a dot lands; anything else is rethrown.
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
          _objectJson(
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
          _objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.25},
          ),
          _objectJson(
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
          _objectJson(
            id: '6e0000000000000000000003',
            code: 'LDB-2F-02',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    expect(find.byType(DeviceDetailScreen), findsNothing);
    await tester.tap(find.byType(PlanMarker));
    await tester.pumpAndSettle();

    expect(find.byType(DeviceDetailScreen), findsOneWidget);
  });

  testWidgets('an unplaced object, and a type not shown on the plan, draw nothing',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          // Placed, but its type is not meant to appear on a drawing.
          _objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            showOnPlan: false,
          ),
          // Shown on the plan, but never placed.
          _objectJson(id: 'o2', code: 'LDB-2'),
          // Placed out of range, which is not a position at all.
          _objectJson(
            id: 'o3',
            code: 'LDB-3',
            planPosition: <String, dynamic>{'x': 1.4, 'y': 0.5},
          ),
        ],
      ),
    );

    // The plan itself is up - so this is not passing merely because nothing rendered.
    expect(find.byType(AuthenticatedImage), findsOneWidget);
    expect(paintedPlan(tester).width, greaterThan(0));
    expect(find.byType(PlanMarker), findsNothing);

    // Two of the three belong on the plan and are not on it, and the caption says so.
    expect(find.textContaining('Планд байрлуулаагүй 2 объект'), findsOneWidget);
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
          _objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    expect(find.textContaining('файл зураг биш'), findsOneWidget);
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
  /// The realised scale is a little under [factor] — the recogniser eats the first few
  /// pixels of separation as slop before it starts reporting one — so the assertions
  /// below compare the plan and its markers against each other rather than against a
  /// number predicted here.
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
          _objectJson(
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

    final double grewBy = planAfter.width / planBefore.width;
    expect(grewBy, greaterThan(1.4));

    // The marker grew by exactly as much. This is the whole claim of drawing the
    // overlay inside the transform rather than beside it: a marker that scaled by some
    // other factor would drift off its point the further in the reader zoomed.
    expect(
      markerAfter.width / markerBefore.width,
      closeTo(grewBy, 0.01),
      reason: 'a marker must magnify with the drawing it sits on',
    );

    // The point it names is still the point it names, measured against the magnified
    // rectangle.
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
          _objectJson(
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

  testWidgets('a magnified marker still opens its object',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          _objectJson(
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
    // opening the wrong object, or nothing at all.
    expect(find.byType(DeviceDetailScreen), findsNothing);
    await tester.tap(_marker('LDB-2F-02'));
    await tester.pump();
    await tester.pump(const Duration(seconds: 1));

    expect(find.byType(DeviceDetailScreen), findsOneWidget);
  });

  testWidgets('each marker draws its own object type, and the types differ',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          _objectJson(
            id: 'o1',
            code: 'PNL-1',
            icon: 'PANEL',
            planPosition: <String, dynamic>{'x': 0.2, 'y': 0.5},
          ),
          _objectJson(
            id: 'o2',
            code: 'LMP-1',
            icon: 'LIGHT',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
          _objectJson(
            id: 'o3',
            code: 'CAM-1',
            icon: 'CAMERA',
            planPosition: <String, dynamic>{'x': 0.8, 'y': 0.5},
          ),
          // A type key this build has never heard of. It must draw the catch-all rather
          // than an empty circle or a crash: the registry is administrator-editable and
          // will outgrow this enum.
          _objectJson(
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
          _objectJson(
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
    //
    // Matched on the object's name rather than its code, because this app's
    // `titleLine` is "name · type" — the customer portal names things, where the
    // employee app leads with the code a technician reads off the equipment.
    expect(
      find.bySemanticsLabel(
        RegExp('Гэрэлтүүлгийн самбар.*${ObjectIcon.light.label}'
            '.*${RiskLevel.critical.label}'),
      ),
      findsOneWidget,
    );
    handle.dispose();
  });

  testWidgets('the plan the request sheet pins on is deliberately not zoomable',
      (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpPlan(
      tester,
      () => screen(
        bytes: bytes,
        objects: <Map<String, dynamic>>[
          _objectJson(
            id: 'o1',
            code: 'LDB-1',
            planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          ),
        ],
      ),
    );

    // The floor's own plan zooms — one viewer, and exactly one, so this is a real
    // assertion about which surface got it rather than a count of nothing.
    expect(find.byType(InteractiveViewer), findsOneWidget);
    // `zoomable` defaults off, which is what keeps the request sheet's tap-to-place
    // plan out of this. Asserted at the constructor because that sheet lives in
    // another test file, and the default is the thing that must not drift.
    expect(
      const AuthenticatedImage.sizedToImage(fileId: 'f1').zoomable,
      isFalse,
      reason: 'a plan that places a pin by being tapped must not also pan',
    );
  });
}
