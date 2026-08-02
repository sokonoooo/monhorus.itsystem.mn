import type { NextFunction, Request, Response } from 'express';

import { created, ok } from '../../common/utils/api-response.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import * as userService from './user.service';
import type {
  CreateUserBody,
  ListUsersQuery,
  ResetPasscodeBody,
  UpdateUserBody,
  UpdateUserStatusBody,
  UserIdParam,
} from './user.validation';

export async function createUserHandler(
  req: Request<unknown, unknown, CreateUserBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await userService.createUser(req.body, requireAuth(req), meta(req));
    created(res, result, 'Хэрэглэгч амжилттай үүслээ.');
  } catch (error) {
    next(error);
  }
}

export async function resetPasscodeHandler(
  req: Request<UserIdParam, unknown, ResetPasscodeBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await userService.resetPasscode(
      req.params.userId,
      req.body.newPassword,
      req.body.reason,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Нууц үг амжилттай шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function updateUserHandler(
  req: Request<UserIdParam, unknown, UpdateUserBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await userService.updateUser(
      req.params.userId,
      req.body,
      requireAuth(req),
      meta(req),
    );
    ok(res, user, 'Хэрэглэгчийн мэдээлэл шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function updateUserStatusHandler(
  req: Request<UserIdParam, unknown, UpdateUserStatusBody>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await userService.updateUserStatus(
      req.params.userId,
      req.body,
      requireAuth(req),
      meta(req),
    );
    ok(res, user, 'Төлөв шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function listUsersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await userService.listUsers(req.query as unknown as ListUsersQuery);
    ok(res, result);
  } catch (error) {
    next(error);
  }
}

export async function getUserHandler(
  req: Request<UserIdParam>,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = await userService.getUserById(req.params.userId);
    ok(res, user);
  } catch (error) {
    next(error);
  }
}
