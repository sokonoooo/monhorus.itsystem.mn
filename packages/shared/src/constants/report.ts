/**
 * Reporting vocabulary, requirements section 15.
 *
 * 15.2 fixes the report catalogue; nothing outside that list is invented here. Every
 * report is an aggregation over data the system already stores, so a report can never
 * show a figure that no module produced.
 */
export const REPORT_KEYS = [
  'PLANNED_WORK',
  'SERVICE_WORK',
  'RISK_ASSESSMENT',
  'SLA',
  'CUSTOMER',
  'EMPLOYEE_PERFORMANCE',
  'INVOICE_RECEIVABLE',
  'AUDIT_LOG',
  'TECHNICAL_REPORT',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  PLANNED_WORK: 'Төлөвлөгөөт ажлын тайлан',
  SERVICE_WORK: 'Үзлэг, оношилгоо, засвар, дуудлага',
  RISK_ASSESSMENT: 'Эрсдэл ба үнэлгээ',
  SLA: 'SLA тайлан',
  CUSTOMER: 'Харилцагч, барилгын тайлан',
  EMPLOYEE_PERFORMANCE: 'Ажилтны гүйцэтгэл',
  INVOICE_RECEIVABLE: 'Нэхэмжлэл ба авлага',
  AUDIT_LOG: 'Audit ба дүгнэлтийн log',
  TECHNICAL_REPORT: 'Техникийн дүгнэлтийн тайлан',
};

/** The 15.2 "Агуулга" column, shown under each report so the scope is explicit. */
export const REPORT_DESCRIPTIONS: Record<ReportKey, string> = {
  PLANNED_WORK: 'Төсөл, давхар, дэд ажил, гүйцэтгэл, материал, дүгнэлт.',
  SERVICE_WORK: 'Ажил, хэмжилт, дүгнэлт, зөвлөмж, үнэлгээ.',
  RISK_ASSESSMENT: '5 түвшин, объектын түүх, засварын шаардлага, дахин үзлэг.',
  SLA: 'Хугацаанд багтсан, ойртсон, зөрчсөн ажил; төрөл, харилцагч, ажилтнаар.',
  CUSTOMER: 'Үйлчилгээ, ажил, үнэлгээ, нэхэмжлэл, SLA.',
  // No labour time is recorded anywhere in the system, so this report promises elapsed
  // request time — raised to closed — rather than hours worked.
  EMPLOYEE_PERFORMANCE:
    'Хийсэн ажил, хүсэлтийн дундаж хугацаа (үүссэнээс дууссан хүртэл), хугацаандаа дууссан, дахин очилт, буцаалт.',
  INVOICE_RECEIVABLE: 'Ноорог, илгээсэн, төлөгдсөн, хугацаа хэтэрсэн, нийт авлага.',
  AUDIT_LOG: 'Хэн, хэзээ, ямар өөрчлөлт хийсэн.',
  TECHNICAL_REPORT: 'Нэгдсэн тайлангийн сан: үнэлгээ, төлөвлөгөөт ажил, үйлчилгээ, нэгтгэл.',
};

/** How a cell is rendered and exported. */
export const REPORT_COLUMN_FORMATS = [
  'TEXT',
  'NUMBER',
  'MONEY',
  'PERCENT',
  'DATE',
  'DATETIME',
] as const;
export type ReportColumnFormat = (typeof REPORT_COLUMN_FORMATS)[number];

/**
 * KPI catalogue, requirements 15.3. The formula is carried alongside the value so a
 * reader can see how a number was produced rather than having to trust it.
 */
export const KPI_KEYS = [
  'ON_TIME_COMPLETION_RATE',
  'AVERAGE_RESOLUTION_HOURS',
  'SLA_BREACHED_COUNT',
  'PLANNED_WORK_COMPLETION_RATE',
  'REVISIT_COUNT',
  'MONTHLY_REVENUE',
  'RECEIVABLE_TOTAL',
] as const;
export type KpiKey = (typeof KPI_KEYS)[number];

export const KPI_LABELS: Record<KpiKey, string> = {
  ON_TIME_COMPLETION_RATE: 'Хугацаандаа дууссан хувь',
  AVERAGE_RESOLUTION_HOURS: 'Дундаж шийдвэрлэх хугацаа',
  SLA_BREACHED_COUNT: 'SLA зөрчсөн ажил',
  PLANNED_WORK_COMPLETION_RATE: 'Төлөвлөгөөт ажлын гүйцэтгэл',
  REVISIT_COUNT: 'Давтан гэмтэл, дахин очилт',
  MONTHLY_REVENUE: 'Сарын орлого',
  RECEIVABLE_TOTAL: 'Авлага',
};

export const KPI_FORMULAS: Record<KpiKey, string> = {
  ON_TIME_COMPLETION_RATE: 'Хугацаандаа дууссан / нийт дууссан × 100',
  AVERAGE_RESOLUTION_HOURS: 'Дууссан цаг - хүсэлт үүссэн цагийн дундаж',
  SLA_BREACHED_COUNT: 'SLA зөрчсөн идэвхтэй болон дууссан ажил',
  PLANNED_WORK_COMPLETION_RATE: 'Хийгдсэн тоо / нийт тоо × 100',
  REVISIT_COUNT: 'Дахин очих шаардлагатай ажлын тоо',
  MONTHLY_REVENUE: 'Илгээсэн болон төлөгдсөн нэхэмжлэлийн нийт дүн',
  RECEIVABLE_TOTAL: 'Илгээсэн боловч төлөгдөөгүй нэхэмжлэл',
};

/** The 15.3 "Зорилго" column. */
export const KPI_PURPOSES: Record<KpiKey, string> = {
  ON_TIME_COMPLETION_RATE: 'Үйлчилгээний чанар',
  AVERAGE_RESOLUTION_HOURS: 'Ажлын хурд',
  SLA_BREACHED_COUNT: 'Эрсдэл',
  PLANNED_WORK_COMPLETION_RATE: 'Төслийн хяналт',
  REVISIT_COUNT: 'Чанарын хяналт',
  MONTHLY_REVENUE: 'Санхүү',
  RECEIVABLE_TOTAL: 'Мөнгөн урсгал',
};

export const KPI_UNITS: Record<KpiKey, 'PERCENT' | 'HOURS' | 'COUNT' | 'MONEY'> = {
  ON_TIME_COMPLETION_RATE: 'PERCENT',
  AVERAGE_RESOLUTION_HOURS: 'HOURS',
  SLA_BREACHED_COUNT: 'COUNT',
  PLANNED_WORK_COMPLETION_RATE: 'PERCENT',
  REVISIT_COUNT: 'COUNT',
  MONTHLY_REVENUE: 'MONEY',
  RECEIVABLE_TOTAL: 'MONEY',
};

/**
 * Rule 17.20 requires PDF and Excel export.
 *
 * CSV is served with a UTF-8 BOM so Excel opens Cyrillic correctly without an import
 * step, and the PDF is produced from a print view in the browser. No server-side PDF or
 * xlsx library is used, which keeps Cyrillic font embedding out of the picture entirely.
 */
export const REPORT_EXPORT_FORMATS = ['csv'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];
