import {
  DIAGRAM_ARROW_TYPES,
  DIAGRAM_ASSET_KINDS,
  DIAGRAM_DASH_STYLES,
  DIAGRAM_EDGE_DIRECTIONS,
  DIAGRAM_HANDLES,
  DIAGRAM_LINE_TYPES,
  DIAGRAM_NODE_STATUSES,
  type DiagramArrowType,
  type DiagramAssetKind,
  type DiagramDashStyle,
  type DiagramEdgeDirection,
  type DiagramHandle,
  type DiagramLineType,
  type DiagramNodeStatus,
} from '@monhorus/shared';
import { Schema, Types, model, type Model } from 'mongoose';

/**
 * Asset diagram.
 *
 * Nodes, edges and the timeline are embedded rather than split into collections: the
 * canvas is loaded and saved as one thing, so separate collections would buy nothing and
 * cost a multi-document write on every save. The limits enforced in the shared schema keep
 * a document far below the 16MB ceiling.
 *
 * There is deliberately **no** version chain, no `supersededBy` and no snapshot array. The
 * timeline holds authored operating states, not previous revisions: saving replaces the
 * document and the prior content is gone. Change is traceable through the audit log, which
 * records what changed rather than a copy of the diagram.
 */
export interface IDiagramMetric {
  id: string;
  label: string;
  value: string;
  unit: string | null;
}

export interface IDiagramNode {
  id: string;
  assetKind: DiagramAssetKind;
  name: string;
  subtitle: string | null;
  icon: DiagramAssetKind;
  position: { x: number; y: number };
  size: { width: number; height: number };
  accentColour: string;
  status: DiagramNodeStatus;
  metrics: IDiagramMetric[];
  object: Types.ObjectId | null;
}

export interface IDiagramEdge {
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

export interface IDiagramTimelineStep {
  id: string;
  label: string;
  at: string | null;
  order: number;
  nodeStates: {
    nodeId: string;
    status?: DiagramNodeStatus;
    metrics?: IDiagramMetric[];
    accentColour?: string;
  }[];
  edgeStates: {
    edgeId: string;
    colour?: string;
    animated?: boolean;
    dashStyle?: DiagramDashStyle;
    label?: string | null;
  }[];
}

export interface IDiagram {
  name: string;
  description: string | null;
  nodes: IDiagramNode[];
  edges: IDiagramEdge[];
  viewport: { x: number; y: number; zoom: number };
  gridSize: number;
  snapToGrid: boolean;
  timeline: IDiagramTimelineStep[];
  activeStepId: string | null;
  updatedBy: Types.ObjectId | null;
  updatedByName: string | null;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const metricSchema = new Schema<IDiagramMetric>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 60 },
    value: { type: String, default: '', maxlength: 60 },
    unit: { type: String, default: null, maxlength: 20 },
  },
  { _id: false },
);

const nodeSchema = new Schema<IDiagramNode>(
  {
    id: { type: String, required: true },
    assetKind: { type: String, enum: DIAGRAM_ASSET_KINDS, required: true },
    name: { type: String, required: true, maxlength: 120 },
    subtitle: { type: String, default: null, maxlength: 160 },
    icon: { type: String, enum: DIAGRAM_ASSET_KINDS, required: true },
    position: {
      x: { type: Number, required: true },
      y: { type: Number, required: true },
    },
    size: {
      width: { type: Number, required: true },
      height: { type: Number, required: true },
    },
    accentColour: { type: String, required: true },
    status: { type: String, enum: DIAGRAM_NODE_STATUSES, required: true },
    metrics: { type: [metricSchema], default: [] },
    // Optional by design: these nodes are authored, and nothing here requires a record.
    object: { type: Schema.Types.ObjectId, ref: 'Object', default: null },
  },
  { _id: false },
);

const edgeSchema = new Schema<IDiagramEdge>(
  {
    id: { type: String, required: true },
    source: { type: String, required: true },
    sourceHandle: { type: String, enum: DIAGRAM_HANDLES, required: true },
    target: { type: String, required: true },
    targetHandle: { type: String, enum: DIAGRAM_HANDLES, required: true },
    direction: { type: String, enum: DIAGRAM_EDGE_DIRECTIONS, required: true },
    arrowType: { type: String, enum: DIAGRAM_ARROW_TYPES, required: true },
    lineType: { type: String, enum: DIAGRAM_LINE_TYPES, required: true },
    colour: { type: String, required: true },
    thickness: { type: Number, required: true },
    dashStyle: { type: String, enum: DIAGRAM_DASH_STYLES, required: true },
    animated: { type: Boolean, default: false },
    label: { type: String, default: null, maxlength: 120 },
  },
  { _id: false },
);

const timelineStepSchema = new Schema<IDiagramTimelineStep>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true, maxlength: 80 },
    at: { type: String, default: null, maxlength: 40 },
    order: { type: Number, required: true },
    nodeStates: {
      type: [
        new Schema(
          {
            nodeId: { type: String, required: true },
            status: { type: String, enum: DIAGRAM_NODE_STATUSES },
            /**
             * `default: undefined` stops Mongoose auto-defaulting the array to `[]`.
             * A step that does not override the metrics must stay absent, otherwise it
             * becomes indistinguishable from one that deliberately clears them.
             */
            metrics: { type: [metricSchema], default: undefined },
            accentColour: { type: String },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    edgeStates: {
      type: [
        new Schema(
          {
            edgeId: { type: String, required: true },
            colour: { type: String },
            animated: { type: Boolean },
            dashStyle: { type: String, enum: DIAGRAM_DASH_STYLES },
            label: { type: String, maxlength: 120 },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const diagramSchema = new Schema<IDiagram>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: null, maxlength: 1000 },
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    viewport: {
      x: { type: Number, default: 0 },
      y: { type: Number, default: 0 },
      zoom: { type: Number, default: 1 },
    },
    gridSize: { type: Number, default: 16 },
    snapToGrid: { type: Boolean, default: true },
    timeline: { type: [timelineStepSchema], default: [] },
    activeStepId: { type: String, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedByName: { type: String, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

diagramSchema.index({ updatedAt: -1 });

export const Diagram: Model<IDiagram> = model<IDiagram>('Diagram', diagramSchema);
