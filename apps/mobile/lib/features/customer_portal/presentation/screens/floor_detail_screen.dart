import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/object_master_model.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../domain/entities/risk_level.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/floor_plan_markers.dart';
import '../widgets/risk_widgets.dart';
import 'customer_shell_screen.dart';
import 'device_detail_screen.dart';

/// s-floor-detail, with the prototype's three tabs.
class FloorDetailScreen extends ConsumerStatefulWidget {
  const FloorDetailScreen({
    super.key,
    required this.floorId,
    required this.buildingId,
    required this.buildingName,
    this.projectName,
  });

  final String floorId;
  final String buildingId;
  final String buildingName;
  final String? projectName;

  @override
  ConsumerState<FloorDetailScreen> createState() => _FloorDetailScreenState();
}

enum _FloorTab { plan, devices, history }

class _FloorDetailScreenState extends ConsumerState<FloorDetailScreen> {
  _FloorTab _tab = _FloorTab.plan;

  @override
  Widget build(BuildContext context) {
    final AsyncValue<FloorModel> floor = ref.watch(floorProvider(widget.floorId));

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: floor.valueOrNull?.name ?? 'Давхар',
        subtitle: floor.valueOrNull == null
            ? 'Давхарын төхөөрөмжүүд'
            : '${floor.valueOrNull!.objectCount} объект',
      ),
      body: Column(
        children: <Widget>[
          TabRow(
            labels: const <String>['Зураглал', 'Төхөөрөмж', 'Түүх'],
            selectedIndex: _tab.index,
            onSelected: (int index) =>
                setState(() => _tab = _FloorTab.values[index]),
          ),
          Expanded(
            child: CustomerAsyncView<FloorModel>(
              value: floor,
              onRetry: () => ref.invalidate(floorProvider(widget.floorId)),
              builder: (BuildContext ctx, FloorModel data) => _body(ctx, data),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, FloorModel floor) {
    return RefreshIndicator(
      onRefresh: () async {
        ref
          ..invalidate(floorProvider(widget.floorId))
          ..invalidate(floorObjectsProvider(widget.floorId))
          ..invalidate(floorPlanProvider(widget.floorId));
      },
      child: ListView(
        padding: const EdgeInsets.only(bottom: 24),
        children: <Widget>[
          Breadcrumb(
            parts: <String>[
              if (widget.projectName != null) widget.projectName!,
              widget.buildingName,
              floor.name,
            ],
          ),
          switch (_tab) {
            _FloorTab.plan => _PlanTab(floor: floor),
            _FloorTab.devices => _DevicesTab(floorId: widget.floorId),
            _FloorTab.history => _HistoryTab(
                buildingId: widget.buildingId,
                floorId: widget.floorId,
              ),
          },
        ],
      ),
    );
  }
}

/// The "Зураглал" tab.
///
/// The plan image with a coloured dot on every object that carries a `planPosition` -
/// the normalised x/y an administrator placed on the admin web - alongside the floor's
/// per-band counts and the objects that need attention first.
///
/// The dots are read-only here. Placing and moving them needs `object_master.manage`,
/// which no customer role holds.
class _PlanTab extends ConsumerWidget {
  const _PlanTab({required this.floor});

  final FloorModel floor;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<FloorPlanModel?> plan = ref.watch(floorPlanProvider(floor.id));
    final AsyncValue<List<ObjectListItemModel>> objects =
        ref.watch(floorObjectsProvider(floor.id));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        PanelCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              Text(
                '${floor.name} эрсдэлийн төлөв',
                style: CustomerTokens.cardTitle,
              ),
              const SizedBox(height: 8),
              RiskSummaryStrip(summary: floor.riskSummary),
              const SizedBox(height: 10),
              Text(
                floor.riskSummary.isEmpty
                    ? 'Энэ давхрын объектод үнэлгээ бүртгэгдээгүй байна.'
                    : 'Өнгө нь тухайн объектын үнэлгээний зэрэглэлийг илэрхийлнэ. '
                        'Объект дээр дарж дэлгэрэнгүйг харна.',
                style: CustomerTokens.rowSub.copyWith(height: 1.55),
              ),
              if (floor.areaSqm != null) ...<Widget>[
                const SizedBox(height: 8),
                Text(
                  'Талбай: ${formatDecimal(floor.areaSqm)} мкв',
                  style: CustomerTokens.rowSub,
                ),
              ],
            ],
          ),
        ),

        const SectionCaption('Давхрын план'),
        CustomerAsyncView<FloorPlanModel?>(
          value: plan,
          onRetry: () => ref.invalidate(floorPlanProvider(floor.id)),
          builder: (BuildContext ctx, FloorPlanModel? data) {
            if (data == null) {
              return const CustomerEmptyState(
                icon: Icons.map_outlined,
                message: 'Энэ давхарт план зураг ачаалагдаагүй байна.',
              );
            }
            if (!data.isImage) {
              return CustomerEmptyState(
                icon: Icons.description_outlined,
                message: '${data.fileName} файл зураг биш тул энд харуулах '
                    'боломжгүй байна.',
              );
            }
            // The plan renders whether or not the object list has landed: a marker
            // layer is worth waiting a beat for, a picture is not.
            final List<ObjectListItemModel> onPlan =
                planMarkersOf(objects.valueOrNull ?? const <ObjectListItemModel>[]);
            final int unplaced =
                unplacedOnPlanCount(objects.valueOrNull ?? const <ObjectListItemModel>[]);

            return PanelCard(
              padding: EdgeInsets.zero,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  AuthenticatedImage.sizedToImage(
                    fileId: data.fileId,
                    overlay: FloorPlanMarkerLayer(
                      objects: onPlan,
                      onTap: (ObjectListItemModel object) =>
                          Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => DeviceDetailScreen(objectId: object.id),
                        ),
                      ),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisSize: MainAxisSize.min,
                      children: <Widget>[
                        Text(
                          <String>[
                            data.title ?? data.fileName,
                            if (data.uploadedByName != null) data.uploadedByName!,
                            formatDate(data.uploadedAt),
                          ].join(' · '),
                          style: CustomerTokens.rowSub,
                        ),
                        if (unplaced > 0) ...<Widget>[
                          const SizedBox(height: 4),
                          // Said out loud, as the web says it: a plan with fewer dots
                          // than the floor has objects is otherwise read as a fault.
                          Text(
                            'Планд байрлуулаагүй $unplaced объект байна.',
                            style: CustomerTokens.rowSub,
                          ),
                        ],
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        ),

        const SectionCaption('Анхаарах объект'),
        CustomerAsyncView<List<ObjectListItemModel>>(
          value: objects,
          onRetry: () => ref.invalidate(floorObjectsProvider(floor.id)),
          builder: (BuildContext ctx, List<ObjectListItemModel> items) {
            // Anything the backend banded below NORMAL. An unassessed object is
            // deliberately not swept in here: it is an unknown, not a fault.
            final List<ObjectListItemModel> needsAttention = items
                .where((ObjectListItemModel object) =>
                    object.riskLevel != null &&
                    object.riskLevel != RiskLevel.normal)
                .toList(growable: false);

            if (needsAttention.isEmpty) {
              return const CustomerEmptyState(
                icon: Icons.check_circle_outline,
                message: 'Анхаарал шаардсан объект алга байна.',
              );
            }

            final List<ObjectListItemModel> sorted = needsAttention.toList()
              ..sort((ObjectListItemModel a, ObjectListItemModel b) =>
                  (a.score ?? 101).compareTo(b.score ?? 101));

            return Column(
              children: <Widget>[
                for (final ObjectListItemModel object in sorted)
                  DeviceRow(object: object),
              ],
            );
          },
        ),
      ],
    );
  }
}

class _DevicesTab extends ConsumerWidget {
  const _DevicesTab({required this.floorId});

  final String floorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SectionCaption('Бүх объект', topPadding: 0),
        CustomerAsyncView<List<ObjectListItemModel>>(
          value: ref.watch(floorObjectsProvider(floorId)),
          onRetry: () => ref.invalidate(floorObjectsProvider(floorId)),
          builder: (BuildContext ctx, List<ObjectListItemModel> items) {
            if (items.isEmpty) {
              return const CustomerEmptyState(
                icon: Icons.devices_other_outlined,
                message: 'Энэ давхарт бүртгэлтэй объект алга байна.',
              );
            }
            return Column(
              children: <Widget>[
                for (final ObjectListItemModel object in items)
                  DeviceRow(object: object),
              ],
            );
          },
        ),
      ],
    );
  }
}

/// The "Түүх" tab.
///
/// There is no floor-level history endpoint. The service request list accepts a
/// building filter but not a floor one, so this fetches the building's requests and
/// narrows them to this floor using the floor reference each row already carries.
/// The heading says as much rather than implying a complete floor audit trail.
class _HistoryTab extends ConsumerWidget {
  const _HistoryTab({required this.buildingId, required this.floorId});

  final String buildingId;
  final String floorId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        const SectionCaption('Энэ давхрын хүсэлтүүд', topPadding: 0),
        CustomerAsyncView<List<ServiceRequestListItemModel>>(
          value: ref.watch(buildingServiceRequestsProvider(buildingId)),
          onRetry: () =>
              ref.invalidate(buildingServiceRequestsProvider(buildingId)),
          builder: (BuildContext ctx, List<ServiceRequestListItemModel> items) {
            final List<ServiceRequestListItemModel> onThisFloor = items
                .where((ServiceRequestListItemModel r) => r.floor?.id == floorId)
                .toList(growable: false);

            if (onThisFloor.isEmpty) {
              return const CustomerEmptyState(
                icon: Icons.history_outlined,
                message: 'Энэ давхарт бүртгэгдсэн үйлчилгээний хүсэлт алга байна.',
              );
            }

            return Timeline(
              entries: <TimelineEntry>[
                for (int i = 0; i < onThisFloor.length; i++)
                  TimelineEntry(
                    title: <String>[
                      onThisFloor[i].requestNumber,
                      if (onThisFloor[i].device != null)
                        onThisFloor[i].device!.name,
                      onThisFloor[i].status?.label ?? '',
                    ].where((String part) => part.isNotEmpty).join(' · '),
                    meta: formatEventStamp(onThisFloor[i].createdAt),
                    tone: onThisFloor[i].status?.tone ?? AccentTone.neutral,
                    icon: onThisFloor[i].isUrgent
                        ? Icons.priority_high
                        : Icons.assignment_outlined,
                    isLast: i == onThisFloor.length - 1,
                  ),
              ],
            );
          },
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(
            CustomerTokens.labelGutter,
            8,
            CustomerTokens.labelGutter,
            0,
          ),
          child: Text(
            'Тухайн объектын бүрэн түүхийг объектын дэлгэрэнгүй хуудаснаас харна.',
            style: CustomerTokens.rowSub,
          ),
        ),
      ],
    );
  }
}

/// One object row, shared by the plan and device tabs.
class DeviceRow extends StatelessWidget {
  const DeviceRow({super.key, required this.object});

  final ObjectListItemModel object;

  @override
  Widget build(BuildContext context) {
    return TappableRow(
      leading: RowTile(
        tone: object.riskLevel?.tone ?? AccentTone.neutral,
        icon: object.icon.glyph,
        size: 42,
        semanticsLabel: object.riskLevel?.label ?? unassessedLabel,
      ),
      title: object.titleLine,
      subtitle: <String>[
        if (object.status != null) object.status!.label,
        if (object.calculatedLoad.hasValue)
          '${formatDecimal(object.calculatedLoad.valueKw)} kW',
      ].join(' · '),
      trailing: ScorePercentBadge(
        score: object.score,
        level: object.riskLevel,
      ),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => DeviceDetailScreen(objectId: object.id),
        ),
      ),
    );
  }
}
