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
import 'dart:convert';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';
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
  Object? iconUrl,
  String typeName = 'Хуваарилах самбар',
}) =>
    <String, dynamic>{
      'id': id,
      'code': code,
      'name': 'Гэрэлтүүлгийн самбар',
      'category': 'PANEL',
      'objectType': <String, dynamic>{
        'id': 'ot1',
        'code': 'DB',
        'name': typeName,
        'icon': icon,
        // Null for the ordinary type, which is what the server sends for all but the
        // handful an administrator has uploaded artwork for.
        'iconUrl': iconUrl,
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
    Map<String, Uint8List> icons = const <String, Uint8List>{},
    Set<String> refused = const <String>{},
    List<String>? fetches,
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
        // The whole family rather than one instance, so an icon is fetched through the
        // same provider the plan is — which is the claim the caching test rests on.
        // Every call is recorded, so "one request for forty markers" is measured rather
        // than assumed.
        fileBytesProvider.overrideWith((Ref ref, String fileId) async {
          fetches?.add(fileId);
          if (fileId == _planFileId) return bytes;
          if (refused.contains(fileId)) {
            throw Exception('the server refused $fileId');
          }
          final Uint8List? icon = icons[fileId];
          if (icon != null) return icon;
          throw Exception('no fixture for $fileId');
        }),
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

  testWidgets('a pinch magnifies the plan but not the markers on it',
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

    // The marker did not. A marker is a label on a point rather than a thing on the
    // floor with a size of its own, so it holds one size on screen and only the drawing
    // under it grows — which is what actually pulls two overlapping dots apart. Without
    // the counter-scale this would read the same multiple as the plan.
    expect(
      markerAfter.width,
      closeTo(markerBefore.width, 0.5),
      reason: 'a marker must keep its size on screen at any magnification',
    );
    expect(markerAfter.width, closeTo(kPlanMarkerDiameter, 0.5));
    expect(markerAfter.height, closeTo(kPlanMarkerDiameter, 0.5));

    // And it is still nailed to its coordinate. Measured against the magnified
    // rectangle, so this fails if shrinking the dot walked it off its point, and fails
    // if the marker was left behind by the pan the pinch applied.
    expect(markerAfter.center.dx, closeTo(planAfter.left + planAfter.width * 0.5, 0.6));
    expect(markerAfter.center.dy, closeTo(planAfter.top + planAfter.height * 0.25, 0.6));
  });

  testWidgets('a marker is the same size on screen at every magnification',
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

    /// The marker's size and its offset within the plan, as fractions, at whatever
    /// magnification the plan is currently at.
    (double, double, double) sample() {
      final Rect plan = paintedPlan(tester);
      final Rect marker = tester.getRect(_marker('LDB-1'));
      return (
        marker.width,
        (marker.center.dx - plan.left) / plan.width,
        (marker.center.dy - plan.top) / plan.height,
      );
    }

    final (double, double, double) fitted = sample();

    final List<TestGesture> gentle = await pinch(tester, factor: 2);
    final (double, double, double) near = sample();
    await release(tester, gentle);

    final List<TestGesture> hard = await pinch(tester, factor: 4);
    final (double, double, double) far = sample();
    await release(tester, hard);

    // Three different magnifications — and the third is reached by pinching again on an
    // already-magnified plan, so this also covers the compounding case.
    for (final (double, double, double) reading in <(double, double, double)>[
      fitted,
      near,
      far,
    ]) {
      expect(
        reading.$1,
        closeTo(kPlanMarkerDiameter, 0.5),
        reason: 'the marker must be $kPlanMarkerDiameter across at every zoom',
      );
      // Still over 0.5/0.5 of the drawing, whatever the drawing is currently sized at.
      expect(reading.$2, closeTo(0.5, 0.01));
      expect(reading.$3, closeTo(0.5, 0.01));
    }
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
        _objectJson(
          id: 'o1',
          code: 'LDB-1',
          planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
        ),
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
    expect(
      magnified.width,
      greaterThan(tester.getSize(find.byType(AuthenticatedImage)).width),
    );

    // Sideways. Started off the marker sitting at 0.5/0.5 — a drag beginning on a
    // marker is a different gesture negotiation, and this test is about the plan.
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

  /// An object type's own uploaded artwork, drawn instead of a built-in glyph.
  ///
  /// The registry is administrator-editable and this build ships fourteen fixed keys, so
  /// every type created after a release used to land on the same generic silhouette —
  /// which is the whole "markers are hard to tell apart" complaint. These pin the path
  /// that lets a type added next month draw correctly with no app release at all.
  group('custom object type icons', () {
    const String iconFileId = '6f00000000000000000000aa';
    const String iconPath = '/api/v1/files/$iconFileId';
    const String otherIconFileId = '6f00000000000000000000bb';
    const String otherIconPath = '/api/v1/files/$otherIconFileId';

    /// A minimal but genuine SVG, so flutter_svg's real parser runs.
    Uint8List svg({String path = 'M4 4 L20 20'}) => Uint8List.fromList(
          utf8.encode(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
            '<path d="$path" stroke="currentColor" stroke-width="2" fill="none"/>'
            '</svg>',
          ),
        );

    /// The uploaded picture a marker drew, or null where it fell back to a glyph.
    SvgPicture? customOf(WidgetTester tester, String code) {
      final Finder found =
          find.descendant(of: _marker(code), matching: find.byType(SvgPicture));
      return found.evaluate().isEmpty ? null : tester.widget<SvgPicture>(found);
    }

    testWidgets('a type with an uploaded icon draws it instead of the built-in glyph',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'CUSTOM-1',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      expect(customOf(tester, 'CUSTOM-1'), isNotNull);
      // Replaced, not stacked on top of: two glyphs in one 26px dot is a smudge.
      expect(
        find.descendant(of: _marker('CUSTOM-1'), matching: find.byType(Icon)),
        findsNothing,
      );
    });

    testWidgets('the uploaded icon is tinted with the risk band, not left as drawn',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'CUSTOM-1',
              iconUrl: iconPath,
              riskLevel: 'CRITICAL',
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      // The bug this treatment exists for, in both apps and on the web: an uploaded file
      // arrives in whatever palette it was drawn in, and an icon drawn in the catalogue's
      // own style — black line art — vanishes against a CRITICAL dot. `srcIn` keeps the
      // shape and takes the colour from the band, so a custom icon and a built-in one are
      // the same kind of thing on a marker.
      expect(
        customOf(tester, 'CUSTOM-1')!.colorFilter,
        ColorFilter.mode(RiskLevel.critical.tone.foreground, BlendMode.srcIn),
      );
    });

    testWidgets('a type with no uploaded icon still draws its built-in glyph',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;
      final List<String> fetches = <String>[];

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          fetches: fetches,
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'BUILTIN-1',
              icon: 'LIGHT',
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      expect(glyphOf(tester, 'BUILTIN-1'), ObjectIcon.light.glyph);
      expect(customOf(tester, 'BUILTIN-1'), isNull);
      // And nothing but the plan is fetched for a floor whose types carry no artwork.
      expect(fetches, <String>[_planFileId]);
    });

    testWidgets('one icon shared by many markers is fetched exactly once',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;
      final List<String> fetches = <String>[];

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          fetches: fetches,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            for (int i = 1; i <= 6; i++)
              _objectJson(
                id: 'o$i',
                code: 'CUSTOM-$i',
                iconUrl: iconPath,
                planPosition: <String, dynamic>{'x': 0.1 * i, 'y': 0.5},
              ),
          ],
        ),
      );

      expect(find.byType(PlanMarker), findsNWidgets(6));
      expect(customOf(tester, 'CUSTOM-6'), isNotNull);
      // Six markers of one type, one request. Keyed by file id and never auto-disposed,
      // so this holds for a floor of forty as well — and revisiting the floor costs none.
      expect(
        fetches.where((String id) => id == iconFileId),
        hasLength(1),
        reason: 'an icon must be fetched once and shared, not once per marker',
      );
    });

    testWidgets('two types with different uploads draw different pictures',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{
            iconFileId: svg(),
            otherIconFileId: svg(path: 'M12 2 A10 10 0 1 1 12 22'),
          },
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'A-1',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.3, 'y': 0.5},
            ),
            _objectJson(
              id: 'o2',
              code: 'B-1',
              iconUrl: otherIconPath,
              planPosition: <String, dynamic>{'x': 0.7, 'y': 0.5},
            ),
          ],
        ),
      );

      // Both drew their own file — which is the point of the whole feature, and the
      // thing a single-marker test cannot show.
      expect(customOf(tester, 'A-1'), isNotNull);
      expect(customOf(tester, 'B-1'), isNotNull);
      expect(
        customOf(tester, 'A-1')!.bytesLoader,
        isNot(equals(customOf(tester, 'B-1')!.bytesLoader)),
        reason: 'each type must draw its own artwork, not the first one fetched',
      );
    });

    testWidgets('a refused icon falls back to the built-in glyph',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          refused: <String>{iconFileId},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'GONE-1',
              icon: 'CAMERA',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      // A 404, a deleted file, an expired token: the marker is still a marker.
      expect(glyphOf(tester, 'GONE-1'), ObjectIcon.camera.glyph);
      expect(customOf(tester, 'GONE-1'), isNull);
    });

    testWidgets('bytes that are not SVG fall back rather than taking the plan down',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          // A PNG served where an SVG was promised. The parser will refuse it.
          icons: <String, Uint8List>{iconFileId: bytes},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'JUNK-1',
              icon: 'PUMP',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
            _objectJson(
              id: 'o2',
              code: 'FINE-1',
              icon: 'LIGHT',
              planPosition: <String, dynamic>{'x': 0.8, 'y': 0.5},
            ),
          ],
        ),
      );

      // The marker beside it is unharmed, which is the half that matters: one bad file
      // in the registry must cost one icon, not the floor.
      expect(find.byType(PlanMarker), findsNWidgets(2));
      expect(glyphOf(tester, 'FINE-1'), ObjectIcon.light.glyph);
      expect(paintedPlan(tester).width, greaterThan(0));
    });

    testWidgets('a malformed icon url is treated as no icon at all',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;
      final List<String> fetches = <String>[];

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          fetches: fetches,
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'BAD-URL',
              icon: 'SENSOR',
              iconUrl: '/api/v1/files/not-an-id',
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      // Refused before the request rather than after it: a path this build cannot read
      // an id out of is not worth a round trip that can only fail.
      expect(glyphOf(tester, 'BAD-URL'), ObjectIcon.sensor.glyph);
      expect(fetches, <String>[_planFileId]);
    });

    testWidgets('a marker drawn from an uploaded icon still opens its object',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: '6e0000000000000000000003',
              code: 'CUSTOM-TAP',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      // The picture must not eat the tap the dot underneath it is there to receive.
      expect(customOf(tester, 'CUSTOM-TAP'), isNotNull);
      expect(find.byType(DeviceDetailScreen), findsNothing);
      await tester.tap(_marker('CUSTOM-TAP'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));

      expect(find.byType(DeviceDetailScreen), findsOneWidget);
    });

    testWidgets('an uploaded icon holds its size against the zoom, like a glyph',
        (WidgetTester tester) async {
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'CUSTOM-1',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      final Rect before = tester.getRect(_marker('CUSTOM-1'));
      final List<TestGesture> fingers = await pinch(tester, factor: 3);
      final Rect after = tester.getRect(_marker('CUSTOM-1'));
      await release(tester, fingers);

      // The counter-scale is applied above the glyph, so it cannot matter which kind of
      // glyph it is — asserted anyway, because "cannot matter" is how regressions get in.
      expect(after.width, closeTo(before.width, 0.5));
      expect(after.width, closeTo(kPlanMarkerDiameter, 0.5));
    });

    testWidgets('the type registry names a custom type to a screen reader',
        (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final Uint8List bytes = (await tester.runAsync(_planBytes))!;

      await pumpPlan(
        tester,
        () => screen(
          bytes: bytes,
          icons: <String, Uint8List>{iconFileId: svg()},
          objects: <Map<String, dynamic>>[
            _objectJson(
              id: 'o1',
              code: 'CUSTOM-1',
              // A type invented long after this build shipped: its key falls back to the
              // catch-all, but it has a name of its own and that is what must be read.
              icon: 'FLUX_CAPACITOR',
              typeName: 'Нарны хавтан',
              iconUrl: iconPath,
              planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
            ),
          ],
        ),
      );

      // This app's `titleLine` is "name · type", so the registry's own name is already
      // in the label — the assertion is that it is, not that a slot was added for it.
      expect(
        find.bySemanticsLabel(RegExp('Гэрэлтүүлгийн самбар · Нарны хавтан')),
        findsOneWidget,
        reason: 'a new type must not be read out as "Бусад"',
      );
      handle.dispose();
    });
  });

  group('the code label', () {
    testWidgets('is hidden at fit and shown once the plan is magnified',
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

      Finder label() => find.descendant(
            of: _marker('LDB-2F-02'),
            matching: find.text('LDB-2F-02'),
          );

      // A whole floor in view is a field of dots, and forty codes over it is a mat.
      expect(label(), findsNothing);

      // Compounded, because one pinch does not clear the threshold: the recogniser eats
      // the first pixels of every gesture as slop.
      final List<TestGesture> first = await pinch(tester, factor: 3);
      await release(tester, first);
      final List<TestGesture> second = await pinch(tester, factor: 3);
      await release(tester, second);

      expect(
        tester
            .widget<InteractiveViewer>(find.byType(InteractiveViewer))
            .transformationController!
            .value
            .getMaxScaleOnAxis(),
        greaterThanOrEqualTo(kPlanCodeMinZoom),
        reason: 'the gesture must actually clear the threshold under test',
      );
      expect(
        label(),
        findsOneWidget,
        reason: 'a reader who has zoomed in is looking at a handful of markers',
      );
    });

    testWidgets('does not move the dot off its coordinate',
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

      final List<TestGesture> first = await pinch(tester, factor: 3);
      await release(tester, first);
      final List<TestGesture> second = await pinch(tester, factor: 3);
      await release(tester, second);

      final Rect plan = paintedPlan(tester);
      final Rect marker = tester.getRect(_marker('LDB-1'));

      // The label is hung off the side of the marker's box rather than sharing width
      // with it. Laid out as a row, the dot would be shoved left by half the code and
      // every marker on the plan would quietly stop pointing at its own coordinate.
      expect(marker.width, closeTo(kPlanMarkerDiameter, 0.5));
      expect(marker.center.dx, closeTo(plan.left + plan.width * 0.5, 0.6));
      expect(marker.center.dy, closeTo(plan.top + plan.height * 0.5, 0.6));
    });
  });
}
