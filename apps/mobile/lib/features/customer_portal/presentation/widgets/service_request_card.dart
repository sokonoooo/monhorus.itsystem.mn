import 'package:flutter/material.dart';

import '../../data/models/service_request_model.dart';
import '../../domain/entities/service_request_enums.dart';
import '../theme/customer_tokens.dart';
import 'customer_ui.dart';

/// The prototype's `.req-card`.
///
/// The urgent variant takes the red border and tint. Urgency is the API's boolean
/// `isUrgent`, not a three-level priority: the contract has no priority field, so
/// the prototype's low/medium/high chooser is rendered as the one flag the backend
/// actually stores.
class ServiceRequestCard extends StatelessWidget {
  const ServiceRequestCard({super.key, required this.request, this.onTap});

  final ServiceRequestListItemModel request;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final ServiceRequestStatus? status = request.status;
    final AccentTone statusTone = status?.tone ?? AccentTone.neutral;
    final Color railColor = request.isUrgent
        ? CustomerTokens.red
        : statusTone.foreground;

    return Padding(
      padding: const EdgeInsets.fromLTRB(
        CustomerTokens.gutter,
        0,
        CustomerTokens.gutter,
        7,
      ),
      child: Material(
        color: request.isUrgent ? CustomerTokens.redBg : CustomerTokens.white,
        borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 12),
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(CustomerTokens.radiusRow),
              border: Border.all(
                color: request.isUrgent
                    ? CustomerTokens.redBorder
                    : CustomerTokens.line,
                width: CustomerTokens.hairline,
              ),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  _title,
                  style: CustomerTokens.rowTitle.copyWith(
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 6),
                Wrap(
                  spacing: 7,
                  runSpacing: 5,
                  children: <Widget>[
                    if (request.isUrgent)
                      const StatusPill(
                        label: 'Яаралтай',
                        tone: AccentTone.red,
                        showDot: true,
                      ),
                    if (status != null)
                      StatusPill(label: status.label, tone: statusTone),
                    if (request.requestType != null)
                      StatusPill(
                        label: request.requestType!.label,
                        tone: AccentTone.neutral,
                      ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: CustomerTokens.rowSub,
                ),
                const SizedBox(height: 8),
                ProgressRail(
                  fraction: status?.progress ?? 0,
                  color: railColor,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  String get _title {
    final String device = request.device?.name ?? '';
    if (device.isEmpty) return request.requestNumber;
    return '${request.requestNumber} · $device';
  }

  String get _subtitle {
    final List<String> parts = <String>[
      if (request.locationLine.isNotEmpty) request.locationLine,
      request.assigneeLine,
    ];
    return parts.join(' · ');
  }
}

/// A one-line SLA read-out. Negative remaining minutes mean the window is overdue,
/// which the backend reports rather than clamping, so it is shown as overdue here.
class SlaLine extends StatelessWidget {
  const SlaLine({super.key, required this.request});

  final ServiceRequestListItemModel request;

  @override
  Widget build(BuildContext context) {
    final SlaState? state = request.slaState;
    final int? remaining = request.slaRemainingMinutes;

    final String text;
    if (remaining == null) {
      text = state?.label ?? 'SLA мэдээлэлгүй';
    } else if (remaining < 0) {
      text = '${_hours(-remaining)} хугацаа хэтэрсэн';
    } else {
      text = '${_hours(remaining)} үлдсэн';
    }

    return StatusPill(
      label: text,
      tone: state?.tone ?? AccentTone.neutral,
    );
  }

  static String _hours(int minutes) {
    if (minutes < 60) return '$minutes мин';
    final int hours = minutes ~/ 60;
    final int rest = minutes % 60;
    return rest == 0 ? '$hours ц' : '$hours ц $rest мин';
  }
}
