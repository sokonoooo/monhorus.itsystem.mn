import 'package:flutter/material.dart';

import '../../../presentation/theme/employee_tokens.dart';
import '../../../shared/service_request_models.dart';
import '../../../shared/service_request_vocabulary.dart';
import '../format.dart';
import 'work_ui.dart';

/// One service request row, in the "Хүсэлт" segment AND in the "Нээлттэй" pool.
///
/// The same card for both, because it is the same record and the same facts; what
/// differs is only whether [onClaim] is supplied. A row the reader already holds has
/// nothing to claim, so the segment that lists their own work passes null and the
/// button is simply absent.
///
/// Carries the prototype's per-row "Ажил авах", which this card went without for a real
/// reason: the only route onto a request used to be `/service-requests/:id/assign`,
/// guarded by `dispatch.assign` — a key the field tier does not hold — and it assigns an
/// arbitrary employee rather than the caller, so the button could only ever have returned
/// 403. `POST /service-requests/:id/claim` takes no employee at all, resolves the claimer
/// from the session and answers to `service_request.claim`, which a technician does hold.
///
/// The button is drawn only when [onClaim] is supplied, which the pane decides from the
/// live permission set rather than from the role string.
///
/// THE ROW OPENS. It used to say here that there was no request detail screen in this app,
/// and that stopped being true when [ServiceRequestDetailScreen] was added for the Нүүр
/// tab's urgent list — but this card was never given a tap target, so the one segment whose
/// whole purpose is deciding whether to take a job was the one place a technician could not
/// open it and read the fault description first. Tapping the card and tapping "Өөртөө авах"
/// are deliberately different acts: the row opens the request, the button takes it.
///
/// Every figure comes from the server: the SLA countdown is the backend's own
/// `slaRemainingMinutes`, which already accounts for authorised extensions, and the
/// urgency band is its `slaState`. Nothing here recomputes what is late.
class OpenRequestCard extends StatelessWidget {
  const OpenRequestCard({
    super.key,
    required this.request,
    this.onTap,
    this.onClaim,
    this.claiming = false,
    this.disabled = false,
  });

  final ServiceRequestListItemModel request;

  /// Opens the request. Independent of [onClaim] and of any permission: reading a request
  /// in the open queue is what `service_request.view` — the key this whole segment is
  /// gated on — already allows, so a row that cannot be claimed is still a row that can
  /// be read.
  final VoidCallback? onTap;

  /// Null when the caller may not claim, which removes the action entirely rather than
  /// showing a control that refuses.
  final VoidCallback? onClaim;

  /// This row's own claim is in flight.
  final bool claiming;

  /// Another row's claim is in flight. The action stays visible but is inert, so a
  /// technician cannot start a second claim while the first is still settling.
  final bool disabled;

  @override
  Widget build(BuildContext context) {
    final SlaState? sla = request.slaState;
    final Color slaTone = _toneOf(sla?.band);
    final bool needsAttention = request.needsAttention;

    return WorkCard(
      accent: needsAttention ? EmployeeTokens.red : null,
      onTap: onTap,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              Expanded(
                child: Text(
                  request.requestNumber,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style:
                      EmployeeTokens.sectionLabel.copyWith(letterSpacing: 0.5),
                ),
              ),
              const SizedBox(width: 8),
              if (request.isUrgent) ...<Widget>[
                const EmployeePill(
                  label: 'Яаралтай',
                  tone: Tone.red,
                  showDot: true,
                ),
                const SizedBox(width: 6),
              ],
              EmployeePill.status(
                label: request.status?.label ?? 'Эзэнгүй',
                color: _toneOf(request.status?.band),
              ),
            ],
          ),
          const SizedBox(height: 7),
          Text(
            request.subjectLabel,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: EmployeeTokens.cardTitle,
          ),
          if (request.locationLabel.isNotEmpty) ...<Widget>[
            const SizedBox(height: 4),
            Text(
              request.locationLabel,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: EmployeeTokens.rowSub,
            ),
          ],
          const SizedBox(height: 6),
          InfoRow(
            label: 'Төрөл',
            value: request.requestType?.label ?? kNoValue,
          ),
          InfoRow(
            label: sla == null ? 'SLA' : 'SLA · ${sla.label}',
            value: formatSlaRemaining(request.slaRemainingMinutes),
            tone:
                slaTone == EmployeeTokens.muted ? EmployeeTokens.ink : slaTone,
          ),
          InfoRow(
            label: 'Бүртгэсэн',
            value: formatShortStamp(request.createdAt),
            divider: false,
          ),
          if (onClaim != null) ...<Widget>[
            const SizedBox(height: 10),
            WorkButton(
              label: 'Өөртөө авах',
              busy: claiming,
              onPressed: claiming || disabled ? null : onClaim,
            ),
          ],
        ],
      ),
    );
  }

  /// The domain's severity band as this tab's status colour.
  ///
  /// `neutral` and an unknown band both read as muted, which is what the planned-work
  /// card does for a status with nothing at stake — colour means risk on this screen and
  /// nothing else.
  static Color _toneOf(SeverityBand? band) {
    switch (band) {
      case SeverityBand.red:
        return EmployeeTokens.red;
      case SeverityBand.yellow:
        return EmployeeTokens.yellow;
      case SeverityBand.green:
        return EmployeeTokens.green;
      case SeverityBand.ink:
        return EmployeeTokens.ink;
      case SeverityBand.neutral:
      case null:
        return EmployeeTokens.muted;
    }
  }
}
