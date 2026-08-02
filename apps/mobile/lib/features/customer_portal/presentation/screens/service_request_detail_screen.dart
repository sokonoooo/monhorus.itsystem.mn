import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/models/service_request_model.dart';
import '../../domain/entities/service_request_enums.dart';
import '../format.dart';
import '../providers/customer_portal_providers.dart';
import '../theme/customer_tokens.dart';
import '../widgets/authenticated_image.dart';
import '../widgets/customer_async_view.dart';
import '../widgets/customer_ui.dart';
import '../widgets/service_request_card.dart';
import 'customer_shell_screen.dart';

/// s-request-detail: one request, its SLA, its location trail and its progress.
class ServiceRequestDetailScreen extends ConsumerWidget {
  const ServiceRequestDetailScreen({super.key, required this.requestId});

  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<ServiceRequestDetailModel> request =
        ref.watch(serviceRequestDetailProvider(requestId));

    return CustomerScaffold(
      navBar: CustomerNavBar(
        title: request.valueOrNull?.requestNumber ?? 'Хүсэлт',
        subtitle: 'Хүсэлтийн явц',
      ),
      body: RefreshIndicator(
        onRefresh: () async =>
            ref.invalidate(serviceRequestDetailProvider(requestId)),
        child: CustomerAsyncView<ServiceRequestDetailModel>(
          value: request,
          onRetry: () => ref.invalidate(serviceRequestDetailProvider(requestId)),
          builder: (BuildContext ctx, ServiceRequestDetailModel data) =>
              _Body(request: data),
        ),
      ),
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.request});

  final ServiceRequestDetailModel request;

  @override
  Widget build(BuildContext context) {
    final ServiceRequestStatus? status = request.status;

    return ListView(
      padding: const EdgeInsets.only(top: 8, bottom: 24),
      children: <Widget>[
        if (request.locationPath.isNotEmpty)
          Breadcrumb(
            parts: request.locationPath
                .map((ObjectBreadcrumbModel node) => node.name)
                .toList(growable: false),
          ),

        PanelCard(
          accent: request.isUrgent
              ? CustomerTokens.red
              : (status?.tone.foreground ?? CustomerTokens.ink),
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
                          <String>[
                            request.requestNumber,
                            if (request.device != null) request.device!.name,
                          ].join(' · '),
                          style: CustomerTokens.monoLabel.copyWith(
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          request.description,
                          style: CustomerTokens.cardTitle.copyWith(height: 1.35),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 10),
                  if (request.isUrgent)
                    const StatusPill(
                      label: 'Яаралтай',
                      tone: AccentTone.red,
                      showDot: true,
                    ),
                ],
              ),
              const SizedBox(height: 12),
              MetricGrid(
                padded: false,
                cards: <Widget>[
                  MetricCard(
                    label: 'Төлөв',
                    value: status?.label ?? '-',
                    note: request.assigneeLine,
                    valueColor: status?.tone.foreground ?? CustomerTokens.ink,
                  ),
                  MetricCard(
                    label: 'SLA',
                    value: _slaValue,
                    note: request.slaState?.label ?? 'SLA мэдээлэлгүй',
                    valueColor:
                        request.slaState?.tone.foreground ?? CustomerTokens.ink,
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 7,
                runSpacing: 5,
                children: <Widget>[
                  if (request.requestType != null)
                    StatusPill(
                      label: request.requestType!.label,
                      tone: AccentTone.neutral,
                    ),
                  SlaLine(request: request),
                ],
              ),
              const SizedBox(height: 10),
              ProgressRail(
                fraction: status?.progress ?? 0,
                color: request.isUrgent
                    ? CustomerTokens.red
                    : (status?.tone.foreground ?? CustomerTokens.ink),
              ),
            ],
          ),
        ),

        const SectionCaption('Байршил ба холбоо барих'),
        PanelCard(
          padding: EdgeInsets.zero,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              if (request.customer != null)
                _InfoRow('Байгууллага', request.customer!.name),
              if (request.branch != null) _InfoRow('Салбар', request.branch!),
              if (request.project != null)
                _InfoRow('Төсөл', request.project!.name),
              if (request.building != null)
                _InfoRow('Барилга', request.building!.name),
              if (request.floor != null) _InfoRow('Давхар', request.floor!.name),
              if (request.room != null) _InfoRow('Өрөө', request.room!.name),
              if (request.panel != null) _InfoRow('Самбар', request.panel!.name),
              if (request.circuit != null)
                _InfoRow('Хэлхээ', request.circuit!.name),
              if (request.device != null)
                _InfoRow('Төхөөрөмж', request.device!.name),
              _InfoRow('Холбоо барих', request.contactName),
              _InfoRow('Утас', request.contactPhone),
              _InfoRow('Үүсгэсэн', formatDateTime(request.createdAt)),
              if (request.createdByName != null)
                _InfoRow('Үүсгэсэн хүн', request.createdByName!),
              if (request.revisitReason != null)
                _InfoRow('Дахин очих шалтгаан', request.revisitReason!),
              if (request.slaExtensionReason != null)
                _InfoRow('SLA сунгасан шалтгаан', request.slaExtensionReason!),
              _InfoRow('Сүүлд шинэчилсэн', formatDateTime(request.updatedAt)),
            ],
          ),
        ),

        if (request.attachments.isNotEmpty) ...<Widget>[
          const SectionCaption('Хавсралт'),
          for (final ServiceRequestAttachmentModel attachment
              in request.attachments)
            _AttachmentCard(attachment: attachment),
        ],

        const SectionCaption('Үйл явц'),
        if (request.statusHistory.isEmpty)
          const CustomerEmptyState(
            icon: Icons.timeline_outlined,
            message: 'Төлөвийн түүх бүртгэгдээгүй байна.',
          )
        else
          Timeline(
            entries: <TimelineEntry>[
              for (int i = 0; i < request.statusHistory.length; i++)
                TimelineEntry(
                  title: _historyTitle(request.statusHistory[i]),
                  meta: <String>[
                    formatEventStamp(request.statusHistory[i].changedAt),
                    if (request.statusHistory[i].changedByName != null)
                      request.statusHistory[i].changedByName!,
                    if (request.statusHistory[i].reason != null)
                      request.statusHistory[i].reason!,
                  ].join(' · '),
                  tone: request.statusHistory[i].toStatus?.tone ??
                      AccentTone.neutral,
                  icon: Icons.circle_outlined,
                  isLast: i == request.statusHistory.length - 1,
                ),
            ],
          ),
      ],
    );
  }

  String get _slaValue {
    final int? remaining = request.slaRemainingMinutes;
    if (remaining == null) return '-';
    final int hours = (remaining.abs() / 60).floor();
    return remaining < 0 ? '-$hours ц' : '$hours ц';
  }

  static String _historyTitle(ServiceRequestStatusHistoryModel entry) {
    final String to = entry.toStatus?.label ?? '-';
    final ServiceRequestStatus? from = entry.fromStatus;
    return from == null ? '$to төлөвт бүртгэгдсэн' : '${from.label} → $to';
  }
}

/// One label / value line in the location card, forwarded to [DetailRow].
class _InfoRow extends StatelessWidget {
  const _InfoRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) =>
      DetailRow(label: label, value: value, labelWidth: 118);
}

class _AttachmentCard extends StatelessWidget {
  const _AttachmentCard({required this.attachment});

  final ServiceRequestAttachmentModel attachment;

  @override
  Widget build(BuildContext context) {
    return PanelCard(
      padding: EdgeInsets.zero,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          if (attachment.isImage)
            AuthenticatedImage(fileId: attachment.id, height: 180),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Row(
              children: <Widget>[
                Icon(
                  attachment.isImage
                      ? Icons.image_outlined
                      : Icons.description_outlined,
                  size: 18,
                  color: CustomerTokens.muted,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      Text(
                        attachment.name,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: CustomerTokens.rowTitle.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      Text(
                        <String>[
                          formatBytes(attachment.sizeBytes),
                          if (attachment.uploadedByName != null)
                            attachment.uploadedByName!,
                          formatDate(attachment.uploadedAt),
                        ].join(' · '),
                        style: CustomerTokens.rowSub,
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
