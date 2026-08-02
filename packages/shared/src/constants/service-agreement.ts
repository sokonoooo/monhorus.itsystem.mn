/**
 * Service agreement (Үйлчилгээний нөхцөл) vocabulary.
 *
 * Statuses and labels are taken verbatim from requirements section 6.3. Test case
 * TC-002 states that no separate contract module exists: the agreement lives inside
 * the customer detail, which is why this is modelled as a child of Customer rather
 * than as a top-level contract entity.
 */
export const SERVICE_AGREEMENT_STATUSES = [
  'DRAFT',
  'SENT',
  'ACTIVE',
  'SUSPENDED',
  'EXPIRED',
  'RENEWED',
  'CANCELLED',
] as const;
export type ServiceAgreementStatus = (typeof SERVICE_AGREEMENT_STATUSES)[number];

export const SERVICE_AGREEMENT_STATUS_LABELS: Record<ServiceAgreementStatus, string> = {
  DRAFT: 'Ноорог',
  SENT: 'Илгээсэн',
  ACTIVE: 'Идэвхтэй',
  SUSPENDED: 'Түр зогсоосон',
  EXPIRED: 'Хугацаа дууссан',
  RENEWED: 'Сунгасан',
  CANCELLED: 'Цуцалсан',
};

/**
 * Requirements 6.3: only an ACTIVE agreement permits calendar generation and
 * invoicing. Requirements 5.1 step 5 repeats this rule.
 */
export function permitsBilling(status: ServiceAgreementStatus): boolean {
  return status === 'ACTIVE';
}

/** Statuses that require a reason, per requirements 6.3. */
export const AGREEMENT_REASON_REQUIRED: readonly ServiceAgreementStatus[] = [
  'SUSPENDED',
  'CANCELLED',
];

export function isAgreementReasonRequired(status: ServiceAgreementStatus): boolean {
  return AGREEMENT_REASON_REQUIRED.includes(status);
}

/** Requirements 6.2: Сар, улирал, хагас жил, жил, custom. */
export const SERVICE_FREQUENCIES = [
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
  'CUSTOM',
] as const;
export type ServiceFrequency = (typeof SERVICE_FREQUENCIES)[number];

export const SERVICE_FREQUENCY_LABELS: Record<ServiceFrequency, string> = {
  MONTHLY: 'Сар',
  QUARTERLY: 'Улирал',
  SEMI_ANNUAL: 'Хагас жил',
  ANNUAL: 'Жил',
  CUSTOM: 'Custom',
};
