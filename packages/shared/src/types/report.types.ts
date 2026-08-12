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
  /** One window of the report, at most `limit` rows wide. */
  rows: readonly ReportRowDto[];
  /** The window this response carries. */
  page: number;
  limit: number;
  /**
   * Rows matching the filter across every page, and what the footer is computed over.
   *
   * A footer reading "Нийт 20" on page one of five would be a lie, and a money column
   * summing one page would be a worse one, so the totals below describe the whole set.
   */
  total: number;
  totalPages: number;
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
  /** The window to ask for. Absent means the first page. */
  page?: number;
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
