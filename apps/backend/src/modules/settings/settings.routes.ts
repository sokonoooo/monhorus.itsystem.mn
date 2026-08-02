import {
  ALL_SETTING_KEYS,
  PERMISSIONS,
  updateSettingsSchema,
  type SettingKey,
  type UpdateSettingsInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { getSettingsDto, resetSetting, updateSettings } from './settings.service';

export const settingsRouter = Router();

settingsRouter.use(authenticate, enforcePasswordChange);

settingsRouter.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await getSettingsDto(requireAuth(req)));
    } catch (error) {
      next(error);
    }
  },
);

settingsRouter.patch(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ body: updateSettingsSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await updateSettings(
        req.body as UpdateSettingsInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result.settings, `${result.changed.length} тохиргоо шинэчлэгдлээ.`);
    } catch (error) {
      next(error);
    }
  },
);

/** Only a declared key can be reset, so an arbitrary path segment cannot reach the store. */
const settingKeyParam = z.object({
  key: z.enum(ALL_SETTING_KEYS as unknown as [SettingKey, ...SettingKey[]]),
});

settingsRouter.delete(
  '/:key',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE),
  validate({ params: settingKeyParam }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await resetSetting(
        pathParam(req, 'key') as SettingKey,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Анхны утгад буцаалаа.');
    } catch (error) {
      next(error);
    }
  },
);
