import {
  DIAGRAM_DASH_ARRAYS,
  type DiagramDashStyle,
  type DiagramLineType,
} from '@monhorus/shared';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  getStraightPath,
  type EdgeProps,
} from '@xyflow/react';
import { memo, type ReactElement } from 'react';

export interface AssetEdgeData extends Record<string, unknown> {
  lineType: DiagramLineType;
  colour: string;
  thickness: number;
  dashStyle: DiagramDashStyle;
  animated: boolean;
  label: string | null;
}

/**
 * Line between two assets.
 *
 * Arrowheads are not drawn here: React Flow renders `markerStart` and `markerEnd` from
 * the edge object itself, so direction is expressed by which markers the canvas attaches
 * rather than by anything this component does.
 *
 * Animation is a local class rather than React Flow's built-in `animated` flag, because
 * that flag hardcodes its own dash pattern and would fight the chosen dash style.
 */
function AssetEdgeComponent({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerStart,
  markerEnd,
  data,
  selected,
}: EdgeProps): ReactElement {
  const edge = data as AssetEdgeData;
  const geometry = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  };

  const [path, labelX, labelY] =
    edge.lineType === 'STRAIGHT'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : edge.lineType === 'BEZIER'
        ? getBezierPath(geometry)
        : getSmoothStepPath({
            ...geometry,
            // STEP is the same routing with square corners.
            borderRadius: edge.lineType === 'STEP' ? 0 : 8,
          });

  const dashArray = DIAGRAM_DASH_ARRAYS[edge.dashStyle];

  return (
    <>
      <BaseEdge
        path={path}
        markerStart={markerStart}
        markerEnd={markerEnd}
        className={edge.animated ? 'monhorus-edge-flow' : undefined}
        style={{
          stroke: edge.colour,
          strokeWidth: selected ? edge.thickness + 1 : edge.thickness,
          ...(dashArray ? { strokeDasharray: dashArray } : {}),
          // A solid line cannot show motion, so animating one gets it a dash pattern.
          ...(edge.animated && !dashArray ? { strokeDasharray: '10 6' } : {}),
        }}
      />

      {edge.label && (
        <EdgeLabelRenderer>
          <div
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            className="pointer-events-none absolute rounded bg-white/95 px-1.5 py-0.5 text-[11px] font-medium text-slate-700 shadow-sm ring-1 ring-slate-200"
          >
            {edge.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const AssetEdge = memo(AssetEdgeComponent);
