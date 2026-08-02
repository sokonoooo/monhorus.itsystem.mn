import type { DiagramEdgeDto, DiagramNodeDto, DiagramTimelineStepDto } from '@monhorus/shared';
import { MarkerType } from '@xyflow/react';
import { describe, expect, it } from 'vitest';

import { applyTimelineStep, makeElementId, toFlowEdge, toFlowNode } from './diagram-mapping';

function node(overrides: Partial<DiagramNodeDto> = {}): DiagramNodeDto {
  return {
    id: 'n1',
    assetKind: 'PANEL',
    name: 'Үндсэн самбар',
    subtitle: 'MDB-01',
    icon: 'PANEL',
    position: { x: 0, y: 0 },
    size: { width: 200, height: 96 },
    accentColour: '#2563eb',
    status: 'OK',
    metrics: [{ id: 'm1', label: 'Ачаалал', value: '6.16', unit: 'kW' }],
    objectId: null,
    ...overrides,
  };
}

function edge(overrides: Partial<DiagramEdgeDto> = {}): DiagramEdgeDto {
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
    animated: false,
    label: null,
    ...overrides,
  };
}

function step(overrides: Partial<DiagramTimelineStepDto> = {}): DiagramTimelineStepDto {
  return {
    id: 's1',
    label: 'Гэмтэл',
    at: '09:00',
    order: 0,
    nodeStates: [],
    edgeStates: [],
    ...overrides,
  };
}

describe('applyTimelineStep', () => {
  it('returns the authored state when no step is active', () => {
    const result = applyTimelineStep([node()], [edge()], null);

    expect(result.nodes[0]?.status).toBe('OK');
    expect(result.edges[0]?.animated).toBe(false);
  });

  it('overrides only the fields the step carries', () => {
    const result = applyTimelineStep(
      [node()],
      [edge()],
      step({ nodeStates: [{ nodeId: 'n1', status: 'FAULT' }] }),
    );

    expect(result.nodes[0]?.status).toBe('FAULT');
    // Untouched fields keep their authored values.
    expect(result.nodes[0]?.name).toBe('Үндсэн самбар');
    expect(result.nodes[0]?.accentColour).toBe('#2563eb');
    expect(result.nodes[0]?.metrics).toHaveLength(1);
  });

  it('replaces metrics when the step supplies them', () => {
    const result = applyTimelineStep(
      [node()],
      [edge()],
      step({
        nodeStates: [
          { nodeId: 'n1', metrics: [{ id: 'm9', label: 'Ачаалал', value: '0', unit: 'kW' }] },
        ],
      }),
    );

    expect(result.nodes[0]?.metrics).toEqual([
      { id: 'm9', label: 'Ачаалал', value: '0', unit: 'kW' },
    ]);
  });

  it('overrides edge animation and colour', () => {
    const result = applyTimelineStep(
      [node()],
      [edge()],
      step({ edgeStates: [{ edgeId: 'e1', animated: true, colour: '#dc2626' }] }),
    );

    expect(result.edges[0]?.animated).toBe(true);
    expect(result.edges[0]?.colour).toBe('#dc2626');
  });

  /** `false` and `null` are meaningful overrides and must not be treated as absent. */
  it('honours an override that turns animation off', () => {
    const result = applyTimelineStep(
      [node()],
      [edge({ animated: true })],
      step({ edgeStates: [{ edgeId: 'e1', animated: false }] }),
    );

    expect(result.edges[0]?.animated).toBe(false);
  });

  it('honours an override that clears the label', () => {
    const result = applyTimelineStep(
      [node()],
      [edge({ label: 'L1' })],
      step({ edgeStates: [{ edgeId: 'e1', label: null }] }),
    );

    expect(result.edges[0]?.label).toBeNull();
  });

  /** Applying a step must never mutate the authored elements. */
  it('leaves the authored elements untouched', () => {
    const authored = node();
    applyTimelineStep([authored], [edge()], step({ nodeStates: [{ nodeId: 'n1', status: 'FAULT' }] }));

    expect(authored.status).toBe('OK');
  });

  it('ignores a step entry for an element that is not there', () => {
    const result = applyTimelineStep(
      [node()],
      [edge()],
      step({ nodeStates: [{ nodeId: 'ghost', status: 'FAULT' }] }),
    );

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]?.status).toBe('OK');
  });
});

describe('toFlowEdge markers', () => {
  it('puts a marker on the far end for a forward edge', () => {
    const flow = toFlowEdge(edge({ direction: 'FORWARD' }));

    expect(flow.markerEnd).toEqual({ type: MarkerType.ArrowClosed, color: '#64748b' });
    expect(flow.markerStart).toBeUndefined();
  });

  it('puts a marker on the near end for a backward edge', () => {
    const flow = toFlowEdge(edge({ direction: 'BACKWARD' }));

    expect(flow.markerStart).toBeDefined();
    expect(flow.markerEnd).toBeUndefined();
  });

  it('puts a marker on both ends for a bidirectional edge', () => {
    const flow = toFlowEdge(edge({ direction: 'BOTH' }));

    expect(flow.markerStart).toBeDefined();
    expect(flow.markerEnd).toBeDefined();
  });

  it('draws no marker at all when there is no direction', () => {
    const flow = toFlowEdge(edge({ direction: 'NONE' }));

    expect(flow.markerStart).toBeUndefined();
    expect(flow.markerEnd).toBeUndefined();
  });

  it('uses the open arrow when that shape is chosen', () => {
    const flow = toFlowEdge(edge({ arrowType: 'ARROW' }));

    expect(flow.markerEnd).toEqual({ type: MarkerType.Arrow, color: '#64748b' });
  });

  /** The dash animation is ours, so React Flow's own flag must stay off or the two fight. */
  it('never sets React Flow own animated flag', () => {
    const flow = toFlowEdge(edge({ animated: true }));

    expect(flow.animated).toBe(false);
    expect(flow.data?.animated).toBe(true);
  });

  it('carries the handles so a connection keeps the side it was drawn from', () => {
    const flow = toFlowEdge(edge({ sourceHandle: 'left', targetHandle: 'right' }));

    expect(flow.sourceHandle).toBe('left');
    expect(flow.targetHandle).toBe('right');
  });
});

describe('toFlowNode', () => {
  it('carries the stored size onto the canvas node', () => {
    const flow = toFlowNode(node({ size: { width: 260, height: 140 } }), true);

    expect(flow.width).toBe(260);
    expect(flow.height).toBe(140);
  });

  it('is draggable only when the caller may edit', () => {
    expect(toFlowNode(node(), true).draggable).toBe(true);
    expect(toFlowNode(node(), false).draggable).toBe(false);
  });

  /** A read-only viewer still selects nodes, because the sidebar shows their properties. */
  it('stays selectable when read-only', () => {
    expect(toFlowNode(node(), false).selectable).toBe(true);
  });
});

describe('makeElementId', () => {
  it('mints unique prefixed ids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => makeElementId('n')));

    expect(ids.size).toBe(200);
    expect([...ids].every((id) => id.startsWith('n-'))).toBe(true);
  });

  /** The API only accepts letters, digits, dashes and underscores. */
  it('mints ids the API will accept', () => {
    expect(makeElementId('e')).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
