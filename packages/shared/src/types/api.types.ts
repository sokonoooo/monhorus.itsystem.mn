/** Every endpoint returns this envelope, on success and on failure alike. */
export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message: string;
}

export interface FieldIssue {
  field: string;
  message: string;
}

export interface ApiErrorResponse extends ApiResponse<null> {
  success: false;
  data: null;
  code: string;
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
