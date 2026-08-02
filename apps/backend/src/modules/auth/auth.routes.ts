import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { ERROR_CODES, ERROR_MESSAGES } from '../../common/errors/error-codes';
import { env } from '../../config/env';
import { authenticate } from '../../middlewares/authenticate.middleware';
import { validate } from '../../middlewares/validate.middleware';
import * as authController from './auth.controller';
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from './auth.validation';

const rateLimitBody = {
  success: false,
  data: null,
  message: ERROR_MESSAGES.RATE_LIMITED,
  code: ERROR_CODES.RATE_LIMITED,
};

/** Credential endpoints are the brute-force surface; limit them per IP. */
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_CREDENTIAL_MAX ?? (env.isProduction ? 10 : 100),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitBody,
});

/** Refresh runs on a timer in every client, so it needs a far higher ceiling. */
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.RATE_LIMIT_REFRESH_MAX ?? (env.isProduction ? 120 : 1000),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitBody,
});

export const authRouter = Router();

// --- Public ----------------------------------------------------------------
// Note: there is deliberately no /register and no /forgot-password route.
authRouter.post(
  '/login',
  credentialLimiter,
  validate({ body: loginSchema }),
  authController.loginHandler,
);

authRouter.post(
  '/refresh',
  refreshLimiter,
  validate({ body: refreshSchema }),
  authController.refreshHandler,
);

authRouter.post('/logout', validate({ body: logoutSchema }), authController.logoutHandler);

// --- Authenticated ---------------------------------------------------------
// Both routes are intentionally reachable while status is must_change_password,
// since they are how a user resolves that state.
authRouter.get('/me', authenticate, authController.meHandler);

authRouter.post(
  '/change-password',
  authenticate,
  credentialLimiter,
  validate({ body: changePasswordSchema }),
  authController.changePasswordHandler,
);
