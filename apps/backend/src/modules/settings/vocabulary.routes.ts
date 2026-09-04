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
        /*
         * `entryStatus` AND `onBoard` ARE PART OF THE ANSWER, not internals.
         *
         * They were withheld, and what that cost is stated plainly in
         * service-request-stage.ts: "moving a request to a stage means moving it to that
         * stage's `entryStatus`". A stage without it is a coloured label; with it, it is
         * the control the design says it is. The field was configured, validated against
         * the stage's own `statuses`, stored — and then never left the server, so no
         * client could offer «Энэ шат руу шилжүүлэх» and every one of them still moves work
         * by raw engine status, re-deriving the mapping by hand.
         *
         * `onBoard` travels with it for the same reason. It answers "does this stage get a
         * column on the dispatch board", which is a question every board renderer asks and
         * currently answers from a compiled list of its own.
         *
         * Neither discloses anything. The engine statuses are already on every request DTO
         * the caller may read, and both fields only describe how the stages the caller is
         * already being handed relate to them.
         */
        requestStages: stages.map((stage) => ({
          key: stage.key,
          label: stage.label,
          colour: stage.colour,
          statuses: [...stage.statuses],
          entryStatus: stage.entryStatus,
          hidden: stage.hidden,
          onBoard: stage.onBoard,
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
