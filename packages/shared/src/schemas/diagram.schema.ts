import { z } from 'zod';

import {
  DIAGRAM_ARROW_TYPES,
  DIAGRAM_ASSET_KINDS,
  DIAGRAM_DASH_STYLES,
  DIAGRAM_EDGE_DIRECTIONS,
  DIAGRAM_GRID_SIZES,
  DIAGRAM_HANDLES,
  DIAGRAM_LIMITS,
  DIAGRAM_LINE_TYPES,
  DIAGRAM_NODE_STATUSES,
  HEX_COLOUR_PATTERN,
} from '../constants/diagram';
import { objectIdSchema } from './common.schema';

const hexColour = z
  .string()
  .trim()
  .regex(HEX_COLOUR_PATTERN, 'Өнгө #rrggbb хэлбэртэй байна.');

/**
 * Client-generated element id.
 *
 * Nodes and edges are created on the canvas before anything is saved, and an edge has to
 * name its endpoints the moment it is drawn. Letting the client mint the id keeps a
 * drawing session from needing a round trip per element.
 */
const elementIdSchema = z
  .string()
  .trim()
  .min(1, 'ID заавал.')
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'ID зөвхөн үсэг, тоо, зураас агуулна.');

const finite = (label: string) =>
  z
    .number()
    .refine((value) => Number.isFinite(value), `${label} тоон утга байна.`);

export const diagramMetricSchema = z.object({
  id: elementIdSchema,
  label: z.string().trim().min(1, 'Үзүүлэлтийн нэр заавал.').max(60),
  value: z.string().trim().max(60),
  unit: z.string().trim().max(20).nullish(),
});

export const diagramNodeSchema = z.object({
  id: elementIdSchema,
  assetKind: z.enum(DIAGRAM_ASSET_KINDS),
  name: z.string().trim().min(1, 'Нэр заавал.').max(120),
  subtitle: z.string().trim().max(160).nullish(),
  icon: z.enum(DIAGRAM_ASSET_KINDS),
  position: z.object({ x: finite('X'), y: finite('Y') }),
  size: z.object({
    width: z
      .number()
      .min(DIAGRAM_LIMITS.nodeMinWidth)
      .max(DIAGRAM_LIMITS.nodeMaxWidth),
    height: z
      .number()
      .min(DIAGRAM_LIMITS.nodeMinHeight)
      .max(DIAGRAM_LIMITS.nodeMaxHeight),
  }),
  accentColour: hexColour,
  status: z.enum(DIAGRAM_NODE_STATUSES),
  metrics: z.array(diagramMetricSchema).max(DIAGRAM_LIMITS.maxMetricsPerNode).default([]),
  objectId: objectIdSchema.nullish(),
});

export const diagramEdgeSchema = z.object({
  id: elementIdSchema,
  source: elementIdSchema,
  sourceHandle: z.enum(DIAGRAM_HANDLES),
  target: elementIdSchema,
  targetHandle: z.enum(DIAGRAM_HANDLES),
  direction: z.enum(DIAGRAM_EDGE_DIRECTIONS),
  arrowType: z.enum(DIAGRAM_ARROW_TYPES),
  lineType: z.enum(DIAGRAM_LINE_TYPES),
  colour: hexColour,
  thickness: z
    .number()
    .min(DIAGRAM_LIMITS.edgeMinThickness)
    .max(DIAGRAM_LIMITS.edgeMaxThickness),
  dashStyle: z.enum(DIAGRAM_DASH_STYLES),
  animated: z.boolean(),
  label: z.string().trim().max(120).nullish(),
});

export const diagramViewportSchema = z.object({
  x: finite('X'),
  y: finite('Y'),
  zoom: z.number().min(DIAGRAM_LIMITS.zoomMin).max(DIAGRAM_LIMITS.zoomMax),
});

export const diagramTimelineStepSchema = z.object({
  id: elementIdSchema,
  label: z.string().trim().min(1, 'Алхмын нэр заавал.').max(80),
  at: z.string().trim().max(40).nullish(),
  order: z.number().int().min(0).max(DIAGRAM_LIMITS.maxTimelineSteps),
  nodeStates: z
    .array(
      z.object({
        nodeId: elementIdSchema,
        status: z.enum(DIAGRAM_NODE_STATUSES).optional(),
        metrics: z.array(diagramMetricSchema).max(DIAGRAM_LIMITS.maxMetricsPerNode).optional(),
        accentColour: hexColour.optional(),
      }),
    )
    .max(DIAGRAM_LIMITS.maxNodes)
    .default([]),
  edgeStates: z
    .array(
      z.object({
        edgeId: elementIdSchema,
        colour: hexColour.optional(),
        animated: z.boolean().optional(),
        dashStyle: z.enum(DIAGRAM_DASH_STYLES).optional(),
        label: z.string().trim().max(120).nullish(),
      }),
    )
    .max(DIAGRAM_LIMITS.maxEdges)
    .default([]),
});

/**
 * Referential integrity for the whole document.
 *
 * An edge naming a node that does not exist, or a timeline step naming a deleted node,
 * would render as an invisible dangling element rather than as an error, so both are
 * rejected here instead of being cleaned up silently.
 */
function checkReferences(
  value: {
    nodes: { id: string }[];
    edges: { id: string; source: string; target: string }[];
    timeline?: { nodeStates: { nodeId: string }[]; edgeStates: { edgeId: string }[] }[];
  },
  ctx: z.RefinementCtx,
): void {
  const nodeIds = new Set(value.nodes.map((node) => node.id));
  if (nodeIds.size !== value.nodes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['nodes'],
      message: 'Node ID давхардсан байна.',
    });
  }

  const edgeIds = new Set(value.edges.map((edge) => edge.id));
  if (edgeIds.size !== value.edges.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['edges'],
      message: 'Edge ID давхардсан байна.',
    });
  }

  value.edges.forEach((edge, index) => {
    if (!nodeIds.has(edge.source)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', index, 'source'],
        message: 'Эхлэх node олдсонгүй.',
      });
    }
    if (!nodeIds.has(edge.target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['edges', index, 'target'],
        message: 'Дуусах node олдсонгүй.',
      });
    }
  });

  (value.timeline ?? []).forEach((step, stepIndex) => {
    step.nodeStates.forEach((state, index) => {
      if (!nodeIds.has(state.nodeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timeline', stepIndex, 'nodeStates', index, 'nodeId'],
          message: 'Node олдсонгүй.',
        });
      }
    });
    step.edgeStates.forEach((state, index) => {
      if (!edgeIds.has(state.edgeId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['timeline', stepIndex, 'edgeStates', index, 'edgeId'],
          message: 'Edge олдсонгүй.',
        });
      }
    });
  });
}

const diagramBody = {
  name: z.string().trim().min(1, 'Нэр заавал.').max(120),
  description: z.string().trim().max(1000).nullish(),
  nodes: z.array(diagramNodeSchema).max(DIAGRAM_LIMITS.maxNodes).default([]),
  edges: z.array(diagramEdgeSchema).max(DIAGRAM_LIMITS.maxEdges).default([]),
  viewport: diagramViewportSchema.default({ x: 0, y: 0, zoom: 1 }),
  gridSize: z
    .number()
    .int()
    .refine(
      (value) => (DIAGRAM_GRID_SIZES as readonly number[]).includes(value),
      'Сүлжээний алхам буруу.',
    )
    .default(16),
  snapToGrid: z.boolean().default(true),
  timeline: z.array(diagramTimelineStepSchema).max(DIAGRAM_LIMITS.maxTimelineSteps).default([]),
  activeStepId: elementIdSchema.nullish(),
};

export const createDiagramSchema = z.object(diagramBody).superRefine(checkReferences);

/** Save is a whole-document replace: the canvas is edited as one thing. */
export const updateDiagramSchema = z.object(diagramBody).superRefine(checkReferences);

/** Pan and zoom fire constantly, so they get their own tiny endpoint. */
export const updateDiagramViewportSchema = z.object({ viewport: diagramViewportSchema });

/** Switching the shown step must not rewrite the node array. */
export const setActiveStepSchema = z.object({ activeStepId: elementIdSchema.nullable() });

export type DiagramNodeInput = z.infer<typeof diagramNodeSchema>;
export type DiagramEdgeInput = z.infer<typeof diagramEdgeSchema>;
export type DiagramTimelineStepInput = z.infer<typeof diagramTimelineStepSchema>;
export type CreateDiagramInput = z.infer<typeof createDiagramSchema>;
export type UpdateDiagramInput = z.infer<typeof updateDiagramSchema>;
export type UpdateDiagramViewportInput = z.infer<typeof updateDiagramViewportSchema>;
export type SetActiveStepInput = z.infer<typeof setActiveStepSchema>;
