/**
 * Notification vocabulary, requirements section 14.3.
 *
 * The event and recipient table in 14.3 is complete, so the events below are transcribed
 * from it rather than invented. What 14.3 never states is the delivery channel, and
 * section 19.2 leaves it open, so this is an in-app centre only: no email, no SMS, no
 * push. Adding a channel later means adding a transport, not rewriting these events.
 */
export const NOTIFICATION_EVENTS = [
  // Төлөвлөгөөт ажил эхлэх/дуусах дөхсөн/хэтэрсэн -> ажилтан, баг, менежер
  'PLANNED_WORK_DUE_SOON',
  'PLANNED_WORK_OVERDUE',
  // Дуудлага үүссэн/хуваарилагдсан/дахин хуваарилагдсан -> ажилтан, админ
  'SERVICE_REQUEST_CREATED',
  'SERVICE_REQUEST_ASSIGNED',
  'SERVICE_REQUEST_REASSIGNED',
  /**
   * Open for two hours with nobody on it. Addressed to dispatchers rather than to
   * technicians: the point is that automatic pickup did not happen and somebody now has to
   * schedule it by hand.
   */
  'SERVICE_REQUEST_UNCLAIMED',
  // Ажил хүлээн авсан/замдаа/очсон/эхэлсэн/дууссан -> хэрэглэгч, админ
  'SERVICE_REQUEST_STATUS_CHANGED',
  // SLA ойртсон/зөрчсөн -> ажилтан, dispatcher, менежер
  'SLA_NEAR_BREACH',
  'SLA_BREACHED',
  // Тайлан илгээсэн/баталсан/буцаасан -> ажилтан, админ, хэрэглэгч (баталсны дараа)
  'REPORT_SUBMITTED',
  'REPORT_APPROVED',
  'REPORT_RETURNED',
  // Шар/улбар/улаан/хар үнэлгээ илэрсэн -> менежер, хариуцагч, хэрэглэгч
  'RISK_ASSESSMENT_RAISED',
  // Засвар/давтан үзлэг шаардлагатай -> хариуцагч, хэрэглэгч, админ
  'REPAIR_REQUIRED',
  'REVISIT_REQUIRED',
  // Invoice үүссэн/төлөх хугацаа дөхсөн/overdue -> админ
  'INVOICE_ISSUED',
  'INVOICE_DUE_SOON',
  'INVOICE_OVERDUE',
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  PLANNED_WORK_DUE_SOON: 'Төлөвлөгөөт ажлын хугацаа дөхсөн',
  PLANNED_WORK_OVERDUE: 'Төлөвлөгөөт ажил хугацаа хэтэрсэн',
  SERVICE_REQUEST_CREATED: 'Шинэ дуудлага үүссэн',
  SERVICE_REQUEST_ASSIGNED: 'Дуудлага хуваарилагдсан',
  SERVICE_REQUEST_REASSIGNED: 'Дуудлага дахин хуваарилагдсан',
  SERVICE_REQUEST_UNCLAIMED: 'Дуудлага эзэнгүй байна',
  SERVICE_REQUEST_STATUS_CHANGED: 'Дуудлагын төлөв өөрчлөгдсөн',
  SLA_NEAR_BREACH: 'SLA хугацаа ойртсон',
  SLA_BREACHED: 'SLA хугацаа зөрчсөн',
  REPORT_SUBMITTED: 'Тайлан илгээсэн',
  REPORT_APPROVED: 'Тайлан батлагдсан',
  REPORT_RETURNED: 'Тайлан буцаагдсан',
  RISK_ASSESSMENT_RAISED: 'Эрсдэлтэй үнэлгээ илэрсэн',
  REPAIR_REQUIRED: 'Засвар шаардлагатай',
  REVISIT_REQUIRED: 'Дахин үзлэг шаардлагатай',
  INVOICE_ISSUED: 'Нэхэмжлэл илгээгдсэн',
  INVOICE_DUE_SOON: 'Нэхэмжлэлийн төлөх хугацаа дөхсөн',
  INVOICE_OVERDUE: 'Нэхэмжлэл хугацаа хэтэрсэн',
};

/** Drives the colour of the row, not a business rule. */
export const NOTIFICATION_SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'] as const;
export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export const NOTIFICATION_SEVERITY_LABELS: Record<NotificationSeverity, string> = {
  INFO: 'Мэдээлэл',
  WARNING: 'Анхааруулга',
  CRITICAL: 'Ноцтой',
};

export const NOTIFICATION_EVENT_SEVERITIES: Record<NotificationEvent, NotificationSeverity> = {
  PLANNED_WORK_DUE_SOON: 'WARNING',
  PLANNED_WORK_OVERDUE: 'CRITICAL',
  SERVICE_REQUEST_CREATED: 'INFO',
  SERVICE_REQUEST_ASSIGNED: 'INFO',
  SERVICE_REQUEST_REASSIGNED: 'INFO',
  SERVICE_REQUEST_UNCLAIMED: 'WARNING',
  SERVICE_REQUEST_STATUS_CHANGED: 'INFO',
  SLA_NEAR_BREACH: 'WARNING',
  SLA_BREACHED: 'CRITICAL',
  REPORT_SUBMITTED: 'INFO',
  REPORT_APPROVED: 'INFO',
  REPORT_RETURNED: 'WARNING',
  RISK_ASSESSMENT_RAISED: 'WARNING',
  REPAIR_REQUIRED: 'WARNING',
  REVISIT_REQUIRED: 'WARNING',
  INVOICE_ISSUED: 'INFO',
  INVOICE_DUE_SOON: 'WARNING',
  INVOICE_OVERDUE: 'CRITICAL',
};

/**
 * Section 19.2 leaves the delivery channel open, so nothing is sent outside the system.
 * Shown on the notification screen so the limit is stated rather than assumed.
 */
export const NOTIFICATION_CHANNEL_UNAPPROVED_NOTE =
  'Мэдэгдлийн хүргэх суваг (имэйл, SMS, push) батлагдаагүй тул системд дотооддоо л харагдана.';
