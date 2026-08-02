import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../../../presentation/theme/employee_tokens.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/risk_widgets.dart';
import 'floor_detail_screen.dart';

/// `s-building-detail` — level 3: one building and its floors.
///
/// The prototype's "+ Давхар нэмэх" action and its "Давхар бүртгэх шаардлага" banner
/// are not reproduced. Creating a floor is `POST /floors` behind `object.manage`,
/// which is master-data authorship rather than field work; a technician's role is not
/// built to hold it and the button would only ever 403.
class BuildingDetailScreen extends ConsumerWidget {
  const BuildingDetailScreen({
    super.key,
    required this.building,
    required this.projectName,
  });

  final BuildingModel building;
  final String projectName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<BuildingModel> fresh =
        ref.watch(buildingDetailProvider(building.id));
    final BuildingModel current = fresh.valueOrNull ?? building;

    return ProjectScaffold(
      navBar: ProjectNavBar(
        title: current.name,
        subtitle: 'Барилгын дэлгэрэнгүй',
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(buildingDetailProvider(building.id))
            ..invalidate(buildingFloorsProvider(building.id));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 28),
          children: <Widget>[
            Breadcrumb(parts: <String>[projectName, current.name]),
            if (current.address != null && current.address!.isNotEmpty)
              NoticeBanner.neutral(text: current.address!, title: 'Хаяг'),
            RiskMetricGrid(summary: current.riskSummary),
            MetricGrid(
              cards: <Widget>[
                MetricCard(
                  label: 'Нийт давхар',
                  value: '${current.floorCount}',
                  note: 'Хяналтад байна',
                ),
                MetricCard(
                  label: 'Төхөөрөмж',
                  value: formatCount(current.objectCount),
                  note: 'Нийт бүртгэлтэй',
                ),
              ],
            ),
            const RiskLegend(),
            const SectionHeading('Давхрууд', topPadding: 4),
            ProjectAsyncView<List<FloorModel>>(
              value: ref.watch(buildingFloorsProvider(building.id)),
              onRetry: () => ref.invalidate(buildingFloorsProvider(building.id)),
              builder: (BuildContext ctx, List<FloorModel> floors) {
                if (floors.isEmpty) {
                  return const ProjectEmptyState(
                    icon: Icons.layers_outlined,
                    message: 'Энэ барилгад бүртгэлтэй давхар алга байна.',
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final FloorModel floor in floors)
                      _FloorRow(
                        floor: floor,
                        buildingName: current.name,
                        projectName: projectName,
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
}

class _FloorRow extends StatelessWidget {
  const _FloorRow({
    required this.floor,
    required this.buildingName,
    required this.projectName,
  });

  final FloorModel floor;
  final String buildingName;
  final String projectName;

  @override
  Widget build(BuildContext context) {
    final RiskSummaryModel summary = floor.riskSummary;
    final RiskLevel? worst = summary.worstLevel;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(worst),
        text: floor.shortLabel,
        level: worst,
        showGlyph: true,
      ),
      title: floor.name,
      subtitle: joinParts(<String?>[
        '${floor.objectCount} төхөөрөмж',
        if (summary.criticalCount > 0) '${summary.criticalCount} ноцтой',
        if (summary.attentionCount > 0) '${summary.attentionCount} анхаарах',
        if (summary.criticalCount == 0 &&
            summary.attentionCount == 0 &&
            summary.normalCount > 0)
          'Бүгд хэвийн',
        floor.hasPlanImage ? 'план зурагтай' : 'план зураггүй',
      ]),
      trailing: _FloorPill(summary: summary),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (BuildContext _) => FloorDetailScreen(
            floorId: floor.id,
            floorName: floor.name,
            buildingName: buildingName,
            projectName: projectName,
          ),
        ),
      ),
    );
  }
}

class _FloorPill extends StatelessWidget {
  const _FloorPill({required this.summary});

  final RiskSummaryModel summary;

  @override
  Widget build(BuildContext context) {
    if (summary.criticalCount > 0) {
      return EmployeePill(
        label: '${summary.criticalCount} ноцтой',
        tone: Tone.red,
      );
    }
    if (summary.attentionCount > 0) {
      return EmployeePill(
        label: '${summary.attentionCount} анхаарах',
        tone: Tone.yellow,
      );
    }
    if (summary.normalCount > 0) {
      return const EmployeePill(label: 'Хэвийн', tone: Tone.green);
    }
    return const EmployeePill(label: unassessedLabel, tone: Tone.neutral);
  }
}
