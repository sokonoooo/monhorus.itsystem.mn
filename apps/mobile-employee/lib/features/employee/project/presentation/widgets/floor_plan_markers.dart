import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../providers/project_providers.dart';
import 'authenticated_image.dart';

/// The objects the plan draws: placed, and of a type the registry marks as shown on
/// the plan.
///
/// Both halves of the rule are the admin web's (`FloorPlanPanel.tsx`), and both are
/// load-bearing. `showOnPlan` is what an administrator sets to say "this kind of thing
/// belongs on a drawing"; a cable run or an inventory line has a floor and can carry a
/// position without ever having been meant to appear as a dot.
List<ObjectListItemModel> planMarkersOf(List<ObjectListItemModel> objects) {
  final List<ObjectListItemModel> placed = objects
      .where((ObjectListItemModel object) =>
          object.planPosition != null && object.objectType?.showOnPlan == true)
      .toList();

  // Worst band painted last, so it lands on top where two markers overlap. On a phone
  // they overlap often, and the one a technician must not lose is the severe one. An
  // unassessed object has no band and sits at the bottom of the pile.
  placed.sort((ObjectListItemModel a, ObjectListItemModel b) =>
      (a.riskLevel?.index ?? -1).compareTo(b.riskLevel?.index ?? -1));
  return placed;
}

/// Objects that belong on the plan but have never been placed. Reported as a count,
/// as the web does, so a thin-looking plan is explained rather than left ambiguous.
int unplacedOnPlanCount(List<ObjectListItemModel> objects) => objects
    .where((ObjectListItemModel object) =>
        object.planPosition == null && object.objectType?.showOnPlan == true)
    .length;

/// The marker's diameter. A dot rather than the web's code pill: a floor carries
/// dozens of devices and a phone is 390px wide, so pills would overlap into an
/// unreadable mat. The band is carried by the fill and the ring, the device type by the
/// glyph inside, and the code is one tap away.
///
/// Sized up from the 22 it was while the dot carried a risk silhouette. A silhouette is
/// one of five shapes and reads at any size; a device-type glyph is one of fourteen and
/// has to be told apart from thirteen others, which needs the pixels. It is still under
/// the 48 of a comfortable touch target, and deliberately: crowding is the binding
/// constraint on a plan, and the plan now zooms — magnifying a marker that is too small
/// to read at rest is exactly what the pinch is for.
const double kPlanMarkerDiameter = 26;

/// The device-type glyph inside the dot, as large as the ring leaves room for.
///
/// [kPlanMarkerDiameter] less the 2px ring on each side is 22; 15 fills that without
/// the glyph's own bounding box touching the ring, which would read as a smudge rather
/// than a symbol at plan size.
const double kPlanMarkerGlyphSize = 15;

/// The magnification past which a marker also spells out its code.
///
/// The admin web does the same thing for the same reason: a whole floor in view is a
/// field of dots, and forty codes drawn over it is an unreadable mat, but a reader who
/// has zoomed in has told you they are looking at a handful of markers rather than at
/// the shape of the floor. Two, rather than the web's 0.9, because this plan starts at
/// "fits the card" and cannot go below it — 0.9 here would mean "always".
///
/// The code is never unreachable at any zoom: it is the marker's accessible name, and
/// it is the title of the screen a tap opens.
const double kPlanCodeMinZoom = 2;

/// The markers, laid over exactly the painted plan, each one a constant size on screen
/// however far the plan is zoomed.
///
/// Positioned from the layer's own box, which `AuthenticatedImage.sizedToImage` has
/// already made identical to the drawing, so `x` and `y` are read straight off the
/// picture. Each marker is centred on its point — offset by half its size, matching
/// the web's `-translate-x-1/2 -translate-y-1/2` — because a coordinate names a spot
/// on the plan, not the corner of a dot.
///
/// The layer is laid out INSIDE the viewer's transform, so the box measured here is the
/// drawing's unzoomed rectangle and a coordinate times that box is the right place all
/// the way up. Everything in that subtree is then multiplied by the zoom, which would
/// blow the dots up with it, so each marker undoes exactly that with `1/zoom` — the
/// same trick the admin web's canvas plays with `scale(1/z)`. A marker is a label on a
/// point, not a thing on the floor with a size of its own: magnifying it would keep the
/// dots overlapping at every zoom, which is the crowding a reader zoomed in to escape.
///
/// The counter-scale is applied about each marker's CENTRE, which is the coordinate
/// itself, so shrinking the dot cannot walk it off the spot it names.
class FloorPlanMarkerLayer extends StatelessWidget {
  const FloorPlanMarkerLayer({
    super.key,
    required this.objects,
    required this.onTap,
  });

  /// Already filtered by [planMarkersOf]; every entry carries a `planPosition`.
  final List<ObjectListItemModel> objects;

  final void Function(ObjectListItemModel object) onTap;

  @override
  Widget build(BuildContext context) {
    // Read here rather than inside the LayoutBuilder so this layer depends on the zoom
    // directly, and is rebuilt by a pinch even though its constraints never change —
    // the box it is measured against is the unzoomed drawing throughout.
    final double zoom = PlanZoom.of(context);

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final double height = constraints.maxHeight;
        if (!width.isFinite || !height.isFinite) return const SizedBox.shrink();

        return Stack(
          // The code label hangs off the side of a marker's own box, so this must not
          // clip. The dots themselves are unaffected: each one still occupies exactly
          // the square below, and a marker on the very edge of the plan overhangs it by
          // the same half-dot it always did.
          clipBehavior: Clip.none,
          children: <Widget>[
            for (final ObjectListItemModel object in objects)
              if (object.planPosition != null)
                Positioned(
                  left: object.planPosition!.x * width - kPlanMarkerDiameter / 2,
                  top: object.planPosition!.y * height - kPlanMarkerDiameter / 2,
                  width: kPlanMarkerDiameter,
                  height: kPlanMarkerDiameter,
                  child: Transform.scale(
                    scale: 1 / zoom,
                    // Centre-aligned by default, and the box above is centred on the
                    // coordinate, so the dot shrinks onto its own point.
                    //
                    // Hit tests go through the same matrix, so what can be tapped is
                    // the dot as drawn — not the box the zoom stretched underneath it.
                    child: PlanMarker(
                      object: object,
                      showCode: zoom >= kPlanCodeMinZoom,
                      onTap: () => onTap(object),
                    ),
                  ),
                ),
          ],
        );
      },
    );
  }
}

/// The fault pin's diameter. Larger than [kPlanMarkerDiameter] because there is only
/// ever one of it — the crowding argument that keeps a device marker small does not
/// apply — and because it has to be findable at a glance among the device dots it is
/// drawn beside.
const double kPlanPinDiameter = 30;

/// The one point the customer marked when they raised the request, drawn read-only.
///
/// The geometry is [FloorPlanMarkerLayer]'s, and for the same reason:
/// `AuthenticatedImage.sizedToImage` has already made this layer's box the painted
/// drawing's own rectangle, so a stored coordinate multiplied by the box IS the point
/// to draw at, offset by half the pin so the dot is centred on the spot rather than
/// hung off its corner. There is no letterbox arithmetic here because there is no
/// letterbox: the widget box and the picture are one rectangle. Nesting this inside the
/// default [AuthenticatedImage] instead would silently shift the pin by the height of
/// the bars.
///
/// NOTHING HERE PLACES OR MOVES THE PIN, and that is the point. The mark is the
/// customer's statement of where their problem is, made on the intake form in the
/// customer app; a technician who could drag it would be editing somebody else's
/// account of the fault. There is no gesture recogniser in this file for that reason.
class FloorPlanPinLayer extends StatelessWidget {
  const FloorPlanPinLayer({super.key, required this.pin});

  /// The recorded coordinate. Null draws nothing.
  final PlanPositionModel? pin;

  @override
  Widget build(BuildContext context) {
    final PlanPositionModel? placed = pin;
    if (placed == null) return const SizedBox.shrink();

    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final double height = constraints.maxHeight;
        // A degenerate box would pin the mark to a corner as though that were the
        // recorded spot. Drawing nothing is the truthful answer.
        if (!width.isFinite || !height.isFinite || width <= 0 || height <= 0) {
          return const SizedBox.shrink();
        }

        return Stack(
          children: <Widget>[
            Positioned(
              left: placed.x * width - kPlanPinDiameter / 2,
              top: placed.y * height - kPlanPinDiameter / 2,
              width: kPlanPinDiameter,
              height: kPlanPinDiameter,
              // Ignores pointers so it cannot swallow a tap meant for a device marker
              // underneath it, which is the only interactive thing on this drawing.
              child: const IgnorePointer(child: FaultPin()),
            ),
          ],
        );
      },
    );
  }
}

/// The mark itself: the attention triad, ringed, with a cross inside.
///
/// Deliberately not one of the risk-band tones a [PlanMarker] wears. A band is an
/// assessment the platform has recorded; this is a claim the customer made when they
/// rang, and the two must not be read as the same kind of statement.
@visibleForTesting
class FaultPin extends StatelessWidget {
  const FaultPin({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Гэмтлийн тэмдэглэсэн байршил',
      child: Container(
        alignment: Alignment.center,
        decoration: BoxDecoration(
          shape: BoxShape.circle,
          color: Tone.red.background,
          border: Border.all(color: Tone.red.foreground, width: 2),
        ),
        child: Icon(Icons.close, size: 16, color: Tone.red.foreground),
      ),
    );
  }
}

/// One device on the plan: its type as a glyph, its risk band as the colour around it.
///
/// The dot carries two independent facts and has room to draw only one shape, so the
/// two are split across the channels available. The glyph is the DEVICE TYPE, taken
/// from `objectType.icon` — the key an administrator picked in the type registry, which
/// is the same key the admin web draws its marker from, so a panel is the same symbol
/// in both places. The RISK BAND is the fill and the ring.
///
/// That is a deliberate change from the risk silhouette this dot used to hold, and it
/// costs something real: the band no longer survives greyscale or a colour-blind
/// reader, because colour is now its only channel here. The trade was made because a
/// plan whose markers are all the same shape cannot answer "which of these is the
/// pump", which is the question a technician standing on the floor is actually asking;
/// the band is still spelled out in words on every row of the list below the plan, on
/// the marker's own accessible name, and on the device screen a tap away, none of which
/// depend on colour.
@visibleForTesting
class PlanMarker extends StatelessWidget {
  const PlanMarker({
    super.key,
    required this.object,
    required this.onTap,
    this.showCode = false,
  });

  final ObjectListItemModel object;
  final VoidCallback onTap;

  /// Whether the plan is magnified enough to spell the code out beside the dot.
  final bool showCode;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = object.riskLevel;
    final Tone tone = riskTone(band);
    final ObjectIcon icon = object.icon;

    final Widget dot = Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        // The chip triad the rest of the app uses, drawn round: a tint the plan
        // shows through less than a solid dot would, ringed in the band colour.
        color: tone.background,
        border: Border.all(color: tone.foreground, width: 2),
      ),
      child: ObjectTypeGlyph(
        icon: icon,
        iconFileId: object.iconFileId,
        size: kPlanMarkerGlyphSize,
        // The band's foreground, not a neutral ink: at this size the glyph is a
        // large part of the dot's visible area, and drawing it in the band colour
        // is what keeps a critical marker reading as critical rather than as a
        // grey symbol in a red circle.
        color: tone.foreground,
      ),
    );

    return Semantics(
      button: true,
      // The type is named as well as drawn. A glyph has no accessible name of its own,
      // so without this the one fact the marker gained would be the one fact a screen
      // reader lost. The type's own name is used where the registry gave it one, so a
      // type added after this build shipped is still named rather than read out as
      // whichever built-in key it falls back to.
      label: <String>[
        object.titleLine,
        object.typeName.isEmpty ? icon.label : object.typeName,
        riskSemanticLabel(band),
      ].join(' · '),
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Stack(
          // Nothing here may move the dot: the box this sits in is centred on the
          // object's coordinate, so the dot fills it and the label is hung outside it
          // rather than sharing the width with it. A row would push the dot off its
          // own point by half the width of the code.
          clipBehavior: Clip.none,
          children: <Widget>[
            Positioned.fill(child: dot),
            if (showCode && object.code.isNotEmpty)
              Positioned(
                left: kPlanMarkerDiameter + 3,
                top: 0,
                bottom: 0,
                // Unconstrained across, because the label is wider than the dot's box
                // and a Stack would otherwise hand it the dot's width and wrap the
                // code one character per line.
                child: UnconstrainedBox(
                  constrainedAxis: Axis.vertical,
                  alignment: Alignment.centerLeft,
                  child: _PlanCodeLabel(code: object.code, tone: tone),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// The device code, drawn beside a marker once the plan is magnified.
///
/// Carries its own background because it is drawn over a technical drawing rather than
/// over a page: black text on the grey of a plan is legible until it crosses a wall.
class _PlanCodeLabel extends StatelessWidget {
  const _PlanCodeLabel({required this.code, required this.tone});

  final String code;
  final Tone tone;

  @override
  Widget build(BuildContext context) {
    return IgnorePointer(
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
        decoration: BoxDecoration(
          color: tone.background,
          borderRadius: BorderRadius.circular(4),
          border: Border.all(color: tone.foreground, width: 1),
        ),
        child: Text(
          code,
          maxLines: 1,
          softWrap: false,
          overflow: TextOverflow.clip,
          style: EmployeeTokens.microLabel.merge(EmployeeTokens.mono).copyWith(
                color: tone.foreground,
                fontWeight: FontWeight.w700,
                height: 1.1,
              ),
        ),
      ),
    );
  }
}

/// An object type's icon: the registry's uploaded SVG where there is one, the built-in
/// glyph otherwise.
///
/// THE POINT IS THAT A TYPE ADDED NEXT MONTH DRAWS CORRECTLY WITHOUT AN APP RELEASE.
/// [ObjectIcon] is a fixed catalogue of fourteen keys compiled into this build, and an
/// administrator can create types faster than the stores can ship; every such type used
/// to land on the same generic silhouette as every other one, which is exactly the
/// "markers are hard to tell apart" complaint. The uploaded file is the type's own
/// artwork and needs nothing from this build but the ability to draw it.
///
/// The SVG is TINTED rather than painted: [ColorFilter] in `srcIn` keeps the artwork's
/// shape and replaces every colour in it with [color], which is the same band colour the
/// built-in glyph is drawn in. Uploaded icons therefore obey the risk band exactly as
/// the built-ins do, instead of arriving in whatever palette they were drawn in and
/// disappearing against a red or near-black dot. It is the same decision the admin web
/// makes by drawing the file as a CSS mask, and it costs the same thing: a multi-coloured
/// upload is flattened to one colour, which is nothing at all for the monochrome line
/// art this catalogue is drawn in.
///
/// EVERY FAILURE FALLS BACK TO THE BUILT-IN GLYPH: no id in the url, bytes still in
/// flight, the request refused, or a file that is not SVG this renderer can parse. A
/// marker always draws something, because a plan with holes in it is worse than a plan
/// with a generic dot on it.
@visibleForTesting
class ObjectTypeGlyph extends ConsumerWidget {
  const ObjectTypeGlyph({
    super.key,
    required this.icon,
    required this.iconFileId,
    required this.size,
    required this.color,
  });

  /// The built-in key, drawn whenever the custom icon is absent or unusable.
  final ObjectIcon icon;

  /// The stored file holding the type's uploaded SVG, or null for a built-in type.
  final String? iconFileId;

  final double size;
  final Color color;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final Widget builtIn = Icon(icon.glyph, size: size, color: color);

    final String? fileId = iconFileId;
    if (fileId == null) return builtIn;

    // The same provider the plan image and every device photograph are fetched through,
    // which is what makes this cached rather than merely fetched: it is keyed by file id
    // and is not auto-disposed, so a floor with forty markers of one type costs ONE
    // request, and revisiting the floor costs none. Sharing it also means icons inherit
    // the bearer header and the error handling that provider already has.
    return ref.watch(projectFileBytesProvider(fileId)).when(
          data: (Uint8List bytes) => SvgPicture.memory(
            bytes,
            width: size,
            height: size,
            fit: BoxFit.contain,
            colorFilter: ColorFilter.mode(color, BlendMode.srcIn),
            // A file that is not parseable SVG must cost this marker its artwork and
            // nothing else. Without this the exception would take down the whole plan.
            errorBuilder: (BuildContext _, Object __, StackTrace? ___) => builtIn,
            // Shown while the picture is being parsed. The built-in glyph rather than a
            // blank: a marker that flickers empty reads as a plan still loading.
            placeholderBuilder: (BuildContext _) => builtIn,
          ),
          // In flight, or refused. Either way the dot is drawn and the plan is readable;
          // an icon is a refinement of a marker, never the marker itself.
          loading: () => builtIn,
          error: (Object _, StackTrace __) => builtIn,
        );
  }
}
