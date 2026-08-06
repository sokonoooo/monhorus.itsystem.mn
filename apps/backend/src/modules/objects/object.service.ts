import {
  riskLevelFor,
  type RiskBand,
  type CreateCustomerInput,
  type CreateObjectNodeInput,
  type CustomerDto,
  type ObjectNodeDto,
  type PaginatedData,
  type UpdateCustomerInput,
  type UpdateObjectNodeInput,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import {
  customerScopeFilter,
  resolveOwnerCustomerId,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import { getRiskBands } from '../settings/settings.service';
import { ServiceAgreement } from '../service-agreement/service-agreement.model';
import { Customer, ObjectNode, type ICustomer, type IObjectNode } from './object.models';
import { deleteBlockersFor } from './project.service';

/** Legal parent for each node kind, from the requirements section 4 hierarchy. */
const PARENT_KIND: Record<string, string | null> = {
  PROJECT: null,
  BUILDING: 'PROJECT',
  FLOOR: 'BUILDING',
  ROOM: 'FLOOR',
  PANEL: 'ROOM',
  CIRCUIT: 'PANEL',
  DEVICE: 'CIRCUIT',
};

function employeeName(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('firstName' in value) || !('lastName' in value)) return null;
  const employee = value as { firstName: string; lastName: string };
  return `${employee.lastName} ${employee.firstName}`.trim();
}

export function toCustomerDto(
  customer: ICustomer & { _id: Types.ObjectId },
  counts?: { projectCount: number; buildingCount: number; activeAgreementCount: number },
): CustomerDto {
  const responsible = customer.responsibleEmployee;

  return {
    id: String(customer._id),
    code: customer.code,
    name: customer.name,
    registrationNumber: customer.registrationNumber,
    taxNumber: customer.taxNumber,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    contactPerson: customer.contactPerson,
    responsibleEmployeeId: responsible
      ? String(
          typeof responsible === 'object' && '_id' in responsible
            ? (responsible as { _id: Types.ObjectId })._id
            : responsible,
        )
      : null,
    responsibleEmployeeName: employeeName(responsible),
    notes: customer.notes,
    isActive: customer.isActive,
    ...(counts ?? {}),
  };
}

/**
 * Maps a node to its DTO.
 *
 * The risk bands are passed in rather than read here: section 16.1 makes the five band
 * thresholds configurable, and resolving them once per request is cheaper and more
 * consistent than resolving them per node.
 */
export function toObjectNodeDto(
  node: IObjectNode & { _id: Types.ObjectId },
  hasChildren: boolean,
  bands: readonly RiskBand[],
): ObjectNodeDto {
  return {
    id: String(node._id),
    kind: node.kind,
    code: node.code,
    name: node.name,
    parentId: node.parent ? String(node.parent) : null,
    customerId: String(node.customer),
    riskScore: node.riskScore,
    riskLevel: node.riskScore === null ? null : riskLevelFor(node.riskScore, bands),
    hasChildren,
    isActive: node.isActive,
  };
}

// -- Customer ----------------------------------------------------------------

export async function createCustomer(
  input: CreateCustomerInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<CustomerDto> {
  const existing = await Customer.findOne({ code: input.code }).select('_id');
  if (existing) {
    throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ кодтой харилцагч бүртгэгдсэн байна.');
  }

  const customer = await Customer.create({
    code: input.code,
    name: input.name,
    registrationNumber: input.registrationNumber ?? null,
    taxNumber: input.taxNumber ?? null,
    phone: input.phone ?? null,
    email: input.email ?? null,
    address: input.address ?? null,
    contactPerson: input.contactPerson ?? null,
    responsibleEmployee: input.responsibleEmployeeId
      ? new Types.ObjectId(input.responsibleEmployeeId)
      : null,
    notes: input.notes ?? null,
    isActive: true,
  });

  await recordAudit({
    entityType: 'Customer',
    entityId: customer._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { code: customer.code, name: customer.name },
  });

  return getCustomerById(String(customer._id));
}

export async function updateCustomer(
  customerId: string,
  input: UpdateCustomerInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<CustomerDto> {
  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Харилцагч олдсонгүй.');
  }

  if (input.code && input.code !== customer.code) {
    const clash = await Customer.findOne({ code: input.code, _id: { $ne: customer._id } });
    if (clash) {
      throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ кодтой харилцагч бүртгэгдсэн байна.');
    }
  }

  const before = { code: customer.code, name: customer.name, isActive: customer.isActive };

  if (input.code !== undefined) customer.code = input.code;
  if (input.name !== undefined) customer.name = input.name;
  if (input.registrationNumber !== undefined) customer.registrationNumber = input.registrationNumber ?? null;
  if (input.phone !== undefined) customer.phone = input.phone ?? null;
  if (input.email !== undefined) customer.email = input.email ?? null;
  if (input.address !== undefined) customer.address = input.address ?? null;
  if (input.contactPerson !== undefined) customer.contactPerson = input.contactPerson ?? null;
  if (input.taxNumber !== undefined) customer.taxNumber = input.taxNumber ?? null;
  if (input.notes !== undefined) customer.notes = input.notes ?? null;
  if (input.responsibleEmployeeId !== undefined) {
    customer.responsibleEmployee = input.responsibleEmployeeId
      ? new Types.ObjectId(input.responsibleEmployeeId)
      : null;
  }
  if (input.isActive !== undefined) customer.isActive = input.isActive;

  await customer.save();

  await recordAudit({
    entityType: 'Customer',
    entityId: customer._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { code: customer.code, name: customer.name, isActive: customer.isActive },
  });

  // Re-read with the responsible employee populated so the response carries the
  // resolved name rather than a bare id.
  return getCustomerById(String(customer._id));
}

export interface CustomerListQuery {
  page: number;
  limit: number;
  search?: string;
  isActive?: boolean;
  responsibleEmployeeId?: string;
  hasActiveAgreement?: boolean;
  sortBy: 'name' | 'code' | 'createdAt';
  sortDir: 'asc' | 'desc';
}

/**
 * Customer list with project, building and active-agreement counts.
 *
 * Counts come from three grouped aggregations over the current page rather than one
 * query per row, so the page cost does not scale with the number of customers shown.
 */
export async function listCustomers(
  query: CustomerListQuery,
): Promise<PaginatedData<CustomerDto>> {
  const filter: Record<string, unknown> = {};

  if (query.isActive !== undefined) filter.isActive = query.isActive;
  if (query.responsibleEmployeeId) {
    filter.responsibleEmployee = new Types.ObjectId(query.responsibleEmployeeId);
  }
  if (query.search) {
    const escaped = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [
      { name: pattern },
      { code: pattern },
      { registrationNumber: pattern },
      { taxNumber: pattern },
      { phone: pattern },
      { email: pattern },
      { address: pattern },
    ];
  }

  const skip = (query.page - 1) * query.limit;
  const sort: Record<string, 1 | -1> = { [query.sortBy]: query.sortDir === 'asc' ? 1 : -1 };

  const [rows, total] = await Promise.all([
    Customer.find(filter)
      .populate({ path: 'responsibleEmployee', select: 'firstName lastName' })
      .sort(sort)
      .skip(skip)
      .limit(query.limit),
    Customer.countDocuments(filter),
  ]);

  const ids = rows.map((row) => row._id);

  const [projects, buildings, agreements] = await Promise.all([
    ObjectNode.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, kind: 'PROJECT', isActive: true } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    ObjectNode.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, kind: 'BUILDING', isActive: true } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
    ServiceAgreement.aggregate<{ _id: Types.ObjectId; count: number }>([
      { $match: { customer: { $in: ids }, status: 'ACTIVE' } },
      { $group: { _id: '$customer', count: { $sum: 1 } } },
    ]),
  ]);

  const projectMap = new Map(projects.map((entry) => [String(entry._id), entry.count]));
  const buildingMap = new Map(buildings.map((entry) => [String(entry._id), entry.count]));
  const agreementMap = new Map(agreements.map((entry) => [String(entry._id), entry.count]));

  let items = rows.map((row) =>
    toCustomerDto(row, {
      projectCount: projectMap.get(String(row._id)) ?? 0,
      buildingCount: buildingMap.get(String(row._id)) ?? 0,
      activeAgreementCount: agreementMap.get(String(row._id)) ?? 0,
    }),
  );

  // Derived from the aggregation above, so it is filtered after mapping. Documented
  // as a known limitation: the page total still reflects the unfiltered count.
  if (query.hasActiveAgreement !== undefined) {
    items = items.filter((item) =>
      query.hasActiveAgreement
        ? (item.activeAgreementCount ?? 0) > 0
        : (item.activeAgreementCount ?? 0) === 0,
    );
  }

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.limit)),
  };
}

export async function getCustomerById(customerId: string): Promise<CustomerDto> {
  const customer = await Customer.findById(customerId).populate({
    path: 'responsibleEmployee',
    select: 'firstName lastName',
  });
  if (!customer) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Харилцагч олдсонгүй.');
  }

  const [projectCount, buildingCount, activeAgreementCount] = await Promise.all([
    ObjectNode.countDocuments({ customer: customer._id, kind: 'PROJECT', isActive: true }),
    ObjectNode.countDocuments({ customer: customer._id, kind: 'BUILDING', isActive: true }),
    ServiceAgreement.countDocuments({ customer: customer._id, status: 'ACTIVE' }),
  ]);

  return toCustomerDto(customer, { projectCount, buildingCount, activeAgreementCount });
}

// -- Object node -------------------------------------------------------------

/**
 * Creates a hierarchy node.
 *
 * Enforces two structural rules the schema cannot express: a node's parent must be of
 * the kind directly above it, and the parent must belong to the same customer. The
 * ancestor chain is materialised at write time so breadcrumbs stay a single query.
 */
export async function createObjectNode(
  input: CreateObjectNodeInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectNodeDto> {
  const ownerCustomerId = resolveOwnerCustomerId(scope, input.customerId);

  const customer = await Customer.findById(ownerCustomerId).select('_id');
  if (!customer) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Харилцагч олдсонгүй.', [
      { field: 'customerId', message: 'Харилцагч олдсонгүй.' },
    ]);
  }

  const expectedParentKind = PARENT_KIND[input.kind];
  let ancestors: Types.ObjectId[] = [];
  let parentId: Types.ObjectId | null = null;

  if (expectedParentKind === null) {
    if (input.parentId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Төсөл эцэг объекттой байж болохгүй.',
        [{ field: 'parentId', message: 'Энэ түвшин эцэггүй байна.' }],
      );
    }
  } else {
    if (!input.parentId) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Эцэг объект заавал.', [
        { field: 'parentId', message: 'Эцэг объект заавал.' },
      ]);
    }

    // Scoped, so a parent belonging to another tenant does not resolve at all rather than
    // being fetched and then rejected.
    const parent = await ObjectNode.findOne({
      _id: input.parentId,
      ...customerScopeFilter(scope),
    }).select('kind customer ancestors');
    if (!parent) {
      throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Эцэг объект олдсонгүй.', [
        { field: 'parentId', message: 'Эцэг объект олдсонгүй.' },
      ]);
    }
    if (parent.kind !== expectedParentKind) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        `${input.kind} нь ${expectedParentKind} дор байрлана.`,
        [{ field: 'parentId', message: 'Шатлал зөрчиж байна.' }],
      );
    }
    if (String(parent.customer) !== ownerCustomerId) {
      throw AppError.badRequest(
        ERROR_CODES.VALIDATION_ERROR,
        'Эцэг объект өөр харилцагчид харьяалагдаж байна.',
        [{ field: 'parentId', message: 'Эцэг объект өөр харилцагчийнх байна.' }],
      );
    }

    parentId = parent._id;
    ancestors = [...parent.ancestors, parent._id];
  }

  const duplicate = await ObjectNode.findOne({
    customer: customer._id,
    code: input.code,
  }).select('_id');
  if (duplicate) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      'Энэ харилцагч дээр ийм кодтой объект бүртгэгдсэн байна.',
    );
  }

  const node = await ObjectNode.create({
    kind: input.kind,
    code: input.code,
    name: input.name,
    parent: parentId,
    customer: customer._id,
    ancestors,
    riskScore: input.riskScore ?? null,
    isActive: true,
  });

  await recordAudit({
    entityType: 'Equipment',
    entityId: node._id,
    action: 'Created',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    newValue: { kind: node.kind, code: node.code, name: node.name },
  });

  return toObjectNodeDto(node, false, await getRiskBands());
}

export async function updateObjectNode(
  nodeId: string,
  input: UpdateObjectNodeInput,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<ObjectNodeDto> {
  const node = await ObjectNode.findOne({ _id: nodeId, ...customerScopeFilter(scope) });
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');
  }

  if (input.code && input.code !== node.code) {
    const clash = await ObjectNode.findOne({
      customer: node.customer,
      code: input.code,
      _id: { $ne: node._id },
    }).select('_id');
    if (clash) {
      throw AppError.conflict(ERROR_CODES.DUPLICATE_KEY, 'Энэ кодтой объект бүртгэгдсэн байна.');
    }
  }

  const before = { name: node.name, code: node.code, riskScore: node.riskScore };

  if (input.name !== undefined) node.name = input.name;
  if (input.code !== undefined) node.code = input.code;
  if (input.riskScore !== undefined) node.riskScore = input.riskScore ?? null;
  if (input.isActive !== undefined) node.isActive = input.isActive;

  await node.save();

  // Requirements 10.1: a score change must be auditable with both values.
  await recordAudit({
    entityType: 'Equipment',
    entityId: node._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    oldValue: before,
    newValue: { name: node.name, code: node.code, riskScore: node.riskScore },
  });

  const hasChildren = (await ObjectNode.countDocuments({ parent: node._id })) > 0;
  return toObjectNodeDto(node, hasChildren, await getRiskBands());
}

/**
 * Removes a hierarchy node — the one operation the generic node endpoints were missing, and
 * what completes the zone (ROOM) CRUD.
 *
 * Deletion is refused while anything depends on the node, using the SAME blocker set the
 * project module applies to a project, building or floor rather than a second rule invented
 * here. That is what stops a zone named on a service request being removed underneath it:
 * the request keeps a `room` reference, so the answer is to archive the zone
 * (`PATCH /objects/nodes/:id { isActive: false }`), which hides it from the selectors while
 * every past request still resolves its name and its breadcrumb.
 */
export async function deleteObjectNode(
  nodeId: string,
  scope: ResolvedCustomerScope,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  // Scoped, so another tenant's node reports as missing rather than as forbidden.
  const node = await ObjectNode.findOne({ _id: nodeId, ...customerScopeFilter(scope) });
  if (!node) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Объект олдсонгүй.');
  }

  const blockers = await deleteBlockersFor(node);
  if (blockers.length > 0) {
    throw AppError.conflict(
      ERROR_CODES.DUPLICATE_KEY,
      `Хамааралтай бичлэгтэй тул устгах боломжгүй. ${blockers.join(' ')} Архивлана уу.`,
    );
  }

  await ObjectNode.deleteOne({ _id: node._id });

  await recordAudit({
    entityType: 'Equipment',
    entityId: node._id,
    action: 'Updated',
    actor: { id: actor.userId, role: actor.role, label: actor.fullName },
    meta,
    reason: `${node.kind.toLowerCase()} deleted`,
    oldValue: { kind: node.kind, code: node.code, name: node.name },
  });
}
