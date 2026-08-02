import 'package:flutter/material.dart';

import '../../presentation/theme/customer_tokens.dart';
import 'json_utils.dart';

/// Mirrors `NotificationSeverity` / `NOTIFICATION_SEVERITY_LABELS` in
/// packages/shared/src/constants/notification.ts.
enum NotificationSeverity {
  info('INFO', 'Мэдээлэл', AccentTone.blue, Icons.info_outline),
  warning('WARNING', 'Анхааруулга', AccentTone.yellow, Icons.warning_amber_outlined),
  critical('CRITICAL', 'Ноцтой', AccentTone.red, Icons.error_outline);

  const NotificationSeverity(this.wireValue, this.label, this.tone, this.glyph);

  final String wireValue;
  final String label;
  final AccentTone tone;
  final IconData glyph;

  static NotificationSeverity fromWire(String? value) {
    for (final NotificationSeverity severity in NotificationSeverity.values) {
      if (severity.wireValue == value) return severity;
    }
    return NotificationSeverity.info;
  }
}

/// Mirrors `NotificationEvent` / `NOTIFICATION_EVENT_LABELS` in
/// packages/shared/src/constants/notification.ts. All eighteen values, in order.
enum NotificationEvent {
  plannedWorkDueSoon('PLANNED_WORK_DUE_SOON', 'Төлөвлөгөөт ажлын хугацаа дөхсөн'),
  plannedWorkOverdue('PLANNED_WORK_OVERDUE', 'Төлөвлөгөөт ажил хугацаа хэтэрсэн'),
  serviceRequestCreated('SERVICE_REQUEST_CREATED', 'Шинэ дуудлага үүссэн'),
  serviceRequestAssigned('SERVICE_REQUEST_ASSIGNED', 'Дуудлага хуваарилагдсан'),
  serviceRequestReassigned('SERVICE_REQUEST_REASSIGNED', 'Дуудлага дахин хуваарилагдсан'),
  serviceRequestStatusChanged(
      'SERVICE_REQUEST_STATUS_CHANGED', 'Дуудлагын төлөв өөрчлөгдсөн'),
  slaNearBreach('SLA_NEAR_BREACH', 'SLA хугацаа ойртсон'),
  slaBreached('SLA_BREACHED', 'SLA хугацаа зөрчсөн'),
  reportSubmitted('REPORT_SUBMITTED', 'Тайлан илгээсэн'),
  reportApproved('REPORT_APPROVED', 'Тайлан батлагдсан'),
  reportReturned('REPORT_RETURNED', 'Тайлан буцаагдсан'),
  riskAssessmentRaised('RISK_ASSESSMENT_RAISED', 'Эрсдэлтэй үнэлгээ илэрсэн'),
  repairRequired('REPAIR_REQUIRED', 'Засвар шаардлагатай'),
  revisitRequired('REVISIT_REQUIRED', 'Дахин үзлэг шаардлагатай'),
  invoiceIssued('INVOICE_ISSUED', 'Нэхэмжлэл илгээгдсэн'),
  invoiceDueSoon('INVOICE_DUE_SOON', 'Нэхэмжлэлийн төлөх хугацаа дөхсөн'),
  invoiceOverdue('INVOICE_OVERDUE', 'Нэхэмжлэл хугацаа хэтэрсэн');

  const NotificationEvent(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static NotificationEvent? fromWire(String? value) {
    if (value == null) return null;
    for (final NotificationEvent event in NotificationEvent.values) {
      if (event.wireValue == value) return event;
    }
    return null;
  }
}

/// Mirrors `NotificationDto` in
/// packages/shared/src/types/notification.types.ts.
///
/// This is the one list endpoint in the whole customer flow that the backend already
/// scopes to the caller: the filter is `{ recipient: actor.userId }`.
class NotificationModel {
  const NotificationModel({
    required this.id,
    required this.event,
    required this.severity,
    required this.title,
    required this.body,
    required this.entityType,
    required this.entityId,
    required this.linkPath,
    required this.readAt,
    required this.createdAt,
  });

  final String id;
  final NotificationEvent? event;
  final NotificationSeverity severity;
  final String title;
  final String? body;

  /// Free-form on the wire; a service request notification carries the string 'Work'.
  final String? entityType;
  final String? entityId;
  final String? linkPath;

  /// Null means unread.
  final DateTime? readAt;
  final DateTime? createdAt;

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: json['id'] as String,
      event: NotificationEvent.fromWire(json['event'] as String?),
      severity: NotificationSeverity.fromWire(json['severity'] as String?),
      title: json['title'] as String? ?? '',
      body: json['body'] as String?,
      entityType: json['entityType'] as String?,
      entityId: json['entityId'] as String?,
      linkPath: json['linkPath'] as String?,
      readAt: parseDate(json['readAt']),
      createdAt: parseDate(json['createdAt']),
    );
  }

  bool get isUnread => readAt == null;

  /// The service request this notification points at, when it points at one.
  String? get serviceRequestId => entityType == 'Work' ? entityId : null;
}

/// Mirrors `NotificationUnreadCountDto`.
class NotificationUnreadCountModel {
  const NotificationUnreadCountModel({required this.unread});

  final int unread;

  factory NotificationUnreadCountModel.fromJson(Map<String, dynamic> json) {
    return NotificationUnreadCountModel(unread: parseInt(json['unread']) ?? 0);
  }
}
