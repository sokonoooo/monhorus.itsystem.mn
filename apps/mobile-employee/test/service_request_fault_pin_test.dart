// The fault pin on a service request, as the assigned technician sees it.
//
// The web portal has shown this since the customer app started collecting it; the
// employee app showed nothing at all, because `ServiceRequestDetailModel.fromJson`
// simply did not read `planPosition` off a DTO that has always sent it. A technician
// therefore got "3-р давхар" and had to find the panel at the far end of the corridor
// themselves.
//
// GEOMETRY, NOT PRESENCE. A test asserting only that a pin exists would pass against the
// bug the whole `sizedToImage` constructor was written to remove: with the picture
// letterboxed inside a fixed-height box, a mark placed at `y * boxHeight` lands tens of
// pixels off the drawing and looks entirely plausible. So the pin's centre is measured
// against the rectangle the plan is actually painted into.
//
// READ-ONLY. The coordinate is the customer's own statement of where their problem is.
// Nothing on this screen may move it, so the layer here carries no gesture recogniser
// and there is no clear control — asserted below, not merely intended.
import 'dart:async';
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:monhorus_employee/core/error/failure.dart';
import 'package:monhorus_employee/features/auth/domain/entities/app_user.dart';
import 'package:monhorus_employee/features/auth/presentation/providers/auth_provider.dart';
import 'package:monhorus_employee/features/employee/project/data/models/project_models.dart';
import 'package:monhorus_employee/features/employee/project/presentation/providers/project_providers.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/authenticated_image.dart';
import 'package:monhorus_employee/features/employee/project/presentation/widgets/floor_plan_markers.dart';
import 'package:monhorus_employee/features/employee/shared/service_request_models.dart';
import 'package:monhorus_employee/features/employee/work/domain/entities/work_identity.dart';
import 'package:monhorus_employee/features/employee/work/presentation/providers/work_providers.dart';
import 'package:monhorus_employee/features/employee/work/presentation/screens/service_request_detail_screen.dart';

const String _requestId = 'r1';
const String _floorId = 'fl1';
const String _planFileId = '6f0000000000000000000009';
const String _employeeId = 'emp-1';

/// A plan four times wider than it is tall.
///
/// Deliberately nothing like the shape of the box it is drawn into, so an assertion on
/// the painted rectangle cannot pass by coincidence.
const int _planWidth = 400;
const int _planHeight = 100;

const AppUser _technician = AppUser(
  id: 'u',
  fullName: 'Дорж Ganbold',
  email: 'd.ganbold@monhorus.mn',
  role: UserRole.technician,
  status: AccountStatus.active,
  permissions: <String>{
    'service_request.view',
    'service_request.update',
    'service_request.self_progress',
    'object.view',
  },
);

const ResolvedWorkIdentity _identity = ResolvedWorkIdentity(
  employeeId: _employeeId,
  employeeCode: 'E-1',
  fullName: 'Дорж Ganbold',
  positionName: null,
  teamId: null,
  teamName: null,
);

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

/// The detail DTO as the backend sends it, with the pin the customer dropped.
Map<String, dynamic> _detailJson({
  Map<String, dynamic>? planPosition,
  bool withFloor = true,
}) {
  return <String, dynamic>{
    'id': _requestId,
    'requestNumber': 'SR-202608-0042',
    'customer': <String, dynamic>{'id': 'c1', 'name': 'Ариг Банк'},
    'building': <String, dynamic>{'id': 'b1', 'name': 'Төв байр'},
    'floor': withFloor
        ? <String, dynamic>{'id': _floorId, 'name': '3-р давхар'}
        : null,
    'device': <String, dynamic>{'id': 'd1', 'name': 'Гэрэлтүүлгийн самбар'},
    'requestType': 'REPAIR',
    'isUrgent': false,
    'status': 'ASSIGNED',
    'slaState': 'STARTED',
    'slaRemainingMinutes': 180,
    'assignedEmployees': <Map<String, dynamic>>[
      <String, dynamic>{'id': _employeeId, 'name': 'Дорж'},
    ],
    'assignedTeam': null,
    'createdAt': '2026-08-01T09:00:00.000Z',
    'description': 'Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.',
    'contactName': 'Батболд',
    'contactPhone': '99112233',
    'attachments': const <Map<String, dynamic>>[],
    'locationPath': <Map<String, dynamic>>[
      <String, dynamic>{'id': 'b1', 'kind': 'BUILDING', 'name': 'Төв байр'},
    ],
    'planPosition': planPosition,
  };
}

Map<String, dynamic> _planJson({String mimeType = 'image/png'}) => <String, dynamic>{
      'id': '6f0000000000000000000001',
      'floorId': _floorId,
      'fileId': _planFileId,
      'fileName': mimeType == 'application/pdf' ? 'plan.pdf' : 'plan.png',
      'downloadUrl': '/api/v1/files/$_planFileId',
      'mimeType': mimeType,
      'sizeBytes': 4096,
      'title': '3-р давхрын план',
      'description': null,
      'uploadedByName': 'Админ',
      'uploadedAt': '2026-07-01T02:00:00.000Z',
    };

void main() {
  // The pumps below run in a real async zone (the image decoder needs one), which is
  // also the only condition under which google_fonts reaches for the network. It is told
  // not to: a test must not depend on fonts.gstatic.com being reachable.
  setUpAll(() => GoogleFonts.config.allowRuntimeFetching = false);

  /// How many times the screen asked for the floor's drawing. A request with no pin has
  /// nothing to draw it on, so the read must not happen at all.
  late int planReads;

  setUp(() => planReads = 0);

  Widget screen({
    required Map<String, dynamic> detail,
    Uint8List? bytes,
    Map<String, dynamic>? plan,
    Object? planError,
  }) {
    return ProviderScope(
      overrides: <Override>[
        currentUserProvider.overrideWithValue(_technician),
        workIdentityProvider.overrideWith((Ref ref) async => _identity),
        serviceRequestDetailProvider(_requestId).overrideWith(
          (Ref ref) async => ServiceRequestDetailModel.fromJson(detail),
        ),
        floorPlanProvider(_floorId).overrideWith((Ref ref) async {
          planReads++;
          if (planError != null) throw planError;
          return plan == null ? null : FloorPlanModel.fromJson(plan);
        }),
        projectFileBytesProvider(_planFileId)
            .overrideWith((Ref ref) async => bytes ?? Uint8List(0)),
      ],
      child: const MaterialApp(
        home: ServiceRequestDetailScreen(
          requestId: _requestId,
          requestNumber: 'SR-202608-0042',
          subject: 'Гэрэлтүүлгийн самбар',
          location: 'Ариг Банк · Төв байр',
        ),
      ),
    );
  }

  /// Pumps in a real async zone and gives the image decoder time to land.
  ///
  /// `pumpAndSettle` is unavailable inside [WidgetTester.runAsync], and the decode is
  /// engine work the fake clock would never complete, so the frames are pumped by hand
  /// with a real delay between them. The surface is tall enough that the whole detail
  /// list is laid out, so nothing asserted below is missing merely for being scrolled
  /// off.
  Future<void> pumpScreen(WidgetTester tester, Widget Function() build) async {
    tester.view.physicalSize = const Size(1170, 6000);
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

  testWidgets('the pin sits on its fraction of the painted plan', (
    WidgetTester tester,
  ) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
        bytes: bytes,
        plan: _planJson(),
      ),
    );

    expect(planReads, 1);
    expect(find.text('ГЭМТЛИЙН БАЙРШИЛ'), findsOneWidget);

    final Rect plan = paintedPlan(tester);
    // The box the pin is measured against IS the drawing. Were the plan still
    // letterboxed inside a fixed-height box, this ratio would not be the image's.
    expect(
      plan.width / plan.height,
      closeTo(_planWidth / _planHeight, 0.02),
      reason: 'the widget box must coincide with the painted image',
    );

    final Rect mark = tester.getRect(find.byType(FaultPin));
    expect(mark.center.dx, closeTo(plan.left + plan.width * 0.25, 0.5));
    expect(mark.center.dy, closeTo(plan.top + plan.height * 0.75, 0.5));
    // Centred on the point, not hung off its corner.
    expect(mark.width, closeTo(kPlanPinDiameter, 0.01));
    expect(mark.height, closeTo(kPlanPinDiameter, 0.01));
  });

  /// The mark is the customer's account of their own fault. A technician who could drag
  /// it would be editing somebody else's statement, so the layer carries no recogniser
  /// and the pin itself is deaf to pointers.
  testWidgets('nothing on the screen can move the pin', (WidgetTester tester) async {
    final Uint8List bytes = (await tester.runAsync(_planBytes))!;

    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
        bytes: bytes,
        plan: _planJson(),
      ),
    );

    final Rect plan = paintedPlan(tester);
    final Rect before = tester.getRect(find.byType(FaultPin));

    await tester.tapAt(Offset(plan.left + plan.width * 0.9, plan.center.dy));
    await tester.pump();

    expect(tester.getRect(find.byType(FaultPin)), before);
    expect(find.text('Тэмдэглэгээг арилгах'), findsNothing);
    expect(
      find.descendant(
        of: find.byType(FloorPlanPinLayer),
        matching: find.byType(GestureDetector),
      ),
      findsNothing,
    );
  });

  testWidgets('a request with no pin has no plan section and reads no plan', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      () => screen(detail: _detailJson(), plan: _planJson()),
    );

    // The record itself is on screen, so this is not passing because nothing rendered.
    expect(
      find.text('Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.'),
      findsOneWidget,
    );

    expect(find.text('ГЭМТЛИЙН БАЙРШИЛ'), findsNothing);
    expect(find.byType(FloorPlanPinLayer), findsNothing);
    expect(find.byType(FaultPin), findsNothing);
    expect(find.byType(AuthenticatedImage), findsNothing);
    // No pin means no reason to fetch a drawing at all.
    expect(planReads, 0);
  });

  /// A pin without a floor cannot be drawn on anything. The DTO can carry one — the
  /// coordinate and the floor are separate fields — and it must cost a section, not a
  /// crash.
  testWidgets('a pin with no floor draws nothing rather than throwing', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.5, 'y': 0.5},
          withFloor: false,
        ),
        plan: _planJson(),
      ),
    );

    expect(find.text('ГЭМТЛИЙН БАЙРШИЛ'), findsNothing);
    expect(planReads, 0);
    expect(tester.takeException(), isNull);
  });

  testWidgets('a floor with no imported plan says so instead of leaving a gap', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
      ),
    );

    expect(find.text('ГЭМТЛИЙН БАЙРШИЛ'), findsOneWidget);
    expect(find.textContaining('план зураг импортлогдоогүй'), findsOneWidget);
    expect(find.byType(AuthenticatedImage), findsNothing);
    expect(find.byType(FaultPin), findsNothing);
  });

  testWidgets('a PDF plan is named as one, not pushed through an image decoder', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
        plan: _planJson(mimeType: 'application/pdf'),
      ),
    );

    expect(find.textContaining('зураг биш файл'), findsOneWidget);
    expect(find.textContaining('plan.pdf'), findsOneWidget);
    expect(find.byType(AuthenticatedImage), findsNothing);
    expect(find.byType(FaultPin), findsNothing);
  });

  testWidgets('a plan that fails to load explains itself and costs nothing else', (
    WidgetTester tester,
  ) async {
    await pumpScreen(
      tester,
      () => screen(
        detail: _detailJson(
          planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75},
        ),
        planError: const NetworkFailure(),
      ),
    );

    expect(find.textContaining('Сүлжээнд холбогдож чадсангүй'), findsOneWidget);
    expect(find.byType(FaultPin), findsNothing);
    // The rest of the request is untouched by a failed second read.
    expect(
      find.text('Гуравдугаар давхрын гэрэлтүүлэг бүхэлдээ унтарсан.'),
      findsOneWidget,
    );
    expect(find.text('99112233'), findsOneWidget);
  });

  group('planPosition off the wire', () {
    test('comes through as the normalised pair the customer stored', () {
      final ServiceRequestDetailModel detail = ServiceRequestDetailModel.fromJson(
        _detailJson(planPosition: <String, dynamic>{'x': 0.25, 'y': 0.75}),
      );

      expect(detail.planPosition, const PlanPositionModel(x: 0.25, y: 0.75));
      expect(detail.floor?.id, _floorId);
    });

    test('is null when the request carries no mark', () {
      expect(
        ServiceRequestDetailModel.fromJson(_detailJson()).planPosition,
        isNull,
      );
    });

    test('a malformed or out-of-range coordinate costs the pin, not the record', () {
      const List<Object?> refused = <Object?>[
        <String, dynamic>{'x': 0.5},
        <String, dynamic>{'x': '0.5', 'y': '0.5'},
        <String, dynamic>{'x': 1.4, 'y': 0.5},
        <String, dynamic>{'x': -0.01, 'y': 0.5},
        <String, dynamic>{'x': double.nan, 'y': 0.5},
        <String, dynamic>{'x': double.infinity, 'y': 0.5},
      ];

      for (final Object? value in refused) {
        final ServiceRequestDetailModel detail =
            ServiceRequestDetailModel.fromJson(
          _detailJson()..['planPosition'] = value,
        );

        expect(detail.planPosition, isNull, reason: 'expected $value to be refused');
        // Everything else on the record survived it.
        expect(detail.requestNumber, 'SR-202608-0042');
        expect(detail.contactPhone, '99112233');
      }

      // A coordinate that is not even a map — an older server, or a scalar — is the
      // same one unplaced pin.
      expect(
        ServiceRequestDetailModel.fromJson(
          _detailJson()..['planPosition'] = 'nowhere',
        ).planPosition,
        isNull,
      );
    });

    test('the exact corners are legal positions', () {
      expect(
        ServiceRequestDetailModel.fromJson(
          _detailJson(planPosition: <String, dynamic>{'x': 0, 'y': 1}),
        ).planPosition,
        const PlanPositionModel(x: 0, y: 1),
      );
    });
  });
}
