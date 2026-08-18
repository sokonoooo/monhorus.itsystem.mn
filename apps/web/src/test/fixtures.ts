import type {
  BuildingDto,
  CalendarEventDto,
  CalendarResultDto,
  CustomerDto,
  DashboardSummaryDto,
  DashboardTodaySummary,
  ObjectNodeDto,
  PaginatedData,
  PlannedWorkDto,
  PlannedWorkListItemDto,
  PlannedWorkReportDto,
  PlannedWorkTaskDto,
  FloorDto,
  FloorLoadSummaryDto,
  FloorPlanDto,
  ObjectDetailDto,
  ObjectHistoryDto,
  ObjectListItemDto,
  ObjectTypeDto,
  InspectionListItemDto,
  InspectionSummaryDto,
  InvoiceListItemDto,
  InvoiceSummaryDto,
  NotificationDto,
  ProjectDto,
  ReportResultDto,
  ReportRollupDto,
  RiskSummaryDto,
  ServiceRequestListItemDto,
} from '@monhorus/shared';

/**
 * Shared test fixtures.
 *
 * Centralised so that adding a field to a DTO breaks one factory instead of every
 * test that happens to construct that shape by hand.
 */

export function makeCustomer(overrides: Partial<CustomerDto> = {}): CustomerDto {
  return {
    id: '507f1f77bcf86cd799439011',
    code: 'CT',
    name: 'Central Tower ХХК',
    registrationNumber: null,
    taxNumber: null,
    phone: null,
    email: null,
    address: null,
    contactPerson: null,
    responsibleEmployeeId: null,
    responsibleEmployeeName: null,
    notes: null,
    isActive: true,
    createdByName: 'Б. Энхтөр',
    ...overrides,
  };
}

export function makeObjectNode(overrides: Partial<ObjectNodeDto> = {}): ObjectNodeDto {
  return {
    id: '507f1f77bcf86cd799439021',
    kind: 'PROJECT',
    code: 'PRJ-1',
    name: 'Preventive Service',
    parentId: null,
    customerId: '507f1f77bcf86cd799439011',
    riskScore: null,
    riskLevel: null,
    hasChildren: true,
    isActive: true,
    ...overrides,
  };
}

export function makeServiceRequest(
  overrides: Partial<ServiceRequestListItemDto> = {},
): ServiceRequestListItemDto {
  return {
    id: 'r1',
    requestNumber: 'SR-202601-0001',
    customer: { id: 'c1', name: 'Central Tower ХХК' },
    project: null,
    building: { id: 'b1', name: 'Main Tower' },
    floor: null,
    room: null,
    device: null,
    requestType: 'URGENT_CALL',
    isUrgent: true,
    status: 'UNASSIGNED',
    assignedEmployees: [],
    assignedTeam: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    createdByName: 'Б. Энхтөр',
    slaDueAt: '2026-01-01T06:00:00.000Z',
    slaState: 'STARTED',
    slaRemainingMinutes: 300,
    ...overrides,
  };
}

export function makePlannedWorkListItem(
  overrides: Partial<PlannedWorkListItemDto> = {},
): PlannedWorkListItemDto {
  return {
    id: '507f1f77bcf86cd799439061',
    workNumber: 'PW-202607-0001',
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    customer: { id: 'c1', name: 'Central Tower ХХК' },
    project: { id: 'p1', name: 'Урьдчилан сэргийлэх үйлчилгээ' },
    building: { id: 'b1', name: 'Төв барилга' },
    lifecycleStatus: 'STARTED',
    effectiveStatus: 'STARTED',
    plannedStartDate: '2026-07-01T00:00:00.000Z',
    plannedEndDate: '2026-07-31T00:00:00.000Z',
    actualStartDate: '2026-07-02T00:00:00.000Z',
    actualEndDate: null,
    overdueAt: null,
    completedLate: false,
    delayMinutes: null,
    totalQuantity: 200,
    completedQuantity: 90,
    remainingQuantity: 110,
    progressPercent: 45,
    taskCount: 3,
    assignedEmployees: [{ id: 'e1', name: 'Бат Дорж' }],
    assignedTeam: null,
    reportStatus: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    createdByName: 'Б. Энхтөр',
    ...overrides,
  };
}

export function makePlannedWorkTask(
  overrides: Partial<PlannedWorkTaskDto> = {},
): PlannedWorkTaskDto {
  return {
    id: '507f1f77bcf86cd799439071',
    plannedWorkId: '507f1f77bcf86cd799439061',
    floorId: 'f1',
    floorName: '1 давхар',
    title: 'Самбарын үзлэг',
    description: null,
    unit: 'PIECE',
    totalQuantity: 10,
    completedQuantity: 4,
    remainingQuantity: 6,
    progressPercent: 40,
    status: 'IN_PROGRESS',
    plannedStartDate: '2026-07-05T00:00:00.000Z',
    plannedEndDate: '2026-07-20T00:00:00.000Z',
    assignedEmployeeId: 'e1',
    assignedEmployeeName: 'Бат Дорж',
    note: null,
    conclusion: null,
    conclusionById: null,
    conclusionByName: null,
    conclusionAt: null,
    durationMinutes: null,
    score: null,
    riskLevel: null,
    recommendation: null,
    relatedObjects: [],
    beforePhotos: [],
    afterPhotos: [],
    missingEvidence: ['Ажлын өмнөх зураг', 'Ажлын дараах зураг', 'Тайлбар', 'Зөвлөмж'],
    completedAt: null,
    createdAt: '2026-06-25T00:00:00.000Z',
    createdByName: 'Б. Энхтөр',
    updatedAt: '2026-06-25T00:00:00.000Z',
    ...overrides,
  };
}

export function makePlannedWorkReport(
  overrides: Partial<PlannedWorkReportDto> = {},
): PlannedWorkReportDto {
  return {
    id: '507f1f77bcf86cd799439081',
    plannedWorkId: '507f1f77bcf86cd799439061',
    status: 'DRAFT',
    conclusion: null,
    recommendation: null,
    createdBy: { id: 'u1', name: 'Тест Хэрэглэгч', at: '2026-07-30T00:00:00.000Z' },
    submittedBy: { id: null, name: null, at: null },
    approvedBy: { id: null, name: null, at: null },
    returnedBy: { id: null, name: null, at: null },
    returnReason: null,
    submissionBlockers: ['Нэгдсэн дүгнэлт бөглөгдөөгүй.'],
    canApprove: false,
    approvalBlockers: ['Тайлан хянуулахаар илгээгдээгүй байна.'],
    visibleToCustomer: false,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

export function makePlannedWork(overrides: Partial<PlannedWorkDto> = {}): PlannedWorkDto {
  return {
    ...makePlannedWorkListItem(),
    description: null,
    updatedAt: '2026-07-02T00:00:00.000Z',
    originalPlannedEndDate: '2026-07-31T00:00:00.000Z',
    currentPauseStartedAt: null,
    totalPausedMinutes: 0,
    pauseHistory: [],
    scheduleHistory: [],
    cancelReason: null,
    cancelledBy: { id: null, name: null, at: null },
    archivedBy: { id: null, name: null, at: null },
    tasks: [makePlannedWorkTask()],
    floorProgress: [
      {
        floorId: 'f1',
        floorName: '1 давхар',
        taskCount: 1,
        totalQuantity: 10,
        completedQuantity: 4,
        remainingQuantity: 6,
        progressPercent: 40,
      },
    ],
    materials: [],
    report: null,
    availableActions: [],
    completionBlockers: ['"Самбарын үзлэг" биелэлт 40% байна.'],
    ...overrides,
  };
}

export function makeCalendarEvent(overrides: Partial<CalendarEventDto> = {}): CalendarEventDto {
  return {
    id: 'PLANNED_WORK:507f1f77bcf86cd799439061',
    source: 'PLANNED_WORK',
    sourceId: '507f1f77bcf86cd799439061',
    reference: 'PW-202607-0001',
    title: 'Хагас жилийн урьдчилан сэргийлэх үзлэг',
    start: '2026-07-06T00:00:00.000Z',
    end: '2026-07-08T00:00:00.000Z',
    status: 'STARTED',
    statusLabel: 'Хэрэгжиж байна',
    isOverdue: false,
    isUrgent: false,
    customerName: 'Central Tower ХХК',
    buildingName: 'Төв барилга',
    assignedNames: ['Бат Дорж'],
    progressPercent: 45,
    detailPath: '/planned-work/507f1f77bcf86cd799439061',
    ...overrides,
  };
}

export function makeCalendarResult(events: CalendarEventDto[]): CalendarResultDto {
  return {
    from: '2026-06-29T00:00:00.000Z',
    to: '2026-08-03T00:00:00.000Z',
    timezone: 'Asia/Ulaanbaatar',
    events,
  };
}

/** Wraps fixtures in the standard paginated envelope. */
export function makePage<T>(items: T[], limit = 20): PaginatedData<T> {
  return { items, page: 1, limit, total: items.length, totalPages: items.length === 0 ? 0 : 1 };
}


// -- Project module ----------------------------------------------------------

/** Nothing assessed yet. Individual tests override it to exercise the risk columns. */
export function makeRiskSummary(overrides: Partial<RiskSummaryDto> = {}): RiskSummaryDto {
  return {
    counts: [],
    unassessedCount: 0,
    hasCritical: false,
    lastAssessedAt: null,
    ...overrides,
  };
}

/**
 * A node with nothing assessed beneath it.
 *
 * Null rather than zero, matching the rollup itself: unassessed is not a bad score, and a
 * fixture that said 0 would quietly assert the opposite of the rule under test.
 */
export function makeRollup(overrides: Partial<ReportRollupDto> = {}): ReportRollupDto {
  return {
    score: null,
    riskLevel: null,
    assessedCount: 0,
    unassessedCount: 0,
    worstObjectId: null,
    worstObjectName: null,
    calculatedAt: null,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<ProjectDto> = {}): ProjectDto {
  return {
    id: '507f1f77bcf86cd799439101',
    code: 'PRJ-1',
    name: 'Урьдчилан сэргийлэх үйлчилгээ',
    customerId: '507f1f77bcf86cd799439011',
    customerName: 'Central Tower ХХК',
    contractNumber: 'C-2026-001',
    responsibleEmployeeId: null,
    responsibleEmployeeName: 'Бат Дорж',
    startDate: '2026-01-01T00:00:00.000Z',
    endDate: '2026-12-31T00:00:00.000Z',
    description: null,
    isActive: true,
    buildingCount: 2,
    floorCount: 8,
    objectCount: 42,
    riskSummary: makeRiskSummary(),
    rollup: makeRollup(),
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleteBlockers: [],
    ...overrides,
  };
}

export function makeBuilding(overrides: Partial<BuildingDto> = {}): BuildingDto {
  return {
    id: '507f1f77bcf86cd799439111',
    code: 'BLD-1',
    name: 'Төв барилга',
    projectId: '507f1f77bcf86cd799439101',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    customerId: '507f1f77bcf86cd799439011',
    address: 'Олимпийн гудамж 15',
    gpsLatitude: 47.9175,
    gpsLongitude: 106.9172,
    description: null,
    isActive: true,
    floorCount: 4,
    objectCount: 21,
    riskSummary: makeRiskSummary(),
    rollup: makeRollup(),
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleteBlockers: [],
    ...overrides,
  };
}

export function makeFloor(overrides: Partial<FloorDto> = {}): FloorDto {
  return {
    id: '507f1f77bcf86cd799439121',
    code: 'FL-2',
    name: '2 давхар',
    buildingId: '507f1f77bcf86cd799439111',
    buildingName: 'Төв барилга',
    projectId: '507f1f77bcf86cd799439101',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    customerId: '507f1f77bcf86cd799439011',
    floorNumber: 2,
    areaSqm: 1245,
    purpose: 'Оффис',
    description: null,
    isActive: true,
    hasPlanImage: true,
    objectCount: 3,
    riskSummary: makeRiskSummary(),
    rollup: makeRollup(),
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deleteBlockers: [],
    ...overrides,
  };
}

export function makeFloorPlan(overrides: Partial<FloorPlanDto> = {}): FloorPlanDto {
  return {
    id: '507f1f77bcf86cd799439131',
    floorId: '507f1f77bcf86cd799439121',
    fileId: '507f1f77bcf86cd799439141',
    fileName: 'plan.png',
    downloadUrl: '/api/v1/files/507f1f77bcf86cd799439141',
    mimeType: 'image/png',
    sizeBytes: 20480,
    title: '2 давхарын төлөвлөгөө',
    description: null,
    uploadedById: 'u1',
    uploadedByName: 'Ерөнхий админ',
    uploadedAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

// -- Object master -----------------------------------------------------------

export function makeObjectType(overrides: Partial<ObjectTypeDto> = {}): ObjectTypeDto {
  return {
    id: '507f1f77bcf86cd799439151',
    code: 'MCB',
    name: 'Автомат таслуур',
    description: null,
    category: 'EQUIPMENT',
    showOnPlan: false,
    insidePanel: true,
    generatesConclusion: true,
    icon: 'BREAKER',
    // No custom icon by default: the built-in glyph is what a type registered before
    // uploads existed still draws with, and that is the case worth being the default.
    iconFileId: null,
    iconUrl: null,
    // No per-type attributes by default. A type declaring none is what every type looked like
    // before they existed, so it is the case that must keep behaving exactly as it did.
    attributes: [],
    isActive: true,
    objectCount: 0,
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeObjectListItem(
  overrides: Partial<ObjectListItemDto> = {},
): ObjectListItemDto {
  return {
    id: '507f1f77bcf86cd799439161',
    code: 'DB-2A',
    name: 'Түгээх самбар 2A',
    category: 'PANEL',
    objectType: {
      id: '507f1f77bcf86cd799439151',
      code: 'DB',
      name: 'Түгээх самбар',
      icon: 'PANEL',
      iconUrl: null,
      showOnPlan: false,
    attributes: [],
    },
    customerId: '507f1f77bcf86cd799439011',
    customerName: 'Central Tower ХХК',
    floorId: '507f1f77bcf86cd799439121',
    floorName: '2 давхар',
    buildingName: 'Төв барилга',
    planPosition: null,
    status: 'ACTIVE',
    latestAssessment: null,
    attributeValues: {},
    calculatedLoad: { valueKw: 18.4, complete: true, reasons: [] },
    measuredLoadKw: null,
    loadVariance: { valueKw: null, complete: false, reasons: [] },
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeObjectDetail(overrides: Partial<ObjectDetailDto> = {}): ObjectDetailDto {
  return {
    ...makeObjectListItem(),
    description: null,
    notes: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    photos: [],
    panel: { capacityKw: 25, location: 'Баруун жигүүр', protection: 'IP54' },
    circuit: null,
    equipment: null,
    attributeValues: {},
    childCircuits: [],
    childEquipment: [],
    mountedEquipment: [],
    loadPercent: { valueKw: 73.6, complete: true, reasons: [] },
    reserveKw: { valueKw: 6.6, complete: true, reasons: [] },
    canAssess: true,
    deleteBlockers: [],
    ...overrides,
  };
}

export function makeObjectHistory(overrides: Partial<ObjectHistoryDto> = {}): ObjectHistoryDto {
  return {
    assessments: [],
    timeline: [],
    ...overrides,
  };
}

export function makeFloorLoad(
  overrides: Partial<FloorLoadSummaryDto> = {},
): FloorLoadSummaryDto {
  return {
    panelCount: 1,
    circuitCount: 1,
    equipmentCount: 1,
    totalKw: { valueKw: 4.8, complete: true, reasons: [] },
    measuredTotalKw: null,
    variance: { valueKw: null, complete: false, reasons: [] },
    unattachedEquipmentCount: 0,
    unattachedEquipmentKw: { valueKw: 0, complete: true, reasons: [] },
    riskCounts: [],
    unassessedCount: 3,
    kvaNote: 'kVA-г тооцохын тулд чадлын коэффициент (power factor) шаардлагатай.',
    ...overrides,
  };
}


// -- Invoicing ---------------------------------------------------------------

export function makeInvoiceListItem(
  overrides: Partial<InvoiceListItemDto> = {},
): InvoiceListItemDto {
  return {
    id: '507f1f77bcf86cd799439201',
    invoiceNumber: 'INV-202607-0001',
    customerId: '507f1f77bcf86cd799439011',
    customerName: 'Central Tower ХХК',
    billingType: 'MONTHLY_SERVICE',
    billingPeriod: '2026-07',
    issueDate: '2026-07-01T00:00:00.000Z',
    dueDate: '2026-07-31T00:00:00.000Z',
    subtotal: 1_500_000,
    taxAmount: 150_000,
    total: 1_650_000,
    currency: 'MNT',
    status: 'DRAFT',
    effectiveStatus: 'DRAFT',
    overdueDays: null,
    createdByName: 'Б. Энхтөр',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeInvoiceSummary(
  overrides: Partial<InvoiceSummaryDto> = {},
): InvoiceSummaryDto {
  return {
    draftCount: 1,
    sentCount: 0,
    paidCount: 0,
    overdueCount: 0,
    cancelledCount: 0,
    receivableTotal: 0,
    overdueTotal: 0,
    paidTotal: 0,
    currency: 'MNT',
    ...overrides,
  };
}

/** The invoice list carries its receivables roll-up alongside the page. */
export function makeInvoicePage(
  items: InvoiceListItemDto[],
  summary: Partial<InvoiceSummaryDto> = {},
): PaginatedData<InvoiceListItemDto> & { summary: InvoiceSummaryDto } {
  return { ...makePage(items), summary: makeInvoiceSummary(summary) };
}

// -- Consolidated device conclusions -----------------------------------------

export function makeInspection(
  overrides: Partial<InspectionListItemDto> = {},
): InspectionListItemDto {
  return {
    id: '507f1f77bcf86cd799439211',
    reportId: '507f1f77bcf86cd799439311',
    reportNumber: 'RPT-202607-0001',
    type: 'OBJECT_ASSESSMENT',
    sourceType: 'MANUAL',
    status: 'APPROVED',
    title: 'Тоноглолын үнэлгээ',
    objectId: '507f1f77bcf86cd799439161',
    objectCode: 'DB-2F-01',
    objectName: 'Түгээх самбар 2A',
    objectTypeName: null,
    siblingCount: 1,
    locationPath: 'Main Tower · 2-р давхар',
    customerId: '507f1f77bcf86cd799439011',
    customerName: 'Central Tower ХХК',
    projectId: '507f1f77bcf86cd799439101',
    projectName: 'Урьдчилан сэргийлэх үйлчилгээ',
    buildingId: '507f1f77bcf86cd799439111',
    buildingName: 'Main Tower',
    floorId: '507f1f77bcf86cd799439121',
    floorName: '2-р давхар',
    score: 38,
    riskLevel: 'CRITICAL',
    observation: null,
    conclusion: 'Кабелийн тусгаарлагчид хэт халалт илэрсэн.',
    recommendation: 'Ачааллыг тэнцвэржүүлэх.',
    evidenceCount: 0,
    createdByName: 'Б. Энхтөр',
    approvedByName: 'Б. Энхтөр',
    occurredAt: '2026-07-01T00:00:00.000Z',
    sourceLabel: 'Гараар бүртгэсэн',
    sourceId: null,
    sourceReference: null,
    ...overrides,
  };
}

export function makeInspectionSummary(
  overrides: Partial<InspectionSummaryDto> = {},
): InspectionSummaryDto {
  return {
    totalObjects: 10,
    assessedObjects: 6,
    unassessedObjects: 4,
    counts: [
      { level: 'NORMAL', count: 4 },
      { level: 'CRITICAL', count: 2 },
    ],
    repairRequiredCount: 2,
    revisitRequiredCount: 1,
    ...overrides,
  };
}

// -- Reporting ----------------------------------------------------------------

export function makeReportResult(overrides: Partial<ReportResultDto> = {}): ReportResultDto {
  return {
    key: 'SLA',
    label: 'SLA тайлан',
    description: 'Хугацаанд багтсан, ойртсон, зөрчсөн ажил.',
    generatedAt: '2026-07-29T00:00:00.000Z',
    dateFrom: '2026-07-01T00:00:00.000Z',
    dateTo: '2026-07-31T23:59:59.999Z',
    columns: [
      { key: 'requestNumber', label: 'Хүсэлтийн №', format: 'TEXT' },
      { key: 'slaResult', label: 'SLA үр дүн', format: 'TEXT' },
      { key: 'extendedMinutes', label: 'Сунгасан (мин)', format: 'NUMBER', align: 'right' },
    ],
    // One page holding everything, which is what a fixture wants unless a test is
    // specifically about paging and overrides these.
    page: 1,
    limit: 25,
    total: 2,
    totalPages: 1,
    rows: [
      { requestNumber: 'SR-202607-0001', slaResult: 'Хугацаанд багтсан', extendedMinutes: 0 },
    ],
    totals: null,
    truncatedAt: null,
    ...overrides,
  };
}

export function makeKpiSummary() {
  return {
    dateFrom: '2026-07-01T00:00:00.000Z',
    dateTo: '2026-07-31T23:59:59.999Z',
    currency: 'MNT',
    values: [
      {
        key: 'ON_TIME_COMPLETION_RATE' as const,
        label: 'Хугацаандаа дууссан хувь',
        formula: 'Хугацаандаа дууссан / нийт дууссан × 100',
        purpose: 'Үйлчилгээний чанар',
        unit: 'PERCENT' as const,
        value: null,
        numerator: 0,
        denominator: 0,
      },
    ],
  };
}

// -- Notifications ------------------------------------------------------------

export function makeNotification(overrides: Partial<NotificationDto> = {}): NotificationDto {
  return {
    id: '507f1f77bcf86cd799439221',
    event: 'INVOICE_ISSUED',
    severity: 'INFO',
    title: 'INV-202607-0001 нэхэмжлэл илгээгдлээ',
    body: 'Төлөх дүн 1,650,000 MNT.',
    entityType: 'Invoice',
    entityId: '507f1f77bcf86cd799439201',
    linkPath: '/invoices/507f1f77bcf86cd799439201',
    readAt: null,
    createdAt: '2026-07-29T00:00:00.000Z',
    ...overrides,
  };
}


// -- Dashboard ----------------------------------------------------------------

export function makeTodaySummary(
  overrides: Partial<DashboardTodaySummary> = {},
): DashboardTodaySummary {
  return {
    date: '2026-07-29',
    timezone: 'Asia/Ulaanbaatar',
    dueCount: 2,
    overdueCount: 1,
    urgentCount: 1,
    unassignedCount: 1,
    completedCount: 3,
    items: [
      {
        id: '507f1f77bcf86cd799439301',
        kind: 'SERVICE_REQUEST',
        reference: 'SR-202607-0001',
        title: 'Гэрэл асахгүй байна.',
        customerName: 'Central Tower ХХК',
        locationLabel: 'Төв байр',
        assigneeNames: ['Дорж Бат'],
        status: 'ASSIGNED',
        statusLabel: 'Хуваарилагдсан',
        dueAt: '2026-07-29T02:00:00.000Z',
        isUrgent: false,
        isOverdue: true,
        linkPath: '/service-requests/507f1f77bcf86cd799439301',
      },
      {
        id: '507f1f77bcf86cd799439302',
        kind: 'PLANNED_WORK',
        reference: 'PW-202607-0001',
        title: 'Самбарын улирлын үзлэг',
        customerName: 'Central Tower ХХК',
        locationLabel: 'Төв байр',
        assigneeNames: [],
        status: 'STARTED',
        statusLabel: 'Эхэлсэн',
        dueAt: '2026-07-29T09:00:00.000Z',
        isUrgent: false,
        isOverdue: false,
        linkPath: '/planned-work/507f1f77bcf86cd799439302',
      },
    ],
    ...overrides,
  };
}

export function makeDashboardSummary(
  overrides: Partial<DashboardSummaryDto> = {},
): DashboardSummaryDto {
  return {
    generatedAt: '2026-07-29T06:00:00.000Z',
    requests: {
      newRequests: 2,
      unassignedRequests: 1,
      urgentRequests: 1,
      slaNearBreach: 2,
      slaBreached: 1,
      inProgress: 3,
      dueToday: 2,
      completedToday: 3,
    },
    requestsByStatus: [
      { key: 'NEW', label: 'Шинэ', count: 2 },
      { key: 'ASSIGNED', label: 'Хуваарилагдсан', count: 4 },
    ],
    requestsByType: [{ key: 'REPAIR', label: 'Засвар үйлчилгээ', count: 3 }],
    trend: Array.from({ length: 14 }, (_, index) => ({
      date: `2026-07-${String(index + 16).padStart(2, '0')}`,
      created: index % 3,
      completed: index % 2,
    })),
    risk: {
      byLevel: [
        { level: 'NORMAL', count: 6 },
        { level: 'CRITICAL', count: 2 },
      ],
      totalAssessedObjects: 8,
      unassessedObjects: 5,
    },
    plannedWork: { total: 4, inProgress: 2, overdue: 1, completed: 1, averageProgress: 45 },
    finance: {
      monthRevenue: 2_350_000,
      receivableTotal: 1_500_000,
      overdueTotal: 1_500_000,
      byStatus: [
        { key: 'DRAFT', label: 'Ноорог', count: 1 },
        { key: 'OVERDUE', label: 'Хугацаа хэтэрсэн', count: 1 },
      ],
      currency: 'MNT',
    },
    today: makeTodaySummary(),
    ...overrides,
  };
}
