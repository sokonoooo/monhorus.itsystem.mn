import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../common/errors/app-error';
import { ERROR_CODES } from '../common/errors/error-codes';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(
    AppError.notFound(
      ERROR_CODES.NOT_FOUND,
      `${req.method} ${req.originalUrl} хаяг олдсонгүй.`,
    ),
  );
}
