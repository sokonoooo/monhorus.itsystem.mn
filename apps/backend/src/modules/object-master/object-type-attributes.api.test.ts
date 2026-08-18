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
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { AuditLog } from '../audit/audit-log.model';
import { Customer } from '../objects/object.models';
import { Role } from '../rbac/role.model';
import { User } from '../user/user.model';
import { ObjectRecord, ObjectType } from './object-master.models';

/**
 * Per-type attributes, end to end (requirements 4.1).
 *
 * Its own suite rather than more of the 2,500-line main one, matching how this module is
 * already split into registry, icons, quick-place and load.
 *
 * What is being pinned down here is a POLICY, not a mechanism, and there are four parts to it
 * that are easy to break without noticing:
 *
 *   1. Requirements are enforced when an object is WRITTEN, never when one is read. Every
 *      object registered before an attribute existed stays readable and is not retrospectively
 *      invalid — which is the entire reason this feature needed no migration.
 *   2. The Үнэлгээ бүртгэх form asks them, and the answers land on the OBJECT rather than on
 *      the assessment: they are facts about the equipment, true between visits.
 *   3. Removing an attribute from a type does NOT erase the values recorded against it.
 *   4. The definitions are global (a type has no `customer`), but the values are not: they
 *      sit on the object and are behind the same tenant scope as everything else on it.
 */

const API = '/api/v1';

const FULL = [
  PERMISSIONS.OBJECT_VIEW,
  PERMISSIONS.OBJECT_MANAGE,
  PERMISSIONS.OBJECT_MASTER_VIEW,
  PERMISSIONS.OBJECT_MASTER_MANAGE,
  // The report form is where the type's attributes are answered, so this suite records
  // assessments as well as objects.
  PERMISSIONS.OBJECT_MASTER_ASSESS,
  PERMISSIONS.OBJECT_TYPE_MANAGE,
] as const;

const PORTAL = [
  PERMISSIONS.PORTAL_PROJECT_VIEW,
  PERMISSIONS.PORTAL_BUILDING_VIEW,
  PERMISSIONS.PORTAL_FLOOR_VIEW,
  PERMISSIONS.PORTAL_OBJECT_VIEW,
] as const;

/** The worked example from the brief: a breaker that is fused or not, with or without a separator. */
const FUSE = {
  key: 'fuse',
  label: 'Хайлмал хамгаалалт',
  type: 'SELECT',
  required: true,
  options: [
    { value: 'FUSED', label: 'Хайлмалтай' },
    { value: 'NOT_FUSED', label: 'Хайлмалгүй' },
  ],
};

const SEPARATOR = {
  key: 'separator',
  label: 'Тусгаарлагч',
  type: 'SELECT',
  required: true,
  options: [
    { value: 'WITH', label: 'Тусгаарлагчтай' },
    { value: 'WITHOUT', label: 'Тусгаарлагчгүй' },
  ],
};

let app: Express;
let token: string;
let customerId: string;
let floorId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

let portalRoleSequence = 0;

/** A `customer` account linked to one organisation, for the isolation check at the end. */
async function loginAsCustomer(
  email: string,
  linkedCustomerId: string | null,
  permissions: readonly PermissionKey[] = PORTAL,
): Promise<string> {
  portalRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_ATTR_PORTAL_ROLE_${portalRoleSequence}`,
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

async function createType(overrides: Record<string, unknown> = {}): Promise<request.Response> {
  return request(app)
    .post(`${API}/object-types`)
    .set('Authorization', `Bearer ${token}`)
    .send({ code: 'MCB', name: 'Автомат таслуур', category: 'EQUIPMENT', ...overrides });
}

/** A type carrying the two example attributes, which is the fixture most tests start from. */
async function createBreakerType(): Promise<string> {
  const response = await createType({ attributes: [FUSE, SEPARATOR] });
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

async function patchType(
  typeId: string,
  body: Record<string, unknown>,
): Promise<request.Response> {
  return request(app)
    .patch(`${API}/object-types/${typeId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function createObject(body: Record<string, unknown>): Promise<request.Response> {
  return request(app)
    .post(`${API}/objects-master`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      customerId,
      code: 'MCB-01',
      name: 'Автомат таслуур 1',
      category: 'EQUIPMENT',
      floorId,
      equipment: {},
      ...body,
    });
}

async function getObject(objectId: string, authToken: string = token): Promise<request.Response> {
  return request(app)
    .get(`${API}/objects-master/${objectId}`)
    .set('Authorization', `Bearer ${authToken}`);
}

/** The `field` keys of a 400, which is the contract every form's error map depends on. */
function issueFields(response: request.Response): string[] {
  return ((response.body.issues ?? []) as { field: string }[]).map((issue) => issue.field);
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });
  customerId = String(customer._id);

  const user = await createUserWithPermissions('attr@test.mn', FULL);
  token = await login(user.email, user.password);

  const project = await request(app)
    .post(`${API}/projects`)
    .set('Authorization', `Bearer ${token}`)
    .send({ customerId, code: 'PRJ-1', name: 'Төсөл' });

  const building = await request(app)
    .post(`${API}/buildings`)
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.body.data.id, code: 'BLD-1', name: 'Барилга' });

  const floor = await request(app)
    .post(`${API}/floors`)
    .set('Authorization', `Bearer ${token}`)
    .send({ buildingId: building.body.data.id, code: 'FL-1', name: '1 давхар', floorNumber: 1 });
  floorId = floor.body.data.id;
});

describe('section 4.1 per-type attribute definitions', () => {
  it('registers a type with attributes and returns them in the order given', async () => {
    const response = await createType({ attributes: [FUSE, SEPARATOR] });

    expect(response.status).toBe(201);
    expect(response.body.data.attributes).toHaveLength(2);
    expect(response.body.data.attributes[0]).toMatchObject({
      key: 'fuse',
      label: 'Хайлмал хамгаалалт',
      type: 'SELECT',
      required: true,
    });
    expect(response.body.data.attributes[0].options).toEqual([
      { value: 'FUSED', label: 'Хайлмалтай' },
      { value: 'NOT_FUSED', label: 'Хайлмалгүй' },
    ]);
  });

  it('defaults to no attributes, so a type registered as before behaves as before', async () => {
    const response = await createType();

    expect(response.status).toBe(201);
    expect(response.body.data.attributes).toEqual([]);
  });

  it('reorders by sending the array rearranged, and the new order sticks', async () => {
    // There is no `sortOrder` and no reorder endpoint: the array order IS the order, which is
    // what this asserts survives a round trip.
    const typeId = await createBreakerType();

    const patched = await patchType(typeId, { attributes: [SEPARATOR, FUSE] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.attributes.map((a: { key: string }) => a.key)).toEqual([
      'separator',
      'fuse',
    ]);

    const reread = await request(app)
      .get(`${API}/object-types/${typeId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reread.body.data.attributes.map((a: { key: string }) => a.key)).toEqual([
      'separator',
      'fuse',
    ]);
  });

  it('leaves the attributes alone when a PATCH does not mention them', async () => {
    const typeId = await createBreakerType();

    const patched = await patchType(typeId, { name: 'Автомат таслуур (шинэ)' });

    expect(patched.status).toBe(200);
    expect(patched.body.data.attributes).toHaveLength(2);
  });

  it('refuses two attributes sharing a key', async () => {
    // The key is the join between a definition and every value stored against it, so a
    // duplicate makes the stored value ambiguous rather than merely repeated.
    const response = await createType({ attributes: [FUSE, { ...FUSE, label: 'Өөр нэр' }] });

    expect(response.status).toBe(400);
  });

  it('refuses a SELECT with no options', async () => {
    const response = await createType({ attributes: [{ ...FUSE, options: [] }] });

    expect(response.status).toBe(400);
  });

  it('refuses options on an attribute that is not a SELECT', async () => {
    const response = await createType({ attributes: [{ ...FUSE, type: 'TEXT' }] });

    expect(response.status).toBe(400);
  });

  it('refuses a key that would not be a safe storage path', async () => {
    const response = await createType({ attributes: [{ ...FUSE, key: 'fuse.type' }] });

    expect(response.status).toBe(400);
  });

  it('records the attribute keys on the audit trail when they change', async () => {
    // The audit log is append-only and is therefore the only record that an attribute was
    // ever removed — the definitions themselves are simply gone afterwards.
    const typeId = await createBreakerType();

    await patchType(typeId, { attributes: [FUSE] });

    const entry = await AuditLog.findOne({ entityType: 'ObjectType', action: 'Updated' });

    expect(entry?.oldValue).toMatchObject({ attributeKeys: ['fuse', 'separator'] });
    expect(entry?.newValue).toMatchObject({ attributeKeys: ['fuse'] });
  });
});

describe('section 4.1 attribute values on an object', () => {
  it('stores the chosen values and returns them with their definitions', async () => {
    const objectTypeId = await createBreakerType();

    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.attributeValues).toEqual({ fuse: 'FUSED', separator: 'WITH' });
    // The definitions ride along on the detail response so the report form can ask the right
    // questions without a second call to the type registry.
    expect(created.body.data.objectType.attributes.map((a: { key: string }) => a.key)).toEqual([
      'fuse',
      'separator',
    ]);
  });

  it('refuses an object that leaves a required attribute empty', async () => {
    const objectTypeId = await createBreakerType();

    const created = await createObject({ objectTypeId, attributeValues: { fuse: 'FUSED' } });

    expect(created.status).toBe(400);
    // The dotted key is what puts the message under the right input on the form.
    expect(issueFields(created)).toEqual(['attributeValues.separator']);
  });

  it('refuses a SELECT value that is not one of its options', async () => {
    const objectTypeId = await createBreakerType();

    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'MELTED', separator: 'WITH' },
    });

    expect(created.status).toBe(400);
    expect(issueFields(created)).toEqual(['attributeValues.fuse']);
  });

  it('refuses a key the type does not declare rather than dropping it', async () => {
    const objectTypeId = await createBreakerType();

    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH', colour: 'RED' },
    });

    expect(created.status).toBe(400);
    expect(issueFields(created)).toEqual(['attributeValues.colour']);
  });

  it('accepts a typed value for each declared kind', async () => {
    const response = await createType({
      attributes: [
        { key: 'serial', label: 'Сериал', type: 'TEXT', required: false, options: [] },
        { key: 'poles', label: 'Туйл', type: 'NUMBER', required: false, options: [] },
        { key: 'sealed', label: 'Лацдсан', type: 'BOOLEAN', required: true, options: [] },
      ],
    });
    expect(response.status).toBe(201);

    const created = await createObject({
      objectTypeId: response.body.data.id,
      // `false` for a required boolean is a complete answer, not an absence.
      attributeValues: { serial: 'AB-1200', poles: 3, sealed: false },
    });

    expect(created.status).toBe(201);
    expect(created.body.data.attributeValues).toEqual({
      serial: 'AB-1200',
      poles: 3,
      sealed: false,
    });
  });

  it('enforces the requirement again when the object is edited', async () => {
    const objectTypeId = await createBreakerType();
    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });

    const patched = await request(app)
      .patch(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attributeValues: { fuse: 'FUSED' } });

    expect(patched.status).toBe(400);
    expect(issueFields(patched)).toEqual(['attributeValues.separator']);
  });

  it('does not demand attributes on an edit that does not touch them', async () => {
    /**
     * THE ENFORCE-ON-WRITE-ONLY GUARANTEE, and the reason this feature needed no migration.
     *
     * The object is written straight to the collection with no values — which is exactly the
     * shape of every one of the objects already in production — and then renamed. A rename is
     * not an answer to "is this breaker fused", so it is not the moment to demand one.
     */
    const objectTypeId = await createBreakerType();
    const legacy = await ObjectRecord.create({
      code: 'MCB-OLD',
      name: 'Хуучин таслуур',
      category: 'EQUIPMENT',
      objectType: new Types.ObjectId(objectTypeId),
      customer: new Types.ObjectId(customerId),
      status: 'ACTIVE',
    });

    const read = await getObject(String(legacy._id));
    expect(read.status).toBe(200);
    expect(read.body.data.attributeValues).toEqual({});

    const renamed = await request(app)
      .patch(`${API}/objects-master/${String(legacy._id)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Шинэ нэр' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Шинэ нэр');
  });

  it('clears a declared attribute that is left out of an update', async () => {
    // A declared key is fully controlled by the payload, or a value entered by mistake could
    // never be removed.
    const response = await createType({
      attributes: [{ key: 'serial', label: 'Сериал', type: 'TEXT', required: false, options: [] }],
    });
    const created = await createObject({
      objectTypeId: response.body.data.id,
      attributeValues: { serial: 'AB-1200' },
    });
    expect(created.status).toBe(201);

    const patched = await request(app)
      .patch(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attributeValues: {} });

    expect(patched.status).toBe(200);
    expect(patched.body.data.attributeValues).toEqual({});
  });

  it('keeps a stored value when its definition is removed, and shows it again when re-added', async () => {
    /**
     * THE PRESERVATION GUARANTEE.
     *
     * Somebody stood in front of the equipment and recorded that value. An administrator
     * tidying the type, and an unrelated later edit of the object, must not be what destroys
     * it — so it stays on disk, out of sight, and comes back if the definition does.
     */
    const objectTypeId = await createBreakerType();
    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    const objectId = created.body.data.id as string;

    await patchType(objectTypeId, { attributes: [FUSE] });

    // Out of sight: the detail response no longer describes it...
    const afterRemoval = await getObject(objectId);
    expect(afterRemoval.body.data.objectType.attributes.map((a: { key: string }) => a.key)).toEqual([
      'fuse',
    ]);

    // ...and an unrelated edit does not take it with it.
    const edited = await request(app)
      .patch(`${API}/objects-master/${objectId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attributeValues: { fuse: 'NOT_FUSED' } });
    expect(edited.status).toBe(200);

    await patchType(objectTypeId, { attributes: [FUSE, SEPARATOR] });

    const restored = await getObject(objectId);
    expect(restored.body.data.attributeValues).toEqual({
      fuse: 'NOT_FUSED',
      separator: 'WITH',
    });
  });

  it("applies the new type's attributes when the object is moved to another type", async () => {
    const plainType = await createType({ code: 'LAMP', name: 'Гэрэл' });
    const breakerType = await createBreakerType();

    const created = await createObject({ objectTypeId: plainType.body.data.id });
    expect(created.status).toBe(201);

    const moved = await request(app)
      .patch(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectTypeId: breakerType });

    // Claiming the object is a breaker is claiming it has the facts a breaker has.
    expect(moved.status).toBe(400);
    expect(issueFields(moved).sort()).toEqual([
      'attributeValues.fuse',
      'attributeValues.separator',
    ]);
  });

  it('moves an object to a type that asks for nothing, keeping the old answers on disk', async () => {
    /**
     * A type change judged against values the object already carries must not trip over the
     * ones the NEW type has never heard of.
     *
     * An undeclared key in a PAYLOAD is a stale client and is refused. The same key sitting in
     * STORAGE is the preservation guarantee working as intended, and feeding it back into the
     * check would refuse the move with a message about an attribute the user never mentioned.
     */
    const breakerType = await createBreakerType();
    const plainType = (await createType({ code: 'LAMP', name: 'Гэрэл' })).body.data.id as string;

    const created = await createObject({
      objectTypeId: breakerType,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    expect(created.status).toBe(201);

    const moved = await request(app)
      .patch(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectTypeId: plainType });

    expect(moved.status).toBe(200);
    // Nothing is asked for now, and nothing was thrown away either.
    expect(moved.body.data.objectType.attributes).toEqual([]);
    expect(moved.body.data.attributeValues).toEqual({ fuse: 'FUSED', separator: 'WITH' });
  });

  it('lets a type deactivated after registration still be edited', async () => {
    // Deactivating a type retires it from the picker; it does not freeze the estate already
    // using it.
    const objectTypeId = await createBreakerType();
    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    await patchType(objectTypeId, { isActive: false });

    const patched = await request(app)
      .patch(`${API}/objects-master/${created.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ attributeValues: { fuse: 'NOT_FUSED', separator: 'WITH' } });

    expect(patched.status).toBe(200);
    expect(patched.body.data.attributeValues.fuse).toBe('NOT_FUSED');
  });

  it('creates a quick-placed object with no values rather than refusing it', async () => {
    /**
     * QUICK-PLACE IS EXEMPT, DELIBERATELY.
     *
     * A tap on a floor plan has no form to carry an answer, and demanding one would put a
     * modal in front of every tap — which is the one thing that endpoint exists to avoid. The
     * object lands unanswered, exactly like the objects that predate the attribute, and the
     * first report written against it is where the questions are asked.
     */
    const objectTypeId = await createBreakerType();

    const placed = await request(app)
      .post(`${API}/objects-master/quick-place`)
      .set('Authorization', `Bearer ${token}`)
      .send({ customerId, objectTypeId, floorId, planPosition: { x: 0.5, y: 0.5 } });

    expect(placed.status).toBe(201);
    expect(placed.body.data.attributeValues).toEqual({});
  });

  it('keeps the definitions global while the values stay behind the tenant scope', async () => {
    // The type catalogue has no `customer` and is shared; the answers recorded against it are
    // on the object, which is not. A customer from another organisation reaches neither.
    const objectTypeId = await createBreakerType();
    const created = await createObject({
      objectTypeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });

    const other = await Customer.create({ code: 'OT', name: 'Бусад ХХК' });
    const outsider = await loginAsCustomer('outsider@test.mn', String(other._id));

    const denied = await getObject(created.body.data.id, outsider);
    // 404 rather than 403: a forbidden answer would confirm the object exists.
    expect(denied.status).toBe(404);
  });

  it('leaves the stored bag sparse, dropping blanks', async () => {
    const response = await createType({
      attributes: [
        { key: 'serial', label: 'Сериал', type: 'TEXT', required: false, options: [] },
        { key: 'batch', label: 'Цуврал', type: 'TEXT', required: false, options: [] },
      ],
    });

    const created = await createObject({
      objectTypeId: response.body.data.id,
      attributeValues: { serial: '  AB-1200  ', batch: '' },
    });

    expect(created.status).toBe(201);
    // Trimmed, and the empty one is absent rather than stored as an empty string.
    expect(created.body.data.attributeValues).toEqual({ serial: 'AB-1200' });
  });

  it('ships the definitions and the answers on a list row', async () => {
    const objectTypeId = await createBreakerType();
    await createObject({ objectTypeId, attributeValues: { fuse: 'FUSED', separator: 'WITH' } });

    const list = await request(app)
      .get(`${API}/objects-master`)
      .query({ customerId })
      .set('Authorization', `Bearer ${token}`);

    expect(list.status).toBe(200);
    // The definitions ARE on a list row, deliberately: the Ажлын тайлан equipment rows and
    // the employee app's Дүгнэлт editor both ask the type's questions from a picked list
    // item, and fetching a detail per piece of equipment would be a round trip per tap.
    expect(list.body.data.items[0].objectType.attributes.map((a: { key: string }) => a.key))
      .toEqual(['fuse', 'separator']);
    expect(list.body.data.items[0].attributeValues).toEqual({ fuse: 'FUSED', separator: 'WITH' });
  });

  it('stores nothing new on a type that declares no attributes', async () => {
    const objectTypeId = (await createType()).body.data.id as string;

    const created = await createObject({ objectTypeId });

    expect(created.status).toBe(201);
    expect(created.body.data.attributeValues).toEqual({});
    expect(created.body.data.objectType.attributes).toEqual([]);
  });
});

describe('section 4.1 attributes answered on the Үнэлгээ бүртгэх report form', () => {
  /**
   * Writing a report is when somebody is standing in front of the equipment, so it is where
   * the type's questions are asked. The answers land on the OBJECT, never on the assessment:
   * "this breaker is fused" is true between visits, and a copy per report would create as
   * many answers as there are reports with no way to say which is current.
   */
  async function uploadPhoto(): Promise<string> {
    const response = await request(app)
      .post(`${API}/files/object-assessment-photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('evidence-bytes'), {
        filename: 'evidence.png',
        contentType: 'image/png',
      });
    expect(response.status).toBe(201);
    return response.body.data.id as string;
  }

  async function assess(
    objectId: string,
    body: Record<string, unknown> = {},
  ): Promise<request.Response> {
    const photoId = await uploadPhoto();
    return request(app)
      .post(`${API}/objects-master/${objectId}/assessments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ newScore: 95, photoIds: [photoId], ...body });
  }

  /** An object of a breaker type carrying no answers yet — the pre-existing case. */
  async function unansweredBreaker(): Promise<{ objectId: string; typeId: string }> {
    const typeId = await createBreakerType();
    const object = await ObjectRecord.create({
      code: 'MCB-OLD',
      name: 'Хуучин таслуур',
      category: 'EQUIPMENT',
      objectType: new Types.ObjectId(typeId),
      customer: new Types.ObjectId(customerId),
      status: 'ACTIVE',
    });
    return { objectId: String(object._id), typeId };
  }

  it('writes the answers onto the equipment, not onto the assessment', async () => {
    const { objectId } = await unansweredBreaker();

    const recorded = await assess(objectId, {
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    expect(recorded.status).toBe(201);

    const reread = await getObject(objectId);
    expect(reread.body.data.attributeValues).toEqual({ fuse: 'FUSED', separator: 'WITH' });

    // The assessment itself keeps no copy: it is an observation of a visit, and these are
    // not observations.
    expect(recorded.body.data).not.toHaveProperty('attributeValues');
  });

  it('refuses the report while a required attribute is unanswered', async () => {
    const { objectId } = await unansweredBreaker();

    const refused = await assess(objectId, { attributeValues: { fuse: 'FUSED' } });

    expect(refused.status).toBe(400);
    expect(issueFields(refused)).toEqual(['attributeValues.separator']);
  });

  it('refuses a value outside the option list, and records nothing', async () => {
    const { objectId } = await unansweredBreaker();

    const refused = await assess(objectId, {
      attributeValues: { fuse: 'MELTED', separator: 'WITH' },
    });

    expect(refused.status).toBe(400);
    expect(issueFields(refused)).toEqual(['attributeValues.fuse']);
    // Checked before anything is written, so no assessment was left behind beside values
    // that were rejected.
    const history = await request(app)
      .get(`${API}/objects-master/${objectId}/history`)
      .set('Authorization', `Bearer ${token}`);
    expect(history.body.data.assessments).toHaveLength(0);
  });

  it('leaves stored values alone when the key is omitted entirely', async () => {
    /**
     * THIS IS WHAT KEEPS THE EMPLOYEE MOBILE APP WORKING.
     *
     * It sends no `attributeValues`, so nothing may be enforced against it and nothing it
     * stores may be cleared. Absent means "not asked" — never "the answer is nothing".
     */
    const typeId = await createBreakerType();
    const created = await createObject({
      objectTypeId: typeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    const objectId = created.body.data.id as string;

    const recorded = await assess(objectId);

    expect(recorded.status).toBe(201);
    const reread = await getObject(objectId);
    expect(reread.body.data.attributeValues).toEqual({ fuse: 'FUSED', separator: 'WITH' });
  });

  it('refuses a key the type does not declare', async () => {
    const { objectId } = await unansweredBreaker();

    const refused = await assess(objectId, {
      attributeValues: { fuse: 'FUSED', separator: 'WITH', colour: 'RED' },
    });

    expect(refused.status).toBe(400);
    expect(issueFields(refused)).toEqual(['attributeValues.colour']);
  });

  it('keeps values whose definition was removed, while correcting the rest', async () => {
    const typeId = await createBreakerType();
    const created = await createObject({
      objectTypeId: typeId,
      attributeValues: { fuse: 'FUSED', separator: 'WITH' },
    });
    const objectId = created.body.data.id as string;

    await patchType(typeId, { attributes: [FUSE] });

    const recorded = await assess(objectId, { attributeValues: { fuse: 'NOT_FUSED' } });

    expect(recorded.status).toBe(201);
    const reread = await getObject(objectId);
    // The report form never knew about `separator`; it must not be what destroys it.
    expect(reread.body.data.attributeValues).toEqual({
      fuse: 'NOT_FUSED',
      separator: 'WITH',
    });
  });
});

describe('permissions', () => {
  it('refuses an attribute change without object_type.manage', async () => {
    const typeId = await createBreakerType();

    const viewer = await createUserWithPermissions('viewer@test.mn', [
      PERMISSIONS.OBJECT_MASTER_VIEW,
    ]);
    const viewerToken = await login(viewer.email, viewer.password);

    const response = await request(app)
      .patch(`${API}/object-types/${typeId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ attributes: [] });

    expect(response.status).toBe(403);
    // And nothing was written.
    const type = await ObjectType.findById(typeId);
    expect(type?.attributes).toHaveLength(2);
  });
});
