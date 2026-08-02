import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../auth/domain/entities/app_user.dart';
import '../../../auth/presentation/providers/auth_provider.dart';
import '../../data/models/project_model.dart';
import '../../data/models/service_request_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../../domain/entities/risk_level.dart';
import '../../domain/entities/service_request_enums.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/notifications_sheet.dart';
import '../widgets/risk_glyph.dart';
import '../widgets/risk_widgets.dart';
import '../widgets/service_request_card.dart';
import 'building_detail_screen.dart';
import 'customer_shell_screen.dart';
import 'service_request_detail_screen.dart';

/// s-home: the customer's own summary.
///
/// Every figure is a sum of values the API supplied. The prototype's donut and its
/// six-month SLA trend are replaced by the two roll-ups the contract can actually
/// support - per-band device counts, which the backend computes per building, and
/// the SLA state the backend reports per request - because there is no endpoint
/// behind a historical trend and drawing one would mean inventing the data.
class CustomerHomeScreen extends ConsumerWidget {
  const CustomerHomeScreen({super.key, required this.onOpenTab});

  final ValueChanged<int> onOpenTab;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AppUser? user = ref.watch(currentUserProvider);
    final CustomerScope scope = ref.watch(customerScopeProvider);

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: user?.fullName ?? 'Хэрэглэгч',
        subtitle: 'Сайн байна уу,',
        showBack: false,
        action: NotificationBell(
          onTap: () => NotificationsSheet.show(
            context,
            onOpenRequest: (String requestId) => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => ServiceRequestDetailScreen(requestId: requestId),
              ),
            ),
          ),
        ),
      ),
      body: scope is! ResolvedCustomerScope
          ? const CustomerScopeUnavailableView()
          : RefreshIndicator(
              onRefresh: () async => ref.invalidate(customerHomeSummaryProvider),
              child: CustomerAsyncView<CustomerHomeSummary>(
                value: ref.watch(customerHomeSummaryProvider),
                onRetry: () => ref.invalidate(customerHomeSummaryProvider),
                builder: (BuildContext ctx, CustomerHomeSummary summary) =>
                    _HomeBody(summary: summary, onOpenTab: onOpenTab),
              ),
            ),
    );
  }
}

class _HomeBody extends StatelessWidget {
  const _HomeBody({required this.summary, required this.onOpenTab});

  final CustomerHomeSummary summary;
  final ValueChanged<int> onOpenTab;

  @override
  Widget build(BuildContext context) {
    final List<ServiceRequestListItemModel> active = summary.activeRequests;
    final BuildingModel? worstBuilding =
        summary.criticalBuildings.isEmpty ? null : summary.criticalBuildings.first;

    return ListView(
      padding: const EdgeInsets.only(
        top: 4,
        bottom: CustomerTokens.scrollBottomSpacer,
      ),
      children: <Widget>[
        KpiStrip(
          tiles: <KpiTile>[
            KpiTile(value: '${summary.buildings.length}', label: 'Барилга'),
            // The band's own colour and glyph, so the figure cannot disagree with
            // the chips and the legend below it.
            KpiTile(
              value: '${summary.attentionCount}',
              label: 'Анхаарах',
              valueColor: RiskLevel.attention.solidBackground,
              level: RiskLevel.attention,
            ),
            KpiTile(
              value: '${summary.criticalCount}',
              label: 'Эрсдэл',
              valueColor: RiskLevel.critical.solidBackground,
              level: RiskLevel.critical,
            ),
            KpiTile(
              value: '${active.length}',
              label: 'Хүсэлт',
              valueColor: CustomerTokens.blue,
            ),
          ],
        ),

        const SectionCaption('Нэгдсэн тайлангийн хураангуй', topPadding: 4),
        _RiskRollUpCard(summary: summary),
        const RiskLegend(),

        const SectionCaption('Хүсэлтийн төлөв'),
        _RequestStatusCard(summary: summary),

        if (worstBuilding != null)
          NoticeBanner.alert(
            text: '${worstBuilding.name} барилгад ноцтой эрсдэлтэй төхөөрөмж '
                'бүртгэгдсэн байна. Дэлгэрэнгүйг харна уу.',
            onTap: () => Navigator.of(context).push(
              MaterialPageRoute<void>(
                builder: (_) => BuildingDetailScreen(building: worstBuilding),
              ),
            ),
          ),

        const SectionCaption('Ойрын хүсэлтүүд'),
        if (active.isEmpty)
          const CustomerEmptyState(
            icon: Icons.inbox_outlined,
            message: 'Идэвхтэй хүсэлт алга байна.',
          )
        else
          for (final ServiceRequestListItemModel request in active.take(3))
            ServiceRequestCard(
              request: request,
              onTap: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => ServiceRequestDetailScreen(requestId: request.id),
                ),
              ),
            ),

        if (active.length > 3)
          Padding(
            padding: const EdgeInsets.fromLTRB(
              CustomerTokens.gutter,
              4,
              CustomerTokens.gutter,
              0,
            ),
            child: OutlinedButton(
              onPressed: () => onOpenTab(2),
              child: Text('Бүх хүсэлт (${summary.requests.length})'),
            ),
          ),
      ],
    );
  }
}

/// Replaces the prototype's donut: the healthy share as one figure, and the exact
/// per-band counts beside it.
class _RiskRollUpCard extends StatelessWidget {
  const _RiskRollUpCard({required this.summary});

  final CustomerHomeSummary summary;

  @override
  Widget build(BuildContext context) {
    final int? healthy = summary.healthyPercent;

    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Container(
                width: 92,
                height: 92,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: CustomerTokens.paper,
                  border: Border.all(
                    color: healthy == null
                        ? CustomerTokens.line
                        : RiskLevel.normal.solidBackground,
                    width: 4,
                  ),
                ),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    Text(
                      healthy == null ? '-' : '$healthy',
                      style: CustomerTokens.monoDisplay,
                    ),
                    const SizedBox(height: 3),
                    const Text('ХЭВИЙН %', style: CustomerTokens.navLabel),
                  ],
                ),
              ),
              const SizedBox(width: 14),
              Expanded(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    for (final RiskLevel level in RiskLevel.values)
                      _LegendRow(
                        level: level,
                        count: summary.countOf(level),
                      ),
                    if (summary.unassessedCount > 0)
                      _LegendRow(
                        level: null,
                        count: summary.unassessedCount,
                      ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 10),
          Text(
            summary.deviceTotal == 0
                ? 'Танай байгууллагад бүртгэлтэй объект алга байна.'
                : 'Нийт ${summary.deviceTotal} объектоос ${summary.assessedTotal} '
                    'нь үнэлгээтэй.',
            style: CustomerTokens.rowSub.copyWith(height: 1.5),
          ),
        ],
      ),
    );
  }
}

class _LegendRow extends StatelessWidget {
  const _LegendRow({required this.level, required this.count});

  /// Null is the `unassessed` display state, not a band.
  final RiskLevel? level;
  final int count;

  @override
  Widget build(BuildContext context) {
    final String label = level?.label ?? unassessedLabel;

    return Padding(
      padding: const EdgeInsets.only(bottom: 5),
      child: Semantics(
        label: '$label $count',
        excludeSemantics: true,
        child: Row(
          children: <Widget>[
            RiskGlyph(level: level, size: 9),
            const SizedBox(width: 6),
            Expanded(
              child: Text(
                label,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: CustomerTokens.sectionLabel.copyWith(letterSpacing: 0),
              ),
            ),
            Text('$count', style: CustomerTokens.monoSub),
          ],
        ),
      ),
    );
  }
}

/// The prototype's request-status bars.
///
/// The three rows are active, completed and cancelled. COMPLETED and CANCELLED are
/// the only two statuses with no outgoing transition in the shared workflow map, so
/// splitting there groups nothing that the workflow does not already group.
class _RequestStatusCard extends StatelessWidget {
  const _RequestStatusCard({required this.summary});

  final CustomerHomeSummary summary;

  @override
  Widget build(BuildContext context) {
    final int active = summary.activeRequests.length;
    final int completed = summary.requests
        .where((ServiceRequestListItemModel r) =>
            r.status == ServiceRequestStatus.completed)
        .length;
    final int cancelled = summary.requests
        .where((ServiceRequestListItemModel r) =>
            r.status == ServiceRequestStatus.cancelled)
        .length;
    final int breached = summary.activeRequests
        .where((ServiceRequestListItemModel r) =>
            r.slaState == SlaState.breached || r.slaState == SlaState.late)
        .length;
    final int total =
        <int>[active, completed, cancelled].fold(0, (int a, int b) => a + b);

    return PanelCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          _Bar(
            label: 'Идэвхтэй',
            count: active,
            total: total,
            colour: CustomerTokens.blue,
          ),
          _Bar(
            label: ServiceRequestStatus.completed.label,
            count: completed,
            total: total,
            colour: CustomerTokens.green,
          ),
          _Bar(
            label: ServiceRequestStatus.cancelled.label,
            count: cancelled,
            total: total,
            colour: CustomerTokens.muted,
          ),
          const SizedBox(height: 8),
          Text(
            breached == 0
                ? 'Идэвхтэй хүсэлтүүд SLA хугацаандаа байна.'
                : 'Идэвхтэй хүсэлтээс $breached нь SLA хугацаа хэтэрсэн байна.',
            style: CustomerTokens.rowSub.copyWith(
              color: breached == 0 ? CustomerTokens.muted : CustomerTokens.ink,
              fontWeight: breached == 0 ? FontWeight.w400 : FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _Bar extends StatelessWidget {
  const _Bar({
    required this.label,
    required this.count,
    required this.total,
    required this.colour,
  });

  final String label;
  final int count;
  final int total;
  final Color colour;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 9),
      child: Row(
        children: <Widget>[
          SizedBox(
            width: 72,
            child: Text(
              label,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
              style: CustomerTokens.sectionLabel.copyWith(letterSpacing: 0),
            ),
          ),
          const SizedBox(width: 7),
          Expanded(
            child: ClipRRect(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusPill),
              child: LinearProgressIndicator(
                value: total == 0 ? 0 : count / total,
                minHeight: 8,
                backgroundColor: CustomerTokens.soft,
                valueColor: AlwaysStoppedAnimation<Color>(colour),
              ),
            ),
          ),
          const SizedBox(width: 7),
          SizedBox(
            width: 28,
            child: Text(
              '$count',
              textAlign: TextAlign.right,
              style: CustomerTokens.monoSub,
            ),
          ),
        ],
      ),
    );
  }
}
