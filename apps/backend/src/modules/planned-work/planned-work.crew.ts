import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { Employee } from '../employee/employee.model';

/**
 * Turns submitted employee ids into ids that are known to exist.
 *
 * ITS OWN MODULE ONLY BECAUSE OF THE IMPORT GRAPH. It began life private to
 * `planned-work.service.ts`, and approval — which lives in `planned-work.transition.service`
 * — now needs the same check. The service already imports the transition module, so reaching
 * back the other way would close a cycle. Copying eight lines across that boundary would
 * work today and rot later: the two copies would answer differently the first time this
 * check learns about employment status or team membership, and the one guarding approval is
 * the one that decides who a job lands on.
 *
 * Counted rather than fetched: nothing here needs the documents, only the assurance that
 * every id resolves. A short id list against a primary-key index makes this a single
 * covered count.
 */
export async function assertEmployeesExist(
  employeeIds: readonly string[],
): Promise<Types.ObjectId[]> {
  if (employeeIds.length === 0) return [];
  const ids = employeeIds.map((id) => new Types.ObjectId(id));
  const found = await Employee.countDocuments({ _id: { $in: ids } });
  if (found !== ids.length) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Ажилтан олдсонгүй.', [
      { field: 'assignedEmployeeIds', message: 'Сонгосон ажилтан олдсонгүй.' },
    ]);
  }
  return ids;
}
