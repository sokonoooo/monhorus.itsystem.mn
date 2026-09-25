import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { Company, Department, Position } from './org.models';

const API = '/api/v1';

let app: Express;
let token: string;
let companyId: string;
let otherCompanyId: string;
let departmentId: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function auth(req: request.Test, bearer = token): request.Test {
  return req.set('Authorization', `Bearer ${bearer}`);
}

beforeAll(async () => {
  app = await startTestApp();
});

afterAll(async () => {
  await stopTestApp();
});

beforeEach(async () => {
  await resetDomainCollections();

  const user = await createUserWithPermissions('org@test.mn', [
    PERMISSIONS.ORG_VIEW,
    PERMISSIONS.ORG_MANAGE,
  ]);
  token = await login(user.email, user.password);

  // Two companies, so "belongs to the wrong parent" can be exercised, and hand-entered
  // codes, so the counter is proved to be issuing its own rather than echoing these.
  const company = await Company.create({ code: 'MH', name: 'Монхорус ХХК' });
  const other = await Company.create({ code: 'OTHER', name: 'Бусад ХХК' });
  companyId = String(company._id);
  otherCompanyId = String(other._id);

  const department = await Department.create({
    company: company._id,
    code: 'ELEC',
    name: 'Цахилгааны хэлтэс',
  });
  departmentId = String(department._id);
});

describe('Company management', () => {
  it('paginates and searches the company list', async () => {
    for (let index = 0; index < 5; index += 1) {
      await Company.create({ code: `SEED${index}`, name: `Тест компани ${index}` });
    }

    const firstPage = await auth(request(app).get(`${API}/org/companies?page=1&limit=2`));
    expect(firstPage.status).toBe(200);
    expect(firstPage.body.data.total).toBe(7);
    expect(firstPage.body.data.items).toHaveLength(2);
    expect(firstPage.body.data.page).toBe(1);
    expect(firstPage.body.data.limit).toBe(2);
    expect(firstPage.body.data.totalPages).toBe(4);

    const secondPage = await auth(request(app).get(`${API}/org/companies?page=2&limit=2`));
    const firstIds = firstPage.body.data.items.map((item: { id: string }) => item.id);
    const secondIds = secondPage.body.data.items.map((item: { id: string }) => item.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);

    const searched = await auth(request(app).get(`${API}/org/companies?search=Монхорус`));
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.items[0].name).toBe('Монхорус ХХК');
  });

  it('issues the code itself and ignores one sent by the client', async () => {
    const response = await auth(request(app).post(`${API}/org/companies`)).send({
      name: 'Шинэ компани',
      code: 'HAND-TYPED',
      registrationNumber: '1234567',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toMatch(/^COM-\d{3}$/);
    expect(response.body.data.code).not.toBe('HAND-TYPED');
    expect(response.body.data.registrationNumber).toBe('1234567');
    expect(response.body.data.isActive).toBe(true);
  });

  it('issues a different code to every company', async () => {
    const first = await auth(request(app).post(`${API}/org/companies`)).send({ name: 'Нэг' });
    const second = await auth(request(app).post(`${API}/org/companies`)).send({ name: 'Хоёр' });

    expect(first.body.data.code).not.toBe(second.body.data.code);
  });

  it('updates a company', async () => {
    const response = await auth(request(app).patch(`${API}/org/companies/${companyId}`)).send({
      name: 'Монхорус групп',
      address: 'Улаанбаатар',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Монхорус групп');
    expect(response.body.data.address).toBe('Улаанбаатар');
    // The code is not touched by an update: it is an identifier, not a field.
    expect(response.body.data.code).toBe('MH');
  });

  it('deactivates and reactivates a company', async () => {
    const off = await auth(request(app).patch(`${API}/org/companies/${companyId}/status`)).send({
      isActive: false,
    });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const on = await auth(request(app).patch(`${API}/org/companies/${companyId}/status`)).send({
      isActive: true,
    });
    expect(on.body.data.isActive).toBe(true);
  });

  it('hides a deactivated company until includeInactive asks for it', async () => {
    await auth(request(app).patch(`${API}/org/companies/${companyId}/status`)).send({
      isActive: false,
    });

    const active = await auth(request(app).get(`${API}/org/companies`));
    expect(active.body.data.items.map((item: { id: string }) => item.id)).not.toContain(companyId);

    const all = await auth(request(app).get(`${API}/org/companies?includeInactive=true`));
    expect(all.body.data.items.map((item: { id: string }) => item.id)).toContain(companyId);
  });

  it('refuses a write from a caller holding only org.view', async () => {
    const reader = await createUserWithPermissions('orgread@test.mn', [PERMISSIONS.ORG_VIEW]);
    const readerToken = await login(reader.email, reader.password);

    const list = await auth(request(app).get(`${API}/org/companies`), readerToken);
    expect(list.status).toBe(200);

    const write = await auth(request(app).post(`${API}/org/companies`), readerToken).send({
      name: 'Зөвшөөрөлгүй',
    });
    expect(write.status).toBe(403);
  });
});

describe('Department management', () => {
  it('paginates, searches and carries the company name on every row', async () => {
    for (let index = 0; index < 4; index += 1) {
      await Department.create({
        company: companyId,
        code: `SEEDDEP${index}`,
        name: `Алба ${index}`,
      });
    }

    const page = await auth(request(app).get(`${API}/org/departments?page=1&limit=2`));
    expect(page.status).toBe(200);
    expect(page.body.data.total).toBe(5);
    expect(page.body.data.items).toHaveLength(2);
    expect(page.body.data.totalPages).toBe(3);
    for (const item of page.body.data.items) {
      expect(item.companyName).toBe('Монхорус ХХК');
    }

    const searched = await auth(request(app).get(`${API}/org/departments?search=Цахилгааны`));
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.items[0].id).toBe(departmentId);

    // Narrowing by company still holds; the other company has no departments at all.
    const narrowed = await auth(
      request(app).get(`${API}/org/departments?companyId=${otherCompanyId}`),
    );
    expect(narrowed.body.data.total).toBe(0);
  });

  it('creates a department with a server-issued code', async () => {
    const response = await auth(request(app).post(`${API}/org/departments`)).send({
      companyId,
      name: 'Санхүүгийн алба',
    });

    expect(response.status).toBe(201);
    expect(response.body.data.code).toMatch(/^DEP-\d{3}$/);
    expect(response.body.data.companyId).toBe(companyId);
    expect(response.body.data.companyName).toBe('Монхорус ХХК');
  });

  it('refuses a department filed under a company that does not exist', async () => {
    const response = await auth(request(app).post(`${API}/org/departments`)).send({
      companyId: '0123456789abcdef01234567',
      name: 'Хоосон',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Компани олдсонгүй');
  });

  it('updates and deactivates a department', async () => {
    const renamed = await auth(request(app).patch(`${API}/org/departments/${departmentId}`)).send({
      name: 'Цахилгаан хангамжийн алба',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Цахилгаан хангамжийн алба');

    const off = await auth(
      request(app).patch(`${API}/org/departments/${departmentId}/status`),
    ).send({ isActive: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const active = await auth(request(app).get(`${API}/org/departments`));
    expect(active.body.data.total).toBe(0);

    const all = await auth(request(app).get(`${API}/org/departments?includeInactive=true`));
    expect(all.body.data.total).toBe(1);
    expect(all.body.data.items[0].isActive).toBe(false);
  });
});

describe('Position management', () => {
  it('paginates, searches and carries both parent names', async () => {
    await Position.create({
      company: companyId,
      department: departmentId,
      code: 'ENG',
      name: 'Цахилгааны инженер',
    });
    for (let index = 0; index < 3; index += 1) {
      await Position.create({
        company: companyId,
        department: null,
        code: `SEEDPOS${index}`,
        name: `Албан тушаал ${index}`,
      });
    }

    const page = await auth(request(app).get(`${API}/org/positions?page=1&limit=3`));
    expect(page.status).toBe(200);
    expect(page.body.data.total).toBe(4);
    expect(page.body.data.items).toHaveLength(3);
    expect(page.body.data.totalPages).toBe(2);

    const searched = await auth(request(app).get(`${API}/org/positions?search=инженер`));
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.items[0].companyName).toBe('Монхорус ХХК');
    expect(searched.body.data.items[0].departmentName).toBe('Цахилгааны хэлтэс');

    // A company-wide position has no department, and its name is null rather than absent.
    const companyWide = await auth(request(app).get(`${API}/org/positions?search=Албан тушаал 0`));
    expect(companyWide.body.data.items[0].departmentId).toBeNull();
    expect(companyWide.body.data.items[0].departmentName).toBeNull();
  });

  it('creates a company-wide position and one scoped to a department', async () => {
    const wide = await auth(request(app).post(`${API}/org/positions`)).send({
      companyId,
      name: 'Захирал',
    });
    expect(wide.status).toBe(201);
    expect(wide.body.data.code).toMatch(/^POS-\d{3}$/);
    expect(wide.body.data.departmentId).toBeNull();

    const scoped = await auth(request(app).post(`${API}/org/positions`)).send({
      companyId,
      departmentId,
      name: 'Цахилгааны инженер',
    });
    expect(scoped.status).toBe(201);
    expect(scoped.body.data.departmentId).toBe(departmentId);
    expect(scoped.body.data.departmentName).toBe('Цахилгааны хэлтэс');
    expect(scoped.body.data.code).not.toBe(wide.body.data.code);
  });

  /** The cross-parent rule: the department exists, but under a different company. */
  it('refuses a position whose department belongs to another company', async () => {
    const response = await auth(request(app).post(`${API}/org/positions`)).send({
      companyId: otherCompanyId,
      departmentId,
      name: 'Буруу харьяалалтай',
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('харьяалагдахгүй');
  });

  it('refuses moving a position to a department of another company', async () => {
    const positionId = String(
      (
        await Position.create({
          company: companyId,
          department: null,
          code: 'DIR',
          name: 'Захирал',
        })
      )._id,
    );
    const foreignDepartmentId = String(
      (
        await Department.create({
          company: otherCompanyId,
          code: 'OTHERDEP',
          name: 'Өөр алба',
        })
      )._id,
    );

    const response = await auth(request(app).patch(`${API}/org/positions/${positionId}`)).send({
      departmentId: foreignDepartmentId,
    });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('харьяалагдахгүй');
  });

  it('updates a position and clears its department scope', async () => {
    const positionId = String(
      (
        await Position.create({
          company: companyId,
          department: departmentId,
          code: 'ENG',
          name: 'Цахилгааны инженер',
        })
      )._id,
    );

    const response = await auth(request(app).patch(`${API}/org/positions/${positionId}`)).send({
      name: 'Ахлах инженер',
      departmentId: null,
    });

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Ахлах инженер');
    expect(response.body.data.departmentId).toBeNull();
  });

  /**
   * Deactivating is always allowed, even with employees assigned. It means "no longer
   * offered", not "never existed", so the record has to remain retrievable.
   */
  it('deactivates a position and still lists it under includeInactive', async () => {
    const positionId = String(
      (
        await Position.create({
          company: companyId,
          department: departmentId,
          code: 'ENG',
          name: 'Цахилгааны инженер',
        })
      )._id,
    );

    const off = await auth(request(app).patch(`${API}/org/positions/${positionId}/status`)).send({
      isActive: false,
    });
    expect(off.status).toBe(200);
    expect(off.body.data.isActive).toBe(false);

    const active = await auth(request(app).get(`${API}/org/positions`));
    expect(active.body.data.total).toBe(0);

    const all = await auth(request(app).get(`${API}/org/positions?includeInactive=true`));
    expect(all.body.data.total).toBe(1);
    expect(all.body.data.items[0].id).toBe(positionId);
  });
});

describe('Team lookup', () => {
  /** Out of scope for management and deliberately still a bare array. */
  it('returns an array, not a page', async () => {
    const response = await auth(request(app).get(`${API}/org/teams?companyId=${companyId}`));

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });
});
