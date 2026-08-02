import type { DispatchCandidateDto, EmployeeWorkloadDto } from '@monhorus/shared';
import { Types } from 'mongoose';

import { Employee, type IEmployee } from './employee.model';
import { ServiceRequest } from '../service-request/service-request.model';

/**
 * Statuses that count as an employee currently holding work. A request that has been
 * completed, cancelled or returned no longer occupies the assignee.
 */
const ACTIVE_ASSIGNMENT_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ON_SITE',
  'IN_PROGRESS',
  'WAITING',
  'REPORT_SUBMITTED',
  'VERIFICATION',
] as const;

/**
 * Counts active and completed assignments for a set of employees in two queries,
 * rather than one query per employee.
 */
export async function loadWorkloadCounts(
  employeeIds: readonly Types.ObjectId[],
): Promise<Map<string, { active: number; completed: number }>> {
  const counts = new Map<string, { active: number; completed: number }>();
  if (employeeIds.length === 0) return counts;

  for (const id of employeeIds) {
    counts.set(String(id), { active: 0, completed: 0 });
  }

  const [active, completed] = await Promise.all([
    ServiceRequest.aggregate<{ _id: Types.ObjectId; count: number }>([
      {
        $match: {
          assignedEmployees: { $in: [...employeeIds] },
          status: { $in: [...ACTIVE_ASSIGNMENT_STATUSES] },
        },
      },
      { $unwind: '$assignedEmployees' },
      { $match: { assignedEmployees: { $in: [...employeeIds] } } },
      { $group: { _id: '$assignedEmployees', count: { $sum: 1 } } },
    ]),
    ServiceRequest.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { assignedEmployees: { $in: [...employeeIds] }, status: 'COMPLETED' } },
      { $unwind: '$assignedEmployees' },
      { $match: { assignedEmployees: { $in: [...employeeIds] } } },
      { $group: { _id: '$assignedEmployees', count: { $sum: 1 } } },
    ]),
  ]);

  for (const entry of active) {
    const key = String(entry._id);
    const current = counts.get(key);
    if (current) current.active = entry.count;
  }
  for (const entry of completed) {
    const key = String(entry._id);
    const current = counts.get(key);
    if (current) current.completed = entry.count;
  }

  return counts;
}

export async function getEmployeeWorkload(
  employeeId: Types.ObjectId,
): Promise<EmployeeWorkloadDto> {
  const counts = await loadWorkloadCounts([employeeId]);
  const entry = counts.get(String(employeeId)) ?? { active: 0, completed: 0 };

  return {
    activeAssignments: entry.active,
    completedAssignments: entry.completed,
    openServiceRequests: entry.active,
  };
}

export interface DispatchCandidateQuery {
  teamId?: string;
  skill?: string;
  search?: string;
  /** When true, only employees with no active assignment are returned. */
  availableOnly?: boolean;
  limit: number;
}

/**
 * Employees eligible to receive work.
 *
 * Dispatch reads through this projection rather than querying the employee
 * collection directly, so there is one definition of "assignable": requirements
 * rule 17 and the Phase 1 brief both restrict assignment to ACTIVE employees.
 */
export async function listDispatchCandidates(
  query: DispatchCandidateQuery,
): Promise<DispatchCandidateDto[]> {
  const filter: Record<string, unknown> = { status: 'ACTIVE' };

  if (query.teamId) filter.team = new Types.ObjectId(query.teamId);
  if (query.skill) filter.skills = query.skill;

  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [{ firstName: pattern }, { lastName: pattern }, { employeeCode: pattern }];
  }

  const employees = await Employee.find(filter)
    .populate({ path: 'team', select: 'name' })
    .sort({ lastName: 1, firstName: 1 })
    .limit(query.limit);

  const counts = await loadWorkloadCounts(employees.map((employee) => employee._id));

  const candidates = employees.map((employee) => {
    const workload = counts.get(String(employee._id)) ?? { active: 0, completed: 0 };
    const team = employee.team as unknown as { _id: Types.ObjectId; name: string } | null;

    return {
      id: String(employee._id),
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      photoUrl: employee.photoDocument ? `/api/v1/files/${String(employee.photoDocument)}` : null,
      team: team && team.name ? { id: String(team._id), name: team.name } : null,
      workLocation: employee.workLocation,
      skills: employee.skills,
      qualificationLevel: employee.qualificationLevel,
      safetyGrade: employee.safetyGrade,
      permittedJobTypes: employee.permittedJobTypes,
      activeAssignments: workload.active,
      isAvailable: workload.active === 0,
    } satisfies DispatchCandidateDto;
  });

  return query.availableOnly
    ? candidates.filter((candidate) => candidate.isAvailable)
    : candidates;
}

export type { IEmployee };
