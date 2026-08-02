import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/service_request_model.dart';
import '../../domain/entities/customer_scope.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/service_request_card.dart';
import 'customer_shell_screen.dart';
import 'service_request_detail_screen.dart';

/// s-requests: the customer's own service requests.
///
/// The tabs split on the workflow's own terminal statuses rather than on a grouping
/// of this app's invention: COMPLETED and CANCELLED are the two statuses with no
/// outgoing transition in the shared map, so everything else is still in flight.
///
/// The split happens client-side because the list endpoint takes a single `status`
/// value and "active" spans twelve of the fourteen.
class ServiceRequestListScreen extends ConsumerStatefulWidget {
  const ServiceRequestListScreen({super.key});

  @override
  ConsumerState<ServiceRequestListScreen> createState() =>
      _ServiceRequestListScreenState();
}

enum _RequestFilter { active, finished, all }

class _ServiceRequestListScreenState
    extends ConsumerState<ServiceRequestListScreen> {
  _RequestFilter _filter = _RequestFilter.active;

  @override
  Widget build(BuildContext context) {
    final CustomerScope scope = ref.watch(customerScopeProvider);

    return CustomerScaffold(
      navBar: const CustomerNavBar(
        title: 'Миний хүсэлт',
        subtitle: 'Илгээсэн дуудлага, засварын явц',
        showBack: false,
      ),
      body: scope is! ResolvedCustomerScope
          ? const CustomerScopeUnavailableView()
          : Column(
              children: <Widget>[
                TabRow(
                  labels: const <String>['Идэвхтэй', 'Дууссан', 'Бүгд'],
                  selectedIndex: _filter.index,
                  onSelected: (int index) => setState(
                    () => _filter = _RequestFilter.values[index],
                  ),
                ),
                Expanded(
                  child: RefreshIndicator(
                    onRefresh: () async =>
                        ref.invalidate(customerServiceRequestsProvider),
                    child: CustomerAsyncView<List<ServiceRequestListItemModel>>(
                      value: ref.watch(customerServiceRequestsProvider),
                      onRetry: () =>
                          ref.invalidate(customerServiceRequestsProvider),
                      builder: (
                        BuildContext ctx,
                        List<ServiceRequestListItemModel> requests,
                      ) =>
                          _buildList(ctx, requests),
                    ),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildList(
    BuildContext context,
    List<ServiceRequestListItemModel> requests,
  ) {
    final List<ServiceRequestListItemModel> visible = switch (_filter) {
      _RequestFilter.active => requests
          .where((ServiceRequestListItemModel r) => r.status?.isActive ?? true)
          .toList(growable: false),
      _RequestFilter.finished => requests
          .where((ServiceRequestListItemModel r) => r.status?.isTerminal ?? false)
          .toList(growable: false),
      _RequestFilter.all => requests,
    };

    final String caption = switch (_filter) {
      _RequestFilter.active => 'Идэвхтэй хүсэлтүүд',
      _RequestFilter.finished => 'Дууссан хүсэлтүүд',
      _RequestFilter.all => 'Бүх хүсэлт',
    };

    return ListView(
      padding: const EdgeInsets.only(
        bottom: CustomerTokens.scrollBottomSpacer,
      ),
      children: <Widget>[
        SectionCaption(caption, topPadding: 6),
        if (visible.isEmpty)
          CustomerEmptyState(
            icon: Icons.inbox_outlined,
            message: requests.isEmpty
                ? 'Танай байгууллагаас илгээсэн хүсэлт алга байна.'
                : 'Энэ шүүлтүүрт тохирох хүсэлт алга байна.',
          )
        else
          for (final ServiceRequestListItemModel request in visible)
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
    );
  }
}
