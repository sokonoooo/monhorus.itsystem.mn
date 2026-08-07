import type { ObjectIcon, PlanPositionDto, RiskLevel } from '@monhorus/shared';
import {
  ReactFlow,
  ReactFlowProvider,
  ViewportPortal,
  useReactFlow,
  useStore,
  type NodeChange,
  type NodeProps,
  type Node as FlowNode,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';

import { Button } from '../../components/ui/Button';
import { RISK_SURFACE_STYLES } from '../../components/ui/DomainBadges';
import {
  planSizeForAspect,
  toCanvasPoint,
  toPlanPosition,
  type PlanSize,
} from './plan-geometry';
import { ObjectTypeGlyph, objectIconLabel } from './plan-icons';

/** One drawn object. `position` is the drafted one while an edit is in flight. */
export interface PlanMarker {
  id: string;
  code: string;
  name: string;
  icon: ObjectIcon | null;
  /**
   * The type's custom SVG as an already-fetched object url, or null for the built-in glyph.
   *
   * Resolved by the panel rather than here: the download route is authenticated, and one
   * icon shared by forty markers must cost one request, not forty.
   */
  iconUrl: string | null;
  typeName: string | null;
  riskLevel: RiskLevel | 'UNASSESSED';
  position: PlanPositionDto;
}

/**
 * "Take me to this marker."
 *
 * A request rather than an id, because asking twice for the same marker is a real thing to
 * ask: a user searches, looks away, pans off, and searches the same code again. `seq` is
 * what makes the second ask a new one; the id alone would be unchanged and the canvas would
 * sit still.
 */
export interface PlanFocusRequest {
  objectId: string;
  seq: number;
}

export interface FloorPlanCanvasProps {
  /** Object URL of the already-authenticated plan image. */
  imageUrl: string;
  imageAlt: string;
  markers: readonly PlanMarker[];
  /** Positions may be dragged. Off by default; the plan is a picture until asked. */
  editing: boolean;
  selectedId: string | null;
  onSelect: (objectId: string | null) => void;
  /** Fired continuously while a marker is dragged, so the move is drafted live. */
  onMarkerMove: (objectId: string, position: PlanPositionDto) => void;
  /** A click on bare plan, in plan coordinates. Not fired outside the drawing. */
  onPlanClick?: (position: PlanPositionDto) => void;
  /** Centre the view on one marker. Ignored for a marker that is not drawn. */
  focus?: PlanFocusRequest | null;
  height?: number;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;

/**
 * How close the view comes when it is sent to a marker.
 *
 * Above `LABEL_MIN_ZOOM`, so the marker the user asked for arrives with its code showing
 * rather than as one more anonymous dot. Treated as a floor rather than a setting: a view
 * already closer than this is left where it is, because being sent to a marker should never
 * pull the plan back out from under someone who had zoomed in on purpose.
 */
export const PLAN_FOCUS_ZOOM = 1.5;

/** Long enough to read as travel between two places, short enough not to be waited on. */
export const PLAN_FOCUS_DURATION_MS = 300;

/**
 * Below this the codes come off.
 *
 * A plan zoomed out to fit a whole floor is a field of dots, and forty codes drawn over it
 * at full size is unreadable noise. The code never becomes unreachable: it is the marker's
 * accessible name and its tooltip at every zoom, and the selected marker always shows it.
 */
const LABEL_MIN_ZOOM = 0.9;

interface MarkerNodeData extends Record<string, unknown> {
  marker: PlanMarker;
  selected: boolean;
  editing: boolean;
}

type MarkerFlowNode = FlowNode<MarkerNodeData, 'planMarker'>;

/**
 * A pin, drawn at a constant size whatever the zoom.
 *
 * This is the whole trick of the canvas. Everything inside the viewport is scaled by the
 * zoom factor `z`, so the marker undoes it with `scale(1/z)`; a pin is a pin at any
 * magnification, and only the drawing under it grows. The order of the two transforms is
 * load-bearing — `scale()` first, then `translate(-50%,-50%)` — because that makes the
 * centring offset a fraction of the marker's *rendered* size rather than of a box that the
 * zoom has already stretched, which is what keeps the point of the pin nailed to its
 * coordinate as you zoom.
 *
 * The node wrapper React Flow puts around this is a single unit across, so what can be
 * clicked is the visible marker rather than an invisible square left behind wherever the
 * zoom stretched the untransformed box to.
 */
function MarkerNode({ data }: NodeProps<MarkerFlowNode>): ReactElement {
  const zoom = useStore((state) => state.transform[2]);
  const { marker, selected, editing } = data;
  const label = `${marker.code} · ${marker.name}`;
  const showCode = selected || zoom >= LABEL_MIN_ZOOM;

  return (
    <div
      className="absolute left-0 top-0"
      style={{
        transform: `scale(${1 / zoom}) translate(-50%, -50%)`,
        transformOrigin: '0 0',
      }}
    >
      <button
        type="button"
        aria-label={label}
        title={
          marker.typeName ? `${label} · ${objectIconLabel(marker.icon)}` : label
        }
        aria-pressed={selected}
        /*
          Selection is handled one level up, on the node, because that is also what tells
          React Flow the marker takes pointer events at all. The button is here for what a
          button is for: a focus stop and a name, so the plan can be read with a keyboard.
        */
        className={`flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-1 text-[10px] font-semibold shadow-sm ring-2 ring-inset ${
          RISK_SURFACE_STYLES[marker.riskLevel]
        } ${
          selected ? 'outline outline-2 outline-offset-2 outline-blue-500' : ''
        } ${editing ? 'cursor-move' : 'cursor-pointer'}`}
      >
        {/*
          Custom or built-in, the icon is drawn at one fixed size inside a marker the
          transform above has already taken the zoom back out of, so an uploaded icon is
          the same size on screen as a glyph at every magnification.
        */}
        <ObjectTypeGlyph icon={marker.icon} iconUrl={marker.iconUrl} />
        {showCode && <span>{marker.code}</span>}
      </button>
    </div>
  );
}

const NODE_TYPES = { planMarker: MarkerNode };

function CanvasInner({
  imageUrl,
  imageAlt,
  markers,
  editing,
  selectedId,
  onSelect,
  onMarkerMove,
  onPlanClick,
  focus = null,
  height = 520,
}: FloorPlanCanvasProps): ReactElement {
  const { fitBounds, getZoom, screenToFlowPosition, setCenter, zoomIn, zoomOut } = useReactFlow();
  const containerWidth = useStore((state) => state.width);
  const containerHeight = useStore((state) => state.height);

  /**
   * The drawing's box in canvas units.
   *
   * Held as the picture's aspect rather than its pixel size: the plan record carries no
   * dimensions, so the only source is the decoded image, and until it decodes a marker
   * still has to be drawn somewhere.
   */
  const [planSize, setPlanSize] = useState<PlanSize>(() =>
    planSizeForAspect(Number.NaN),
  );

  /**
   * Idempotent on purpose: the same picture must not produce a state change.
   *
   * `planSizeForAspect` builds a fresh object every call, and this runs from the
   * image's ref callback — which React invokes on EVERY render, not once. A cached
   * picture reports `complete` immediately, so an unconditional `setPlanSize` here
   * made every render schedule the next one: "Maximum update depth exceeded", and a
   * blank page behind an error boundary. Returning the current value when nothing
   * moved lets React bail out of the re-render entirely.
   *
   * jsdom sets neither `complete` nor `naturalWidth`, which is why the whole suite
   * passed while the page could not render at all in a browser.
   */
  const handleImageLoad = useCallback((image: HTMLImageElement): void => {
    if (image.naturalWidth <= 0 || image.naturalHeight <= 0) return;
    const next = planSizeForAspect(image.naturalWidth / image.naturalHeight);
    setPlanSize((current) =>
      current.width === next.width && current.height === next.height ? current : next,
    );
  }, []);

  /**
   * Stable, so the ref detaches and reattaches only when the element really changes.
   * An inline arrow here is re-created every render, which is what made the loop
   * above reachable in the first place.
   */
  const imageRef = useCallback(
    (node: HTMLImageElement | null): void => {
      // A picture the browser already holds may be complete before React attaches
      // the handler, and then no load event ever comes.
      if (node?.complete) handleImageLoad(node);
    },
    [handleImageLoad],
  );

  const fitPlan = useCallback((): void => {
    if (containerWidth === 0 || containerHeight === 0) return;
    void fitBounds(
      { x: 0, y: 0, width: planSize.width, height: planSize.height },
      { padding: 0.06, duration: 0 },
    );
  }, [fitBounds, containerWidth, containerHeight, planSize]);

  /**
   * Fit once per drawing, not on every resize.
   *
   * Refitting whenever the container changed size would throw away a zoom the user had
   * just set, so the fit is keyed: it runs when the canvas is first measured, and again
   * when the image reports a shape different from the one assumed, because at that moment
   * every marker moves and whatever was on screen is no longer what the user framed.
   */
  const fittedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (containerWidth === 0 || containerHeight === 0) return;
    const key = `${imageUrl}|${planSize.height}`;
    if (fittedKeyRef.current === key) return;
    fittedKeyRef.current = key;
    fitPlan();
  }, [containerWidth, containerHeight, imageUrl, planSize, fitPlan]);

  /**
   * Sends the view to one marker.
   *
   * Keyed on the request's sequence rather than on the marker, so it fires once per ask and
   * not again when the drawing re-renders around it — a marker being dragged, or a layer
   * being switched on, must not yank the view back. A request naming a marker that is not
   * drawn does nothing at all: there is no coordinate to travel to, and the caller is the
   * one that knows why it is missing.
   */
  const servedFocusRef = useRef<number | null>(null);
  useEffect(() => {
    if (!focus || servedFocusRef.current === focus.seq) return;
    const marker = markers.find((entry) => entry.id === focus.objectId);
    if (!marker) return;
    servedFocusRef.current = focus.seq;
    const point = toCanvasPoint(marker.position, planSize);
    void setCenter(point.x, point.y, {
      zoom: Math.max(getZoom(), PLAN_FOCUS_ZOOM),
      duration: PLAN_FOCUS_DURATION_MS,
    });
  }, [focus, markers, planSize, setCenter, getZoom]);

  const nodes = useMemo<MarkerFlowNode[]>(
    () =>
      markers.map((marker) => ({
        id: marker.id,
        type: 'planMarker' as const,
        position: toCanvasPoint(marker.position, planSize),
        /*
          A wrapper of one unit, sitting exactly on the coordinate.

          The pin itself is drawn out of this box by transform, at a size the zoom cannot
          change, so the box must not be the pin's size — a box that stayed at the drawing's
          scale would leave an invisible square to click wherever the zoom had stretched it
          to. One unit rather than none because a node measuring nothing is treated as one
          that has not been laid out yet, and hidden. What remains is a speck at the very
          point the marker is centred on, inside the visible pin.
        */
        width: 1,
        height: 1,
        // Above the drawing, which sits at the floor of the viewport's stack.
        zIndex: 10,
        draggable: editing,
        data: {
          marker,
          selected: selectedId === marker.id,
          editing,
        },
      })),
    [markers, planSize, editing, selectedId],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<MarkerFlowNode>[]): void => {
      if (!editing) return;
      for (const change of changes) {
        if (change.type !== 'position' || !change.position) continue;
        onMarkerMove(change.id, toPlanPosition(change.position, planSize));
      }
    },
    [editing, onMarkerMove, planSize],
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void zoomIn()}>
          Томруулах
        </Button>
        <Button variant="secondary" size="sm" onClick={() => void zoomOut()}>
          Жижигрүүлэх
        </Button>
        <Button variant="secondary" size="sm" onClick={fitPlan}>
          Дэлгэцэд багтаах
        </Button>
        <p className="text-xs text-slate-500">
          Дугуй мушгиж томруулна, чирж хөдөлгөнө.
        </p>
      </div>

      <div
        className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
        style={{ height }}
      >
        <ReactFlow<MarkerFlowNode>
          nodes={nodes}
          edges={[]}
          nodeTypes={NODE_TYPES}
          onNodesChange={handleNodesChange}
          onNodeClick={(_event, node) => onSelect(node.id)}
          onPaneClick={(event) => {
            if (!onPlanClick) return;
            const point = screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            // A click on the mat around the drawing is not a spot on the plan.
            if (
              point.x < 0 ||
              point.y < 0 ||
              point.x > planSize.width ||
              point.y > planSize.height
            ) {
              onSelect(null);
              return;
            }
            onPlanClick(toPlanPosition(point, planSize));
          }}
          nodesDraggable={editing}
          /*
            No dead zone before a drag begins: the marker follows the pointer from the
            first pixel, which is the whole point of a live preview. React Flow's default
            waits a pixel before it starts, and that reads as the pin sticking.
          */
          nodeDragThreshold={0}
          nodesConnectable={false}
          elementsSelectable={false}
          selectNodesOnDrag={false}
          // A marker cannot be dragged off the drawing it belongs to.
          nodeExtent={[
            [0, 0],
            [planSize.width, planSize.height],
          ]}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          proOptions={{ hideAttribution: false }}
        >
          {/*
            The drawing itself, laid into the viewport rather than made a node: it is the
            surface everything else is placed on, never a thing to select or drag. It takes
            no pointer events at all, so a press anywhere on it reaches the pane underneath
            and pans, and the browser rescales the original image on zoom — nothing is
            resampled through a canvas, so it stays as sharp as the file allows.
          */}
          <ViewportPortal>
            <div
              className="pointer-events-none absolute left-0 top-0 select-none"
              style={{ width: planSize.width, height: planSize.height, zIndex: 0 }}
            >
              <img
                src={imageUrl}
                alt={imageAlt}
                draggable={false}
                // Both: the ref covers a picture already in cache, `onLoad` covers
                // one still arriving. Both paths are idempotent.
                ref={imageRef}
                onLoad={(event) => handleImageLoad(event.currentTarget)}
                className="block h-full w-full"
              />
            </div>
          </ViewportPortal>
        </ReactFlow>
      </div>
    </div>
  );
}

/** React Flow needs its provider in scope for `useReactFlow`. */
export function FloorPlanCanvas(props: FloorPlanCanvasProps): ReactElement {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
