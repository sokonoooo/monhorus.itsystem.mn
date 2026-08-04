import 'package:flutter/material.dart';

import '../../data/models/object_master_model.dart';
import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';
import 'risk_glyph.dart';

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
/// unreadable mat. The band is carried by the fill, the ring and the silhouette
/// inside, and the name is one tap away.
const double kPlanMarkerDiameter = 22;

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

/// One object on the plan.
@visibleForTesting
class PlanMarker extends StatelessWidget {
  const PlanMarker({super.key, required this.object, required this.onTap});

  final ObjectListItemModel object;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = object.riskLevel;
    final AccentTone tone = band?.tone ?? AccentTone.neutral;

    return Semantics(
      button: true,
      label: <String>[
        object.titleLine,
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
          // The silhouette, so the band survives colour-blindness and a plan printed
          // in greyscale - the same rule every other risk indicator here follows.
          child: RiskGlyph(level: band, size: 10),
        ),
      ),
    );
  }
}
