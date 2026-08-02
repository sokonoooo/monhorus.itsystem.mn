import {
  DIAGRAM_ASSET_KINDS,
  DIAGRAM_ASSET_KIND_LABELS,
  DIAGRAM_GRID_SIZES,
  DIAGRAM_NODE_STATUS_COLOURS,
  type DiagramAssetKind,
  type DiagramEdgeDto,
  type DiagramNodeDto,
  type DiagramTimelineStepDto,
  type DiagramViewportDto,
} from '@monhorus/shared';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type OnSelectionChangeParams,
  type Viewport,
} from '@xyflow/react';
import { useCallback, useMemo, useState, type ReactElement } from 'react';

import { Button } from '../../components/ui/Button';
import { COMPACT_SELECT, FILTER_SELECT } from '../../components/ui/control-styles';
import { AssetEdge } from './AssetEdge';
import { AssetNode, type AssetNodeData } from './AssetNode';
import { PropertiesSidebar } from './PropertiesSidebar';
import { TimelineBar } from './TimelineBar';
import {
  applyTimelineStep,
  makeElementId,
  newEdge,
  newNode,
  toFlowEdge,
  toFlowNode,
  type AssetFlowNode,
} from './diagram-mapping';

const NODE_TYPES = { asset: AssetNode };
const EDGE_TYPES = { asset: AssetEdge };

export interface DiagramCanvasState {
  nodes: readonly DiagramNodeDto[];
  edges: readonly DiagramEdgeDto[];
  viewport: DiagramViewportDto;
  gridSize: number;
  snapToGrid: boolean;
  timeline: readonly DiagramTimelineStepDto[];
  activeStepId: string | null;
}

export interface DiagramCanvasProps {
  state: DiagramCanvasState;
  editable: boolean;
  onChange: (patch: Partial<DiagramCanvasState>) => void;
  /** Fired for pan and zoom only, so the host can persist it separately. */
  onViewportChange?: (viewport: DiagramViewportDto) => void;
  height?: number;
}

/** Snaps a value to the nearest grid line. */
function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

function CanvasInner({
  state,
  editable,
  onChange,
  onViewportChange,
  height = 560,
}: DiagramCanvasProps): ReactElement {
  const { screenToFlowPosition } = useReactFlow();
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  /**
   * What the canvas actually draws.
   *
   * The authored elements with the active timeline step applied over them. The step is
   * never written back into `state`, so switching steps cannot damage the diagram.
   */
  const displayed = useMemo(() => {
    const step = state.timeline.find((entry) => entry.id === state.activeStepId) ?? null;
    return applyTimelineStep(state.nodes, state.edges, step);
  }, [state.nodes, state.edges, state.timeline, state.activeStepId]);

  const flowNodes = useMemo(
    () => displayed.nodes.map((node) => toFlowNode(node, editable)),
    [displayed.nodes, editable],
  );
  const flowEdges = useMemo(
    () => displayed.edges.map((edge) => toFlowEdge(edge)),
    [displayed.edges],
  );

  const selectedNode = state.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = state.edges.find((edge) => edge.id === selectedEdgeId) ?? null;

  /**
   * Position and size changes come back through React Flow's change stream.
   *
   * Only drag and resize are taken from it; selection is handled separately, and removal
   * goes through the sidebar so a stray keypress cannot silently delete work.
   */
  const handleNodesChange = useCallback(
    (changes: NodeChange[]): void => {
      if (!editable) return;

      let nodes = [...state.nodes];
      let touched = false;

      for (const change of changes) {
        if (change.type === 'position' && change.position) {
          const index = nodes.findIndex((node) => node.id === change.id);
          if (index < 0) continue;
          const position = state.snapToGrid
            ? {
                x: snap(change.position.x, state.gridSize),
                y: snap(change.position.y, state.gridSize),
              }
            : change.position;
          nodes[index] = { ...nodes[index]!, position };
          touched = true;
        }

        if (change.type === 'dimensions' && change.dimensions) {
          const index = nodes.findIndex((node) => node.id === change.id);
          if (index < 0) continue;
          nodes[index] = {
            ...nodes[index]!,
            size: {
              width: Math.round(change.dimensions.width),
              height: Math.round(change.dimensions.height),
            },
          };
          touched = true;
        }
      }

      if (touched) onChange({ nodes });
    },
    [editable, state.nodes, state.snapToGrid, state.gridSize, onChange],
  );

  const handleEdgesChange = useCallback(
    (_changes: EdgeChange[]): void => {
      // Edge geometry is derived from its endpoints, so nothing in the change stream
      // needs storing. Deletion is an explicit action in the sidebar.
    },
    [],
  );

  const handleConnect = useCallback(
    (connection: Connection): void => {
      if (!editable || !connection.source || !connection.target) return;
      // A node connected to itself renders as a loop with no meaning on a single-line
      // diagram, so it is refused rather than drawn.
      if (connection.source === connection.target) return;

      onChange({
        edges: [
          ...state.edges,
          newEdge(
            makeElementId('e'),
            connection.source,
            (connection.sourceHandle ?? 'right') as DiagramEdgeDto['sourceHandle'],
            connection.target,
            (connection.targetHandle ?? 'left') as DiagramEdgeDto['targetHandle'],
          ),
        ],
      });
    },
    [editable, state.edges, onChange],
  );

  const handleSelectionChange = useCallback((params: OnSelectionChangeParams): void => {
    const node = params.nodes[0];
    const edge = params.edges[0];
    setSelectedNodeId(node ? node.id : null);
    setSelectedEdgeId(!node && edge ? edge.id : null);
  }, []);

  function addNode(assetKind: DiagramAssetKind): void {
    // Dropped into the middle of the visible canvas rather than at the origin, which may
    // be off screen after panning.
    const centre = screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const position = state.snapToGrid
      ? { x: snap(centre.x, state.gridSize), y: snap(centre.y, state.gridSize) }
      : centre;

    const node = newNode(makeElementId('n'), assetKind, position);
    onChange({ nodes: [...state.nodes, node] });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }

  function patchNode(patch: Partial<DiagramNodeDto>): void {
    if (!selectedNode) return;
    onChange({
      nodes: state.nodes.map((node) =>
        node.id === selectedNode.id ? { ...node, ...patch } : node,
      ),
    });
  }

  function patchEdge(patch: Partial<DiagramEdgeDto>): void {
    if (!selectedEdge) return;
    onChange({
      edges: state.edges.map((edge) =>
        edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
      ),
    });
  }

  function deleteSelectedNode(): void {
    if (!selectedNode) return;
    onChange({
      nodes: state.nodes.filter((node) => node.id !== selectedNode.id),
      // Edges to a removed node would dangle, and the API rejects that, so they go too.
      edges: state.edges.filter(
        (edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id,
      ),
      timeline: state.timeline.map((step) => ({
        ...step,
        nodeStates: step.nodeStates.filter((entry) => entry.nodeId !== selectedNode.id),
      })),
    });
    setSelectedNodeId(null);
  }

  function deleteSelectedEdge(): void {
    if (!selectedEdge) return;
    onChange({
      edges: state.edges.filter((edge) => edge.id !== selectedEdge.id),
      timeline: state.timeline.map((step) => ({
        ...step,
        edgeStates: step.edgeStates.filter((entry) => entry.edgeId !== selectedEdge.id),
      })),
    });
    setSelectedEdgeId(null);
  }

  /** Aligns the selected node's row or column mates to it. */
  function alignSelection(axis: 'x' | 'y'): void {
    if (!editable || !selectedNode) return;
    const anchor = selectedNode.position[axis];
    const tolerance = 60;

    onChange({
      nodes: state.nodes.map((node) =>
        Math.abs(node.position[axis] - anchor) <= tolerance
          ? { ...node, position: { ...node.position, [axis]: anchor } }
          : node,
      ),
    });
  }

  function addTimelineStep(): void {
    const step: DiagramTimelineStepDto = {
      id: makeElementId('s'),
      label: `Алхам ${state.timeline.length + 1}`,
      at: null,
      order: state.timeline.length,
      // Seeded from what is on screen now, so a step starts as a copy of the current
      // state rather than as an empty override nobody can see the effect of.
      nodeStates: displayed.nodes.map((node) => ({
        nodeId: node.id,
        status: node.status,
        metrics: node.metrics,
      })),
      edgeStates: displayed.edges.map((edge) => ({
        edgeId: edge.id,
        animated: edge.animated,
        colour: edge.colour,
      })),
    };
    onChange({ timeline: [...state.timeline, step], activeStepId: step.id });
  }

  function removeTimelineStep(stepId: string): void {
    const timeline = state.timeline
      .filter((step) => step.id !== stepId)
      .map((step, index) => ({ ...step, order: index }));
    onChange({
      timeline,
      activeStepId: state.activeStepId === stepId ? null : state.activeStepId,
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {editable && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
          <label htmlFor="add-asset" className="text-xs font-medium text-slate-600">
            Объект нэмэх
          </label>
          <select
            id="add-asset"
            value=""
            onChange={(event) => {
              if (event.target.value) addNode(event.target.value as DiagramAssetKind);
              event.target.value = '';
            }}
            className={FILTER_SELECT}
          >
            <option value="">Сонгох…</option>
            {DIAGRAM_ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DIAGRAM_ASSET_KIND_LABELS[kind]}
              </option>
            ))}
          </select>

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />

          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={state.snapToGrid}
              onChange={(event) => onChange({ snapToGrid: event.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-300"
            />
            Сүлжээнд таллах
          </label>

          <select
            value={state.gridSize}
            onChange={(event) => onChange({ gridSize: Number(event.target.value) })}
            aria-label="Сүлжээний алхам"
            className={COMPACT_SELECT}
          >
            {DIAGRAM_GRID_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}px
              </option>
            ))}
          </select>

          <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden="true" />

          <Button
            variant="secondary"
            size="sm"
            onClick={() => alignSelection('x')}
            disabled={!selectedNode}
          >
            Босоо тэгшлэх
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => alignSelection('y')}
            disabled={!selectedNode}
          >
            Хэвтээ тэгшлэх
          </Button>
        </div>
      )}

      <div className="flex" style={{ height }}>
        <div className="min-w-0 flex-1">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            edgeTypes={EDGE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onSelectionChange={handleSelectionChange}
            onMoveEnd={(_event, viewport: Viewport) => onViewportChange?.(viewport)}
            defaultViewport={state.viewport}
            snapToGrid={state.snapToGrid}
            snapGrid={[state.gridSize, state.gridSize]}
            // Loose mode lets any of the four handles act as both source and target, so a
            // connection can run from any side to any side with one handle per side.
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={editable}
            nodesConnectable={editable}
            elementsSelectable
            minZoom={0.1}
            maxZoom={4}
            proOptions={{ hideAttribution: false }}
          >
            <Background variant={BackgroundVariant.Dots} gap={state.gridSize} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable
              zoomable
              nodeColor={(node) =>
                DIAGRAM_NODE_STATUS_COLOURS[(node as AssetFlowNode).data?.status ?? 'OK']
              }
              className="!bg-slate-50"
            />
          </ReactFlow>
        </div>

        <PropertiesSidebar
          node={selectedNode}
          edge={selectedEdge}
          editable={editable}
          onNodeChange={patchNode}
          onEdgeChange={patchEdge}
          onDeleteNode={deleteSelectedNode}
          onDeleteEdge={deleteSelectedEdge}
          onClose={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
        />
      </div>

      <TimelineBar
        steps={state.timeline}
        activeStepId={state.activeStepId}
        editable={editable}
        onSelect={(activeStepId) => onChange({ activeStepId })}
        onAddStep={addTimelineStep}
        onRemoveStep={removeTimelineStep}
      />
    </div>
  );
}

/** React Flow needs its provider in scope for `useReactFlow`. */
export function DiagramCanvas(props: DiagramCanvasProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}

export type { AssetNodeData };
