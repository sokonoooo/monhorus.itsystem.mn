import { Router, type NextFunction, type Request, type Response } from 'express';

import { ok } from '../../common/utils/api-response.util';
import { authenticate, enforcePasswordChange } from '../../middlewares/authenticate.middleware';

import { getRequestStages, getRiskBands } from './settings.service';

/**
 * The words and colours a client should paint with.
 *
 * Separate from `GET /settings` on purpose. Settings are configuration and are gated on
 * `settings.view`, which a technician and a customer do not hold and should not — reading
 * the SLA thresholds or the finance keys is none of their business. But the *vocabulary*
 * derived from those settings is: if an administrator renames a stage to "Замд гарсан",
 * every screen in every app has to say "Замд гарсан", including the two phones.
 *
 * Without this the mobile apps fall back to the labels compiled into the binary, and a
 * rename silently means the web and the phones disagree until the next store release.
 *
 * Read-only, and it exposes nothing an authenticated user cannot already infer from the
 * records they are allowed to see.
 */
export const vocabularyRouter = Router();

vocabularyRouter.use(authenticate, enforcePasswordChange);

vocabularyRouter.get(
  '/',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const [stages, bands] = await Promise.all([getRequestStages(), getRiskBands()]);

      ok(res, {
        requestStages: stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          colour: stage.colour,
          statuses: [...stage.statuses],
          hidden: stage.hidden,
        })),
        riskBands: bands.map((band) => ({
          level: band.level,
          label: band.labelMn,
          colour: band.colour,
          min: band.min,
          max: band.max,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
