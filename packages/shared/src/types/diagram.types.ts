import type {
  DiagramArrowType,
  DiagramAssetKind,
  DiagramDashStyle,
  DiagramEdgeDirection,
  DiagramHandle,
  DiagramLineType,
  DiagramNodeStatus,
} from '../constants/diagram';

/** One reading shown on a node, for example "Ачаалал 6.16 kW". */
export interface DiagramMetricDto {
  id: string;
  label: string;
  value: string;
  unit: string | null;
}

export interface DiagramNodeDto {
  id: string;
  assetKind: DiagramAssetKind;
  name: string;
  subtitle: string | null;
  /** Glyph key; the renderer maps it to a shape. */
  icon: DiagramAssetKind;
  position: { x: number; y: number };
  size: { width: number; height: number };
  /** `#rrggbb`. Styling only, never an assessment result. */
  accentColour: string;
  status: DiagramNodeStatus;
  metrics: readonly DiagramMetricDto[];
  /**
   * Optional link to a real asset record.
   *
   * Nothing requires it: these nodes are authored. It exists so a node can be pointed at
   * its master record later without a migration.
   */
  objectId: string | null;
}

export interface DiagramEdgeDto {
  id: string;
  source: string;
  sourceHandle: DiagramHandle;
  target: string;
  targetHandle: DiagramHandle;
  direction: DiagramEdgeDirection;
  arrowType: DiagramArrowType;
  lineType: DiagramLineType;
  colour: string;
  thickness: number;
  dashStyle: DiagramDashStyle;
  animated: boolean;
  label: string | null;
}

export interface DiagramViewportDto {
  x: number;
  y: number;
  zoom: number;
}

/** Per-node overrides a timeline step applies. Absent fields leave the node as authored. */
export interface DiagramTimelineNodeStateDto {
  nodeId: string;
  status?: DiagramNodeStatus;
  metrics?: readonly DiagramMetricDto[];
  accentColour?: string;
}

export interface DiagramTimelineEdgeStateDto {
  edgeId: string;
  colour?: string;
  animated?: boolean;
  dashStyle?: DiagramDashStyle;
  label?: string | null;
}

/**
 * One authored point on the timeline.
 *
 * `at` is a label, not a version stamp: it orders the steps and names them for the reader.
 * Nothing about the diagram's structure is stored here, so a step is not a snapshot and
 * discarding one loses no history.
 */
export interface DiagramTimelineStepDto {
  id: string;
  label: string;
  at: string | null;
  order: number;
  nodeStates: readonly DiagramTimelineNodeStateDto[];
  edgeStates: readonly DiagramTimelineEdgeStateDto[];
}

export interface DiagramDto {
  id: string;
  name: string;
  description: string | null;
  nodes: readonly DiagramNodeDto[];
  edges: readonly DiagramEdgeDto[];
  viewport: DiagramViewportDto;
  gridSize: number;
  snapToGrid: boolean;
  timeline: readonly DiagramTimelineStepDto[];
  /** The step shown when the diagram loads. Null means the authored state. */
  activeStepId: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiagramListItemDto {
  id: string;
  name: string;
  description: string | null;
  nodeCount: number;
  edgeCount: number;
  timelineStepCount: number;
  updatedByName: string | null;
  updatedAt: string;
}

/**
 * A project's objects as a graph, generated from the records.
 *
 * Reuses the diagram node and edge shapes so one canvas renders both the authored
 * dashboard diagram and this derived view. Nothing here is stored: it is rebuilt on every
 * request and therefore cannot drift from the data or need versioning.
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
