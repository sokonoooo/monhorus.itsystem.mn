import type { PermissionKey } from '@monhorus/shared';
import type { Express } from 'express';
import mongoose from 'mongoose';
import { inject } from 'vitest';

import { createApp } from '../app';
import { Customer, ObjectNode } from '../modules/objects/object.models';
import { Company, Department, Position, Team } from '../modules/org/org.models';
import { invalidateRecipientCache } from '../modules/notification/notification.service';
import { ObjectType } from '../modules/object-master/object-master.models';
import { seedRbac } from '../modules/rbac/rbac.service';
import { Role } from '../modules/rbac/role.model';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';
import { closeSharedServers } from './supertest-shared-server';

/**
 * One database for the whole run. The name is a constant on purpose.
 *
 * It used to be `monhorus_test_${process.pid}`, written in the belief that every suite
 * landed in the same database. It did not. Vitest's fork pool isolates by handing each
 * test file a *fresh child process*, so `process.pid` differs per file and the run minted
 * one database per suite — thirty-three of them, each with roughly forty collections and
 * their indexes, all left behind in a single mongod because teardown only emptied
 * documents. Later suites paid for every database an earlier suite had created, which is
 * precisely the superlinear WiredTiger cost the original comment was trying to avoid.
 *
 * A fixed name means the collections and indexes are built once, by whichever file runs
 * first, and every later file only empties documents. Isolation still holds: files run one
 * at a time under `fileParallelism: false`, and `startTestApp` wipes before seeding.
 */
const TEST_DB_NAME = 'monhorus_test';

/** Connects to the shared in-memory MongoDB and returns a fully wired Express app. */
/** Monotonic, because object types survive resetDomainCollections and code is unique. */
let callableTypeSequence = 0;

export async function startTestApp(): Promise<Express> {
  const uri = inject('mongoUri');
  await mongoose.connect(uri, {
    dbName: TEST_DB_NAME,
    // A stalled or dropped connection must surface as a failed operation, not as a hook
    // that hangs until the suite-level timeout and reports the wrong culprit.
    serverSelectionTimeoutMS: 10_000,
    // One file runs at a time and issues one request at a time; twenty sockets per file
    // bought nothing and left more for mongod to reap between suites.
    maxPoolSize: 10,
    minPoolSize: 0,
  });
  // Roles carry over between suites, so the catalogue is resynced rather than reseeded
  // into an empty collection.
  await dropAllCollections();
  await seedRbac();
  return createApp();
}

/**
 * Empties every collection without dropping the database itself.
 *
 * The deletes are issued together rather than one after another. They target disjoint
 * collections, so there is no ordering to preserve, and serialising them cost a full
 * round trip per collection on a wipe that runs before every single test.
 */
async function dropAllCollections(): Promise<void> {
  invalidateRecipientCache();
  const collections = (await mongoose.connection.db?.collections()) ?? [];
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

export async function stopTestApp(): Promise<void> {
  // No wipe here. `startTestApp` already empties everything before it seeds, so doing it
  // again on the way out only repeated forty `deleteMany` calls per suite. Teardown's job
  // is to close the handles, and to close them deterministically.
  invalidateRecipientCache();
  await closeSharedServers();
  mongoose.connection.removeAllListeners();
  await mongoose.disconnect();
}

/** Clears domain collections between tests while keeping the seeded RBAC catalogue. */
export async function resetDomainCollections(): Promise<void> {
  // The notification pipeline caches which users hold which permission; wiping users
  // behind its back would leave it pointing at recipients that no longer exist.
  invalidateRecipientCache();

  const keep = new Set(['roles', 'permissions']);
  const collections = (await mongoose.connection.db?.collections()) ?? [];
  await Promise.all(
    collections
      .filter((collection) => !keep.has(collection.collectionName))
      .map((collection) => collection.deleteMany({})),
  );
}

export interface TestUser {
  userId: string;
  email: string;
  password: string;
}

/**
 * Creates an active user holding exactly the supplied permissions.
 *
 * A bespoke role is created per call so a test can assert a precise permission
 * boundary rather than relying on whatever a system role happens to include.
 * `legacyRole` stays 'admin' because 'head_admin' is an unconditional superuser.
 */
/**
 * Monotonic counter for generated role keys.
 *
 * `resetDomainCollections` deliberately preserves the roles collection, so a key
 * derived only from the email collides across tests once two emails normalise to the
 * same string. A counter guarantees uniqueness for the lifetime of the suite.
 */
let testRoleSequence = 0;

export async function createUserWithPermissions(
  email: string,
  permissions: readonly PermissionKey[],
): Promise<TestUser> {
  testRoleSequence += 1;

  const role = await Role.create({
    key: `TEST_ROLE_${testRoleSequence}`,
    name: `Test role ${email}`,
    description: null,
    permissions: [...permissions],
    isSystem: false,
  });

  const password = 'TestPassword2026x';
  const user = await User.create({
    fullName: `Test ${email}`,
    email,
    password: await hashPassword(password),
    role: 'admin',
    roles: [role._id],
    status: 'active',
    passwordChangedAt: new Date(),
  });

  return { userId: String(user._id), email, password };
}

/** Creates a head_admin, which bypasses every permission check by design. */
export async function createSuperUser(email = 'super@test.mn'): Promise<TestUser> {
  const password = 'SuperPassword2026x';
  const user = await User.create({
    fullName: 'Super Admin',
    email,
    password: await hashPassword(password),
    role: 'head_admin',
    roles: [],
    status: 'active',
    passwordChangedAt: new Date(),
  });
  return { userId: String(user._id), email, password };
}

export interface ObjectFixture {
  customerId: string;
  projectId: string;
  buildingId: string;
  floorId: string;
  /** A building belonging to a DIFFERENT project, for cross-project rejection. */
  foreignBuildingId: string;
  /** A floor belonging to a DIFFERENT building, for cross-building rejection. */
  foreignFloorId: string;
}

/**
 * Customer plus a two-level object hierarchy.
 *
 * `ancestors` is written explicitly, exactly as the object service materialises it, so
 * the containment checks under test see realistic data rather than a shortcut.
 */
export async function createObjectFixture(): Promise<ObjectFixture> {
  const customer = await Customer.create({ code: 'CT', name: 'Central Tower ХХК' });

  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'PRJ-1',
    name: 'Урьдчилан сэргийлэх үйлчилгээ',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });

  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'BLD-1',
    name: 'Төв барилга',
    parent: project._id,
    customer: customer._id,
    ancestors: [project._id],
  });

  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'FL-1',
    name: '1 давхар',
    parent: building._id,
    customer: customer._id,
    ancestors: [project._id, building._id],
  });

  const otherProject = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'PRJ-2',
    name: 'Өөр төсөл',
    parent: null,
    customer: customer._id,
    ancestors: [],
  });

  const foreignBuilding = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'BLD-2',
    name: 'Өөр барилга',
    parent: otherProject._id,
    customer: customer._id,
    ancestors: [otherProject._id],
  });

  const foreignFloor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'FL-2',
    name: 'Өөр давхар',
    parent: foreignBuilding._id,
    customer: customer._id,
    ancestors: [otherProject._id, foreignBuilding._id],
  });

  return {
    customerId: String(customer._id),
    projectId: String(project._id),
    buildingId: String(building._id),
    floorId: String(floor._id),
    foreignBuildingId: String(foreignBuilding._id),
    foreignFloorId: String(foreignFloor._id),
  };
}

export interface OrgFixture {
  companyId: string;
  departmentId: string;
  positionId: string;
  teamId: string;
  otherCompanyId: string;
  otherDepartmentId: string;
}

/** Two companies, so cross-company relationship rejection can be exercised. */
export async function createOrgFixture(): Promise<OrgFixture> {
  const company = await Company.create({ code: 'MH', name: 'Монхорус ХХК' });
  const other = await Company.create({ code: 'OTHER', name: 'Бусад ХХК' });

  const department = await Department.create({
    company: company._id,
    code: 'ELEC',
    name: 'Цахилгааны хэлтэс',
  });
  const otherDepartment = await Department.create({
    company: other._id,
    code: 'OTHERDEP',
    name: 'Өөр хэлтэс',
  });
  const position = await Position.create({
    company: company._id,
    department: department._id,
    code: 'ENG',
    name: 'Цахилгааны инженер',
  });
  const team = await Team.create({
    company: company._id,
    department: department._id,
    code: 'TEAM1',
    name: 'Баг 1',
  });

  return {
    companyId: String(company._id),
    departmentId: String(department._id),
    positionId: String(position._id),
    teamId: String(team._id),
    otherCompanyId: String(other._id),
    otherDepartmentId: String(otherDepartment._id),
  };
}

/**
 * An equipment type a call may be raised against, with an SLA window of its own.
 *
 * Calls now take their deadline from the equipment type rather than from the urgent flag,
 * and the create schema requires one, so any test that posts a service request needs a
 * callable type to name. The default of 24 hours matches the worked example the rule was
 * specified with (a light gets a day).
 *
 * `code` is made unique per call because the collection has a unique index on it and a
 * suite may seed several types in one case.
 *
 * Object types ARE cleared by `resetDomainCollections` - they are domain data, not part of
 * the RBAC catalogue - so this must be called AFTER the reset, not before it. Seeding first
 * produces a type that is deleted moments later and a call that 404s on a valid-looking id.
 */
export async function createCallableObjectType(
  overrides: { callSlaHours?: number; canCreateCall?: boolean; name?: string } = {},
): Promise<string> {
  callableTypeSequence += 1;
  const type = await ObjectType.create({
    code: `CALLTYPE-${callableTypeSequence}`,
    name: overrides.name ?? 'Гэрэл',
    category: 'EQUIPMENT',
    showOnPlan: true,
    insidePanel: false,
    generatesConclusion: true,
    icon: 'LIGHT',
    canCreateCall: overrides.canCreateCall ?? true,
    callSlaHours: (overrides.canCreateCall ?? true) ? (overrides.callSlaHours ?? 24) : null,
    isActive: true,
  });
  return String(type._id);
}
