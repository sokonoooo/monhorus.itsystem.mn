import type { CurrentUserDto } from '@monhorus/shared';
import type { NextFunction, Request, Response } from 'express';

import { noContent, ok } from '../../common/utils/api-response.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import * as authService from './auth.service';
import type {
  ChangePasswordBody,
  ForgotPasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
  ResetPasswordBody,
} from './auth.validation';

/** Controllers stay thin: unwrap, delegate, wrap. No business rules live here. */

export async function loginHandler(
  req: Request<unknown, unknown, LoginBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await authService.login(req.body, meta(req));
    ok(res, session, 'Амжилттай нэвтэрлээ.');
  } catch (error) {
    next(error);
  }
}

export async function refreshHandler(
  req: Request<unknown, unknown, RefreshBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const session = await authService.refreshSession(req.body.refreshToken, meta(req));
    ok(res, session, 'Сесс шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function logoutHandler(
  req: Request<unknown, unknown, LogoutBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.logout(req.body.refreshToken, meta(req));
    noContent(res, 'Амжилттай гарлаа.');
  } catch (error) {
    next(error);
  }
}

export async function changePasswordHandler(
  req: Request<unknown, unknown, ChangePasswordBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.changePassword(req.body, requireAuth(req), meta(req));
    noContent(res, 'Нууц үг солигдлоо. Дахин нэвтэрнэ үү.');
  } catch (error) {
    next(error);
  }
}

/**
 * The one message every outcome gets.
 *
 * Sent whether the address is registered, unregistered, or belongs to a suspended account,
 * and whether or not the mail actually went out. Wording it as "if the address is
 * registered" is what lets it be truthful in all of those cases at once without confirming
 * any of them.
 */
const RESET_REQUESTED_MESSAGE =
  'Хэрэв энэ имэйл бүртгэлтэй бол нууц үг сэргээх холбоос илгээгдлээ. Ирсэн захидлаа шалгана уу.';

export async function forgotPasswordHandler(
  req: Request<unknown, unknown, ForgotPasswordBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.requestPasswordReset(req.body.email, meta(req));
    noContent(res, RESET_REQUESTED_MESSAGE);
  } catch (error) {
    next(error);
  }
}

export async function resetPasswordHandler(
  req: Request<unknown, unknown, ResetPasswordBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await authService.resetPassword(req.body, meta(req));
    noContent(res, 'Нууц үг шинэчлэгдлээ. Шинэ нууц үгээрээ нэвтэрнэ үү.');
  } catch (error) {
    next(error);
  }
}

export async function meHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const auth = requireAuth(req);
    const user = await authService.getCurrentUser(auth.userId);

    // The effective permission set is resolved per request by the authenticate
    // middleware, so it is already available here without a second lookup.
    const payload: CurrentUserDto = {
      ...user,
      roleIds: auth.roleIds,
      permissions: [...auth.permissions],
    };

    ok(res, payload);
  } catch (error) {
    next(error);
  }
}
