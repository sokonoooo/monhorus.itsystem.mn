import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../data/models/object_models.dart';
import '../../data/models/project_models.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/project_providers.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/floor_plan_markers.dart';
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
            _FloorPlanSection(
              floorId: floorId,
              floorName: current?.name ?? floorName,
              buildingName: buildingName,
              projectName: projectName,
            ),

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

/// The floor plan, with a coloured dot per placed device.
///
/// `FloorPlanDto` carries the image alone, but the coordinate is not on it and never
/// was: it is `planPosition` on each object, the normalised x/y an administrator
/// placed on the admin web. The dots are read-only here — placing and moving them
/// needs `object_master.manage`, which a technician deliberately does not hold.
class _FloorPlanSection extends ConsumerWidget {
  const _FloorPlanSection({
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
    // The same provider the device list below already watches, so the markers cost no
    // extra request. Left unwatched without `object_master.view`: the objects endpoint
    // would answer 403 and there would be nothing to draw anyway.
    final List<ObjectListItemModel> objects = ref.watch(canViewDevicesProvider)
        ? (ref.watch(floorObjectsProvider(floorId)).valueOrNull ??
            const <ObjectListItemModel>[])
        : const <ObjectListItemModel>[];
    final List<ObjectListItemModel> onPlan = planMarkersOf(objects);
    final int unplaced = unplacedOnPlanCount(objects);

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
                    child: AuthenticatedImage.sizedToImage(
                      fileId: plan.fileId,
                      overlay: FloorPlanMarkerLayer(
                        objects: onPlan,
                        onTap: (ObjectListItemModel object) =>
                            Navigator.of(context).push(
                          MaterialPageRoute<void>(
                            builder: (BuildContext _) => DeviceDetailScreen(
                              objectId: object.id,
                              fallbackTitle:
                                  object.code.isEmpty ? object.name : object.code,
                              fallbackSubtitle: object.name,
                              floorName: floorName,
                              buildingName: buildingName,
                              projectName: projectName,
                            ),
                          ),
                        ),
                      ),
                    ),
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
            Padding(
              padding: const EdgeInsets.fromLTRB(
                EmployeeTokens.labelGutter,
                0,
                EmployeeTokens.labelGutter,
                10,
              ),
              child: Text(
                <String>[
                  'Тэмдэглэгээний өнгө нь тухайн төхөөрөмжийн эрсдэлийн түвшин. '
                      'Дээр нь дарж дэлгэрэнгүйг харна.',
                  // Said out loud, as the admin web says it: a plan with fewer dots
                  // than the floor has devices otherwise reads as a rendering fault.
                  if (unplaced > 0) 'Планд байрлуулаагүй $unplaced төхөөрөмж байна.',
                ].join(' '),
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
