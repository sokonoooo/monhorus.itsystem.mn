import {
  PERMISSIONS,
  changeAgreementStatusSchema,
  createServiceAgreementSchema,
  isAgreementReasonRequired,
  updateServiceAgreementSchema,
  type ChangeAgreementStatusInput,
  type CreateServiceAgreementInput,
  type ServiceAgreementDto,
  type UpdateServiceAgreementInput,
} from '@monhorus/shared';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { created, ok } from '../../common/utils/api-response.util';
import { CREATOR_POPULATE, creatorName } from '../../common/utils/creator.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import {
  authenticate,
  enforcePasswordChange,
  requireAuth,
} from '../../middlewares/authenticate.middleware';
import { requirePermission } from '../../middlewares/authorize.middleware';
import { validate } from '../../middlewares/validate.middleware';
import { recordAudit } from '../audit/audit.service';
import { Employee } from '../employee/employee.model';
import { Customer } from '../objects/object.models';
import {
  ServiceAgreement,
  nextAgreementNumber,
  type IServiceAgreement,
} from './service-agreement.model';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'ID буруу форматтай байна.');

type WithId<T> = T & { _id: Types.ObjectId };

function named(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if ('name' in value) return String((value as { name: string }).name);
  if ('firstName' in value && 'lastName' in value) {
    const employee = value as { firstName: string; lastName: string };
    return `${employee.lastName} ${employee.firstName}`.trim();
  }
  return null;
}

function toDto(agreement: WithId<IServiceAgreement>): ServiceAgreementDto {
  return {
    id: String(agreement._id),
    agreementNumber: agreement.agreementNumber,
    customerId:
      typeof agreement.customer === 'object' && '_id' in agreement.customer
        ? String((agreement.customer as { _id: Types.ObjectId })._id)
        : String(agreement.customer),
    customerName: named(agreement.customer) ?? '',
    startDate: agreement.startDate.toISOString(),
    endDate: agreement.endDate.toISOString(),
    serviceType: agreement.serviceType,
    slaUrgentHours: agreement.slaUrgentHours,
    slaStandardHours: agreement.slaStandardHours,
    frequency: agreement.frequency,
    calendarRule: agreement.calendarRule,
    monthlyFee: agreement.monthlyFee,
    currency: agreement.currency,
    responsibleEmployeeId: agreement.responsibleEmployee
      ? String(
          typeof agreement.responsibleEmployee === 'object' && '_id' in agreement.responsibleEmployee
            ? (agreement.responsibleEmployee as { _id: Types.ObjectId })._id
            : agreement.responsibleEmployee,
        )
      : null,
    responsibleEmployeeName: named(agreement.responsibleEmployee),
    status: agreement.status,
    statusReason: agreement.statusReason,
    attachmentIds: agreement.attachments.map((id) => String(id)),
    notes: agreement.notes,
    createdByName: creatorName(agreement.createdBy),
    createdAt: agreement.createdAt.toISOString(),
    updatedAt: agreement.updatedAt.toISOString(),
  };
}

const POPULATE = [
  { path: 'customer', select: 'name' },
  { path: 'responsibleEmployee', select: 'firstName lastName' },
  CREATOR_POPULATE,
] as const;

export const serviceAgreementRouter = Router();

serviceAgreementRouter.use(authenticate, enforcePasswordChange);

serviceAgreementRouter.get(
  '/',
  requirePermission(PERMISSIONS.CUSTOMER_VIEW),
  validate({
    query: z.object({
      customerId: objectId.optional(),
      status: z.string().optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
    }),
  }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as { customerId?: string; status?: string; limit: number };
      const filter: Record<string, unknown> = {};
      if (query.customerId) filter.customer = new Types.ObjectId(query.customerId);
      if (query.status) filter.status = query.status;

      const agreements = await ServiceAgreement.find(filter)
        .populate([...POPULATE])
        .sort({ startDate: -1 })
        .limit(query.limit);

      ok(res, agreements.map(toDto));
    } catch (error) {
      next(error);
    }
  },
);

serviceAgreementRouter.post(
  '/',
  requirePermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ body: createServiceAgreementSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const input = req.body as CreateServiceAgreementInput;

      const customer = await Customer.findById(input.customerId).select('_id');
      if (!customer) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', [
          { field: 'customerId', message: 'Харилцагч олдсонгүй.' },
        ]);
      }

      // The responsible person is an internal employee and must be active.
      if (input.responsibleEmployeeId) {
        const employee = await Employee.findById(input.responsibleEmployeeId).select('status');
        if (!employee) {
          throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Хариуцагч олдсонгүй.', [
            { field: 'responsibleEmployeeId', message: 'Ажилтан олдсонгүй.' },
          ]);
        }
        if (employee.status !== 'ACTIVE') {
          throw AppError.badRequest(
            ERROR_CODES.VALIDATION_ERROR,
            'Хариуцагч идэвхтэй ажилтан байх ёстой.',
            [{ field: 'responsibleEmployeeId', message: 'Зөвхөн идэвхтэй ажилтан.' }],
          );
        }
      }

      const agreement = await ServiceAgreement.create({
        agreementNumber: input.agreementNumber ?? (await nextAgreementNumber()),
        customer: customer._id,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
        serviceType: input.serviceType,
        slaUrgentHours: input.slaUrgentHours,
        slaStandardHours: input.slaStandardHours,
        frequency: input.frequency ?? null,
        calendarRule: input.calendarRule ?? null,
        monthlyFee: input.monthlyFee,
        responsibleEmployee: input.responsibleEmployeeId
          ? new Types.ObjectId(input.responsibleEmployeeId)
          : null,
        status: 'DRAFT',
        statusHistory: [
          {
            _id: new Types.ObjectId(),
            fromStatus: null,
            toStatus: 'DRAFT',
            reason: null,
            changedBy: new Types.ObjectId(auth.userId),
            changedByName: auth.fullName,
            changedAt: new Date(),
          },
        ],
        notes: input.notes ?? null,
        createdBy: new Types.ObjectId(auth.userId),
      });

      await recordAudit({
        entityType: 'Customer',
        entityId: customer._id,
        action: 'Created',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: 'service agreement created',
        newValue: {
          agreementNumber: agreement.agreementNumber,
          monthlyFee: agreement.monthlyFee,
          status: agreement.status,
        },
      });

      const populated = await ServiceAgreement.findById(agreement._id).populate([...POPULATE]);
      created(res, populated ? toDto(populated) : null, 'Үйлчилгээний нөхцөл үүслээ.');
    } catch (error) {
      next(error);
    }
  },
);

serviceAgreementRouter.patch(
  '/:agreementId',
  requirePermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ params: z.object({ agreementId: objectId }), body: updateServiceAgreementSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const input = req.body as UpdateServiceAgreementInput;

      const agreement = await ServiceAgreement.findById(pathParam(req, 'agreementId'));
      if (!agreement) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Үйлчилгээний нөхцөл олдсонгүй.');
      }

      const before = { monthlyFee: agreement.monthlyFee, serviceType: agreement.serviceType };

      if (input.startDate !== undefined) agreement.startDate = new Date(input.startDate);
      if (input.endDate !== undefined) agreement.endDate = new Date(input.endDate);
      if (input.serviceType !== undefined) agreement.serviceType = input.serviceType;
      if (input.slaUrgentHours !== undefined) agreement.slaUrgentHours = input.slaUrgentHours;
      if (input.slaStandardHours !== undefined) agreement.slaStandardHours = input.slaStandardHours;
      if (input.frequency !== undefined) agreement.frequency = input.frequency ?? null;
      if (input.calendarRule !== undefined) agreement.calendarRule = input.calendarRule ?? null;
      if (input.monthlyFee !== undefined) agreement.monthlyFee = input.monthlyFee;
      if (input.notes !== undefined) agreement.notes = input.notes ?? null;
      if (input.responsibleEmployeeId !== undefined) {
        agreement.responsibleEmployee = input.responsibleEmployeeId
          ? new Types.ObjectId(input.responsibleEmployeeId)
          : null;
      }

      // Requirements 13: a price change after the fact must be auditable.
      await agreement.save();

      await recordAudit({
        entityType: 'Customer',
        entityId: agreement.customer,
        action: 'Updated',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: 'service agreement updated',
        oldValue: before,
        newValue: { monthlyFee: agreement.monthlyFee, serviceType: agreement.serviceType },
      });

      const populated = await ServiceAgreement.findById(agreement._id).populate([...POPULATE]);
      ok(res, populated ? toDto(populated) : null, 'Үйлчилгээний нөхцөл шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);

serviceAgreementRouter.post(
  '/:agreementId/status',
  requirePermission(PERMISSIONS.CUSTOMER_MANAGE),
  validate({ params: z.object({ agreementId: objectId }), body: changeAgreementStatusSchema }),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const auth = requireAuth(req);
      const input = req.body as ChangeAgreementStatusInput;

      const agreement = await ServiceAgreement.findById(pathParam(req, 'agreementId'));
      if (!agreement) {
        throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Үйлчилгээний нөхцөл олдсонгүй.');
      }

      const from = agreement.status;
      if (from === input.status) {
        throw AppError.badRequest(
          ERROR_CODES.VALIDATION_ERROR,
          'Нөхцөл аль хэдийн энэ төлөвт байна.',
        );
      }

      // Requirements 6.3 records the reason for a suspension or cancellation in the
      // audit log; the shared schema already enforces its presence.
      if (isAgreementReasonRequired(input.status) && !input.reason) {
        throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Шалтгаан заавал бөглөнө.', [
          { field: 'reason', message: 'Шалтгаан заавал.' },
        ]);
      }

      agreement.status = input.status;
      agreement.statusReason = input.reason ?? null;
      agreement.statusHistory.push({
        _id: new Types.ObjectId(),
        fromStatus: from,
        toStatus: input.status,
        reason: input.reason ?? null,
        changedBy: new Types.ObjectId(auth.userId),
        changedByName: auth.fullName,
        changedAt: new Date(),
      });
      await agreement.save();

      await recordAudit({
        entityType: 'Customer',
        entityId: agreement.customer,
        action: 'StatusChanged',
        actor: { id: auth.userId, role: auth.role, label: auth.fullName },
        meta: meta(req),
        reason: input.reason ?? 'service agreement status changed',
        oldValue: { agreementStatus: from },
        newValue: { agreementStatus: input.status },
      });

      const populated = await ServiceAgreement.findById(agreement._id).populate([...POPULATE]);
      ok(res, populated ? toDto(populated) : null, 'Төлөв шинэчлэгдлээ.');
    } catch (error) {
      next(error);
    }
  },
);
