import { PERMISSIONS, SYSTEM_ROLE_KEYS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createOrgFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type OrgFixture,
} from '../../test/helpers';
import { hashPassword } from '../../utils/password.util';
import { Role } from '../rbac/role.model';
import { StoredFile } from '../storage/stored-file.model';
import { User } from '../user/user.model';
import { Employee } from './employee.model';

/**
 * AUTHENTICATED EMPLOYEE IDENTITY.
 *
 * The bug these tests exist for was live: the seeded TECHNICIAN role held `employee.view`
 * purely so the mobile app could work out which employee was signed in, and the app did that
 * by SEARCHING `GET /employees`. So every technician in the field could read every
 * colleague's registration number (Mongolian РД), phone and email; one real response carried
 * "registrationNumber": "УЮ99081733".
 *
 * The fix has three moving parts and all three are pinned here: the middleware resolves the
 * link server-side onto `req.auth.employeeId`, `GET /employees/me` serves it and takes no
 * identifier of any kind, and the directory itself is closed to a technician again.
 */

const API = '/api/v1';

let app: Express;
let org: OrgFixture;

const PASSWORD = 'TestPassword2026x';

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  expect(response.status).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An employee record carrying a value in every field the profile must NOT return, so an
 * accidental widening of the DTO shows up as a leaked value rather than as a null.
 */
async function seedEmployee(
  overrides: Record<string, unknown> = {},
): Promise<InstanceType<typeof Employee>> {
  return Employee.create({
    employeeCode: 'EMP-0007',
    firstName: 'Мөнхзул',
    lastName: 'Чулуун',
    registrationNumber: 'УЮ99081733',
    email: 'ch.munkhzul@monhorus.mn',
    phone: '9422-6655',
    birthDate: new Date('1999-08-17'),
    gender: 'FEMALE',
    company: org.companyId,
    department: org.departmentId,
    position: org.positionId,
    team: org.teamId,
    workLocation: 'Улаанбаатар',
    employmentStartDate: new Date('2024-01-15'),
    employeeType: 'FULL_TIME',
    status: 'ACTIVE',
    icCardNumber: 'IC-0007',
    attendanceNumber: 'ATT-0007',
    skills: ['Кабель татах'],
    qualificationLevel: 'MIDDLE',
    safetyGrade: 'III',
    permittedJobTypes: ['ELECTRICAL'],
    hasDriverLicense: true,
    currentAddress: 'СБД, 1-р хороо, 12-р байр',
    residentialAddress: 'ЧД, 4-р хороо',
    maritalStatus: 'SINGLE',
    familySize: 3,
    emergencyContactName: 'Батаа',
    emergencyContactRelation: 'Ах',
    emergencyContactPhone: '9911-0000',
    ...overrides,
  });
}

/**
 * An account on the TECHNICIAN tier holding the SEEDED technician role — not a bespoke
 * permission set. The point of these tests is what a real field technician can do, so the
 * role has to be the one the seed actually produces.
 */
async function createTechnician(
  email: string,
  employee: InstanceType<typeof Employee> | null,
): Promise<{ userId: string; email: string; password: string }> {
  const role = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN });
  expect(role, 'seedRbac did not create the TECHNICIAN role').not.toBeNull();

  const user = await User.create({
    fullName: `Test ${email}`,
    email,
    password: await hashPassword(PASSWORD),
    role: 'technician',
    roles: [role?._id],
    status: 'active',
    passwordChangedAt: new Date(),
  });

  if (employee) {
    employee.systemUser = user._id;
    await employee.save();
  }

  return { userId: String(user._id), email, password: PASSWORD };
}

beforeAll(async () => {
  app = await startTestApp();
}, 60_000);

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();
  org = await createOrgFixture();
});

describe('GET /employees/me', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(app).get(`${API}/employees/me`);
    expect(response.status).toBe(401);
    expect(response.body.code).toBe('UNAUTHENTICATED');
  });

  /** The whole point: this works for an account that cannot read the directory at all. */
  it('returns the caller’s own record without employee.view', async () => {
    const employee = await seedEmployee();
    const account = await createTechnician('tech@test.mn', employee);
    const token = await login(account.email, account.password);

    const me = await request(app).get(`${API}/auth/me`).set('Authorization', `Bearer ${token}`);
    expect(me.body.data.permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(String(employee._id));
    expect(response.body.data.employeeCode).toBe('EMP-0007');
    expect(response.body.data.position).toEqual({
      id: org.positionId,
      name: 'Цахилгааны инженер',
    });
    // The Нүүр tab's per-person counters, which used to be org-wide.
    expect(response.body.data.workload).toEqual({
      activeAssignments: 0,
      completedAssignments: 0,
      openServiceRequests: 0,
    });
  });

  /**
   * The leak, asserted field by field against a record that has a value in every one of
   * them. `registrationNumber` is the specific field that was observed in a live response.
   */
  it('returns no sensitive field, not even about the caller', async () => {
    const employee = await seedEmployee();
    const account = await createTechnician('tech@test.mn', employee);
    const token = await login(account.email, account.password);

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const body = response.body.data as Record<string, unknown>;

    for (const field of [
      'registrationNumber',
      'birthDate',
      'gender',
      'currentAddress',
      'residentialAddress',
      'maritalStatus',
      'familySize',
      'emergencyContactName',
      'emergencyContactRelation',
      'emergencyContactPhone',
      'icCardNumber',
      'attendanceNumber',
      'currentSalary',
      'documents',
      'statusHistory',
      'education',
      'workHistory',
      'certificates',
      'directManager',
      'systemAccess',
      'terminationReason',
    ]) {
      expect(body, `${field} must not be reachable through /employees/me`).not.toHaveProperty(
        field,
      );
    }

    // And the serialised payload contains none of the values either, whatever they were
    // named — a rename of the field would not slip past this.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('УЮ99081733');
    expect(raw).not.toContain('9911-0000');
    expect(raw).not.toContain('СБД, 1-р хороо');
  });

  it('answers with a clear 404 when the account is linked to no employee', async () => {
    const account = await createTechnician('unlinked@test.mn', null);
    const token = await login(account.email, account.password);

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    // Says what is wrong and who fixes it, rather than looking like an empty profile.
    expect(response.body.message).toContain('ажилтны картад холбогдоогүй');
  });

  /** An administrator legitimately has no employee card. The same clear answer, not a 500. */
  it('answers the same way for an admin account with no employee card', async () => {
    const actor = await createUserWithPermissions('admin@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
  });

  /**
   * ROUTE ORDER. `/me` is declared above `/:employeeId`, whose param schema is an ObjectId
   * regex. Were the order reversed, this would be a 400 for everyone and a 403 for the
   * technician who has no `employee.view` — the endpoint would simply not exist.
   */
  it('is not captured by the /:employeeId route, even for a caller who holds employee.view', async () => {
    const employee = await seedEmployee();
    const actor = await createUserWithPermissions('viewer@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    await Employee.updateOne({ _id: employee._id }, { $set: { systemUser: actor.userId } });
    const token = await login(actor.email, actor.password);

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(String(employee._id));
  });

  /**
   * THE ENDPOINT TAKES NO IDENTIFIER. Not from the query string, not from the body. If any
   * of these could steer it, the fix would have reintroduced the hole it closed, because
   * every technician could then read any colleague by id without `employee.view`.
   */
  it('cannot be aimed at another employee by query or body', async () => {
    const mine = await seedEmployee();
    const colleague = await seedEmployee({
      employeeCode: 'EMP-0008',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'other@monhorus.mn',
      icCardNumber: 'IC-0008',
      attendanceNumber: 'ATT-0008',
    });
    const account = await createTechnician('tech@test.mn', mine);
    const token = await login(account.email, account.password);

    for (const attempt of [
      request(app)
        .get(`${API}/employees/me?employeeId=${String(colleague._id)}`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .get(`${API}/employees/me?id=${String(colleague._id)}`)
        .set('Authorization', `Bearer ${token}`),
      request(app)
        .get(`${API}/employees/me`)
        .set('Authorization', `Bearer ${token}`)
        .send({ employeeId: String(colleague._id) }),
    ]) {
      const response = await attempt;
      expect(response.status).toBe(200);
      expect(response.body.data.id).toBe(String(mine._id));
    }
  });

  /**
   * The link is read from the database on every request, never from the access token. An
   * administrator relinking an account must take effect at once — the same rule the
   * middleware already applies to the customer link and the permission set.
   */
  it('follows a re-link on the very next request, with no new token', async () => {
    const first = await seedEmployee();
    const account = await createTechnician('tech@test.mn', first);
    const token = await login(account.email, account.password);

    expect(
      (await request(app).get(`${API}/employees/me`).set('Authorization', `Bearer ${token}`)).body
        .data.id,
    ).toBe(String(first._id));

    // The administrator moves the login to a different employee card.
    await Employee.updateOne({ _id: first._id }, { $set: { systemUser: null } });
    const second = await seedEmployee({
      employeeCode: 'EMP-0009',
      firstName: 'Сараа',
      lastName: 'Пүрэв',
      registrationNumber: 'УЮ95073322',
      email: 'saraa@monhorus.mn',
      icCardNumber: 'IC-0009',
      attendanceNumber: 'ATT-0009',
      systemUser: account.userId,
    });

    const after = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(200);
    expect(after.body.data.id).toBe(String(second._id));

    // And revoking the link closes the endpoint on the same token.
    await Employee.updateOne({ _id: second._id }, { $set: { systemUser: null } });
    const revoked = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(revoked.status).toBe(404);
  });
});

describe('the staff directory is closed to a technician', () => {
  it('refuses the list and an arbitrary colleague by id', async () => {
    const mine = await seedEmployee();
    const colleague = await seedEmployee({
      employeeCode: 'EMP-0008',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'other@monhorus.mn',
      icCardNumber: 'IC-0008',
      attendanceNumber: 'ATT-0008',
    });
    const account = await createTechnician('tech@test.mn', mine);
    const token = await login(account.email, account.password);

    const list = await request(app)
      .get(`${API}/employees`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(403);

    const byId = await request(app)
      .get(`${API}/employees/${String(colleague._id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byId.status).toBe(403);

    // Not even their own record by id: the id-addressed route is `employee.view`, and the
    // whole point is that self-identity does not travel through an id.
    const ownById = await request(app)
      .get(`${API}/employees/${String(mine._id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(ownById.status).toBe(403);

    // The colleague's documents are refused too, so the directory is not reachable sideways.
    const documents = await request(app)
      .get(`${API}/employees/${String(colleague._id)}/documents`)
      .set('Authorization', `Bearer ${token}`);
    expect(documents.status).toBe(403);
  });

  /**
   * `GET /employees/me` returns `photoUrl`, and file downloads are keyed on the owning
   * entity — EMPLOYEE-owned files need `employee.view`, which a technician no longer holds.
   * Without the narrow self-photo exemption in `storage.routes.ts` every field employee's
   * profile picture would be a broken image, and the obvious "fix" would be to hand the
   * directory permission back.
   *
   * The permission gate runs before the file is looked for on disk, so a caller that PASSES
   * it reaches the missing-file 404 while a caller that fails it gets 403. That difference
   * is what distinguishes the two outcomes here without writing bytes to the upload
   * directory.
   */
  it('lets a technician fetch their own profile photo but not a colleague’s', async () => {
    const mine = await seedEmployee();
    const colleague = await seedEmployee({
      employeeCode: 'EMP-0008',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'other@monhorus.mn',
      icCardNumber: 'IC-0008',
      attendanceNumber: 'ATT-0008',
    });

    const photoOf = async (employeeId: unknown): Promise<string> => {
      const file = await StoredFile.create({
        storageKey: `${String(employeeId)}.bin`,
        originalName: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1,
        ownerType: 'EMPLOYEE',
        ownerId: employeeId,
      });
      await Employee.updateOne({ _id: employeeId }, { $set: { photoDocument: file._id } });
      return String(file._id);
    };

    const myPhoto = await photoOf(mine._id);
    const theirPhoto = await photoOf(colleague._id);

    const account = await createTechnician('tech@test.mn', mine);
    const token = await login(account.email, account.password);

    const own = await request(app)
      .get(`${API}/files/${myPhoto}`)
      .set('Authorization', `Bearer ${token}`);
    expect(own.status).not.toBe(403);

    const other = await request(app)
      .get(`${API}/files/${theirPhoto}`)
      .set('Authorization', `Bearer ${token}`);
    expect(other.status).toBe(403);
  });
});
