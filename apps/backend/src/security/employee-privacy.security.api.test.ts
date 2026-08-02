import { PERMISSIONS, SYSTEM_ROLE_KEYS, type PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createOrgFixture,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
  type OrgFixture,
} from '../test/helpers';
import { Employee } from '../modules/employee/employee.model';
import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';

/**
 * EMPLOYEE PRIVACY — the half of the hardening round that is about DATA, not about roles.
 *
 * The live leak: the seeded TECHNICIAN role held `employee.view` so the mobile app could
 * work out which employee was signed in, and it did that by paging `GET /employees`. Every
 * technician in the field therefore read every colleague's registration number (Mongolian
 * РД), phone and personal email.
 *
 * `employee-self.api.test.ts` already pins the endpoint itself: the 404 for an unlinked
 * account, the field-by-field absence of sensitive data, the refusal of the directory, the
 * re-link taking effect on the next request, and the narrow own-photo exemption. Nothing
 * here restates any of that. What is added is the part those cases cannot reach:
 *
 *   - TWO linked technicians at once, so "returns the caller's own record" is distinguished
 *     from "returns the only record there is" (owner case 2).
 *   - The authorised administrator, asserted to be UNCHANGED rather than merely working, so
 *     the fix is shown to have narrowed the technician and nobody else (owner case 6).
 *   - INDEPENDENCE OF PERMISSION AND SCOPE: a technician handed staff permissions it should
 *     never have received still reads no colleague. A permission is per-action; none of them
 *     is a bundle, and none of them is a substitute for `employee.view`.
 *
 * Every case here fails against the pre-hardening code, where `GET /employees` answered a
 * technician with the whole directory.
 */

const API = '/api/v1';
const PASSWORD = 'TestPassword2026x';

let app: Express;
let org: OrgFixture;

/** A monotonic suffix so bespoke role keys never collide across cases. */
let roleSequence = 0;

async function login(email: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password: PASSWORD });
  expect(response.status, `login failed for ${email}`).toBe(200);
  return response.body.data.tokens.accessToken as string;
}

/**
 * An employee record with a value in every field that must never leave the server for
 * anyone but an authorised administrator. Written straight to the collection: the endpoints
 * are what is under test, so building the fixture through them would make a failure
 * ambiguous between the setup and the case.
 */
async function seedEmployee(
  overrides: Record<string, unknown> = {},
): Promise<InstanceType<typeof Employee>> {
  return Employee.create({
    employeeCode: 'EMP-1001',
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
    icCardNumber: 'IC-1001',
    attendanceNumber: 'ATT-1001',
    skills: ['Кабель татах'],
    qualificationLevel: 'MIDDLE',
    safetyGrade: 'III',
    permittedJobTypes: ['ELECTRICAL'],
    hasDriverLicense: true,
    currentAddress: 'СБД, 1-р хороо, 12-р байр',
    maritalStatus: 'SINGLE',
    familySize: 3,
    emergencyContactName: 'Батаа',
    emergencyContactPhone: '9911-0000',
    ...overrides,
  });
}

/**
 * A technician-tier account holding the SEEDED TECHNICIAN role, optionally linked to an
 * employee card and optionally carrying EXTRA permissions it has no business holding.
 *
 * The extra keys go on a second, bespoke role rather than onto the seeded one: mutating
 * TECHNICIAN would change what every other case in the file means, and the point of the
 * independence cases is an account that holds the real technician contract PLUS a mistake.
 */
async function createTechnician(options: {
  email: string;
  employee?: InstanceType<typeof Employee> | null;
  extraPermissions?: readonly PermissionKey[];
}): Promise<{ userId: string; token: string }> {
  const technicianRole = await Role.findOne({ key: SYSTEM_ROLE_KEYS.TECHNICIAN }).select('_id');
  expect(technicianRole, 'seedRbac did not create the TECHNICIAN role').not.toBeNull();

  const roleIds: Types.ObjectId[] = [technicianRole!._id];

  if (options.extraPermissions && options.extraPermissions.length > 0) {
    roleSequence += 1;
    const extra = await Role.create({
      key: `SECURITY_EXTRA_${roleSequence}`,
      name: 'Санамсаргүй олгосон эрх',
      description: null,
      permissions: [...options.extraPermissions],
      isSystem: false,
    });
    roleIds.push(extra._id);
  }

  const user = await User.create({
    fullName: `Test ${options.email}`,
    email: options.email,
    password: await hashPassword(PASSWORD),
    role: 'technician',
    roles: roleIds,
    status: 'active',
    passwordChangedAt: new Date(),
  });

  if (options.employee) {
    options.employee.systemUser = user._id;
    await options.employee.save();
  }

  return { userId: String(user._id), token: await login(options.email) };
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

/**
 * OWNER CASE 2 — "receives ONLY their linked record".
 *
 * With a single employee in the collection, "returns my record" and "returns the only
 * record" are the same assertion, and a handler that ignored the caller entirely would pass.
 * Two linked technicians make the two claims distinguishable.
 */
describe('GET /employees/me serves the caller and nobody else', () => {
  it('gives two linked technicians two different records from the same endpoint', async () => {
    const mine = await seedEmployee();
    const theirs = await seedEmployee({
      employeeCode: 'EMP-1002',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'b.dorj@monhorus.mn',
      phone: '8800-1122',
      icCardNumber: 'IC-1002',
      attendanceNumber: 'ATT-1002',
    });

    const first = await createTechnician({ email: 'sec-tech-a@test.mn', employee: mine });
    const second = await createTechnician({ email: 'sec-tech-b@test.mn', employee: theirs });

    const mineResponse = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${first.token}`);
    const theirsResponse = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${second.token}`);

    expect(mineResponse.status).toBe(200);
    expect(theirsResponse.status).toBe(200);

    expect(mineResponse.body.data.id).toBe(String(mine._id));
    expect(theirsResponse.body.data.id).toBe(String(theirs._id));
    expect(mineResponse.body.data.id).not.toBe(theirsResponse.body.data.id);

    // Neither payload carries so much as a fragment of the other person. Serialised whole,
    // because a leak could arrive in a nested object nobody thought to assert on.
    const mineBody = JSON.stringify(mineResponse.body);
    expect(mineBody).not.toContain(String(theirs._id));
    expect(mineBody).not.toContain('EMP-1002');
    expect(mineBody).not.toContain('УХ88031160');
    expect(mineBody).not.toContain('b.dorj@monhorus.mn');
    expect(mineBody).not.toContain('8800-1122');

    const theirsBody = JSON.stringify(theirsResponse.body);
    expect(theirsBody).not.toContain(String(mine._id));
    expect(theirsBody).not.toContain('EMP-1001');
    expect(theirsBody).not.toContain('УЮ99081733');
  });

  /**
   * The endpoint takes no identifier, so the only way to aim it at somebody else is to make
   * the SERVER resolve a different link. Moving the card to another account must move the
   * answer with it — and must not leave the previous holder reading it.
   */
  it('follows the link rather than the token when a card is moved to another account', async () => {
    const card = await seedEmployee();
    const loser = await createTechnician({ email: 'sec-loser@test.mn', employee: card });
    const winner = await createTechnician({ email: 'sec-winner@test.mn', employee: null });

    expect(
      (await request(app).get(`${API}/employees/me`).set('Authorization', `Bearer ${loser.token}`))
        .status,
    ).toBe(200);

    await Employee.updateOne(
      { _id: card._id },
      { $set: { systemUser: new Types.ObjectId(winner.userId) } },
    );

    const afterLoser = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${loser.token}`);
    // The old token is still perfectly valid; it simply no longer resolves to a card.
    expect(afterLoser.status).toBe(404);

    const afterWinner = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${winner.token}`);
    expect(afterWinner.status).toBe(200);
    expect(afterWinner.body.data.id).toBe(String(card._id));
  });
});

/**
 * OWNER CASE 6 — the authorised administrator is UNCHANGED.
 *
 * A hardening round that quietly narrowed the HR screen as well would be a regression, not
 * a fix. This asserts the directory still answers in full for a caller who holds the key,
 * including the exact field whose exposure was the leak.
 */
describe('the staff directory is unchanged for a caller who holds employee.view', () => {
  it('lists every employee and serves any of them by id, registration number included', async () => {
    const first = await seedEmployee();
    const second = await seedEmployee({
      employeeCode: 'EMP-1002',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'b.dorj@monhorus.mn',
      icCardNumber: 'IC-1002',
      attendanceNumber: 'ATT-1002',
    });

    const admin = await createUserWithPermissions('sec-hr@test.mn', [PERMISSIONS.EMPLOYEE_VIEW]);
    const token = await login(admin.email);

    const list = await request(app).get(`${API}/employees`).set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    const codes = (list.body.data.items as Array<{ employeeCode: string }>).map(
      (item) => item.employeeCode,
    );
    expect(codes).toContain('EMP-1001');
    expect(codes).toContain('EMP-1002');

    const detail = await request(app)
      .get(`${API}/employees/${String(second._id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(String(second._id));
    // The HR screen is SUPPOSED to show this. The leak was who else could see it.
    expect(detail.body.data.registrationNumber).toBe('УХ88031160');

    // And the administrator, having no card of their own, is told so plainly rather than
    // being handed somebody else's.
    const me = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(404);
    expect(JSON.stringify(me.body)).not.toContain(String(first._id));
  });
});

/**
 * INDEPENDENCE OF PERMISSION AND SCOPE, employee half.
 *
 * The failure mode this guards against is the one that caused the leak in the first place:
 * an account is handed a staff permission for one reason (it needed to record materials, or
 * park a login, or dispatch a job) and that permission turns out to carry directory access
 * with it. Permissions in this system are per-action and none of them is a bundle. Nothing
 * short of `employee.view` opens the directory.
 */
describe('a technician handed staff permissions still reads no colleague', () => {
  /** Staff keys a field technician might plausibly be given by accident, none of them employee.view. */
  const ACCIDENTAL_STAFF_KEYS: readonly PermissionKey[] = [
    PERMISSIONS.EMPLOYEE_MANAGE_SYSTEM_ACCESS,
    PERMISSIONS.PLANNED_WORK_UPDATE,
    PERMISSIONS.DISPATCH_ASSIGN,
    PERMISSIONS.ORG_VIEW,
    PERMISSIONS.CUSTOMER_VIEW,
    PERMISSIONS.RBAC_VIEW,
  ];

  it('refuses the list, the colleague, their documents, their salary and their certificate', async () => {
    const mine = await seedEmployee();
    const colleague = await seedEmployee({
      employeeCode: 'EMP-1002',
      firstName: 'Бат',
      lastName: 'Дорж',
      registrationNumber: 'УХ88031160',
      email: 'b.dorj@monhorus.mn',
      icCardNumber: 'IC-1002',
      attendanceNumber: 'ATT-1002',
    });

    const tech = await createTechnician({
      email: 'sec-tech-extra@test.mn',
      employee: mine,
      extraPermissions: ACCIDENTAL_STAFF_KEYS,
    });

    // The permissions really are held — otherwise this case would pass for the wrong reason.
    const me = await request(app)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${tech.token}`);
    expect(me.status).toBe(200);
    const permissions = me.body.data.permissions as string[];
    for (const key of ACCIDENTAL_STAFF_KEYS) {
      expect(permissions, `fixture did not actually grant ${key}`).toContain(key);
    }
    expect(permissions).not.toContain(PERMISSIONS.EMPLOYEE_VIEW);

    const colleagueId = String(colleague._id);
    const refusals: Array<[string, string]> = [
      ['list', `${API}/employees`],
      ['detail', `${API}/employees/${colleagueId}`],
      ['own detail by id', `${API}/employees/${String(mine._id)}`],
      ['documents', `${API}/employees/${colleagueId}/documents`],
      ['salary', `${API}/employees/${colleagueId}/salary`],
      ['certificate', `${API}/employees/${colleagueId}/certificate`],
    ];

    for (const [label, path] of refusals) {
      const response = await request(app)
        .get(path)
        .set('Authorization', `Bearer ${tech.token}`);
      expect(response.status, `${label} should be forbidden`).toBe(403);
      expect(JSON.stringify(response.body), `${label} leaked the record`).not.toContain(
        'УХ88031160',
      );
    }
  });

  it('does not widen the self payload either', async () => {
    const mine = await seedEmployee();
    const tech = await createTechnician({
      email: 'sec-tech-extra2@test.mn',
      employee: mine,
      extraPermissions: ACCIDENTAL_STAFF_KEYS,
    });

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${tech.token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.id).toBe(String(mine._id));

    // The self DTO is an allowlist, so holding more permissions cannot add fields to it.
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('УЮ99081733');
    expect(body).not.toContain('IC-1001');
    expect(body).not.toContain('ATT-1001');
    expect(body).not.toContain('9911-0000');
    expect(response.body.data.registrationNumber).toBeUndefined();
    expect(response.body.data.systemAccess).toBeUndefined();
    expect(response.body.data.salary).toBeUndefined();
  });

  /**
   * The unlinked case, with the accidental permissions in play. A null `employeeId` must
   * read as "no record", never as "any record" — the failure that would turn this endpoint
   * back into a directory.
   */
  it('fails closed for an unlinked technician instead of falling back to some other card', async () => {
    await seedEmployee();
    await seedEmployee({
      employeeCode: 'EMP-1002',
      registrationNumber: 'УХ88031160',
      email: 'b.dorj@monhorus.mn',
      icCardNumber: 'IC-1002',
      attendanceNumber: 'ATT-1002',
    });

    const tech = await createTechnician({
      email: 'sec-tech-unlinked@test.mn',
      employee: null,
      extraPermissions: ACCIDENTAL_STAFF_KEYS,
    });

    const response = await request(app)
      .get(`${API}/employees/me`)
      .set('Authorization', `Bearer ${tech.token}`);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('NOT_FOUND');
    const body = JSON.stringify(response.body);
    expect(body).not.toContain('EMP-1001');
    expect(body).not.toContain('EMP-1002');
    expect(body).not.toContain('УЮ99081733');
  });
});
