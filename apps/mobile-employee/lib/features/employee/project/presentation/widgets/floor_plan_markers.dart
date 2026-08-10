import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../domain/entities/object_enums.dart';
import '../../domain/entities/risk_level.dart';
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
                    child: PlanMarker(object: object, onTap: () => onTap(object)),
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
  const PlanMarker({super.key, required this.object, required this.onTap});

  final ObjectListItemModel object;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = object.riskLevel;
    final Tone tone = riskTone(band);
    final ObjectIcon icon = object.icon;

    return Semantics(
      button: true,
      // The type is named as well as drawn. A glyph has no accessible name of its own,
      // so without this the one fact the marker gained would be the one fact a screen
      // reader lost.
      label: <String>[
        object.titleLine,
        icon.label,
        riskSemanticLabel(band),
      ].join(' · '),
      excludeSemantics: true,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTap: onTap,
        child: Container(
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            // The chip triad the rest of the app uses, drawn round: a tint the plan
            // shows through less than a solid dot would, ringed in the band colour.
            color: tone.background,
            border: Border.all(color: tone.foreground, width: 2),
          ),
          child: Icon(
            icon.glyph,
            size: kPlanMarkerGlyphSize,
            // The band's foreground, not a neutral ink: at this size the glyph is a
            // large part of the dot's visible area, and drawing it in the band colour
            // is what keeps a critical marker reading as critical rather than as a
            // grey symbol in a red circle.
            color: tone.foreground,
          ),
        ),
      ),
    );
  }
}
