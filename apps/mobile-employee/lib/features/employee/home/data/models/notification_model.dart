import '../../domain/entities/work_enums.dart';
import '../../../../../core/util/json_parse.dart';

/// Mirrors `NotificationDto` in packages/shared/src/types/notification.types.ts.
///
/// This is the one list endpoint the home tab reads that the backend already scopes
/// to the caller: the filter is `{ recipient: actor.userId }`. Nothing here needs an
/// employee id, which is why the bell keeps working even when the account cannot be
/// linked to an employee record.
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
  final String? entityType;
  final String? entityId;
  final String? linkPath;

  /// Null means unread.
  final DateTime? readAt;
  final DateTime? createdAt;

  factory NotificationModel.fromJson(Map<String, dynamic> json) {
    return NotificationModel(
      id: parseString(json['id']) ?? '',
      event: NotificationEvent.fromWire(parseString(json['event'])),
      severity: NotificationSeverity.fromWire(parseString(json['severity'])),
      title: parseString(json['title']) ?? '',
      body: parseString(json['body']),
      entityType: parseString(json['entityType']),
      entityId: parseString(json['entityId']),
      linkPath: parseString(json['linkPath']),
      readAt: parseDate(json['readAt']),
      createdAt: parseDate(json['createdAt']),
    );
  }

  bool get isUnread => readAt == null;
}

/// Mirrors `NotificationUnreadCountDto` — the figure behind the bell badge.
class NotificationUnreadCountModel {
  const NotificationUnreadCountModel({required this.unread});

  final int unread;

  factory NotificationUnreadCountModel.fromJson(Map<String, dynamic> json) {
    return NotificationUnreadCountModel(unread: parseInt(json['unread']) ?? 0);
  }
}
