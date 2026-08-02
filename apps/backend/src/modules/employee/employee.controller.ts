import {
  PERMISSIONS,
  type ChangeEmployeeStatusInput,
  type CreateEmployeeInput,
  type EmployeeCertificatePayloadDto,
  type EmployeeListQueryInput,
  type EmployeeSalaryInput,
  type LinkSystemAccessInput,
  type SystemAccessActionInput,
  type UpdateEmployeeInput,
  type UpdateSystemAccessRolesInput,
} from '@monhorus/shared';
import type { NextFunction, Request, Response } from 'express';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { created, ok } from '../../common/utils/api-response.util';
import { pathParam } from '../../common/utils/path-param.util';
import { buildRequestMeta as meta } from '../../common/utils/request-meta.util';
import { requireAuth } from '../../middlewares/authenticate.middleware';
import { assertPermission } from '../../middlewares/authorize.middleware';
import {
  manageSystemAccess,
  restoreSystemAccess,
  revokeSystemAccess,
  suspendSystemAccess,
  updateSystemAccessRoles,
} from './employee-access.service';
import * as employeeService from './employee.service';
import { Employee } from './employee.model';

export async function systemAccessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await manageSystemAccess(
      pathParam(req, 'employeeId'),
      req.body as LinkSystemAccessInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Системийн эрх шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function systemAccessRolesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await updateSystemAccessRoles(
      pathParam(req, 'employeeId'),
      req.body as UpdateSystemAccessRolesInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Хэрэглэгчийн эрх шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function suspendSystemAccessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await suspendSystemAccess(
      pathParam(req, 'employeeId'),
      req.body as SystemAccessActionInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Системийн эрх түр хаагдлаа.');
  } catch (error) {
    next(error);
  }
}

export async function restoreSystemAccessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await restoreSystemAccess(
      pathParam(req, 'employeeId'),
      req.body as SystemAccessActionInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Системийн эрх сэргээгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function revokeSystemAccessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await revokeSystemAccess(
      pathParam(req, 'employeeId'),
      req.body as SystemAccessActionInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, result, 'Системийн эрх хүчингүй болголоо.');
  } catch (error) {
    next(error);
  }
}

export async function listEmployeesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result = await employeeService.listEmployees(
      req.query as unknown as EmployeeListQueryInput,
    );
    ok(res, result);
  } catch (error) {
    next(error);
  }
}

/**
 * `GET /employees/me` — the signed-in account's own employee record.
 *
 * Reads `req.auth` and nothing else. Note that no part of `req.query`, `req.params` or
 * `req.body` is touched here or below: the identity is the authenticated one, so there is
 * no input to validate and none to be tricked by.
 */
export async function getMyEmployeeRecordHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const record = await employeeService.getMyEmployeeRecord(requireAuth(req));
    ok(res, record);
  } catch (error) {
    next(error);
  }
}

export async function getEmployeeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await employeeService.getEmployeeById(pathParam(req, 'employeeId'), requireAuth(req));
    ok(res, employee);
  } catch (error) {
    next(error);
  }
}

export async function createEmployeeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await employeeService.createEmployee(
      req.body as CreateEmployeeInput,
      requireAuth(req),
      meta(req),
    );
    created(res, employee, 'Ажилтан амжилттай бүртгэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function updateEmployeeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await employeeService.updateEmployee(
      pathParam(req, 'employeeId'),
      req.body as UpdateEmployeeInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, employee, 'Ажилтны мэдээлэл шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function changeStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const employee = await employeeService.changeEmployeeStatus(
      pathParam(req, 'employeeId'),
      req.body as ChangeEmployeeStatusInput,
      requireAuth(req),
      meta(req),
    );
    ok(res, employee, 'Ажилтны төлөв шинэчлэгдлээ.');
  } catch (error) {
    next(error);
  }
}

export async function listSalaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const history = await employeeService.listSalaryHistory(pathParam(req, 'employeeId'));
    ok(res, history);
  } catch (error) {
    next(error);
  }
}

export async function upsertSalaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const salary = await employeeService.upsertSalary(
      pathParam(req, 'employeeId'),
      req.body as EmployeeSalaryInput,
      requireAuth(req),
      meta(req),
    );
    created(res, salary, 'Цалингийн мэдээлэл хадгалагдлаа.');
  } catch (error) {
    next(error);
  }
}

/**
 * Printable employee certificate payload.
 *
 * Deliberately excludes every salary field. The registration number is included only
 * for a caller who also holds employee.view_salary-level trust; the Phase 1 brief says
 * "registration number when permitted", and employee.view_audit is the closest
 * existing sensitivity marker for personally identifying data.
 */
export async function certificateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const auth = requireAuth(req);
    assertPermission(auth, PERMISSIONS.EMPLOYEE_PRINT_CERTIFICATE);

    const employee = await Employee.findById(pathParam(req, 'employeeId')).populate([
      { path: 'company', select: 'name' },
      { path: 'department', select: 'name' },
      { path: 'position', select: 'name' },
    ]);
    if (!employee) {
      throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Ажилтан олдсонгүй.');
    }

    const named = (value: unknown): string | null =>
      typeof value === 'object' && value !== null && 'name' in value
        ? String((value as { name: string }).name)
        : null;

    const payload: EmployeeCertificatePayloadDto = {
      employeeCode: employee.employeeCode,
      fullName: `${employee.lastName} ${employee.firstName}`.trim(),
      registrationNumber: auth.permissions.has(PERMISSIONS.EMPLOYEE_VIEW_AUDIT)
        ? employee.registrationNumber
        : null,
      companyName: named(employee.company),
      departmentName: named(employee.department),
      positionName: named(employee.position),
      employmentStartDate: employee.employmentStartDate
        ? employee.employmentStartDate.toISOString()
        : null,
      status: employee.status,
      generatedAt: new Date().toISOString(),
      generatedByName: auth.fullName,
    };

    ok(res, payload);
  } catch (error) {
    next(error);
  }
}
