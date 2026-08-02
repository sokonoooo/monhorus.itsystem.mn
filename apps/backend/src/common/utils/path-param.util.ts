import type { Request } from 'express';

import { AppError } from '../errors/app-error';
import { ERROR_CODES } from '../errors/error-codes';

/**
 * Reads a route parameter as a definite string.
 *
 * Express types `req.params` as an index signature, which under
 * `noUncheckedIndexedAccess` yields `string | undefined`. Typing each handler with a
 * params generic instead would work, but breaks overload resolution as soon as more
 * than one middleware precedes the handler, so a helper is used consistently.
 *
 * The value is always present in practice because the route pattern declares it and
 * the Zod params schema has already validated it; the throw is a safety net.
 */
export function pathParam(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, `Замын параметр "${name}" алга.`);
  }
  return value;
}
