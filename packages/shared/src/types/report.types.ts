import type { KpiKey, ReportColumnFormat, ReportKey } from '../constants/report';

export interface ReportColumnDto {
  key: string;
  label: string;
  format: ReportColumnFormat;
  align?: 'left' | 'right';
}

/** One cell. Null renders as a dash and exports as an empty field, never as a zero. */
export type ReportCellValue = string | number | null;

export type ReportRowDto = Readonly<Record<string, ReportCellValue>>;

/**
 * A rendered report, requirements 15.2.
 *
 * Columns travel with the rows so a single screen and a single CSV writer serve every
 * report in the catalogue; adding a report never adds a bespoke table component.
 */
export interface ReportResultDto {
  key: ReportKey;
  label: string;
  description: string;
  generatedAt: string;
  /** Echoes the filter actually applied, so an exported file is self-describing. */
  dateFrom: string | null;
  dateTo: string | null;
  columns: readonly ReportColumnDto[];
  rows: readonly ReportRowDto[];
  /** Column-keyed totals rendered as a footer row. Null when a total is meaningless. */
  totals: ReportRowDto | null;
  /** Set when the row set was capped, so a truncated export is never silent. */
  truncatedAt: number | null;
}

export interface ReportQuery {
  dateFrom?: string;
  dateTo?: string;
  customerId?: string;
  projectId?: string;
  employeeId?: string;
  limit?: number;
}

export interface KpiValueDto {
  key: KpiKey;
  label: string;
  formula: string;
  purpose: string;
  unit: 'PERCENT' | 'HOURS' | 'COUNT' | 'MONEY';
  /** Null when the denominator is zero, never a fabricated zero. */
  value: number | null;
  /** Numerator and denominator, so a percentage can be read back to its inputs. */
  numerator: number | null;
  denominator: number | null;
}

export interface KpiSummaryDto {
  dateFrom: string;
  dateTo: string;
  currency: string;
  values: readonly KpiValueDto[];
}
