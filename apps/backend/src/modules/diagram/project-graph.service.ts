import {
  DIAGRAM_NODE_STATUS_COLOURS,
  RISK_LEVEL_LABELS,
  type DiagramAssetKind,
  type DiagramEdgeDto,
  type DiagramNodeDto,
  type DiagramNodeStatus,
  type ObjectCategory,
  type RiskLevel,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import { ObjectRecord } from '../object-master/object-master.models';
import { ObjectNode } from '../objects/object.models';

/**
 * The project's objects, drawn from the records rather than authored.
 *
 * This is the customer page's visual: it is generated from the real hierarchy and the real
 * electrical relations every time it is asked for, so it cannot drift from the data. It is
 * deliberately not stored: there is nothing to save, and therefore nothing to version.
 *
 * The payload reuses the diagram node and edge shapes so the same canvas renders both.
 */

export interface ProjectGraphDto {
  projectId: string;
  projectName: string;
  nodes: readonly DiagramNodeDto[];
  edges: readonly DiagramEdgeDto[];
  buildingCount: number;
  floorCount: number;
  objectCount: number;
}

/** Layout constants. A layered tree: buildings at the top, equipment at the bottom. */
const COLUMN_WIDTH = 260;
const ROW_HEIGHT = 150;
const NODE_WIDTH = 210;
const NODE_HEIGHT = 92;

/** Section 10 bands map onto the operational badge the node renderer understands. */
const RISK_TO_STATUS: Record<RiskLevel, DiagramNodeStatus> = {
  NORMAL: 'OK',
  ATTENTION: 'WARNING',
  SCHEDULE_REPAIR: 'WARNING',
  CRITICAL: 'FAULT',
  OUT_OF_SERVICE: 'OFFLINE',
  // A band an administrator added has no diagram semantics of its own, so it reads as a
  // warning: visible, but not claiming a fault the configuration never asserted.
  BAND_6: 'WARNING',
  BAND_7: 'WARNING',
  BAND_8: 'WARNING',
};

const CATEGORY_TO_KIND: Record<ObjectCategory, DiagramAssetKind> = {
  PANEL: 'PANEL',
  CIRCUIT: 'BREAKER',
  EQUIPMENT: 'OTHER',
};

const LEVEL_COLOURS = {
  building: '#1e293b',
  floor: '#0d9488',
  object: '#2563eb',
} as const;

function nodeOf(
  id: string,
  assetKind: DiagramAssetKind,
  name: string,
  subtitle: string | null,
  column: number,
  row: number,
  accentColour: string,
  status: DiagramNodeStatus,
  metrics: DiagramNodeDto['metrics'],
  objectId: string | null,
): DiagramNodeDto {
  return {
    id,
    assetKind,
    name,
    subtitle,
    icon: assetKind,
    position: { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT },
    size: { width: NODE_WIDTH, height: NODE_HEIGHT },
    accentColour,
    status,
    metrics,
    objectId,
  };
}

function edgeOf(source: string, target: string, dashed: boolean): DiagramEdgeDto {
  return {
    id: `${source}__${target}`,
    source,
    sourceHandle: 'bottom',
    target,
    targetHandle: 'top',
    direction: 'FORWARD',
    arrowType: 'ARROW_CLOSED',
    lineType: 'SMOOTHSTEP',
    colour: dashed ? '#94a3b8' : '#64748b',
    thickness: dashed ? 1 : 2,
    // Containment is drawn faintly and dashed; a real electrical feed is drawn solid, so
    // the two kinds of relation are not confused for one another.
    dashStyle: dashed ? 'DASHED' : 'SOLID',
    animated: false,
    label: null,
  };
}

export async function buildProjectGraph(projectId: string): Promise<ProjectGraphDto> {
  const project = await ObjectNode.findOne({ _id: projectId, kind: 'PROJECT' })
    .select('name')
    .lean();
  if (!project) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Төсөл олдсонгүй.');
  }

  const projectObjectId = new Types.ObjectId(projectId);

  const [buildings, floors] = await Promise.all([
    ObjectNode.find({ kind: 'BUILDING', ancestors: projectObjectId })
      .select('name code')
      .sort({ name: 1 })
      .lean(),
    ObjectNode.find({ kind: 'FLOOR', ancestors: projectObjectId })
      .select('name code parent')
      .sort({ name: 1 })
      .lean(),
  ]);

  const objects = await ObjectRecord.find({ floor: { $in: floors.map((floor) => floor._id) } })
    .select('code name category floor status latestAssessment panel circuit equipment')
    .sort({ code: 1 })
    .lean();

  const nodes: DiagramNodeDto[] = [];
  const edges: DiagramEdgeDto[] = [];

  const floorsByBuilding = new Map<string, typeof floors>();
  for (const floor of floors) {
    const key = String(floor.parent);
    floorsByBuilding.set(key, [...(floorsByBuilding.get(key) ?? []), floor]);
  }

  const objectsByFloor = new Map<string, typeof objects>();
  for (const object of objects) {
    const key = String(object.floor);
    objectsByFloor.set(key, [...(objectsByFloor.get(key) ?? []), object]);
  }

  let column = 0;

  for (const building of buildings) {
    const buildingId = `b-${String(building._id)}`;
    const buildingColumn = column;
    const buildingFloors = floorsByBuilding.get(String(building._id)) ?? [];

    for (const floor of buildingFloors) {
      const floorId = `f-${String(floor._id)}`;
      const floorObjects = objectsByFloor.get(String(floor._id)) ?? [];

      nodes.push(
        nodeOf(
          floorId,
          'OTHER',
          floor.name,
          floor.code,
          column,
          1,
          LEVEL_COLOURS.floor,
          'OK',
          [{ id: `${floorId}-count`, label: 'Объект', value: String(floorObjects.length), unit: null }],
          null,
        ),
      );
      edges.push(edgeOf(buildingId, floorId, true));

      floorObjects.forEach((object, index) => {
        const objectId = `o-${String(object._id)}`;
        const assessment = object.latestAssessment;

        nodes.push(
          nodeOf(
            objectId,
            CATEGORY_TO_KIND[object.category],
            object.name,
            object.code,
            column + index,
            2,
            LEVEL_COLOURS.object,
            // A decommissioned object reads as offline whatever its last score was.
            object.status === 'DECOMMISSIONED'
              ? 'OFFLINE'
              : assessment
                ? RISK_TO_STATUS[assessment.riskLevel]
                : 'MAINTENANCE',
            assessment
              ? [
                  {
                    id: `${objectId}-score`,
                    label: RISK_LEVEL_LABELS[assessment.riskLevel],
                    value: `${assessment.score}`,
                    unit: '%',
                  },
                ]
              : [{ id: `${objectId}-score`, label: 'Үнэлгээ', value: 'Үнэлгээгүй', unit: null }],
            String(object._id),
          ),
        );
        edges.push(edgeOf(floorId, objectId, true));
      });

      column += Math.max(1, floorObjects.length);
    }

    nodes.push(
      nodeOf(
        buildingId,
        'SUBSTATION',
        building.name,
        building.code,
        buildingColumn,
        0,
        LEVEL_COLOURS.building,
        'OK',
        [{ id: `${buildingId}-floors`, label: 'Давхар', value: String(buildingFloors.length), unit: null }],
        null,
      ),
    );

    // A building with no floors still occupies a column, so the next one does not overlap.
    if (buildingFloors.length === 0) column += 1;
  }

  /**
   * Electrical relations on top of containment.
   *
   * A circuit belongs to a panel and equipment is fed by a circuit (section 11.4), which is
   * the connection an electrician actually reads. Drawn solid so it stands apart from the
   * dashed containment lines.
   *
   * A DEVICE MOUNTED IN A PANEL IS DRAWN, AND DRAWN DASHED. It appears as a node already —
   * it sits on a floor like anything else — but leaving it hanging off the floor alone
   * would show an RCD floating beside the panel it is bolted inside, which is the exact
   * confusion this whole edge was added to end. Dashed rather than solid because the line
   * already means "contains" everywhere else on this canvas and that is precisely what a
   * mount is: no current flows along it, and the legend must not be made to lie. A device
   * that is both mounted here and fed from a circuit gets both lines, which is the truth.
   */
  const presentObjects = new Set(objects.map((object) => `o-${String(object._id)}`));

  for (const object of objects) {
    const target = `o-${String(object._id)}`;

    const panelId = object.circuit?.panel;
    if (panelId && presentObjects.has(`o-${String(panelId)}`)) {
      edges.push(edgeOf(`o-${String(panelId)}`, target, false));
    }

    const circuitId = object.equipment?.circuit;
    if (circuitId && presentObjects.has(`o-${String(circuitId)}`)) {
      edges.push(edgeOf(`o-${String(circuitId)}`, target, false));
    }

    const mountPanelId = object.equipment?.panel;
    if (mountPanelId && presentObjects.has(`o-${String(mountPanelId)}`)) {
      edges.push(edgeOf(`o-${String(mountPanelId)}`, target, true));
    }
  }

  // The same pair can be linked by both containment and a feed; the feed wins, so the
  // fainter duplicate is dropped rather than drawn underneath.
  const seen = new Map<string, DiagramEdgeDto>();
  for (const edge of edges) {
    const key = `${edge.source}__${edge.target}`;
    const existing = seen.get(key);
    if (!existing || (existing.dashStyle === 'DASHED' && edge.dashStyle === 'SOLID')) {
      seen.set(key, edge);
    }
  }

  return {
    projectId,
    projectName: project.name,
    nodes,
    edges: [...seen.values()],
    buildingCount: buildings.length,
    floorCount: floors.length,
    objectCount: objects.length,
  };
}
