import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/project_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/risk_level.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/risk_widgets.dart';
import 'building_detail_screen.dart';
import 'customer_shell_screen.dart';

/// s-buildings: the customer's own buildings.
///
/// The three tabs filter the fetched list rather than re-querying: the buildings
/// endpoint has no risk parameter, and the roll-up that decides "эрсдэлтэй" is
/// already on every row.
class BuildingListScreen extends ConsumerStatefulWidget {
  const BuildingListScreen({super.key});

  @override
  ConsumerState<BuildingListScreen> createState() => _BuildingListScreenState();
}

enum _BuildingFilter { all, risky, healthy }

class _BuildingListScreenState extends ConsumerState<BuildingListScreen> {
  _BuildingFilter _filter = _BuildingFilter.all;

  @override
  Widget build(BuildContext context) {
    final CustomerScope scope = ref.watch(customerScopeProvider);

    return CustomerScaffold(
      navBar: const CustomerNavBar(
        title: 'Барилга',
        subtitle: 'Төсөл → Барилга → Давхар → Төхөөрөмж',
        showBack: false,
      ),
      body: scope is! ResolvedCustomerScope
          ? const CustomerScopeUnavailableView()
          : Column(
              children: <Widget>[
                TabRow(
                  labels: const <String>['Бүгд', 'Эрсдэлтэй', 'Хэвийн'],
                  selectedIndex: _filter.index,
                  onSelected: (int index) => setState(
                    () => _filter = _BuildingFilter.values[index],
                  ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async =>
                        ref.invalidate(customerBuildingsProvider),
                    child: CustomerAsyncView<List<BuildingModel>>(
                      value: ref.watch(customerBuildingsProvider),
                      onRetry: () => ref.invalidate(customerBuildingsProvider),
                      builder: (BuildContext ctx, List<BuildingModel> buildings) =>
                          _buildList(ctx, buildings),
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildList(BuildContext context, List<BuildingModel> buildings) {
    final List<BuildingModel> visible = switch (_filter) {
      _BuildingFilter.all => buildings,
      _BuildingFilter.risky => buildings
          .where((BuildingModel b) =>
              b.riskSummary.hasCritical || b.riskSummary.attentionCount > 0)
          .toList(growable: false),
      _BuildingFilter.healthy => buildings
          .where((BuildingModel b) =>
              !b.riskSummary.hasCritical && b.riskSummary.attentionCount == 0)
          .toList(growable: false),
    };

    return ListView(
      padding: const EdgeInsets.only(
        bottom: CustomerTokens.scrollBottomSpacer,
      ),
      children: <Widget>[
        const NoticeBanner.info(
          text: 'Энэ хэсгээс өөрийн байгууллагын барилга, давхар, төхөөрөмжийн '
              'эрсдэлийг харна.',
        ),
        const SectionCaption('Миний барилгууд', topPadding: 4),
        if (visible.isEmpty)
          CustomerEmptyState(
            icon: Icons.apartment_outlined,
            message: buildings.isEmpty
                ? 'Танай байгууллагад бүртгэлтэй барилга алга байна.'
                : 'Энэ шүүлтүүрт тохирох барилга алга байна.',
          )
        else
          for (final BuildingModel building in visible)
            BuildingRow(
              building: building,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => BuildingDetailScreen(building: building),
                ),
              ),
            ),
      ],
    );
  }
}

class BuildingRow extends StatelessWidget {
  const BuildingRow({super.key, required this.building, this.onTap});

  final BuildingModel building;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final RiskLevel? worst = building.riskSummary.worstLevel;

    return TappableRow(
      leading: RowTile(
        tone: worst?.tone ?? AccentTone.neutral,
        text: building.shortCode,
        semanticsLabel: worst?.label ?? unassessedLabel,
      ),
      title: building.name,
      subtitle: <String>[
        if (building.projectName != null) building.projectName!,
        '${building.floorCount} давхар',
        '${building.objectCount} объект',
      ].join(' · '),
      // Bounded so a long band label cannot push the title column to zero width.
      trailing: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 116),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            RiskPill(level: worst, flexibleText: true),
            const SizedBox(height: 5),
            RiskSummaryStrip(summary: building.riskSummary, compact: true),
          ],
        ),
      ),
      onTap: onTap,
    );
  }
}
