import type {
  CreateDiagramInput,
  DiagramDto,
  DiagramEdgeDto,
  DiagramListItemDto,
  DiagramNodeDto,
  DiagramTimelineStepDto,
  SetActiveStepInput,
  UpdateDiagramInput,
  UpdateDiagramViewportInput,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { AppError } from '../../common/errors/app-error';
import { ERROR_CODES } from '../../common/errors/error-codes';
import type { AuthContext } from '../../common/types/express';
import type { RequestMeta } from '../../common/utils/request-meta.util';
import { recordAudit } from '../audit/audit.service';
import {
  Diagram,
  type IDiagram,
  type IDiagramEdge,
  type IDiagramNode,
  type IDiagramTimelineStep,
} from './diagram.model';

type WithId<T> = T & { _id: Types.ObjectId };

const ENTITY = 'Diagram';

function toNodeDto(node: IDiagramNode): DiagramNodeDto {
  return {
    id: node.id,
    assetKind: node.assetKind,
    name: node.name,
    subtitle: node.subtitle,
    icon: node.icon,
    position: { x: node.position.x, y: node.position.y },
    size: { width: node.size.width, height: node.size.height },
    accentColour: node.accentColour,
    status: node.status,
    metrics: node.metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      unit: metric.unit,
    })),
    objectId: node.object ? String(node.object) : null,
  };
}

function toEdgeDto(edge: IDiagramEdge): DiagramEdgeDto {
  return {
    id: edge.id,
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    direction: edge.direction,
    arrowType: edge.arrowType,
    lineType: edge.lineType,
    colour: edge.colour,
    thickness: edge.thickness,
    dashStyle: edge.dashStyle,
    animated: edge.animated,
    label: edge.label,
  };
}

function toStepDto(step: IDiagramTimelineStep): DiagramTimelineStepDto {
  return {
    id: step.id,
    label: step.label,
    at: step.at,
    order: step.order,
    nodeStates: step.nodeStates.map((state) => ({
      nodeId: state.nodeId,
      ...(state.status ? { status: state.status } : {}),
      ...(state.metrics ? { metrics: state.metrics } : {}),
      ...(state.accentColour ? { accentColour: state.accentColour } : {}),
    })),
    edgeStates: step.edgeStates.map((state) => ({
      edgeId: state.edgeId,
      ...(state.colour ? { colour: state.colour } : {}),
      ...(state.animated === undefined ? {} : { animated: state.animated }),
      ...(state.dashStyle ? { dashStyle: state.dashStyle } : {}),
      ...(state.label === undefined ? {} : { label: state.label }),
    })),
  };
}

export function toDiagramDto(diagram: WithId<IDiagram>): DiagramDto {
  return {
    id: String(diagram._id),
    name: diagram.name,
    description: diagram.description,
    nodes: diagram.nodes.map(toNodeDto),
    edges: diagram.edges.map(toEdgeDto),
    viewport: diagram.viewport,
    gridSize: diagram.gridSize,
    snapToGrid: diagram.snapToGrid,
    // Sorted here so every client renders the same order without having to sort.
    timeline: [...diagram.timeline].sort((a, b) => a.order - b.order).map(toStepDto),
    activeStepId: diagram.activeStepId,
    updatedByName: diagram.updatedByName,
    createdAt: diagram.createdAt.toISOString(),
    updatedAt: diagram.updatedAt.toISOString(),
  };
}

function toListItemDto(diagram: WithId<IDiagram>): DiagramListItemDto {
  return {
    id: String(diagram._id),
    name: diagram.name,
    description: diagram.description,
    nodeCount: diagram.nodes.length,
    edgeCount: diagram.edges.length,
    timelineStepCount: diagram.timeline.length,
    updatedByName: diagram.updatedByName,
    updatedAt: diagram.updatedAt.toISOString(),
  };
}

function actorOf(actor: AuthContext): {
  id: string;
  role: AuthContext['role'];
  label: string | null;
} {
  return { id: actor.userId, role: actor.role, label: actor.fullName ?? null };
}

/** Maps the wire shape onto the stored shape; `objectId` becomes a real reference. */
function toStoredNodes(nodes: CreateDiagramInput['nodes']): IDiagramNode[] {
  return nodes.map((node) => ({
    id: node.id,
    assetKind: node.assetKind,
    name: node.name,
    subtitle: node.subtitle ?? null,
    icon: node.icon,
    position: node.position,
    size: node.size,
    accentColour: node.accentColour,
    status: node.status,
    metrics: node.metrics.map((metric) => ({
      id: metric.id,
      label: metric.label,
      value: metric.value,
      unit: metric.unit ?? null,
    })),
    object: node.objectId ? new Types.ObjectId(node.objectId) : null,
  }));
}

function toStoredEdges(edges: CreateDiagramInput['edges']): IDiagramEdge[] {
  return edges.map((edge) => ({ ...edge, label: edge.label ?? null }));
}

function toStoredTimeline(timeline: CreateDiagramInput['timeline']): IDiagramTimelineStep[] {
  return timeline.map((step) => ({
    id: step.id,
    label: step.label,
    at: step.at ?? null,
    order: step.order,
    nodeStates: step.nodeStates.map((state) => ({
      nodeId: state.nodeId,
      ...(state.status ? { status: state.status } : {}),
      ...(state.metrics
        ? { metrics: state.metrics.map((metric) => ({ ...metric, unit: metric.unit ?? null })) }
        : {}),
      ...(state.accentColour ? { accentColour: state.accentColour } : {}),
    })),
    edgeStates: step.edgeStates.map((state) => ({
      edgeId: state.edgeId,
      ...(state.colour ? { colour: state.colour } : {}),
      ...(state.animated === undefined ? {} : { animated: state.animated }),
      ...(state.dashStyle ? { dashStyle: state.dashStyle } : {}),
      ...(state.label === undefined ? {} : { label: state.label ?? null }),
    })),
  }));
}

/**
 * The active step must name a step that exists.
 *
 * A save that deletes the shown step would otherwise leave the diagram pointing at
 * nothing, which renders as the authored state with no indication why.
 */
function resolveActiveStep(
  requested: string | null | undefined,
  timeline: IDiagramTimelineStep[],
): string | null {
  if (!requested) return null;
  return timeline.some((step) => step.id === requested) ? requested : null;
}

export async function listDiagrams(): Promise<DiagramListItemDto[]> {
  const rows = await Diagram.find().sort({ updatedAt: -1 }).lean<WithId<IDiagram>[]>();
  return rows.map(toListItemDto);
}

export async function getDiagram(diagramId: string): Promise<DiagramDto> {
  const diagram = await Diagram.findById(diagramId).lean<WithId<IDiagram> | null>();
  if (!diagram) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Схем зураг олдсонгүй.');
  }
  return toDiagramDto(diagram);
}

/**
 * The dashboard's diagram.
 *
 * The dashboard shows one canvas, so it asks for "the" diagram rather than picking an id.
 * The most recently updated one is returned, and null when none has been drawn yet, so the
 * page can offer to start one instead of erroring.
 */
export async function getDashboardDiagram(): Promise<DiagramDto | null> {
  const diagram = await Diagram.findOne()
    .sort({ updatedAt: -1 })
    .lean<WithId<IDiagram> | null>();
  return diagram ? toDiagramDto(diagram) : null;
}

export async function createDiagram(
  input: CreateDiagramInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<DiagramDto> {
  const timeline = toStoredTimeline(input.timeline);

  const diagram = await Diagram.create({
    name: input.name,
    description: input.description ?? null,
    nodes: toStoredNodes(input.nodes),
    edges: toStoredEdges(input.edges),
    viewport: input.viewport,
    gridSize: input.gridSize,
    snapToGrid: input.snapToGrid,
    timeline,
    activeStepId: resolveActiveStep(input.activeStepId, timeline),
    createdBy: new Types.ObjectId(actor.userId),
    updatedBy: new Types.ObjectId(actor.userId),
    updatedByName: actor.fullName ?? null,
  });

  await recordAudit({
    entityType: ENTITY,
    entityId: diagram._id,
    action: 'Created',
    actor: actorOf(actor),
    meta,
    newValue: {
      name: diagram.name,
      nodes: diagram.nodes.length,
      edges: diagram.edges.length,
      timelineSteps: diagram.timeline.length,
    },
  });

  return getDiagram(String(diagram._id));
}

export async function updateDiagram(
  diagramId: string,
  input: UpdateDiagramInput,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<DiagramDto> {
  const existing = await Diagram.findById(diagramId);
  if (!existing) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Схем зураг олдсонгүй.');
  }

  const before = {
    name: existing.name,
    nodes: existing.nodes.length,
    edges: existing.edges.length,
    timelineSteps: existing.timeline.length,
  };

  const timeline = toStoredTimeline(input.timeline);

  existing.name = input.name;
  existing.description = input.description ?? null;
  existing.set('nodes', toStoredNodes(input.nodes));
  existing.set('edges', toStoredEdges(input.edges));
  existing.viewport = input.viewport;
  existing.gridSize = input.gridSize;
  existing.snapToGrid = input.snapToGrid;
  existing.set('timeline', timeline);
  existing.activeStepId = resolveActiveStep(input.activeStepId, timeline);
  existing.updatedBy = new Types.ObjectId(actor.userId);
  existing.updatedByName = actor.fullName ?? null;

  await existing.save();

  /**
   * The audit row records the shape of the change, never the diagram itself.
   *
   * Writing the node array into every audit entry would rebuild a version store by the
   * back door, which is exactly what this feature is required not to have.
   */
  await recordAudit({
    entityType: ENTITY,
    entityId: existing._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: before,
    newValue: {
      name: existing.name,
      nodes: existing.nodes.length,
      edges: existing.edges.length,
      timelineSteps: existing.timeline.length,
    },
  });

  return getDiagram(diagramId);
}

/**
 * Pan and zoom only.
 *
 * Kept off the main save path because it fires on every wheel tick: rewriting the node
 * array to remember a scroll position would be absurd, and it is not an audited event.
 */
export async function updateViewport(
  diagramId: string,
  input: UpdateDiagramViewportInput,
): Promise<DiagramDto> {
  const updated = await Diagram.findByIdAndUpdate(
    diagramId,
    { $set: { viewport: input.viewport } },
    { new: true },
  ).lean<WithId<IDiagram> | null>();

  if (!updated) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Схем зураг олдсонгүй.');
  }
  return toDiagramDto(updated);
}

/** Switching the shown timeline step. Structure is untouched. */
export async function setActiveStep(
  diagramId: string,
  input: SetActiveStepInput,
): Promise<DiagramDto> {
  const diagram = await Diagram.findById(diagramId);
  if (!diagram) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Схем зураг олдсонгүй.');
  }

  if (input.activeStepId && !diagram.timeline.some((step) => step.id === input.activeStepId)) {
    throw AppError.badRequest(ERROR_CODES.VALIDATION_ERROR, 'Timeline алхам олдсонгүй.', [
      { field: 'activeStepId', message: 'Алхам олдсонгүй.' },
    ]);
  }

  diagram.activeStepId = input.activeStepId;
  await diagram.save();

  return getDiagram(diagramId);
}

export async function deleteDiagram(
  diagramId: string,
  actor: AuthContext,
  meta: RequestMeta,
): Promise<void> {
  const diagram = await Diagram.findById(diagramId).lean<WithId<IDiagram> | null>();
  if (!diagram) {
    throw AppError.notFound(ERROR_CODES.NOT_FOUND, 'Схем зураг олдсонгүй.');
  }

  await Diagram.deleteOne({ _id: diagram._id });

  await recordAudit({
    entityType: ENTITY,
    entityId: diagram._id,
    action: 'Updated',
    actor: actorOf(actor),
    meta,
    oldValue: { name: diagram.name, nodes: diagram.nodes.length, edges: diagram.edges.length },
    newValue: null,
    reason: 'Схем зураг устгасан.',
  });
}
