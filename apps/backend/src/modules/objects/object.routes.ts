import {
  PERMISSIONS,
  createCustomerSchema,
  createObjectNodeSchema,
  updateCustomerSchema,
  updateObjectNodeSchema,
  type CreateCustomerInput,
  type CreateObjectNodeInput,
  type ObjectNodeDto,
  type ObjectNodeKind,
  type UpdateCustomerInput,
  type UpdateObjectNodeInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import {
  assertInCustomerScope,
  customerScopeFilter,
  resolveCustomerScope,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { created, noContent, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requireAnyPermission, requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { getRiskBands } from '../settings/settings.service';
import { Customer, ObjectNode, type IObjectNode } from './object.models';
import * as objectService from './object.service';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

/**
 * The tenant a hierarchy handler reads and writes within.
 *
 * These endpoints are staff-only today, so the scope resolves to no predicate for every
 * caller who can reach them. It is threaded through anyway: the guard and the scope are
 * separate defences, and a later change to either must not silently open an unscoped read.
 */
function scopeOf(req: Request, requested?: string): ResolvedCustomerScope {
  return resolveCustomerScope(requireAuth(req), requested ?? null);
}

const childrenQuerySchema = z.object({
  parentId: objectId.optional(),
  customerId: objectId.optional(),
  kind: z
    .enum(['CUSTOMER', 'PROJECT', 'BUILDING', 'FLOOR', 'ROOM', 'PANEL', 'CIRCUIT', 'DEVICE'])
    .optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().positive().max(200).default(100),
});

type ChildrenQuery = z.infer<typeof childrenQuerySchema>;

async function hasChildrenMap(ids: Types.ObjectId[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const parents = await ObjectNode.distinct('parent', { parent: { $in: ids } });
  return new Set(parents.map((id) => String(id)));
}

const customerListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().max(200).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  responsibleEmployeeId: objectId.optional(),
  hasActiveAgreement: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['name', 'code', 'createdAt']).default('name'),
  sortDir: z.enum(['asc', 'desc']).default('asc'),
});

type CustomerListQueryRaw = z.infer<typeof customerListQuerySchema>;

export const objectRouter = Router();

objectRouter.use(authenticate, enforcePasswordChange);

objectRouter.get(
  '/customers',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ query: customerListQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as CustomerListQueryRaw;
      const result = await objectService.listCustomers({
        page: query.page,
        limit: query.limit,
        ...(query.search ? { search: query.search } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive === 'true' } : {}),
        ...(query.responsibleEmployeeId
          ? { responsibleEmployeeId: query.responsibleEmployeeId }
          : {}),
        ...(query.hasActiveAgreement !== undefined
          ? { hasActiveAgreement: query.hasActiveAgreement === 'true' }
          : {}),
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      });
      ok(res, result);
    } catch (error) {
      next(error);
    }
  },
);

objectRouter.get(
  '/customers/:customerId',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({ params: z.object({ customerId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      ok(res, await objectService.getCustomerById(pathParam(req, 'customerId')));
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Progressive hierarchy loader.
 *
 * Returns only the direct children of the requested parent, never the whole tree.
 * The dependent selector on the request form calls this once per level.
 *
 * Open to `portal.floor.view` as well as the staff key, because the customer app's
 * create-request sheet lists a floor's Өрөө/Бүс nodes through here and this is the only
 * route that returns them — a customer holds portal keys alone, so under the staff key
 * by itself the zone picker was refused 403 on every floor.
 *
 * Safe to widen because the scope is not the guard: `scopeOf` discards a customer
 * caller's requested `customerId` in favour of their own, and `customerScopeFilter`
 * then pins the query to it, so a customer reads their own hierarchy and no other's
 * however this is called. The pairing matches `/floors` and `/floors/:id`, which are
 * already `OBJECT_VIEW` or `PORTAL_FLOOR_VIEW`.
 */
objectRouter.get(
  '/nodes',
  requireAnyPermission(PERMISSIONS.OBJECT_VIEW, PERMISSIONS.PORTAL_FLOOR_VIEW),
  validate({ query: childrenQuerySchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as ChildrenQuery;
      const scope = scopeOf(req, query.customerId);

      // Either a parent or a customer plus kind is required; an unscoped query would
      // return the entire hierarchy, which the brief explicitly forbids.
      if (!query.parentId && !(query.customerId && query.kind)) {
        ok(res, [] as ObjectNodeDto[]);
        return;
      }

      // The scope predicate replaces the requested customer id. For staff the resolver has
      // already folded that id in, so the filter is unchanged.
      const filter: Record<string, unknown> = { isActive: true, ...customerScopeFilter(scope) };
      if (query.parentId) filter.parent = new Types.ObjectId(query.parentId);
      if (query.kind) filter.kind = query.kind as ObjectNodeKind;
      if (query.search) {
        const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(escaped, 'i');
        filter.$or = [{ name: pattern }, { code: pattern }];
      }

      const nodes = await ObjectNode.find(filter).sort({ name: 1 }).limit(query.limit);
      const childSet = await hasChildrenMap(nodes.map((node) => node._id));
      const bands = await getRiskBands();

      ok(
        res,
        nodes.map((node) => objectService.toObjectNodeDto(node, childSet.has(String(node._id)), bands)),
      );
    } catch (error) {
      next(error);
    }
  },
);

// -- Write operations --------------------------------------------------------

objectRouter.post(
  '/customers',
  requirePermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ body: createCustomerSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.createCustomer(
        req.body as CreateCustomerInput,
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Харилцагч амжилттай үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectRouter.patch(
  '/customers/:customerId',
  requirePermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ params: z.object({ customerId: objectId }), body: updateCustomerSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.updateCustomer(
        pathParam(req, 'customerId'),
        req.body as UpdateCustomerInput,
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Харилцагчийн мэдээлэл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectRouter.post(
  '/nodes',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ body: createObjectNodeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.createObjectNode(
        req.body as CreateObjectNodeInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      created(res, result, 'Объект амжилттай үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

objectRouter.patch(
  '/nodes/:nodeId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ nodeId: objectId }), body: updateObjectNodeSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await objectService.updateObjectNode(
        pathParam(req, 'nodeId'),
        req.body as UpdateObjectNodeInput,
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      ok(res, result, 'Объект шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Removes a node, or refuses with the reasons it cannot go.
 *
 * The zone level's "remove". Archiving through `PATCH { isActive: false }` stays the
 * always-available alternative and is what a zone already named on a request gets.
 */
objectRouter.delete(
  '/nodes/:nodeId',
  requirePermission(PERMISSIONS.OBJECT_MANAGE),
  validate({ params: z.object({ nodeId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await objectService.deleteObjectNode(
        pathParam(req, 'nodeId'),
        scopeOf(req),
        requireAuth(req),
        meta(req),
      );
      noContent(res, 'Объект устгагдлаа.');
    } catch (error) {
      next(error);
    }
  },
);

/** Breadcrumb trail for a node, resolved from the materialised ancestor chain. */
objectRouter.get(
  '/nodes/:nodeId/breadcrumb',
  requirePermission(PERMISSIONS.OBJECT_VIEW),
  validate({ params: z.object({ nodeId: objectId }) }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const scope = scopeOf(req);

      const node = await ObjectNode.findById(pathParam(req, 'nodeId'));
      if (!node) {
        ok(res, []);
        return;
      }
      // A breadcrumb names the project and building above a node, so it discloses the
      // hierarchy just as a detail read does and is scoped the same way.
      assertInCustomerScope(scope, node.customer);

      const ancestors = await ObjectNode.find({
        _id: { $in: node.ancestors },
        ...customerScopeFilter(scope),
      }).select('kind name');
      const ordered = node.ancestors
        .map((id) => ancestors.find((entry) => String(entry._id) === String(id)))
        .filter((entry): entry is (typeof ancestors)[number] => entry !== undefined)
        .map((entry) => ({ id: String(entry._id), kind: entry.kind, name: entry.name }));

      ordered.push({ id: String(node._id), kind: node.kind, name: node.name });
      ok(res, ordered);
    } catch (error) {
      next(error);
    }
  },
);
