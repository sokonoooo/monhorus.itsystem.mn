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
    // The stage the server groups this request under, when it sent one: that is the
    // word the office and the dispatch board print for the same job, and a list row's
    // only job is to say where the work has got to. Falls back to the status, which
    // carries an administrator's rename of its own where the two are one to one.
    final String? step = request.stepLabel;
    final AccentTone statusTone = request.stepTone;
    final double? fraction = status?.progress;
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
                    if (step != null) StatusPill(label: step, tone: statusTone),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  _subtitle,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: CustomerTokens.rowSub,
                ),
                // Drawn only when the status has a position on the workflow to
                // report. A cancelled request — and any status off the linear path —
                // gets no rail at all, because a rail is a fill and every fill this
                // card could pick for one would be invented. The status pill above
                // already says what happened.
                if (fraction != null) ...<Widget>[
                  const SizedBox(height: 8),
                  ProgressRail(fraction: fraction, color: railColor),
                ],
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

