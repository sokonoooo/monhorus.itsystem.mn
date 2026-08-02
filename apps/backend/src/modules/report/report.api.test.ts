import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ReportStatus, ReportType } from '@monhorus/shared';
import { Types } from 'mongoose';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { ObjectAssessment, ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { writeReport } from '../report-record/report-record.service';

const API = '/api/v1';

let app: Express;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

interface Hierarchy {
  customerId: string;
  projectId: string;
  buildingId: string;
  floorId: string;
  objectTypeId: string;
}

async function seedHierarchy(): Promise<Hierarchy> {
  const customer = await Customer.create({ code: 'C-RPT', name: 'Central Tower ХХК' });
  const project = await ObjectNode.create({
    kind: 'PROJECT',
    code: 'PRJ-RPT',
    name: 'Урьдчилан сэргийлэх үйлчилгээ',
    customer: customer._id,
    parent: null,
    ancestors: [],
  });
  const building = await ObjectNode.create({
    kind: 'BUILDING',
    code: 'BLD-RPT',
    name: 'Main Tower',
    customer: customer._id,
    parent: project._id,
    ancestors: [project._id],
  });
  const floor = await ObjectNode.create({
    kind: 'FLOOR',
    code: 'FL-2',
    name: '2-р давхар',
    customer: customer._id,
    parent: building._id,
    ancestors: [project._id, building._id],
  });
  const objectType = await ObjectType.create({
    code: 'DB',
    name: 'Түгээх самбар',
    category: 'PANEL',
    showOnPlan: false,
    insidePanel: false,
    generatesConclusion: true,
    icon: 'PANEL',
    isActive: true,
  });

  return {
    customerId: String(customer._id),
    projectId: String(project._id),
    buildingId: String(building._id),
    floorId: String(floor._id),
    objectTypeId: String(objectType._id),
  };
}

/**
 * Creates an object and its head assessment.
 *
 * The object is written first without a head, then the assessment, then the denormalised
 * head is attached: `latestAssessment.assessment` is a required reference, so the
 * assessment has to exist before the object can point at it.
 */
async function seedAssessedObject(
  hierarchy: Hierarchy,
  code: string,
  score: number,
  riskLevel: string,
): Promise<string> {
  const object = await ObjectRecord.create({
    code,
    name: `Самбар ${code}`,
    category: 'PANEL',
    objectType: hierarchy.objectTypeId,
    customer: hierarchy.customerId,
    floor: hierarchy.floorId,
    status: 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment: null,
  });

  const assessment = await ObjectAssessment.create({
    object: object._id,
    previousScore: null,
    newScore: score,
    riskLevel,
    assessedByName: 'Б. Энхтөр',
    assessedAt: new Date('2026-07-01'),
    conclusion: 'Кабелийн тусгаарлагчид хэт халалт илэрсэн.',
    recommendation: 'Ачааллыг тэнцвэржүүлэх.',
    repairRequired: riskLevel === 'CRITICAL',
    revisitRequired: false,
  });

  await ObjectRecord.updateOne(
    { _id: object._id },
    {
      $set: {
        latestAssessment: {
          assessment: assessment._id,
          score,
          riskLevel,
          assessedAt: new Date('2026-07-01'),
          assessedByName: 'Б. Энхтөр',
          conclusion: 'Кабелийн тусгаарлагчид хэт халалт илэрсэн.',
          recommendation: 'Ачааллыг тэнцвэржүүлэх.',
          repairRequired: riskLevel === 'CRITICAL',
          revisitRequired: false,
          revisitDate: null,
        },
      },
    },
  );

  return String(object._id);
}

/** A bare registered object with no assessment head, for reports to name. */
async function seedObject(hierarchy: Hierarchy, code: string): Promise<Types.ObjectId> {
  const object = await ObjectRecord.create({
    code,
    name: `Самбар ${code}`,
    category: 'PANEL',
    objectType: hierarchy.objectTypeId,
    customer: hierarchy.customerId,
    floor: hierarchy.floorId,
    status: 'ACTIVE',
    panel: { capacityKw: 25, location: null, protection: null },
    latestAssessment: null,
  });
  return object._id;
}

/** One report in the unified store, written the same way every producer writes one. */
async function seedReport(
  objectId: Types.ObjectId,
  score: number | null,
  options: { type?: ReportType; status?: ReportStatus; occurredAt?: Date } = {},
): Promise<string> {
  const report = await writeReport({
    type: options.type ?? 'OBJECT_ASSESSMENT',
    status: options.status ?? 'APPROVED',
    title: 'Тоноглолын үнэлгээ',
    sourceType: 'MANUAL',
    conclusion: 'Кабелийн тусгаарлагчид хэт халалт илэрсэн.',
    recommendation: 'Ачааллыг тэнцвэржүүлэх.',
    items: [{ object: objectId, score, conclusion: 'Кабелийн тусгаарлагчид хэт халалт илэрсэн.' }],
    actor: { id: null, name: 'Б. Энхтөр' },
    occurredAt: options.occurredAt ?? new Date('2026-07-01'),
  });
  return String(report._id);
}

describe('Report and inspection API', () => {
  beforeAll(async () => {
    app = await startTestApp();
  });

  afterAll(async () => {
    await stopTestApp();
  });

  beforeEach(async () => {
    await resetDomainCollections();
    const superUser = await createSuperUser();
    token = await login(superUser.email, superUser.password);
  });

  it('publishes the section 15.2 catalogue rather than hardcoding it in the client', async () => {
    const response = await request(app)
      .get(`${API}/reports`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toHaveLength(9);
    expect(response.body.data.map((entry: { key: string }) => entry.key)).toContain('SLA');
    expect(response.body.data.map((entry: { key: string }) => entry.key)).toContain(
      'TECHNICAL_REPORT',
    );
  });

  it('returns columns alongside rows so one screen serves every report', async () => {
    const response = await request(app)
      .get(`${API}/reports/RISK_ASSESSMENT`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data.columns)).toBe(true);
    expect(response.body.data.columns[0]).toHaveProperty('format');
    expect(response.body.data.key).toBe('RISK_ASSESSMENT');
  });

  it('rejects an unknown report key rather than returning an empty table', async () => {
    const response = await request(app)
      .get(`${API}/reports/NOT_A_REPORT`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });

  /** Rule 17.20: CSV carries a BOM so Excel opens Cyrillic without an import step. */
  it('exports CSV with a UTF-8 BOM', async () => {
    const hierarchy = await seedHierarchy();
    await seedAssessedObject(hierarchy, 'DB-01', 38, 'CRITICAL');

    const response = await request(app)
      .get(`${API}/reports/RISK_ASSESSMENT?format=csv`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.startsWith('﻿')).toBe(true);
    expect(response.text).toContain('Эрсдэлийн түвшин');
  });

  /** Section 14.2 separates taking a file out of the system from reading a report. */
  it('refuses an export to a reader without report.export', async () => {
    const reader = await createUserWithPermissions('reader@test.mn', [PERMISSIONS.REPORT_VIEW]);
    const readerToken = await login(reader.email, reader.password);

    const view = await request(app)
      .get(`${API}/reports/SLA`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(view.status).toBe(200);

    const exported = await request(app)
      .get(`${API}/reports/SLA?format=csv`)
      .set('Authorization', `Bearer ${readerToken}`);
    expect(exported.status).toBe(403);
  });

  it('reports a KPI over an empty set as null rather than as zero', async () => {
    const response = await request(app)
      .get(`${API}/reports/kpi?dateFrom=2026-07-01T00:00:00.000Z&dateTo=2026-07-31T00:00:00.000Z`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const onTime = response.body.data.values.find(
      (value: { key: string }) => value.key === 'ON_TIME_COMPLETION_RATE',
    );
    expect(onTime.value).toBeNull();
    expect(onTime.denominator).toBe(0);
    expect(onTime.formula).toBeTruthy();
  });

  it('lists conclusions of every type with their location trail', async () => {
    const hierarchy = await seedHierarchy();
    const objectId = await seedObject(hierarchy, 'DB-01');
    await seedReport(objectId, 38);
    await seedReport(objectId, 55, { type: 'PLANNED_WORK' });
    await seedReport(objectId, 70, { type: 'SERVICE_REQUEST' });
    await seedReport(objectId, null, { type: 'CONSOLIDATED' });

    const response = await request(app)
      .get(`${API}/inspections`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(4);
    const types = response.body.data.items.map((item: { type: string }) => item.type);
    expect(new Set(types).size).toBe(4);

    const assessment = response.body.data.items.find(
      (item: { type: string }) => item.type === 'OBJECT_ASSESSMENT',
    );
    expect(assessment.locationPath).toBe('Main Tower · 2-р давхар');
    expect(assessment.score).toBe(38);
    expect(assessment.reportNumber).toMatch(/^RPT-\d{6}-\d{4}$/);
    expect(assessment.projectName).toBe('Урьдчилан сэргийлэх үйлчилгээ');
    expect(assessment.objectCode).toBe('DB-01');
  });

  it('narrows to one producer through the type filter', async () => {
    const hierarchy = await seedHierarchy();
    const objectId = await seedObject(hierarchy, 'DB-01');
    await seedReport(objectId, 38);
    await seedReport(objectId, 55, { type: 'PLANNED_WORK' });

    const response = await request(app)
      .get(`${API}/inspections?type=PLANNED_WORK`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].type).toBe('PLANNED_WORK');
  });

  it('filters conclusions by risk band', async () => {
    const hierarchy = await seedHierarchy();
    await seedReport(await seedObject(hierarchy, 'DB-01'), 38);
    await seedReport(await seedObject(hierarchy, 'DB-02'), 92);

    const response = await request(app)
      .get(`${API}/inspections?riskLevel=CRITICAL`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].objectCode).toBe('DB-01');
  });

  it('filters conclusions by building', async () => {
    const hierarchy = await seedHierarchy();
    await seedReport(await seedObject(hierarchy, 'DB-01'), 38);

    // A second building under the same project, so the filter is proved to discriminate
    // between siblings rather than merely between projects.
    const otherBuilding = await ObjectNode.create({
      kind: 'BUILDING',
      code: 'BLD-2',
      name: 'Annex',
      customer: hierarchy.customerId,
      parent: hierarchy.projectId,
      ancestors: [hierarchy.projectId],
    });

    const inScope = await request(app)
      .get(`${API}/inspections?buildingId=${hierarchy.buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(inScope.body.data.items).toHaveLength(1);

    const elsewhere = await request(app)
      .get(`${API}/inspections?buildingId=${String(otherBuilding._id)}`)
      .set('Authorization', `Bearer ${token}`);
    expect(elsewhere.body.data.items).toHaveLength(0);

    // The project filter still reaches every building beneath it.
    const wholeProject = await request(app)
      .get(`${API}/inspections?projectId=${hierarchy.projectId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(wholeProject.body.data.items).toHaveLength(1);
  });

  /** Section 19.2 forbids a single rolled-up score, so the summary is counts only. */
  it('summarises by band and never emits an aggregate score', async () => {
    const hierarchy = await seedHierarchy();
    await seedAssessedObject(hierarchy, 'DB-01', 38, 'CRITICAL');
    await seedAssessedObject(hierarchy, 'DB-02', 92, 'NORMAL');
    await ObjectRecord.create({
      code: 'DB-03',
      name: 'Үнэлгээгүй самбар',
      category: 'PANEL',
      objectType: hierarchy.objectTypeId,
      customer: hierarchy.customerId,
      floor: hierarchy.floorId,
      status: 'ACTIVE',
      panel: { capacityKw: 10, location: null, protection: null },
      latestAssessment: null,
    });

    const response = await request(app)
      .get(`${API}/inspections/summary`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.totalObjects).toBe(3);
    expect(response.body.data.assessedObjects).toBe(2);
    expect(response.body.data.unassessedObjects).toBe(1);
    expect(response.body.data.counts).toHaveLength(2);
    expect(response.body.data).not.toHaveProperty('averageScore');
    expect(response.body.data).not.toHaveProperty('overallScore');
  });

  it('counts a device once no matter how many times it was assessed', async () => {
    const hierarchy = await seedHierarchy();
    const objectId = await seedAssessedObject(hierarchy, 'DB-01', 38, 'CRITICAL');
    await seedReport(new Types.ObjectId(objectId), 38);
    await seedReport(new Types.ObjectId(objectId), 42, { occurredAt: new Date('2026-07-15') });

    const summary = await request(app)
      .get(`${API}/inspections/summary`)
      .set('Authorization', `Bearer ${token}`);
    expect(summary.body.data.totalObjects).toBe(1);

    // Two settled results remain two rows; the summary above still counts one device.
    const list = await request(app)
      .get(`${API}/inspections`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.body.data.items).toHaveLength(2);
  });

  /** The unified store exports through the same envelope and CSV writer as every report. */
  it('exports the technical report registry as CSV', async () => {
    const hierarchy = await seedHierarchy();
    await seedReport(await seedObject(hierarchy, 'DB-01'), 38);

    const response = await request(app)
      .get(`${API}/reports/TECHNICAL_REPORT?format=csv`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.text.startsWith('﻿')).toBe(true);
    expect(response.text).toContain('Тайлангийн №');
    expect(response.text).toContain('Тоноглолын үнэлгээ');
    expect(response.text).toMatch(/RPT-\d{6}-\d{4}/);
  });

  it('hides the conclusion report from a caller without object_master.view', async () => {
    const outsider = await createUserWithPermissions('outsider@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/inspections`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });
});
