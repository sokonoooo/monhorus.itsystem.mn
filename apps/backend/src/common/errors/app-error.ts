import type { FieldIssue } from '@monhorus/shared';

import { ERROR_CODES, ERROR_MESSAGES, type ErrorCode } from './error-codes';

export type { FieldIssue };

/**
 * Operational error. Anything thrown as an AppError is a known, expected condition
 * and is rendered to the client verbatim. Everything else becomes a generic 500.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: ErrorCode;
  public readonly issues: FieldIssue[] | undefined;
  public readonly isOperational = true;

  constructor(code: ErrorCode, statusCode: number, message?: string, issues?: FieldIssue[]) {
    super(message ?? ERROR_MESSAGES[code]);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.issues = issues;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(
    code: ErrorCode = ERROR_CODES.VALIDATION_ERROR,
    message?: string,
    issues?: FieldIssue[],
  ): AppError {
    return new AppError(code, 400, message, issues);
  }

  static unauthorized(code: ErrorCode = ERROR_CODES.UNAUTHENTICATED, message?: string): AppError {
    return new AppError(code, 401, message);
  }

  static forbidden(code: ErrorCode = ERROR_CODES.FORBIDDEN, message?: string): AppError {
    return new AppError(code, 403, message);
  }

  static notFound(code: ErrorCode = ERROR_CODES.NOT_FOUND, message?: string): AppError {
    return new AppError(code, 404, message);
  }

  static conflict(code: ErrorCode = ERROR_CODES.DUPLICATE_KEY, message?: string): AppError {
    return new AppError(code, 409, message);
  }

  static internal(message?: string): AppError {
    return new AppError(ERROR_CODES.INTERNAL_ERROR, 500, message);
  }
}
