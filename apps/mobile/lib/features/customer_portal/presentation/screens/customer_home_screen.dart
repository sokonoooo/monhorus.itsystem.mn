import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/risk_level.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/blueprint_ui.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/notifications_sheet.dart';
import '../widgets/service_request_card.dart';
import 'building_detail_screen.dart';
import 'service_request_detail_screen.dart';

/// s-home: the customer's own summary, in the steel blueprint direction.
///
/// The dark hero band carries the wordmark, the one sentence that says how bad things
/// are, and the risk stair - the five band counts as five columns, which replaces the
/// old KPI strip, roll-up card and legend. Below it the page is a technical listing:
/// hairline building rows worst-first, the request-status bars, the nearest requests
/// and one framed action.
///
/// Every figure is still a sum of values the API supplied. The prototype's donut and
/// its six-month SLA trend stay out, because there is no endpoint behind a historical
/// trend and drawing one would mean inventing the data.
class CustomerHomeScreen extends ConsumerWidget {
  const CustomerHomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);
    final CustomerScope scope = ref.watch(customerScopeProvider);
    final bool resolved = scope is ResolvedCustomerScope;

    // Watched here rather than only inside the async view because the hero needs the
    // summary too, and it is painted above the view. An unlinked account never asks:
    // the provider would throw before any read, and the body explains itself instead.
    final AsyncValue<CustomerHomeSummary>? summaryAsync =
        resolved ? ref.watch(customerHomeSummaryProvider) : null;
    final CustomerHomeSummary? summary = summaryAsync?.valueOrNull;

    return Scaffold(
      backgroundColor: CustomerTokens.bg,
      // No top SafeArea: the hero pays for the status-bar inset itself so its navy
      // runs flush to the top of the display.
      body: Column(
        children: <Widget>[
          SteelHero(
            title: 'soko',
            subtitle: summary == null
                ? 'Сайн байна уу, ${user?.fullName ?? 'Хэрэглэгч'}'
                : '${summary.buildings.length} БАРИЛГА · '
                    '${_formatDate(DateTime.now())}',
            headline: _headline(summary),
            stair: summary == null
                ? const <RiskStairStep>[]
                : <RiskStairStep>[
                    for (final RiskLevel level in RiskLevel.values)
                      (
                        band: level.solidBackground,
                        count: summary.countOf(level),
                        label: level.shortLabel.toUpperCase(),
                      ),
                  ],
            action: const _HeroNotificationBell(),
          ),
          Expanded(
            child: summaryAsync == null
                ? const CustomerScopeUnavailableView()
                : RefreshIndicator(
                    onRefresh: () async =>
                        ref.invalidate(customerHomeSummaryProvider),
                    child: CustomerAsyncView<CustomerHomeSummary>(
                      value: summaryAsync,
                      onRetry: () => ref.invalidate(customerHomeSummaryProvider),
                      builder: (BuildContext ctx, CustomerHomeSummary data) =>
                          _HomeBody(summary: data, onOpenTab: onOpenTab),
                    ),
                  ),
          ),
        ],
      ),
    );
  }

  /// The one sentence the hero exists for. Worst state first; the neutral line only
  /// when the API really did report nothing wrong.
  String _headline(CustomerHomeSummary? summary) {
    if (summary == null) return 'Барилгын эрсдэлийн тойм';
    if (summary.criticalCount > 0) {
      return '${summary.criticalCount} төхөөрөмж яаралтай засвар шаардлагатай';
    }
    if (summary.attentionCount > 0) {
      return '${summary.attentionCount} төхөөрөмж анхаарал шаардаж байна';
    }
    if (summary.deviceTotal == 0) return 'Бүртгэлтэй объект алга байна';
    return 'Бүх төхөөрөмж хэвийн ажиллаж байна';
  }
}

/// `YYYY.MM.DD`. Written out rather than pulled from `intl`, which this app does not
/// depend on, and which would be a package for four lines of padding.
String _formatDate(DateTime date) {
  final DateTime local = date.toLocal();
  final String month = local.month.toString().padLeft(2, '0');
  final String day = local.day.toString().padLeft(2, '0');
  return '${local.year}.$month.$day';
}

/// The shell's notification bell, restated for the dark hero: the same sheet, the same
/// unread count, drawn as a [HeroIconButton] instead of a paper [NavChip].
class _HeroNotificationBell extends ConsumerWidget {
  const _HeroNotificationBell();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<int> unread = ref.watch(unreadNotificationCountProvider);
    final int count = unread.valueOrNull ?? 0;

    return Stack(
      clipBehavior: Clip.none,
      children: <Widget>[
        HeroIconButton(
          icon: Icons.notifications_none,
          tooltip: 'Мэдэгдэл',
          onTap: () => NotificationsSheet.show(
            context,
            onOpenRequest: (String requestId) => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ServiceRequestDetailScreen(requestId: requestId),
              ),
            ),
          ),
        ),
        if (count > 0)
          Positioned(
            top: -4,
            right: -4,
            child: Container(
              width: 17,
              height: 17,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: CustomerTokens.red,
                shape: BoxShape.circle,
                border: Border.all(color: CustomerTokens.hero, width: 2),
              ),
              child: Text(
                count > 9 ? '9+' : '$count',
                style: CustomerTokens.navLabel.copyWith(
                  fontWeight: FontWeight.w800,
                  color: CustomerTokens.white,
                ),
              ),
            ),
          ),
      ],
    );
  }
}

class _HomeBody extends StatelessWidget {
  const _HomeBody({required this.summary, required this.onOpenTab});

  final CustomerHomeSummary summary;
  final ValueChanged<int> onOpenTab;

  /// Worst first: a building the backend flagged critical outranks everything, then
  /// the severity of its own worst band.
  List<BuildingModel> get _ranked {
    final List<BuildingModel> buildings =
        List<BuildingModel>.of(summary.buildings);
    buildings.sort((BuildingModel a, BuildingModel b) {
      final int critical = _criticalRank(b) - _criticalRank(a);
      if (critical != 0) return critical;
      return _severity(b) - _severity(a);
    });
    return buildings;
  }

  static int _criticalRank(BuildingModel building) =>
      building.riskSummary.hasCritical ? 1 : 0;

  /// `RiskLevel.values` runs best-first, so a higher index is a worse band. An
  /// unassessed building has no band at all and sorts below every one of them.
  static int _severity(BuildingModel building) =>
      building.riskSummary.worstLevel?.index ?? -1;

  @override
  Widget build(BuildContext context) {
    final List<ServiceRequestListItemModel> active = summary.activeRequests;
    final BuildingModel? worstBuilding = summary.criticalBuildings.isEmpty
        ? null
        : summary.criticalBuildings.first;

    return ListView(
      padding: EdgeInsets.zero,
      physics: const AlwaysScrollableScrollPhysics(),
      children: <Widget>[
        SectionHead(
          kicker: 'БҮХ БАРИЛГА · ЭРСДЭЛЭЭР',
          actionLabel: 'Бүгдийг харах',
          onAction: () => onOpenTab(1),
        ),
        if (summary.buildings.isEmpty)
          const CustomerEmptyState(
            icon: Icons.apartment_outlined,
            message: 'Бүртгэлтэй барилга алга байна.',
          )
        else
          BlueprintRowList(
            rows: <Widget>[
              for (final BuildingModel building in _ranked.take(4))
                _buildingRow(context, building),
            ],
          ),

        if (worstBuilding != null) ...<Widget>[
          const SizedBox(height: 14),
          NoticeBanner.alert(
            text: '${worstBuilding.name} барилгад ноцтой эрсдэлтэй төхөөрөмж '
                'бүртгэгдсэн байна. Дэлгэрэнгүйг харна уу.',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => BuildingDetailScreen(building: worstBuilding),
              ),
            ),
          ),
        ],

        SectionHead(
          kicker: 'ОЙРЫН ХҮСЭЛТҮҮД',
          actionLabel: active.length > 3 ? 'Бүгдийг харах' : null,
          onAction: () => onOpenTab(2),
        ),
        if (active.isEmpty)
          const CustomerEmptyState(
            icon: Icons.inbox_outlined,
            message: 'Идэвхтэй хүсэлт алга байна.',
          )
        else ...<Widget>[
          const SizedBox(height: 14),
          for (final ServiceRequestListItemModel request in active.take(3))
            ServiceRequestCard(
              request: request,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) =>
                      ServiceRequestDetailScreen(requestId: request.id),
                ),
              ),
            ),
        ],

        const SizedBox(height: CustomerTokens.scrollBottomSpacer),
      ],
    );
  }

  Widget _buildingRow(BuildContext context, BuildingModel building) {
    final RiskLevel? worst = building.riskSummary.worstLevel;
    final DateTime? assessed = building.riskSummary.lastAssessedAt;

    return BlueprintRow(
      band: worst?.solidBackground ?? CustomerTokens.muted,
      name: building.name,
      subtitle: building.address ?? building.projectName ?? '',
      stateLabel: worst?.label ?? unassessedLabel,
      metaLabel: 'ШАЛГАСАН',
      metaValue: assessed == null ? '—' : _formatDate(assessed),
      onTap: () => Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => BuildingDetailScreen(building: building),
        ),
      ),
    );
  }
}
