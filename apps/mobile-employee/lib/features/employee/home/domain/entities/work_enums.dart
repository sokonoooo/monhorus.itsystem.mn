/// The vocabularies the home tab reads, transcribed from
/// `packages/shared/src/constants/`.
///
/// Labels are the backend's own Mongolian strings so the app never invents a second
/// name for a state the server already named. Every `fromWire` degrades to a null or
/// a neutral value rather than throwing, so an enum value added by a newer API
/// version renders as unknown instead of crashing a technician's home screen.
///
/// [SeverityBand] and the service-request vocabulary — status, type and SLA state —
/// are no longer declared here: the Ажил tab's "Нээлттэй" segment reads the same rows,
/// and a feature must not import across a sibling feature. They live in
/// `features/employee/shared/service_request_vocabulary.dart` and are re-exported from
/// this file, so every call site that already imported it keeps working.
library;

import '../../../shared/service_request_vocabulary.dart';

export '../../../shared/service_request_vocabulary.dart';

// -- Planned work ------------------------------------------------------------

/// `PLANNED_WORK_EFFECTIVE_STATUSES`. OVERDUE is derived by the backend on read and
/// is never persisted, so it appears here but is never sent as an input.
enum PlannedWorkStatus {
  draft('DRAFT', 'Төсөл', SeverityBand.neutral),
  planned('PLANNED', 'Төлөвлөгдсөн', SeverityBand.neutral),
  started('STARTED', 'Хэрэгжиж байна', SeverityBand.yellow),
  paused('PAUSED', 'Түр зогссон', SeverityBand.yellow),
  overdue('OVERDUE', 'Хугацаа хэтэрсэн', SeverityBand.red),
  completed('COMPLETED', 'Дууссан', SeverityBand.green),
  archived('ARCHIVED', 'Архивласан', SeverityBand.neutral),
  cancelled('CANCELLED', 'Цуцлагдсан', SeverityBand.neutral);

  const PlannedWorkStatus(this.wireValue, this.label, this.band);

  final String wireValue;
  final String label;
  final SeverityBand band;

  static PlannedWorkStatus? fromWire(String? value) {
    if (value == null) return null;
    for (final PlannedWorkStatus status in PlannedWorkStatus.values) {
      if (status.wireValue == value) return status;
    }
    return null;
  }

  /// Work that is still outstanding, which is what the "Идэвхтэй ажил" figure counts.
  bool get isOutstanding =>
      this == PlannedWorkStatus.planned ||
      this == PlannedWorkStatus.started ||
      this == PlannedWorkStatus.paused ||
      this == PlannedWorkStatus.overdue;

  bool get isInProgress =>
      this == PlannedWorkStatus.started || this == PlannedWorkStatus.paused;

  bool get isFinished =>
      this == PlannedWorkStatus.completed || this == PlannedWorkStatus.archived;
}

// -- Notifications -----------------------------------------------------------

/// `NOTIFICATION_SEVERITIES`.
enum NotificationSeverity {
  info('INFO', 'Мэдээлэл', SeverityBand.neutral),
  warning('WARNING', 'Анхааруулга', SeverityBand.yellow),
  critical('CRITICAL', 'Ноцтой', SeverityBand.red);

  const NotificationSeverity(this.wireValue, this.label, this.band);

  final String wireValue;
  final String label;
  final SeverityBand band;

  static NotificationSeverity fromWire(String? value) {
    for (final NotificationSeverity severity in NotificationSeverity.values) {
      if (severity.wireValue == value) return severity;
    }
    return NotificationSeverity.info;
  }
}

/// `NOTIFICATION_EVENTS`, all eighteen.
///
/// The prototype's inbox showed only assignment and re-assignment, on the stated
/// rule that a technician is not told about invoices. That rule is enforced by the
/// backend's recipient resolution, not by the client, so every event is transcribed
/// here: filtering the list a second time on the device would hide a notification an
/// administrator deliberately addressed to this person.
enum NotificationEvent {
  plannedWorkDueSoon('PLANNED_WORK_DUE_SOON', 'Төлөвлөгөөт ажлын хугацаа дөхсөн'),
  plannedWorkOverdue('PLANNED_WORK_OVERDUE', 'Төлөвлөгөөт ажил хугацаа хэтэрсэн'),
  serviceRequestCreated('SERVICE_REQUEST_CREATED', 'Шинэ дуудлага үүссэн'),
  serviceRequestAssigned('SERVICE_REQUEST_ASSIGNED', 'Дуудлага хуваарилагдсан'),
  serviceRequestReassigned(
      'SERVICE_REQUEST_REASSIGNED', 'Дуудлага дахин хуваарилагдсан'),
  serviceRequestStatusChanged(
      'SERVICE_REQUEST_STATUS_CHANGED', 'Дуудлагын төлөв өөрчлөгдсөн'),
  slaNearBreach('SLA_NEAR_BREACH', 'SLA хугацаа ойртсон'),
  slaBreached('SLA_BREACHED', 'SLA хугацаа зөрчсөн'),
  reportSubmitted('REPORT_SUBMITTED', 'Дүгнэлт илгээсэн'),
  reportApproved('REPORT_APPROVED', 'Тайлан батлагдсан'),
  reportReturned('REPORT_RETURNED', 'Тайлан буцаагдсан'),
  riskAssessmentRaised('RISK_ASSESSMENT_RAISED', 'Эрсдэлтэй үнэлгээ илэрсэн'),
  repairRequired('REPAIR_REQUIRED', 'Засвар шаардлагатай'),
  revisitRequired('REVISIT_REQUIRED', 'Дахин үзлэг шаардлагатай'),
  serviceRequestUnclaimed('SERVICE_REQUEST_UNCLAIMED', 'Дуудлага эзэнгүй байна'),
  serviceRequestSiteBusy('SERVICE_REQUEST_SITE_BUSY', 'Ажиллаж буй байршилд шинэ дуудлага'),
  plannedWorkAssigned('PLANNED_WORK_ASSIGNED', 'Төлөвлөгөөт ажил хуваарилагдсан'),
  plannedWorkTaskAssigned('PLANNED_WORK_TASK_ASSIGNED', 'Дэд ажил хуваарилагдсан'),
  plannedWorkScheduled('PLANNED_WORK_SCHEDULED', 'Төлөвлөгөөт ажил товлогдсон'),
  plannedWorkStarted('PLANNED_WORK_STARTED', 'Төлөвлөгөөт ажил эхэлсэн'),
  surveyRequested('SURVEY_REQUESTED', 'Үйлчилгээгээ үнэлнэ үү'),
  surveyReminder('SURVEY_REMINDER', 'Үйлчилгээний үнэлгээ хүлээгдэж байна'),
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

  /// True for the two events the prototype's inbox was built around: work landing on
  /// this person, or moving to them from someone else.
  bool get isAssignment =>
      this == NotificationEvent.serviceRequestAssigned ||
      this == NotificationEvent.serviceRequestReassigned;
}

// -- Calendar ----------------------------------------------------------------

/// `CALENDAR_SOURCES`. Every calendar entry is a projection of a record that already
/// exists in another module; there is no calendar-only entity.
enum CalendarSource {
  plannedWork('PLANNED_WORK', 'Төлөвлөгөөт ажил'),
  serviceRequest('SERVICE_REQUEST', 'Үйлчилгээний хүсэлт');

  const CalendarSource(this.wireValue, this.label);

  final String wireValue;
  final String label;

  static CalendarSource? fromWire(String? value) {
    if (value == null) return null;
    for (final CalendarSource source in CalendarSource.values) {
      if (source.wireValue == value) return source;
    }
    return null;
  }
}
