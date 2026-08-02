import { PERMISSIONS } from '@monhorus/shared';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createSuperUser,
  createUserWithPermissions,
  resetDomainCollections,
  startTestApp,
  stopTestApp,
} from '../../test/helpers';
import { AuditLog } from '../audit/audit-log.model';
import { ObjectRecord, ObjectType } from '../object-master/object-master.models';
import { Customer, ObjectNode } from '../objects/object.models';
import { Diagram } from './diagram.model';

const API = '/api/v1';

let app: Express;
let token: string;

async function login(email: string, password: string): Promise<string> {
  const response = await request(app).post(`${API}/auth/login`).send({ email, password });
  return response.body.data.tokens.accessToken as string;
}

function node(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'n1',
    assetKind: 'PANEL',
    name: 'Үндсэн самбар',
    subtitle: 'MDB-01',
    icon: 'PANEL',
    position: { x: 40, y: 80 },
    size: { width: 220, height: 120 },
    accentColour: '#2563eb',
    status: 'OK',
    metrics: [{ id: 'm1', label: 'Ачаалал', value: '6.16', unit: 'kW' }],
    ...overrides,
  };
}

function edge(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'e1',
    source: 'n1',
    sourceHandle: 'bottom',
    target: 'n2',
    targetHandle: 'top',
    direction: 'FORWARD',
    arrowType: 'ARROW_CLOSED',
    lineType: 'SMOOTHSTEP',
    colour: '#64748b',
    thickness: 2,
    dashStyle: 'SOLID',
    animated: true,
    label: 'L1',
    ...overrides,
  };
}

function diagram(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Цахилгааны схем',
    description: null,
    nodes: [node(), node({ id: 'n2', assetKind: 'TRANSFORMER', name: 'Трансформатор', icon: 'TRANSFORMER' })],
    edges: [edge()],
    viewport: { x: 0, y: 0, zoom: 1 },
    gridSize: 16,
    snapToGrid: true,
    timeline: [],
    activeStepId: null,
    ...overrides,
  };
}

async function createDiagram(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await request(app)
    .post(`${API}/diagrams`)
    .set('Authorization', `Bearer ${token}`)
    .send(diagram(overrides));
  expect(response.status).toBe(201);
  return response.body.data.id as string;
}

// Hoisted to file level so every describe below shares one app and one reset.
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

describe('Diagram API', () => {
  it('round-trips nodes, edges and viewport', async () => {
    const id = await createDiagram({ viewport: { x: -120, y: 40, zoom: 1.5 } });

    const response = await request(app)
      .get(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.nodes).toHaveLength(2);
    expect(data.edges).toHaveLength(1);
    expect(data.viewport).toEqual({ x: -120, y: 40, zoom: 1.5 });
    expect(data.nodes[0].metrics[0]).toEqual({
      id: 'm1',
      label: 'Ачаалал',
      value: '6.16',
      unit: 'kW',
    });
  });

  it('keeps every editable edge property', async () => {
    const id = await createDiagram({
      edges: [
        edge({
          direction: 'BOTH',
          arrowType: 'ARROW',
          lineType: 'STEP',
          colour: '#dc2626',
          thickness: 6,
          dashStyle: 'DASHED',
          animated: false,
          label: '400A',
        }),
      ],
    });

    const stored = (
      await request(app).get(`${API}/diagrams/${id}`).set('Authorization', `Bearer ${token}`)
    ).body.data.edges[0];

    expect(stored).toMatchObject({
      direction: 'BOTH',
      arrowType: 'ARROW',
      lineType: 'STEP',
      colour: '#dc2626',
      thickness: 6,
      dashStyle: 'DASHED',
      animated: false,
      label: '400A',
    });
  });

  /** A dangling edge renders as nothing at all, so it is rejected rather than dropped. */
  it('rejects an edge whose endpoint does not exist', async () => {
    const response = await request(app)
      .post(`${API}/diagrams`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ edges: [edge({ target: 'missing' })] }));

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Дуусах node олдсонгүй');
  });

  it('rejects duplicate node ids', async () => {
    const response = await request(app)
      .post(`${API}/diagrams`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ nodes: [node(), node()], edges: [] }));

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('давхардсан');
  });

  it('rejects a colour that is not #rrggbb', async () => {
    const response = await request(app)
      .post(`${API}/diagrams`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ nodes: [node({ accentColour: 'red' })], edges: [] }));

    expect(response.status).toBe(400);
  });

  it('rejects a node smaller than the minimum renderable size', async () => {
    const response = await request(app)
      .post(`${API}/diagrams`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ nodes: [node({ size: { width: 4, height: 4 } })], edges: [] }));

    expect(response.status).toBe(400);
  });

  it('replaces the whole document on save', async () => {
    const id = await createDiagram();

    const response = await request(app)
      .put(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ name: 'Шинэчилсэн', nodes: [node()], edges: [] }));

    expect(response.status).toBe(200);
    expect(response.body.data.name).toBe('Шинэчилсэн');
    expect(response.body.data.nodes).toHaveLength(1);
    expect(response.body.data.edges).toHaveLength(0);
  });

  it('updates the viewport without touching the nodes', async () => {
    const id = await createDiagram();

    const response = await request(app)
      .patch(`${API}/diagrams/${id}/viewport`)
      .set('Authorization', `Bearer ${token}`)
      .send({ viewport: { x: 10, y: 20, zoom: 2 } });

    expect(response.status).toBe(200);
    expect(response.body.data.viewport).toEqual({ x: 10, y: 20, zoom: 2 });
    expect(response.body.data.nodes).toHaveLength(2);
  });

  it('rejects a zoom outside the renderable range', async () => {
    const id = await createDiagram();

    const response = await request(app)
      .patch(`${API}/diagrams/${id}/viewport`)
      .set('Authorization', `Bearer ${token}`)
      .send({ viewport: { x: 0, y: 0, zoom: 99 } });

    expect(response.status).toBe(400);
  });

  // -- Timeline ----------------------------------------------------------------

  const step = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 's1',
    label: 'Хэвийн горим',
    at: '08:00',
    order: 0,
    nodeStates: [{ nodeId: 'n1', status: 'OK' }],
    edgeStates: [{ edgeId: 'e1', animated: true }],
    ...overrides,
  });

  it('stores timeline steps and returns them in order', async () => {
    const id = await createDiagram({
      timeline: [
        step({ id: 's2', label: 'Гэмтэл', order: 1, nodeStates: [{ nodeId: 'n1', status: 'FAULT' }] }),
        step(),
      ],
      activeStepId: 's1',
    });

    const data = (
      await request(app).get(`${API}/diagrams/${id}`).set('Authorization', `Bearer ${token}`)
    ).body.data;

    expect(data.timeline.map((entry: { id: string }) => entry.id)).toEqual(['s1', 's2']);
    expect(data.activeStepId).toBe('s1');
    expect(data.timeline[1].nodeStates[0]).toEqual({ nodeId: 'n1', status: 'FAULT' });
  });

  it('changes the shown step without rewriting the structure', async () => {
    const id = await createDiagram({ timeline: [step(), step({ id: 's2', label: 'Гэмтэл', order: 1 })] });

    const response = await request(app)
      .patch(`${API}/diagrams/${id}/active-step`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activeStepId: 's2' });

    expect(response.status).toBe(200);
    expect(response.body.data.activeStepId).toBe('s2');
    expect(response.body.data.nodes).toHaveLength(2);
    expect(response.body.data.timeline).toHaveLength(2);
  });

  it('refuses to show a step that does not exist', async () => {
    const id = await createDiagram({ timeline: [step()] });

    const response = await request(app)
      .patch(`${API}/diagrams/${id}/active-step`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activeStepId: 'nope' });

    expect(response.status).toBe(400);
  });

  it('rejects a timeline step referring to a node that does not exist', async () => {
    const response = await request(app)
      .post(`${API}/diagrams`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ timeline: [step({ nodeStates: [{ nodeId: 'ghost', status: 'OK' }] })] }));

    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body.issues)).toContain('Node олдсонгүй');
  });

  /** Deleting the shown step must not leave the diagram pointing at nothing. */
  it('clears the active step when a save removes it', async () => {
    const id = await createDiagram({ timeline: [step()], activeStepId: 's1' });

    const response = await request(app)
      .put(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ timeline: [], activeStepId: 's1' }));

    expect(response.status).toBe(200);
    expect(response.body.data.activeStepId).toBeNull();
  });

  // -- No versioning -----------------------------------------------------------

  /**
   * Requirement: no diagram versioning and no historical version storage. A save must
   * overwrite in place, leaving exactly one document and no snapshot behind.
   */
  it('keeps no prior version of the diagram', async () => {
    const id = await createDiagram();

    await request(app)
      .put(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ name: 'Хоёр дахь', nodes: [node()], edges: [] }));
    await request(app)
      .put(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ name: 'Гурав дахь', nodes: [node()], edges: [] }));

    expect(await Diagram.countDocuments()).toBe(1);
    const stored = await Diagram.findById(id).lean();
    expect(stored?.name).toBe('Гурав дахь');
    expect(stored).not.toHaveProperty('versions');
    expect(stored).not.toHaveProperty('history');
    expect(stored).not.toHaveProperty('supersededBy');
  });

  /** The audit row records the shape of the change, never a copy of the canvas. */
  it('audits a save without storing the diagram contents', async () => {
    const id = await createDiagram();
    await request(app)
      .put(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send(diagram({ name: 'Засварласан' }));

    const entry = await AuditLog.findOne({ entityType: 'Diagram', action: 'Updated' }).lean();
    expect(entry?.newValue).toMatchObject({ name: 'Засварласан', nodes: 2, edges: 1 });
    expect(JSON.stringify(entry?.newValue)).not.toContain('position');
    expect(JSON.stringify(entry?.newValue)).not.toContain('accentColour');
  });

  // -- Dashboard and permissions ------------------------------------------------

  it('returns null for the dashboard when nothing has been drawn', async () => {
    const response = await request(app)
      .get(`${API}/diagrams/dashboard`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toBeNull();
  });

  it('returns the dashboard diagram once one exists', async () => {
    const id = await createDiagram();

    const response = await request(app)
      .get(`${API}/diagrams/dashboard`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.body.data.id).toBe(id);
  });

  it('lets a viewer read and switch step but not save', async () => {
    const id = await createDiagram({ timeline: [step()] });
    const viewer = await createUserWithPermissions('diagview@test.mn', [PERMISSIONS.DIAGRAM_VIEW]);
    const viewerToken = await login(viewer.email, viewer.password);

    expect(
      (await request(app).get(`${API}/diagrams/${id}`).set('Authorization', `Bearer ${viewerToken}`))
        .status,
    ).toBe(200);

    // Choosing which operating state to look at is reading, not editing.
    expect(
      (
        await request(app)
          .patch(`${API}/diagrams/${id}/active-step`)
          .set('Authorization', `Bearer ${viewerToken}`)
          .send({ activeStepId: 's1' })
      ).status,
    ).toBe(200);

    expect(
      (
        await request(app)
          .put(`${API}/diagrams/${id}`)
          .set('Authorization', `Bearer ${viewerToken}`)
          .send(diagram())
      ).status,
    ).toBe(403);
  });

  it('refuses a caller without diagram.view', async () => {
    const outsider = await createUserWithPermissions('diagout@test.mn', [
      PERMISSIONS.DASHBOARD_VIEW,
    ]);
    const outsiderToken = await login(outsider.email, outsider.password);

    const response = await request(app)
      .get(`${API}/diagrams/dashboard`)
      .set('Authorization', `Bearer ${outsiderToken}`);

    expect(response.status).toBe(403);
  });

  it('deletes a diagram', async () => {
    const id = await createDiagram();

    await request(app)
      .delete(`${API}/diagrams/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(await Diagram.countDocuments()).toBe(0);
  });
});

describe('Project graph', () => {
  it('draws a node for each building, floor and object', async () => {

    const customer = await Customer.create({ code: 'C-GRAPH', name: 'Graph ХХК' });
    const project = await ObjectNode.create({
      kind: 'PROJECT',
      code: 'PRJ-G',
      name: 'Graph төсөл',
      customer: customer._id,
      parent: null,
      ancestors: [],
    });
    const building = await ObjectNode.create({
      kind: 'BUILDING',
      code: 'BLD-G',
      name: 'Барилга',
      customer: customer._id,
      parent: project._id,
      ancestors: [project._id],
    });
    const floor = await ObjectNode.create({
      kind: 'FLOOR',
      code: 'FL-G',
      name: '1 давхар',
      customer: customer._id,
      parent: building._id,
      ancestors: [project._id, building._id],
    });
    const type = await ObjectType.create({
      code: 'DBG',
      name: 'Самбар',
      category: 'PANEL',
      showOnPlan: false,
      insidePanel: false,
      generatesConclusion: true,
      icon: 'PANEL',
      isActive: true,
    });
    const panel = await ObjectRecord.create({
      code: 'P-1',
      name: 'Самбар 1',
      category: 'PANEL',
      objectType: type._id,
      customer: customer._id,
      floor: floor._id,
      status: 'ACTIVE',
      panel: { capacityKw: 25, location: null, protection: null },
      latestAssessment: null,
    });
    await ObjectRecord.create({
      code: 'C-1',
      name: 'Хэлхээ 1',
      category: 'CIRCUIT',
      objectType: type._id,
      customer: customer._id,
      floor: floor._id,
      status: 'ACTIVE',
      circuit: {
        panel: panel._id,
        startPointObject: null,
        endPointObject: null,
        breakerRating: null,
        cableType: null,
        cableSectionMm2: null,
        cableLengthM: null,
        permittedCapacityKw: null,
      },
      latestAssessment: null,
    });

    const response = await request(app)
      .get(`${API}/projects/${String(project._id)}/graph`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    const data = response.body.data;
    expect(data.projectName).toBe('Graph төсөл');
    expect(data.buildingCount).toBe(1);
    expect(data.objectCount).toBe(2);
    // One building, one floor, two objects.
    expect(data.nodes).toHaveLength(4);

    // The circuit is fed by its panel, drawn solid to separate it from containment.
    const feed = data.edges.find(
      (entry: { source: string; dashStyle: string }) =>
        entry.source === `o-${String(panel._id)}` && entry.dashStyle === 'SOLID',
    );
    expect(feed).toBeDefined();
  });

  it('marks an unassessed object as such rather than inventing a score', async () => {

    const customer = await Customer.create({ code: 'C-G2', name: 'Graph2 ХХК' });
    const project = await ObjectNode.create({
      kind: 'PROJECT', code: 'PRJ-G2', name: 'T2', customer: customer._id, parent: null, ancestors: [],
    });
    const building = await ObjectNode.create({
      kind: 'BUILDING', code: 'B2', name: 'B', customer: customer._id, parent: project._id, ancestors: [project._id],
    });
    const floor = await ObjectNode.create({
      kind: 'FLOOR', code: 'F2', name: 'F', customer: customer._id, parent: building._id,
      ancestors: [project._id, building._id],
    });
    const type = await ObjectType.create({
      code: 'T2', name: 'T', category: 'PANEL', showOnPlan: false, insidePanel: false,
      generatesConclusion: true, icon: 'PANEL', isActive: true,
    });
    await ObjectRecord.create({
      code: 'P-9', name: 'Самбар 9', category: 'PANEL', objectType: type._id,
      customer: customer._id, floor: floor._id, status: 'ACTIVE',
      panel: { capacityKw: 10, location: null, protection: null }, latestAssessment: null,
    });

    const response = await request(app)
      .get(`${API}/projects/${String(project._id)}/graph`)
      .set('Authorization', `Bearer ${token}`);

    const objectNode = response.body.data.nodes.find((entry: { id: string }) =>
      entry.id.startsWith('o-'),
    );
    expect(objectNode.metrics[0].value).toBe('Үнэлгээгүй');
    expect(objectNode.status).toBe('MAINTENANCE');
  });

  it('refuses a project id that does not exist', async () => {
    const response = await request(app)
      .get(`${API}/projects/507f1f77bcf86cd799439999/graph`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});
