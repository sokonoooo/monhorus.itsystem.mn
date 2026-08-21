import type { RiskLevel } from '../constants/service-request';

/**
 * Customer object hierarchy, requirements section 4:
 * Харилцагч байгууллага -> Төсөл -> Барилга/Объект -> Давхар -> Өрөө/Бүс
 * -> Самбар -> Хэлхээ/Шугам -> Тоноглол/Объект
 *
 * Every node shares this shape so the dependent selector and the breadcrumb trail
 * can be written once instead of eight times.
 */
export const OBJECT_NODE_KINDS = [
  'CUSTOMER',
  'PROJECT',
  'BUILDING',
  'FLOOR',
  'ROOM',
  'PANEL',
  'CIRCUIT',
  'DEVICE',
] as const;
export type ObjectNodeKind = (typeof OBJECT_NODE_KINDS)[number];

export const OBJECT_NODE_KIND_LABELS: Record<ObjectNodeKind, string> = {
  CUSTOMER: 'Харилцагч байгууллага',
  PROJECT: 'Төсөл',
  BUILDING: 'Барилга/Объект',
  FLOOR: 'Давхар',
  ROOM: 'Өрөө/Бүс',
  PANEL: 'Самбар',
  CIRCUIT: 'Хэлхээ/Шугам',
  DEVICE: 'Төхөөрөмж',
};

/** Ordered parent-to-child chain, used to drive the dependent selector. */
export const OBJECT_HIERARCHY_ORDER: readonly ObjectNodeKind[] = OBJECT_NODE_KINDS;

export function childKindOf(kind: ObjectNodeKind): ObjectNodeKind | null {
  const index = OBJECT_HIERARCHY_ORDER.indexOf(kind);
  return index >= 0 && index < OBJECT_HIERARCHY_ORDER.length - 1
    ? (OBJECT_HIERARCHY_ORDER[index + 1] as ObjectNodeKind)
    : null;
}

export interface ObjectNodeDto {
  id: string;
  kind: ObjectNodeKind;
  code: string;
  name: string;
  parentId: string | null;
  customerId: string;
  /** Latest valid assessment, requirements section 10.2. Null when never assessed. */
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  hasChildren: boolean;
  isActive: boolean;
}

export interface ObjectBreadcrumbDto {
  id: string;
  kind: ObjectNodeKind;
  name: string;
}

export interface CustomerDto {
  id: string;
  code: string;
  name: string;
  /** РД, requirements 4.2. */
  registrationNumber: string | null;
  /** ТТД, requirements 4.2. */
  taxNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  contactPerson: string | null;
  /** Хариуцсан хүн, requirements 4.2. Internal employee, not a customer contact. */
  responsibleEmployeeId: string | null;
  responsibleEmployeeName: string | null;
  notes: string | null;
  isActive: boolean;
  projectCount?: number;
  buildingCount?: number;
  activeAgreementCount?: number;
  /**
   * Who created the record, resolved to a display name.
   *
   * Null where it is not known: rows created before the creator was recorded, and
   * records the system itself made. The screen renders that as a dash rather than
   * guessing, because an absent creator is a real answer here.
   */
  createdByName: string | null;
}

export interface ObjectChildrenQuery {
  parentId?: string;
  kind?: ObjectNodeKind;
  customerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}
