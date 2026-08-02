import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/risk_widgets.dart';
import 'building_detail_screen.dart';

/// `s-project-detail` — level 2 of the drill-down: one project and its buildings.
///
/// Takes the [ProjectModel] the list already fetched so the header paints on the
/// first frame, and re-reads it in the background so a stale figure cannot survive a
/// pull to refresh.
class ProjectDetailScreen extends ConsumerWidget {
  const ProjectDetailScreen({super.key, required this.project});

  final ProjectModel project;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ProjectModel> fresh =
        ref.watch(projectDetailProvider(project.id));
    final ProjectModel current = fresh.valueOrNull ?? project;

    return ProjectScaffold(
      navBar: ProjectNavBar(
        title: current.name,
        subtitle: 'Төслийн дэлгэрэнгүй',
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(projectDetailProvider(project.id))
            ..invalidate(projectBuildingsProvider(project.id));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 28),
          children: <Widget>[
            Breadcrumb(
              parts: <String>[
                if (current.customerName != null) current.customerName!,
                current.name,
              ],
            ),
            _HeaderCard(project: current),
            const SectionHeading('Барилгууд'),
            ProjectAsyncView<List<BuildingModel>>(
              value: ref.watch(projectBuildingsProvider(project.id)),
              onRetry: () => ref.invalidate(projectBuildingsProvider(project.id)),
              builder: (BuildContext ctx, List<BuildingModel> buildings) {
                if (buildings.isEmpty) {
                  return const ProjectEmptyState(
                    icon: Icons.apartment_outlined,
                    message: 'Энэ төсөлд бүртгэлтэй барилга алга байна.',
                  );
                }
                return Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    for (final BuildingModel building in buildings)
                      _BuildingRow(building: building, project: current),
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

class _HeaderCard extends StatelessWidget {
  const _HeaderCard({required this.project});

  final ProjectModel project;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = project.riskSummary.worstLevel;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        ProjectCard(
          accent: worst?.tone.foreground ?? EmployeeTokens.ink,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(project.name, style: EmployeeTokens.cardTitle),
              const SizedBox(height: 5),
              Text(
                joinParts(<String?>[
                  project.code,
                  project.contractNumber,
                  formatMonthRange(project.startDate, project.endDate),
                ]),
                style: EmployeeTokens.microNote.merge(EmployeeTokens.mono),
              ),
              if (project.description != null &&
                  project.description!.isNotEmpty) ...<Widget>[
                const SizedBox(height: 9),
                Text(
                  project.description!,
                  style: EmployeeTokens.body,
                ),
              ],
              const SizedBox(height: 12),
              InfoStrip(
                items: <InfoStripItem>[
                  InfoStripItem(
                    value: '${project.buildingCount}',
                    label: 'Барилга',
                  ),
                  InfoStripItem(value: '${project.floorCount}', label: 'Давхар'),
                  InfoStripItem(
                    value: formatCount(project.objectCount),
                    label: 'Төхөөрөмж',
                  ),
                ],
              ),
              const SizedBox(height: 12),
              const Text('ЭРСДЭЛИЙН ТӨЛӨВ', style: EmployeeTokens.sectionLabel),
              const SizedBox(height: 7),
              RiskCountStrip(summary: project.riskSummary),
              if (project.responsibleEmployeeName != null) ...<Widget>[
                const SizedBox(height: 12),
                DetailRow(
                  label: 'Хариуцсан',
                  value: project.responsibleEmployeeName!,
                  isLast: true,
                ),
              ],
            ],
          ),
        ),
        const RiskLegend(),
      ],
    );
  }
}

class _BuildingRow extends StatelessWidget {
  const _BuildingRow({required this.building, required this.project});

  final BuildingModel building;
  final ProjectModel project;

  @override
  Widget build(BuildContext context) {
    final RiskSummaryModel summary = building.riskSummary;
    final RiskLevel? worst = summary.worstLevel;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(worst),
        text: building.shortCode,
        level: worst,
        showGlyph: true,
      ),
      title: building.name,
      subtitle: joinParts(<String?>[
        '${building.floorCount} давхар',
        '${building.objectCount} төхөөрөмж',
        if (summary.criticalCount > 0) '${summary.criticalCount} ноцтой',
        if (summary.criticalCount == 0 && summary.attentionCount > 0)
          '${summary.attentionCount} анхаарах',
        building.address,
      ]),
      trailing: _BuildingPill(summary: summary),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (BuildContext _) => BuildingDetailScreen(
            building: building,
            projectName: building.projectName ?? project.name,
          ),
        ),
      ),
    );
  }
}

class _BuildingPill extends StatelessWidget {
  const _BuildingPill({required this.summary});

  final RiskSummaryModel summary;

  @override
  Widget build(BuildContext context) {
    if (summary.criticalCount > 0) {
      return const EmployeePill(
        label: 'Эрсдэл',
        tone: Tone.red,
        showDot: true,
      );
    }
    if (summary.attentionCount > 0) {
      return const EmployeePill(label: 'Анхааруулга', tone: Tone.yellow);
    }
    if (summary.normalCount > 0) {
      return const EmployeePill(label: 'Хэвийн', tone: Tone.green);
    }
    return const EmployeePill(label: unassessedLabel, tone: Tone.neutral);
  }
}
