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
        /*
         * `requiresConclusion` AND `requiresRecommendation` ARE PART OF THE ANSWER.
         *
         * They were withheld on the reasoning that they govern what the API accepts and
         * the API is where they are enforced. The first half is right and nothing about
         * enforcement changes: `recordObjectAssessment` still resolves the band itself and
         * is still the only thing that can refuse a write. The second half was the mistake
         * — it left every form with a band's demands to GUESS, and the only material to
         * guess from is the band's name. `ObjectFormPage` guessed
         * `level === 'CRITICAL' || level === 'OUT_OF_SERVICE'`, which is the exact
         * construction object-master.service.ts warns against, and was wrong for every
         * band in between: it asked for none of the fields the server was about to demand,
         * so the object was written and its assessment refused on a control the page did
         * not render.
         *
         * A band's demands are the band's own property. Publishing them lets a form ask
         * the right question; it does not let it answer one. `decommissions` and
         * `notifies` stay behind, because those are consequences the server carries out
         * rather than fields a form has to collect, and a client with no use for a flag is
         * a client that will find one.
         */
        riskBands: bands.map((band) => ({
          level: band.level,
          label: band.labelMn,
          colour: band.colour,
          min: band.min,
          max: band.max,
          requiresConclusion: band.requiresConclusion,
          requiresRecommendation: band.requiresRecommendation,
        })),
      });
    } catch (error) {
      next(error);
    }
  },
);
