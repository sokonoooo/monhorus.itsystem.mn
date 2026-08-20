/**
 * Notification vocabulary, requirements section 14.3.
 *
 * The event and recipient table in 14.3 is complete, so the events below are transcribed
 * from it rather than invented. What 14.3 never states is the delivery channel, and
 * section 19.2 left it open.
 *
 * That gap is now partly closed: Android push was approved on 2026-08-18 and is delivered
 * alongside the in-app record. iOS push was declined in the same decision — it needs a paid
 * Apple Developer membership and a bundle identifier the customer app does not yet have —
 * so an iPhone still sees notifications only inside the app. Email remains reserved for
 * password reset and is not a notification channel.
 *
 * The prediction in the original note held: adding a channel meant adding a transport, and
 * none of these events changed.
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
  /**
   * A second call at a site that already has unfinished work.
   *
   * Addressed to whoever is on the existing job rather than broadcast: the point is that
   * somebody already standing there can pick it up, which is information only they can act
   * on. A dispatcher learns the same thing from SERVICE_REQUEST_CREATED.
   */
  'SERVICE_REQUEST_SITE_BUSY',
  // Төлөвлөгөөт ажил хуваарилагдсан/товлогдсон/эхэлсэн -> хариуцагч, хэрэглэгч
  'PLANNED_WORK_ASSIGNED',
  'PLANNED_WORK_TASK_ASSIGNED',
  'PLANNED_WORK_SCHEDULED',
  'PLANNED_WORK_STARTED',
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
  SERVICE_REQUEST_SITE_BUSY: 'Ажиллаж буй байршилд шинэ дуудлага',
  PLANNED_WORK_ASSIGNED: 'Төлөвлөгөөт ажил хуваарилагдсан',
  PLANNED_WORK_TASK_ASSIGNED: 'Дэд ажил хуваарилагдсан',
  PLANNED_WORK_SCHEDULED: 'Төлөвлөгөөт ажил товлогдсон',
  PLANNED_WORK_STARTED: 'Төлөвлөгөөт ажил эхэлсэн',
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
  SERVICE_REQUEST_SITE_BUSY: 'INFO',
  PLANNED_WORK_ASSIGNED: 'INFO',
  PLANNED_WORK_TASK_ASSIGNED: 'INFO',
  PLANNED_WORK_SCHEDULED: 'INFO',
  PLANNED_WORK_STARTED: 'INFO',
  INVOICE_ISSUED: 'INFO',
  INVOICE_DUE_SOON: 'WARNING',
  INVOICE_OVERDUE: 'CRITICAL',
};

/**
 * Shown on the notification screen so the delivery limit is stated rather than assumed.
 *
 * Kept under its original name because three clients import it. The wording changed when
 * Android push was approved: promising "in-app only" to someone whose phone is buzzing is
 * worse than saying nothing. It still states the two real limits — iPhone gets no push, and
 * nothing is emailed — because both are surprises a user would otherwise discover alone.
 */
export const NOTIFICATION_CHANNEL_UNAPPROVED_NOTE =
  'Android утсанд push мэдэгдэл очно. iPhone дээр болон имэйлээр илгээгдэхгүй — зөвхөн энэ жагсаалтад харагдана.';

/**
 * Platforms a push registration can come from.
 *
 * `ios` and `web` are accepted by the API but never dispatched to: only Android push was
 * approved. They are listed so a device that registers from an unapproved platform is
 * recorded and ignored, rather than rejected as a validation error the client cannot act
 * on — and so that enabling iOS later is a dispatch change, not a migration.
 */
export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;
export type DevicePlatform = (typeof DEVICE_PLATFORMS)[number];

/** The platforms push is actually delivered to today. */
export const PUSH_ENABLED_PLATFORMS: readonly DevicePlatform[] = ['android'];
