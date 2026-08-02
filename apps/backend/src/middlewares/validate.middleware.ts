import type { FieldIssue } from '@monhorus/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES } from '../common/errors/error-codes';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

export function zodIssuesToFieldIssues(error: ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '_',
    message: issue.message,
  }));
}

/**
 * Parses and REPLACES req.body/query/params with the validated output, so handlers
 * receive coerced, stripped, correctly typed values rather than raw input.
 */
export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        // req.query is getter-only on newer Express; assign defensively.
        Object.defineProperty(req, 'query', {
          value: schemas.query.parse(req.query),
          writable: true,
          configurable: true,
        });
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          AppError.badRequest(
            ERROR_CODES.VALIDATION_ERROR,
            undefined,
            zodIssuesToFieldIssues(error),
          ),
        );
        return;
      }
      next(error);
    }
  };
}
