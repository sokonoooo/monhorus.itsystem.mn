import type { CurrentUserDto } from '@monhorus/shared';
import type { NextFunction, Request, Response } from 'express';

import { noContent, ok } from '../../common/utils/api-response.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import * as authService from './auth.service';
import type {
  ChangePasswordBody,
  LoginBody,
  LogoutBody,
  RefreshBody,
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
