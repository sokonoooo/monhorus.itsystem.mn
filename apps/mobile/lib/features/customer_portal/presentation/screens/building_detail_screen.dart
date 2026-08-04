import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/project_model.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/building_silhouette.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/risk_widgets.dart';
import 'customer_shell_screen.dart';
import 'floor_detail_screen.dart';

/// s-building-detail: one building, its risk roll-up, its silhouette and its floors.
class BuildingDetailScreen extends ConsumerWidget {
  const BuildingDetailScreen({super.key, required this.building});

  final BuildingModel building;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<List<FloorModel>> floors =
        ref.watch(buildingFloorsProvider(building.id));

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: building.name,
        subtitle: '${building.floorCount} давхар · ${building.objectCount} объект',
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(buildingFloorsProvider(building.id)),
        child: ListView(
          padding: const EdgeInsets.only(top: 8, bottom: 24),
          children: <Widget>[
            Breadcrumb(
              parts: <String>[
                if (building.projectName != null) building.projectName!,
                building.name,
              ],
            ),
            _HeroCard(building: building),
            const SectionCaption('Барилгын харагдац'),
            CustomerAsyncView<List<FloorModel>>(
              value: floors,
              onRetry: () => ref.invalidate(buildingFloorsProvider(building.id)),
              builder: (BuildContext ctx, List<FloorModel> items) {
                if (items.isEmpty) {
                  return const CustomerEmptyState(
                    icon: Icons.layers_outlined,
                    message: 'Энэ барилгад бүртгэлтэй давхар алга байна.',
                  );
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    BuildingSilhouette(
                      floors: items,
                      onFloorTap: (FloorModel floor) => _openFloor(ctx, floor),
                    ),
                    const SectionCaption('Давхрууд'),
                    for (final FloorModel floor in items)
                      _FloorRow(
                        floor: floor,
                        onTap: () => _openFloor(ctx, floor),
                      ),
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }

  void _openFloor(BuildContext context, FloorModel floor) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => FloorDetailScreen(
          floorId: floor.id,
          buildingId: building.id,
          buildingName: building.name,
          projectName: building.projectName,
        ),
      ),
    );
  }
}

class _HeroCard extends StatelessWidget {
  const _HeroCard({required this.building});

  final BuildingModel building;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = building.riskSummary.worstLevel;

    return PanelCard(
      accent: worst?.solidBackground ?? CustomerTokens.ink,
      radius: CustomerTokens.radiusHomeCard,
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        15,
        CustomerTokens.gutter,
        CustomerTokens.gutter,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      building.name,
                      style: CustomerTokens.headerTitle.copyWith(height: 1.25),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      <String>[
                        if (building.address != null) building.address!,
                        '${building.floorCount} давхар · '
                            '${building.objectCount} объектын эрсдэлийн хяналт',
                      ].join('\n'),
                      style: CustomerTokens.rowSub.copyWith(height: 1.5),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 10),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 120),
                child: RiskPill(level: worst, flexibleText: true),
              ),
            ],
          ),
          const SizedBox(height: 12),
          RiskSummaryStrip(summary: building.riskSummary),
          if (building.riskSummary.lastAssessedAt != null) ...<Widget>[
            const SizedBox(height: 8),
            Text(
              'Сүүлийн үнэлгээ: '
              '${formatDate(building.riskSummary.lastAssessedAt)}',
              style: CustomerTokens.rowSub,
            ),
          ],
        ],
      ),
    );
  }
}

class _FloorRow extends StatelessWidget {
  const _FloorRow({required this.floor, required this.onTap});

  final FloorModel floor;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = floor.riskSummary.worstLevel;

    return TappableRow(
      leading: RowTile(
        tone: worst?.tone ?? AccentTone.neutral,
        text: floor.shortLabel,
        semanticsLabel: worst?.label ?? unassessedLabel,
      ),
      title: floor.name,
      subtitle: <String>[
        if (floor.purpose != null) floor.purpose!,
        '${floor.objectCount} объект',
      ].join(' · '),
      trailing: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 116),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (floor.hasPlanImage)
              const StatusPill(label: 'План', tone: AccentTone.blue),
            if (floor.hasPlanImage) const SizedBox(height: 5),
            RiskSummaryStrip(summary: floor.riskSummary, compact: true),
          ],
        ),
      ),
      onTap: onTap,
    );
  }
}
