import { Types } from 'mongoose';

import { Employee } from '../employee/employee.model';

/**
 * Maps employees to the user accounts they sign in with.
 *
 * A notification is addressed to a user, but the domain assigns work to an employee, and
 * the two are separate records joined by `systemUser`. An employee with no account simply
 * drops out: there is nobody to notify, and inventing a recipient would be worse than
 * notifying nobody.
 */
export async function userIdsForEmployees(
  employeeIds: readonly string[],
): Promise<Types.ObjectId[]> {
  if (employeeIds.length === 0) return [];

  const employees = await Employee.find({
    _id: { $in: employeeIds.map((id) => new Types.ObjectId(id)) },
    systemUser: { $ne: null },
  })
    .select('systemUser')
    .lean();

  return employees
    .map((employee) => employee.systemUser)
    .filter((id): id is Types.ObjectId => id !== null);
}
