import type { FieldIssue } from '../errors/app-error';
import type { ErrorCode } from '../errors/error-codes';

/**
 * The single response envelope for every endpoint. `success`, `data` and `message`
 * are always present so clients can parse without branching on status code first.
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string;
}

export interface ApiErrorResponse extends ApiResponse<null> {
  success: false;
  data: null;
  code: ErrorCode;
  /** Present only for VALIDATION_ERROR, so forms can highlight individual fields. */
  issues?: FieldIssue[];
}

export interface PaginatedData<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
