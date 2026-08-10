import 'package:flutter/material.dart';

import '../../data/models/object_master_model.dart';
import '../../domain/entities/object_master_enums.dart';
import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';

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
  // they overlap often, and the one a reader must not lose is the severe one. An
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
/// dozens of objects and a phone is 390px wide, so pills would overlap into an
/// unreadable mat. The band is carried by the fill and the ring, the object type by the
/// glyph inside, and the name is one tap away.
///
/// Sized up from the 22 it was while the dot carried a risk silhouette. A silhouette is
/// one of five shapes and reads at any size; an object-type glyph is one of fourteen
/// and has to be told apart from thirteen others, which needs the pixels. It is still
/// deliberately under a comfortable touch target: crowding is the binding constraint on
/// a plan, and the plan now zooms, which is the answer to a marker too small to read.
const double kPlanMarkerDiameter = 26;

/// The object-type glyph inside the dot, as large as the ring leaves room for.
///
/// [kPlanMarkerDiameter] less the 2px ring on each side is 22; 15 fills that without
/// the glyph's own bounding box touching the ring, which would read as a smudge rather
/// than a symbol at plan size.
const double kPlanMarkerGlyphSize = 15;

/// The markers, laid over exactly the painted plan.
///
/// Positioned from the layer's own box, which `AuthenticatedImage.sizedToImage` has
/// already made identical to the drawing, so `x` and `y` are read straight off the
/// picture. Each marker is centred on its point - offset by half its size, matching
/// the web's `-translate-x-1/2 -translate-y-1/2` - because a coordinate names a spot
/// on the plan, not the corner of a dot.
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
                  child: PlanMarker(object: object, onTap: () => onTap(object)),
                ),
          ],
        );
      },
    );
  }
}

/// The fault pin's diameter. Larger than [kPlanMarkerDiameter] because this one is a
/// touch target as well as a mark, and because there is only ever one of it — the
/// crowding argument that keeps an object marker small does not apply.
const double kPlanPinDiameter = 30;

/// The one pin a customer drops on the plan to say where the problem is.
///
/// The geometry is [FloorPlanMarkerLayer]'s, in both directions, and for the same
/// reason: `AuthenticatedImage.sizedToImage` has already made this layer's box the
/// painted drawing's own rectangle, so
///
///   * a tap's `localPosition` divided by the box IS the normalised coordinate the API
///     stores, and
///   * a stored coordinate multiplied by the box IS the point to draw at, offset by
///     half the pin so the dot is centred on the spot rather than hung off its corner.
///
/// There is no letterbox arithmetic here because there is no letterbox: the widget box
/// and the picture are one rectangle. Nesting this inside the default
/// [AuthenticatedImage] instead would silently shift every pin by the height of the
/// bars, which is precisely the bug `sizedToImage` was written to remove.
///
/// Tapping anywhere moves the pin, including onto the pin itself — the dot is drawn
/// behind an [IgnorePointer] so it cannot swallow the second tap. Clearing is not done
/// here; it belongs to a labelled control the reader can find without guessing.
class FloorPlanPinLayer extends StatelessWidget {
  const FloorPlanPinLayer({
    super.key,
    required this.pin,
    required this.onTapAt,
  });

  /// The pin already placed, or null while the plan carries none.
  final PlanPositionModel? pin;

  /// Called with the normalised coordinate of every tap on the drawing.
  final void Function(PlanPositionModel position) onTapAt;

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (BuildContext context, BoxConstraints constraints) {
        final double width = constraints.maxWidth;
        final double height = constraints.maxHeight;
        // A degenerate box would divide by zero and pin the mark to a corner as though
        // that were the recorded spot. Drawing nothing is the truthful answer.
        if (!width.isFinite || !height.isFinite || width <= 0 || height <= 0) {
          return const SizedBox.shrink();
        }

        final PlanPositionModel? placed = pin;

        return Semantics(
          button: true,
          label: 'Планд гэмтлийн байршил тэмдэглэх',
          child: GestureDetector(
            behavior: HitTestBehavior.opaque,
            onTapUp: (TapUpDetails details) {
              final Offset local = details.localPosition;
              // Clamped rather than rejected: a tap on the very edge is a legitimate
              // placement, and `planPositionSchema` refuses anything outside 0..1.
              onTapAt(
                PlanPositionModel(
                  x: (local.dx / width).clamp(0.0, 1.0),
                  y: (local.dy / height).clamp(0.0, 1.0),
                ),
              );
            },
            child: Stack(
              children: <Widget>[
                if (placed != null)
                  Positioned(
                    left: placed.x * width - kPlanPinDiameter / 2,
                    top: placed.y * height - kPlanPinDiameter / 2,
                    width: kPlanPinDiameter,
                    height: kPlanPinDiameter,
                    child: const IgnorePointer(child: FaultPin()),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// The mark itself: the attention triad, ringed, with a crosshair inside.
///
/// Deliberately not one of the risk-band tones a [PlanMarker] wears — this is a claim
/// the customer is making, not an assessment the platform has recorded, and the two
/// must not be read as the same kind of statement.
@visibleForTesting
class FaultPin extends StatelessWidget {
  const FaultPin({super.key});

  @override
  Widget build(BuildContext context) {
    return Container(
      alignment: Alignment.center,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        color: CustomerTokens.redBg,
        border: Border.all(color: CustomerTokens.red, width: 2),
      ),
      child: const Icon(
        Icons.close,
        size: 16,
        color: CustomerTokens.red,
      ),
    );
  }
}

/// One object on the plan: its type as a glyph, its risk band as the colour around it.
///
/// The dot carries two independent facts and has room to draw only one shape, so the
/// two are split across the channels available. The glyph is the OBJECT TYPE, taken
/// from `objectType.icon` — the key an administrator picked in the type registry, which
/// is the same key the admin web draws its marker from, so a panel is the same symbol
/// in both places. The RISK BAND is the fill and the ring.
///
/// That is a deliberate change from the risk silhouette this dot used to hold, and it
/// costs something real: the band no longer survives greyscale or a colour-blind
/// reader, because colour is now its only channel here. The trade was made because a
/// plan whose markers are all the same shape cannot answer "which of these is the
/// pump"; the band is still spelled out in words on the marker's own accessible name,
/// on every row of the lists below the plan, and on the object screen a tap away, none
/// of which depend on colour.
@visibleForTesting
class PlanMarker extends StatelessWidget {
  const PlanMarker({super.key, required this.object, required this.onTap});

  final ObjectListItemModel object;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = object.riskLevel;
    final AccentTone tone = band?.tone ?? AccentTone.neutral;
    final ObjectIcon icon = object.icon;

    return Semantics(
      button: true,
      // The type is named as well as drawn. A glyph has no accessible name of its own,
      // so without this the one fact the marker gained would be the one fact a screen
      // reader lost.
      label: <String>[
        object.titleLine,
        icon.label,
        band?.label ?? unassessedLabel,
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
