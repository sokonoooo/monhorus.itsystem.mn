import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/project_async_view.dart';
import '../widgets/project_ui.dart';
import '../widgets/risk_widgets.dart';
import 'device_detail_screen.dart';
import 'floor_reports_screen.dart';

/// `s-floor-detail` — level 4: the floor's counters, its imported plan image, the
/// devices on it and a link to the floor's written conclusions.
class FloorDetailScreen extends ConsumerWidget {
  const FloorDetailScreen({
    super.key,
    required this.floorId,
    required this.floorName,
    required this.buildingName,
    required this.projectName,
  });

  final String floorId;
  final String floorName;
  final String buildingName;
  final String projectName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<FloorModel> floor = ref.watch(floorDetailProvider(floorId));
    final FloorModel? current = floor.valueOrNull;

    return ProjectScaffold(
      navBar: ProjectNavBar(
        title: current?.name ?? floorName,
        subtitle: buildingName,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref
            ..invalidate(floorDetailProvider(floorId))
            ..invalidate(floorPlanProvider(floorId))
            ..invalidate(floorObjectsProvider(floorId));
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.only(bottom: 28),
          children: <Widget>[
            Breadcrumb(
              parts: <String>[
                projectName,
                buildingName,
                current?.name ?? floorName,
              ],
            ),
            ProjectAsyncView<FloorModel>(
              value: floor,
              onRetry: () => ref.invalidate(floorDetailProvider(floorId)),
              builder: (BuildContext ctx, FloorModel data) => _FloorHeader(
                floor: data,
              ),
            ),

            const SectionHeading('Давхарын план зураг', topPadding: 4),
            _FloorPlanSection(floorId: floorId),

            const SectionHeading('Төхөөрөмжийн жагсаалт'),
            _DeviceList(
              floorId: floorId,
              floorName: current?.name ?? floorName,
              buildingName: buildingName,
              projectName: projectName,
            ),

            FullWidthButton(
              label: 'Давхарын тайлан харах',
              icon: Icons.description_outlined,
              secondary: true,
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (BuildContext _) => FloorReportsScreen(
                    floorId: floorId,
                    floorName: current?.name ?? floorName,
                    buildingName: buildingName,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _FloorHeader extends StatelessWidget {
  const _FloorHeader({required this.floor});

  final FloorModel floor;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        RiskMetricGrid(summary: floor.riskSummary),
        if (floor.purpose != null && floor.purpose!.isNotEmpty ||
            floor.areaSqm != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              EmployeeTokens.labelGutter,
              0,
              EmployeeTokens.labelGutter,
              10,
            ),
            child: Text(
              joinParts(<String?>[
                floor.purpose,
                floor.areaSqm == null ? null : '${formatDecimal(floor.areaSqm)} м²',
                floor.code,
              ]),
              style: EmployeeTokens.rowSub,
            ),
          ),
      ],
    );
  }
}

/// The floor plan.
///
/// The prototype overlays a coloured dot per device at an x/y position on the plan.
/// `FloorPlanDto` carries the image and nothing else — no pin, no marker, no
/// coordinate — and no object DTO carries a point on a floor either, so there is
/// nothing to place. The image is shown as imported and the caption says why the pins
/// are absent, rather than scattering dots at made-up positions.
class _FloorPlanSection extends ConsumerWidget {
  const _FloorPlanSection({required this.floorId});

  final String floorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ProjectAsyncView<FloorPlanModel?>(
      value: ref.watch(floorPlanProvider(floorId)),
      onRetry: () => ref.invalidate(floorPlanProvider(floorId)),
      builder: (BuildContext ctx, FloorPlanModel? plan) {
        if (plan == null) {
          return const ProjectEmptyState(
            icon: Icons.map_outlined,
            message: 'Энэ давхарт план зураг импортлогдоогүй байна.',
          );
        }
        if (!plan.isImage) {
          return ProjectEmptyState(
            icon: Icons.description_outlined,
            message: '${plan.fileName} нь зураг биш файл тул энд харуулах '
                'боломжгүй байна.',
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            ProjectCard(
              padding: EdgeInsets.zero,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  Container(
                    color: EmployeeTokens.white,
                    child: AuthenticatedImage(fileId: plan.fileId, height: 210),
                  ),
                  Container(
                    padding: const EdgeInsets.all(11),
                    decoration: const BoxDecoration(
                      color: EmployeeTokens.soft2,
                      border: Border(
                        top: BorderSide(color: EmployeeTokens.faint),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          plan.title ?? plan.fileName,
                          style: EmployeeTokens.rowSub.copyWith(
                            fontWeight: FontWeight.w700,
                            color: EmployeeTokens.ink,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Text(
                          joinParts(<String?>[
                            plan.uploadedByName,
                            formatDate(plan.uploadedAt),
                            formatBytes(plan.sizeBytes),
                          ]),
                          style: EmployeeTokens.microLabel
                              .merge(EmployeeTokens.mono),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
            const Padding(
              padding: EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                0,
                EmployeeTokens.labelGutter,
                10,
              ),
              child: Text(
                'Импортолсон план зураг. Төхөөрөмжийн байршлын цэг системд '
                'хадгалагддаггүй тул зураг дээр тэмдэглэгээ харагдахгүй.',
                style: EmployeeTokens.microNote,
              ),
            ),
          ],
        );
      },
    );
  }
}

class _DeviceList extends ConsumerWidget {
  const _DeviceList({
    required this.floorId,
    required this.floorName,
    required this.buildingName,
    required this.projectName,
  });

  final String floorId;
  final String floorName;
  final String buildingName;
  final String projectName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(canViewDevicesProvider)) {
      return const ProjectEmptyState(
        icon: Icons.lock_outline,
        message: 'Төхөөрөмжийн жагсаалт харах эрх (object_master.view) танд '
            'олгогдоогүй байна.',
      );
    }

    return ProjectAsyncView<List<ObjectListItemModel>>(
      value: ref.watch(floorObjectsProvider(floorId)),
      onRetry: () => ref.invalidate(floorObjectsProvider(floorId)),
      builder: (BuildContext ctx, List<ObjectListItemModel> objects) {
        if (objects.isEmpty) {
          return const ProjectEmptyState(
            icon: Icons.devices_other_outlined,
            message: 'Энэ давхарт холбогдсон төхөөрөмж алга байна.',
          );
        }

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            for (final ObjectListItemModel object in objects)
              DeviceRow(
                object: object,
                floorName: floorName,
                buildingName: buildingName,
                projectName: projectName,
              ),
          ],
        );
      },
    );
  }
}

/// One device row, shared by the floor list and any other list of objects.
///
/// The leading tile carries the үнэлгээ, as the prototype does, and falls back to the
/// device-type glyph when there is no assessment — a tile reading "0" would state a
/// score that was never recorded.
class DeviceRow extends StatelessWidget {
  const DeviceRow({
    super.key,
    required this.object,
    required this.floorName,
    required this.buildingName,
    required this.projectName,
  });

  final ObjectListItemModel object;
  final String floorName;
  final String buildingName;
  final String projectName;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? band = object.riskLevel;
    final int? score = object.score;

    return ProjectRow(
      leading: RowTile(
        tone: riskTone(band),
        text: score == null ? null : '$score',
        icon: score == null ? object.icon.glyph : null,
        level: band,
        showGlyph: true,
      ),
      title: object.titleLine,
      subtitle: joinParts(<String?>[
        object.typeName,
        object.status?.label,
        object.calculatedLoad.hasValue
            ? '${formatDecimal(object.calculatedLoad.valueKw)} kW'
            : null,
      ]),
      trailing: RiskPill(score: score, level: band),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (BuildContext _) => DeviceDetailScreen(
            objectId: object.id,
            fallbackTitle: object.code.isEmpty ? object.name : object.code,
            fallbackSubtitle: object.name,
            floorName: floorName,
            buildingName: buildingName,
            projectName: projectName,
          ),
        ),
      ),
    );
  }
}
