import {
  DIAGRAM_DEFAULT_ACCENT,
  DIAGRAM_DEFAULT_EDGE_COLOUR,
  type DiagramDto,
  type DiagramEdgeDto,
  type DiagramNodeDto,
  type DiagramTimelineStepDto,
} from '@monhorus/shared';
import { MarkerType, type Edge, type Node } from '@xyflow/react';

import type { AssetEdgeData } from './AssetEdge';
import type { AssetNodeData } from './AssetNode';

export type AssetFlowNode = Node<AssetNodeData, 'asset'>;
export type AssetFlowEdge = Edge<AssetEdgeData, 'asset'>;

/**
 * Applies a timeline step to the authored elements.
 *
 * The step carries only the fields it overrides, so anything it leaves out keeps the
 * authored value. Nothing is written back: this is a view of the same document under a
 * different operating state, which is why it needs no version storage.
 */
export function applyTimelineStep(
  nodes: readonly DiagramNodeDto[],
  edges: readonly DiagramEdgeDto[],
  step: DiagramTimelineStepDto | null,
): { nodes: DiagramNodeDto[]; edges: DiagramEdgeDto[] } {
  if (!step) return { nodes: [...nodes], edges: [...edges] };

  const nodeOverrides = new Map(step.nodeStates.map((state) => [state.nodeId, state]));
  const edgeOverrides = new Map(step.edgeStates.map((state) => [state.edgeId, state]));

  return {
    nodes: nodes.map((node) => {
      const override = nodeOverrides.get(node.id);
      if (!override) return node;
      return {
        ...node,
        ...(override.status ? { status: override.status } : {}),
        ...(override.metrics ? { metrics: override.metrics } : {}),
        ...(override.accentColour ? { accentColour: override.accentColour } : {}),
      };
    }),
    edges: edges.map((edge) => {
      const override = edgeOverrides.get(edge.id);
      if (!override) return edge;
      return {
        ...edge,
        ...(override.colour ? { colour: override.colour } : {}),
        ...(override.animated === undefined ? {} : { animated: override.animated }),
        ...(override.dashStyle ? { dashStyle: override.dashStyle } : {}),
        ...(override.label === undefined ? {} : { label: override.label }),
      };
    }),
  };
}

export function toFlowNode(node: DiagramNodeDto, editable: boolean): AssetFlowNode {
  return {
    id: node.id,
    type: 'asset',
    position: node.position,
    width: node.size.width,
    height: node.size.height,
    // Resizing is a node capability, so it is disabled by taking away the drag rather than
    // by hiding the handles and leaving the node movable.
    draggable: editable,
    selectable: true,
    data: {
      assetKind: node.assetKind,
      name: node.name,
      subtitle: node.subtitle,
      icon: node.icon,
      accentColour: node.accentColour,
      status: node.status,
      metrics: node.metrics,
      editable,
    },
  };
}

/** Direction decides which end carries a marker; the arrow type decides its shape. */
function markersFor(edge: DiagramEdgeDto): {
  markerStart?: { type: MarkerType; color: string };
  markerEnd?: { type: MarkerType; color: string };
} {
  const marker = {
    type: edge.arrowType === 'ARROW' ? MarkerType.Arrow : MarkerType.ArrowClosed,
    color: edge.colour,
  };

  switch (edge.direction) {
    case 'FORWARD':
      return { markerEnd: marker };
    case 'BACKWARD':
      return { markerStart: marker };
    case 'BOTH':
      return { markerStart: marker, markerEnd: marker };
    default:
      return {};
  }
}

export function toFlowEdge(edge: DiagramEdgeDto): AssetFlowEdge {
  return {
    id: edge.id,
    type: 'asset',
    source: edge.source,
    sourceHandle: edge.sourceHandle,
    target: edge.target,
    targetHandle: edge.targetHandle,
    selectable: true,
    // React Flow's own `animated` stays off: the dash animation is applied by the edge
    // component so it composes with the chosen dash style.
    animated: false,
    ...markersFor(edge),
    data: {
      lineType: edge.lineType,
      colour: edge.colour,
      thickness: edge.thickness,
      dashStyle: edge.dashStyle,
      animated: edge.animated,
      label: edge.label,
    },
  };
}

/** A new node, positioned where the user dropped it. */
export function newNode(
  id: string,
  assetKind: DiagramNodeDto['assetKind'],
  position: { x: number; y: number },
): DiagramNodeDto {
  return {
    id,
    assetKind,
    name: 'Шинэ объект',
    subtitle: null,
    icon: assetKind,
    position,
    size: { width: 200, height: 96 },
    accentColour: DIAGRAM_DEFAULT_ACCENT,
    status: 'OK',
    metrics: [],
    objectId: null,
  };
}

export function newEdge(
  id: string,
  source: string,
  sourceHandle: DiagramEdgeDto['sourceHandle'],
  target: string,
  targetHandle: DiagramEdgeDto['targetHandle'],
): DiagramEdgeDto {
  return {
    id,
    source,
    sourceHandle,
    target,
    targetHandle,
    direction: 'FORWARD',
    arrowType: 'ARROW_CLOSED',
    lineType: 'SMOOTHSTEP',
    colour: DIAGRAM_DEFAULT_EDGE_COLOUR,
    thickness: 2,
    dashStyle: 'SOLID',
    animated: false,
    label: null,
  };
}

/**
 * Element ids are minted on the client.
 *
 * An edge has to name its endpoints the instant it is drawn, so waiting for the server to
 * assign an id would mean a round trip in the middle of a drag.
 */
export function makeElementId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/** An empty canvas, used when the dashboard has no diagram yet. */
export function emptyDiagram(name: string): Omit<DiagramDto, 'id' | 'createdAt' | 'updatedAt' | 'updatedByName'> {
  return {
    name,
    description: null,
    nodes: [],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    gridSize: 16,
    snapToGrid: true,
    timeline: [],
    activeStepId: null,
  };
}
