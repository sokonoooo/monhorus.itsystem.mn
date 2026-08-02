import type { NextFunction, Request, Response } from 'express';

import { buildRequestContext } from '../common/utils/request-context.util';

/** Attaches channel/device/IP metadata required by the audit trail (req 14.4). */
export function attachRequestContext(req: Request, _res: Response, next: NextFunction): void {
  req.context = buildRequestContext(req);
  next();
}
