import 'package:flutter/material.dart';

import '../../data/models/project_model.dart';
import '../../domain/entities/risk_level.dart';
import '../theme/customer_tokens.dart';

/// The prototype's `.sil-wrap`: the building drawn as a stack of floor bars, worst
/// floor first to the eye because each bar carries its own band colour.
///
/// Bar height rises with the floor number so the shape reads as a building. A floor
/// with no number gets the shortest bar rather than being dropped, since a missing
/// storey would misrepresent the building.
class BuildingSilhouette extends StatelessWidget {
  const BuildingSilhouette({
    super.key,
    required this.floors,
    required this.onFloorTap,
    this.selectedFloorId,
  });

  /// Ordered top floor first, as [buildingFloorsProvider] returns them.
  final List<FloorModel> floors;
  final ValueChanged<FloorModel> onFloorTap;
  final String? selectedFloorId;

  @override
  Widget build(BuildContext context) {
    if (floors.isEmpty) return const SizedBox.shrink();

    // Drawn ground-up, so the reversed order matches the on-screen left-to-right run
    // from lowest storey to highest.
    final List<FloorModel> ascending = floors.reversed.toList(growable: false);
    final int maxNumber = ascending.fold<int>(
      1,
      (int highest, FloorModel floor) {
        final int? number = floor.floorNumber;
        return number != null && number > highest ? number : highest;
      },
    );

    return Container(
      margin: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        0,
        CustomerTokens.gutter,
        10,
      ),
      padding: const EdgeInsets.fromLTRB(11, 12, 11, 0),
      decoration: CustomerTokens.card(),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox(
            height: 118,
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: <Widget>[
                  for (final FloorModel floor in ascending)
                    _FloorBar(
                      floor: floor,
                      maxNumber: maxNumber,
                      selected: floor.id == selectedFloorId,
                      onTap: () => onFloorTap(floor),
                    ),
                ],
              ),
            ),
          ),
          Container(
            height: 4,
            margin: const EdgeInsets.fromLTRB(4, 0, 4, 9),
            decoration: const BoxDecoration(
              color: CustomerTokens.soft,
              borderRadius: BorderRadius.vertical(
                bottom: Radius.circular(CustomerTokens.radiusInput),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _FloorBar extends StatelessWidget {
  const _FloorBar({
    required this.floor,
    required this.maxNumber,
    required this.selected,
    required this.onTap,
  });

  final FloorModel floor;
  final int maxNumber;
  final bool selected;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = floor.riskSummary.worstLevel;
    final Color fill = worst?.solidBackground ?? CustomerTokens.line;
    final int number = floor.floorNumber ?? 0;
    final double height = 28 + (number.clamp(0, maxNumber) / maxNumber) * 70;

    return Padding(
      padding: const EdgeInsets.only(right: 3),
      child: Semantics(
        button: true,
        label: '${floor.name}, ${worst?.label ?? unassessedLabel}',
        child: GestureDetector(
          onTap: onTap,
          child: Container(
            width: 26,
            height: height,
            alignment: Alignment.bottomCenter,
            padding: const EdgeInsets.only(bottom: 4),
            decoration: BoxDecoration(
              color: fill,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(CustomerTokens.radiusInput),
              ),
              border: selected
                  ? Border.all(color: CustomerTokens.ink, width: 2)
                  : Border.all(
                      color: CustomerTokens.white.withValues(alpha: 0.35),
                    ),
            ),
            child: FittedBox(
              child: Text(
                floor.shortLabel,
                style: CustomerTokens.monoLabel.copyWith(
                  color: CustomerTokens.white.withValues(alpha: 0.9),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
