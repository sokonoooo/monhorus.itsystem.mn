import fs from 'node:fs';

import { PERMISSIONS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  createCallableObjectType,
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { Employee } from '../employee/employee.model';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Customer } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { ServiceRequest } from '../service-request/service-request.model';
import { WorkReport } from '../service-request/work-report.model';
import { User } from '../user/user.model';
import {
  ensureUploadDirectory,
  generateStorageKey,
  resolveStoredFilePath,
} from './storage.service';
import { StoredFile, type StoredFileOwnerType } from './stored-file.model';

/**
 * The authenticated download, GET /files/:fileId.
 *
 * The route is keyed on a file id alone, so it is the one place where a permission on
 * its own would be a master key: guess 24 hex characters and read the file. It answers
 * two questions separately and both have to hold — the permission says whether the
 * caller may look at this KIND of file, the customer scope says whose files those may be.
 *
 * The portal half exists because a customer's floor detail screen renders the plan image
 * through this route. Before it, every floor of every building 403'd for every customer,
 * which is what "customers cannot access information about their own buildings" turned
 * out to mean.
 */

const API = '/api/v1';

/** Staff who may see the whole object graph and manage plans, i.e. today's behaviour. */
const OBJECT_STAFF = [PERMISSIONS.OBJECT_VIEW, PERMISSIONS.OBJECT_MANAGE] as const;

/** Exactly what the CUSTOMER system role holds. No staff key appears. */
const PORTAL = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
  PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
  PERMISSIONS.PORTAL_SERVICE_REQUEST_CREATE,
] as const;

let app: Express;
let token: string;
let callableTypeId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

/**
 * Monotonic counter for generated role keys. `resetDomainCollections` preserves the roles
 * collection, so a key derived only from the email would collide across tests.
 */
let portalRoleSequence = 0;

/**
 * Signs in a `customer` account linked to one organisation.
 *
 * `permissions` is a parameter so a test can hand a customer a STAFF key and prove the
 * scope still refuses them: the permission answers "may you look at this module", never
 * "at whose records".
 */
async function loginAsCustomer(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[] = PORTAL,
): Promise<string> {
  portalRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_FILE_PORTAL_ROLE_${portalRoleSequence}`,
    name: `Portal role ${email}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });

  const password = 'PortalPassword2026x';
  await User.create({
    fullName: `Portal ${email}`,
    email,
    password: await hashPassword(password),
    role: 'customer',
    roles: [role._id],
    status: 'active',
    customer: linkedCustomerId ? new Types.ObjectId(linkedCustomerId) : null,
    passwordChangedAt: new Date(),
  });

  return login(email, password);
}

/**
 * Writes a real file to the upload directory and returns its StoredFile id.
 *
 * Used for the owner kinds whose upload path is a whole workflow (an assessment must be
 * recorded to claim its evidence; a request must be created to claim its attachment).
 * The bytes are real so a 200 means the stream actually served something, rather than
 * the route falling through to "missing on disk".
 */
async function plantFile(
  ownerType: StoredFileOwnerType,
  ownerId: Types.ObjectId,
): Promise<string> {
  ensureUploadDirectory();
  const storageKey = generateStorageKey();
  fs.writeFileSync(resolveStoredFilePath(storageKey), 'file-bytes');

  const stored = await StoredFile.create({
    storageKey,
    originalName: 'evidence.png',
    mimeType: 'image/png',
    sizeBytes: 'file-bytes'.length,
    ownerType,
    ownerId,
    uploadedBy: null,
    uploadedByName: 'Тест',
  });

  return String(stored._id);
}

interface Tenant {
  customerId: string;
  buildingId: string;
  floorId: string;
  /** The stored file behind the floor's plan image. */
  planFileId: string;
  /** An assessment photo claimed by a piece of this tenant's equipment. */
  objectPhotoFileId: string;
  /** An attachment claimed by one of this tenant's service requests. */
  requestAttachmentFileId: string;
  /**
   * Before/after evidence on an APPROVED conclusion — the photos the customer read hands
   * out download urls for. Parked on a USER id, never on the request, because that is
   * exactly what production holds: `POST /files/work-report-photos` owns the file to the
   * uploading technician and `saveWorkReport` only stores the id in the conclusion.
   */
  approvedReportPhotoFileId: string;
  /** The same shape on a DRAFT conclusion, which no customer may read. */
  draftReportPhotoFileId: string;
}

/** One organisation with a floor plan, an object photo and a request attachment. */
async function seedTenant(code: string): Promise<Tenant> {
  const customer = await Customer.create({ code, name: `${code} ХХК` });
  const customerId = String(customer._id);

  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId, code: `${code}-PRJ`, name: `${code} төсөл` });
  expect(project.status).toBe(201);

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, code: `${code}-BLD`, name: `${code} барилга` });
  expect(building.status).toBe(201);

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      buildingId: building.body.data.id,
      code: `${code}-FL`,
      name: `${code} 1 давхар`,
      floorNumber: 1,
    });
  expect(floor.status).toBe(201);
  const floorId = floor.body.data.id as string;

  // The plan goes through the real upload route, so the file on disk and the FLOOR_PLAN
  // owner link are exactly what production writes.
  const plan = await request(app)
    .put(`${API}/floors/${floorId}/plan`)
    .set('Authorization', `Bearer ${token}`)
    .field('title', `${code} төлөвлөгөө`)
    .attach('file', Buffer.from('plan-image-bytes'), {
      filename: 'plan.png',
      contentType: 'image/png',
    });
  expect(plan.status).toBe(200);

  const objectType = await ObjectType.findOne({ category: 'PANEL' }).select('_id');
  const type =
    objectType ??
    (await ObjectType.create({
      code: `${code}-TYPE`,
      name: 'Дэд самбар',
      category: 'PANEL',
      icon: 'PANEL',
    }));

  const object = await ObjectRecord.create({
    code: `${code}-LDB-1`,
    name: `${code} самбар`,
    category: 'PANEL',
    objectType: type._id,
    customer: customer._id,
    floor: new Types.ObjectId(floorId),
    status: 'ACTIVE',
  });

  const seedRequest = async (suffix: string) =>
    ServiceRequest.create({
      requestNumber: `SR-${code}-${suffix}`,
      customer: customer._id,
      building: new Types.ObjectId(building.body.data.id as string),
      floor: new Types.ObjectId(floorId),
      requestType: 'URGENT_CALL',
      description: 'Таслуур халж байна.',
      contactName: 'Тест',
      contactPhone: '99112233',
      slaStartedAt: new Date(),
      slaDueAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });

  const serviceRequest = await seedRequest('0001');
  const approvedRequest = await seedRequest('0002');
  const draftRequest = await seedRequest('0003');

  // Parked on a user id, matching what `POST /files/work-report-photos` writes: the
  // conclusion references the file and nothing ever re-owns it onto the request.
  const uploaderId = new Types.ObjectId();
  const approvedPhotoId = await plantFile('SERVICE_REQUEST', uploaderId);
  const draftPhotoId = await plantFile('SERVICE_REQUEST', uploaderId);

  await WorkReport.create({
    serviceRequest: approvedRequest._id,
    status: 'APPROVED',
    beforePhotos: [new Types.ObjectId(approvedPhotoId)],
    approvedAt: new Date(),
  });
  await WorkReport.create({
    serviceRequest: draftRequest._id,
    status: 'DRAFT',
    afterPhotos: [new Types.ObjectId(draftPhotoId)],
  });

  return {
    customerId,
    buildingId: building.body.data.id as string,
    floorId,
    planFileId: plan.body.data.fileId as string,
    objectPhotoFileId: await plantFile('OBJECT', object._id),
    requestAttachmentFileId: await plantFile('SERVICE_REQUEST', serviceRequest._id),
    approvedReportPhotoFileId: approvedPhotoId,
    draftReportPhotoFileId: draftPhotoId,
  };
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

let tenantA: Tenant;
let tenantB: Tenant;
let customerToken: string;

beforeEach(async () => {
  await resetDomainCollections();
  // After the reset: object types are domain data and are wiped with everything else.
  callableTypeId = await createCallableObjectType();
  const staff = await createUserWithPermissions('files-staff@test.mn', OBJECT_STAFF);
  token = await login(staff.email, staff.password);

  tenantA = await seedTenant('TA');
  tenantB = await seedTenant('TB');
  customerToken = await loginAsCustomer('files-a@test.mn', tenantA.customerId);
});

const download = (fileId: string, bearer: string): request.Test =>
  request(app).get(`${API}/files/${fileId}`).set('Authorization', `Bearer ${bearer}`);

describe('GET /files/:fileId for a customer', () => {
  /**
   * The bug this suite was written for. The floor detail screen renders the plan through
   * this route, so before the portal keys were accepted here every floor of every
   * building showed a broken image to the customer who owns it.
   */
  it('serves the floor plan of the calling customer own floor', async () => {
    const response = await download(tenantA.planFileId, customerToken);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    // Private files must never be cached by an intermediary.
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  /**
   * The security-critical half. The route is keyed on the file id alone, so accepting a
   * portal key without resolving the file back to its organisation would hand every
   * customer every other tenant's floor plan for the cost of guessing 24 hex characters.
   *
   * Not-found rather than forbidden, matching every other customer-scoped read: a
   * forbidden reply would confirm the id is real.
   */
  it('reports another organisation floor plan as not found', async () => {
    const response = await download(tenantB.planFileId, customerToken);

    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  it('serves an object photo of the calling customer own equipment, and no other', async () => {
    const own = await download(tenantA.objectPhotoFileId, customerToken);
    expect(own.status).toBe(200);

    const foreign = await download(tenantB.objectPhotoFileId, customerToken);
    expect(foreign.status).toBe(404);
  });

  it('serves a request attachment of the calling customer own request, and no other', async () => {
    const own = await download(tenantA.requestAttachmentFileId, customerToken);
    expect(own.status).toBe(200);

    const foreign = await download(tenantB.requestAttachmentFileId, customerToken);
    expect(foreign.status).toBe(404);
  });

  /**
   * Conclusion evidence, which is the case the SERVICE_REQUEST branch could not resolve.
   *
   * A conclusion photo is parked on the uploading technician's USER id and never re-owned
   * onto the request, so `ServiceRequest.findById(ownerId)` matched nothing and every
   * before/after image on the customer's conclusion screen 404'd — the endpoint handed
   * out download urls that could not be followed.
   */
  it('serves the before/after evidence on the calling customer own approved conclusion', async () => {
    const response = await download(tenantA.approvedReportPhotoFileId, customerToken);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
  });

  /**
   * The security half. The widened lookup resolves the file through the conclusion, so it
   * must resolve to that conclusion's OWN organisation and no other — otherwise it would
   * have handed every customer every tenant's evidence for the cost of a guessed id.
   */
  it('reports another organisation conclusion evidence as not found', async () => {
    const response = await download(tenantB.approvedReportPhotoFileId, customerToken);

    expect(response.status).toBe(404);
    expect(response.body.data).toBeNull();
  });

  /**
   * The widening stops exactly where `GET /:id/report/customer` does. A customer who could
   * fetch a draft conclusion's photographs would be reading a verdict nobody has signed
   * off, one file at a time, while the endpoint that serves it still answered 404.
   */
  it('refuses evidence attached to a conclusion that is not approved', async () => {
    const response = await download(tenantA.draftReportPhotoFileId, customerToken);

    expect(response.status).toBe(404);
  });

  /** Staff are unaffected by the approval rule: a technician still reads their own draft. */
  it('still serves an unapproved conclusion evidence to staff', async () => {
    const staff = await createUserWithPermissions('files-sr-staff@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_VIEW,
    ]);
    const staffToken = await login(staff.email, staff.password);

    const response = await download(tenantA.draftReportPhotoFileId, staffToken);

    expect(response.status).toBe(200);
  });

  /**
   * The pre-existing rule the widening had to preserve: an upload still sitting on its
   * uploader, claimed by nothing, resolves to no organisation and stays unreadable.
   */
  it('still refuses an upload no request and no conclusion has claimed', async () => {
    const parked = await plantFile('SERVICE_REQUEST', new Types.ObjectId());

    const response = await download(parked, customerToken);

    expect(response.status).toBe(404);
  });

  /**
   * EMPLOYEE-owned files carry no portal key at all: an HR document is not customer
   * facing, so the refusal happens at the guard and never reaches a scope question.
   */
  it('refuses an employee-owned file outright', async () => {
    const employee = await Employee.create({
      employeeCode: 'EMP-001',
      firstName: 'Энхтөр',
      lastName: 'Батбаяр',
    });
    const fileId = await plantFile('EMPLOYEE', employee._id);

    const response = await download(fileId, customerToken);
    expect(response.status).toBe(403);
  });

  /**
   * The scope, not the guard, is what stops the cross-tenant read. Proven by handing a
   * customer account the STAFF key it must never hold in production: the permission alone
   * gets it past the guard and no further.
   */
  it('refuses a cross-tenant file even when the account holds the staff permission', async () => {
    const overPrivileged = await loginAsCustomer('files-over@test.mn', tenantA.customerId, [
      PERMISSIONS.OBJECT_VIEW,
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);

    const foreign = await download(tenantB.planFileId, overPrivileged);
    expect(foreign.status).toBe(404);

    const own = await download(tenantA.planFileId, overPrivileged);
    expect(own.status).toBe(200);
  });

  /**
   * A customer account linked to no organisation cannot be scoped, so it is refused
   * rather than defaulted — "no filter" would expose every tenant.
   */
  it('refuses a customer account that is linked to no organisation', async () => {
    const orphan = await loginAsCustomer('files-orphan@test.mn', null);

    const response = await download(tenantA.planFileId, orphan);
    expect(response.status).toBe(403);
    expect(response.body.message).toContain('харилцагч байгууллагад холбогдоогүй');
  });

  it('refuses a customer holding no portal key for the owner kind', async () => {
    const noFloorKey = await loginAsCustomer('files-nokey@test.mn', tenantA.customerId, [
      PERMISSIONS.PORTAL_PROJECT_VIEW,
    ]);

    const response = await download(tenantA.planFileId, noFloorKey);
    expect(response.status).toBe(403);
  });
});

describe('GET /files/:fileId for staff', () => {
  it('keeps cross-tenant access for a staff caller holding the staff permission', async () => {
    const first = await download(tenantA.planFileId, token);
    expect(first.status).toBe(200);

    const second = await download(tenantB.planFileId, token);
    expect(second.status).toBe(200);
  });

  it('still refuses a staff caller holding neither the staff nor the portal key', async () => {
    const outsider = await createUserWithPermissions('files-out@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await download(tenantA.planFileId, outsiderToken);
    expect(response.status).toBe(403);
  });

  it('answers not found for a file id that does not exist', async () => {
    const response = await download('000000000000000000000000', token);
    expect(response.status).toBe(404);
  });
});

/**
 * POST /files/service-request-attachments.
 *
 * The other half of the same bug the download tests were written for. A customer could
 * create a request but not photograph what it was about: the create route accepts
 * `portal.service_request.create` and this one demanded the STAFF `service_request.create`,
 * so the mobile create form shipped with no photo field at all rather than one that 403'd.
 *
 * Opening it must not open anything else, and the two questions stay separate here as
 * they do on the download. The permission says a customer may attach files. Nothing in
 * the request says whose file it is — `ownerId` and `uploadedBy` come from the session —
 * so the "at whose records" question is asked where the answer exists: when a request
 * claims the file.
 */
describe('POST /files/service-request-attachments', () => {
  const uploadAttachment = (bearer: string): request.Test =>
    request(app)
      .post(`${API}/files/service-request-attachments`)
      .set('Authorization', `Bearer ${bearer}`)
      .attach('file', Buffer.from('photo-bytes'), {
        filename: 'gemtel.png',
        contentType: 'image/png',
      });

  /** A minimal valid body for the tenant A building, with whatever attachments given. */
  const createRequestBody = (attachmentIds: string[]): Record<string, unknown> => ({
    customerId: tenantA.customerId,
    buildingId: tenantA.buildingId,
    requestType: 'STANDARD_CALL',
    objectTypeId: callableTypeId,
    isUrgent: false,
    description: 'Коридорын гэрэл анивчиж байна.',
    contactName: 'Д. Оюунчимэг',
    contactPhone: '99112233',
    attachmentIds,
  });

  it('accepts a customer holding only the portal create key', async () => {
    const response = await uploadAttachment(customerToken);

    expect(response.status).toBe(201);
    expect(response.body.data.id).toMatch(/^[a-f\d]{24}$/i);
    expect(response.body.data.downloadUrl).toBe(
      `/api/v1/files/${response.body.data.id as string}`,
    );
  });

  it('refuses a customer holding the portal view key but not the create key', async () => {
    const readOnly = await loginAsCustomer('files-readonly@test.mn', tenantA.customerId, [
      PERMISSIONS.PORTAL_SERVICE_REQUEST_VIEW,
    ]);

    const response = await uploadAttachment(readOnly);
    expect(response.status).toBe(403);
  });

  it('keeps the staff upload working unchanged', async () => {
    const staff = await createUserWithPermissions('files-sr-staff@test.mn', [
      PERMISSIONS.SERVICE_REQUEST_CREATE,
    ]);
    const staffToken = await login(staff.email, staff.password);

    const response = await uploadAttachment(staffToken);
    expect(response.status).toBe(201);
  });

  /**
   * The upload parks the file on the uploader, so it is owned by a user id rather than a
   * request and resolves to no organisation. A customer therefore cannot read even their
   * OWN attachment until the request that claims it exists — which is the safe direction
   * to fail in, and the reason the parked window opens nothing.
   */
  it('parks the file on the uploader, unreadable until a request claims it', async () => {
    const uploaded = await uploadAttachment(customerToken);
    const fileId = uploaded.body.data.id as string;

    const beforeClaim = await download(fileId, customerToken);
    expect(beforeClaim.status).toBe(404);

    const stored = await StoredFile.findById(fileId).select('ownerType ownerId uploadedBy');
    expect(stored?.ownerType).toBe('SERVICE_REQUEST');
    // Owned by the uploading account, never by anything named in the request.
    expect(String(stored?.ownerId)).toBe(String(stored?.uploadedBy));
  });

  it('serves the attachment to its own customer once their request claims it', async () => {
    const uploaded = await uploadAttachment(customerToken);
    const fileId = uploaded.body.data.id as string;

    const createdRequest = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(createRequestBody([fileId]));
    expect(createdRequest.status).toBe(201);
    expect(createdRequest.body.data.attachments).toHaveLength(1);

    const afterClaim = await download(fileId, customerToken);
    expect(afterClaim.status).toBe(200);

    // And no further: the claim moved it into tenant A, so tenant B is refused.
    const otherTenant = await loginAsCustomer('files-b@test.mn', tenantB.customerId);
    expect((await download(fileId, otherTenant)).status).toBe(404);
  });

  /**
   * The attack the upload permission would otherwise enable. `attachmentIds` is a list of
   * ids the CLIENT chooses, so it is an assertion to verify, not a fact. Naming another
   * tenant's claimed attachment must not put its filename, size and uploader on a request
   * the caller owns — the metadata half of the leak the download route closes for bytes.
   */
  it('refuses to attach another organisation file to a customer own request', async () => {
    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(createRequestBody([tenantB.requestAttachmentFileId]));

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Хавсралт файл олдсонгүй.');

    // Nothing was written, so the foreign file still belongs to tenant B.
    const stolen = await StoredFile.findById(tenantB.requestAttachmentFileId).select('ownerId');
    expect(String(stolen?.ownerId)).not.toBe(String(tenantB.customerId));
    expect((await download(tenantB.requestAttachmentFileId, customerToken)).status).toBe(404);
  });

  /**
   * Same refusal for a file another CUSTOMER parked but has not yet claimed, which is the
   * window an id guessed from a neighbouring upload would land in.
   */
  it('refuses to attach a file another account uploaded', async () => {
    const otherTenant = await loginAsCustomer('files-b-upload@test.mn', tenantB.customerId);
    const theirs = await uploadAttachment(otherTenant);
    expect(theirs.status).toBe(201);

    const response = await request(app)
      .post(`${API}/service-requests`)
      .set('Authorization', `Bearer ${customerToken}`)
      .send(createRequestBody([theirs.body.data.id as string]));

    expect(response.status).toBe(400);
    expect(response.body.issues?.[0]?.field).toBe('attachmentIds');
  });
});
