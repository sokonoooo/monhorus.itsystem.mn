import {
  DIAGRAM_ASSET_KIND_LABELS,
  DIAGRAM_HANDLES,
  DIAGRAM_NODE_STATUS_COLOURS,
  DIAGRAM_NODE_STATUS_LABELS,
  type DiagramAssetKind,
  type DiagramMetricDto,
  type DiagramNodeStatus,
} from '@monhorus/shared';
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react';
import { memo, type ReactElement } from 'react';

/** What the canvas stores on each node. */
export interface AssetNodeData extends Record<string, unknown> {
  assetKind: DiagramAssetKind;
  name: string;
  subtitle: string | null;
  icon: DiagramAssetKind;
  accentColour: string;
  status: DiagramNodeStatus;
  metrics: readonly DiagramMetricDto[];
  editable: boolean;
}

/**
 * Asset glyphs.
 *
 * Drawn rather than imported: an icon set would be another dependency for twelve shapes,
 * and these are schematic symbols rather than decorative icons.
 */
function AssetGlyph({ kind, colour }: { kind: DiagramAssetKind; colour: string }): ReactElement {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: colour,
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  switch (kind) {
    case 'PANEL':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="1.5" />
          <path d="M8 7h8M8 11h8M8 15h4" />
        </svg>
      );
    case 'TRANSFORMER':
      return (
        <svg {...common}>
          <circle cx="9" cy="12" r="5" />
          <circle cx="15" cy="12" r="5" />
        </svg>
      );
    case 'SUBSTATION':
      return (
        <svg {...common}>
          <path d="M4 20V9l8-5 8 5v11" />
          <path d="M9 20v-6h6v6" />
        </svg>
      );
    case 'METER':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 12l4-3" />
          <path d="M12 4v2M20 12h-2M12 20v-2M4 12h2" />
        </svg>
      );
    case 'PUMP':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M12 5v7l5 3" />
          <path d="M19 19l2 2" />
        </svg>
      );
    case 'SERVER':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="7" rx="1.5" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" />
          <path d="M7 7.5h.01M7 16.5h.01" />
        </svg>
      );
    case 'GENERATOR':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M13 7l-4 6h3l-1 4 4-6h-3z" />
        </svg>
      );
    case 'UPS':
      return (
        <svg {...common}>
          <rect x="3" y="6" width="15" height="12" rx="1.5" />
          <path d="M21 10v4" />
          <path d="M10 9l-2 3h3l-2 3" />
        </svg>
      );
    case 'MOTOR':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7" />
          <path d="M8 15V9l4 4 4-4v6" />
        </svg>
      );
    case 'BREAKER':
      return (
        <svg {...common}>
          <path d="M5 12h4M15 12h4" />
          <path d="M9 12l6-4" />
          <circle cx="9" cy="12" r="1.2" />
          <circle cx="15" cy="12" r="1.2" />
        </svg>
      );
    case 'SENSOR':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M6.5 6.5a8 8 0 000 11M17.5 6.5a8 8 0 010 11" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
        </svg>
      );
  }
}

const HANDLE_POSITIONS: Record<(typeof DIAGRAM_HANDLES)[number], Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
};

/**
 * One asset on the canvas.
 *
 * Each of the four sides carries a single handle that acts as both source and target, so
 * a connection can be drawn from any side to any side. Two overlapping handles per side
 * would be the alternative and would make the smaller one unclickable.
 */
function AssetNodeComponent({ data, selected }: NodeProps): ReactElement {
  const node = data as AssetNodeData;
  const statusColour = DIAGRAM_NODE_STATUS_COLOURS[node.status];

  return (
    <>
      {node.editable && (
        <NodeResizer
          isVisible={selected}
          minWidth={80}
          minHeight={48}
          lineClassName="!border-blue-500"
          handleClassName="!h-2 !w-2 !rounded-sm !border-white !bg-blue-500"
        />
      )}

      <div
        className={`flex h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-sm ring-1 transition-shadow ${
          selected ? 'ring-2 ring-blue-500' : 'ring-slate-300'
        }`}
        // The accent is a left bar rather than a fill, so the status colour beside it stays
        // readable whatever accent is chosen.
        style={{ borderLeft: `4px solid ${node.accentColour}` }}
      >
        <div className="flex items-start gap-2 px-2.5 pt-2">
          <span className="mt-0.5 shrink-0">
            <AssetGlyph kind={node.icon} colour={node.accentColour} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight text-slate-900">
              {node.name}
            </span>
            {node.subtitle && (
              <span className="block truncate text-[11px] leading-tight text-slate-500">
                {node.subtitle}
              </span>
            )}
          </span>
          <span
            className="mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium text-white"
            style={{ backgroundColor: statusColour }}
            title={DIAGRAM_NODE_STATUS_LABELS[node.status]}
          >
            {DIAGRAM_NODE_STATUS_LABELS[node.status]}
          </span>
        </div>

        {node.metrics.length > 0 && (
          <dl className="mt-1.5 flex-1 space-y-0.5 overflow-hidden px-2.5 pb-2">
            {node.metrics.map((metric) => (
              <div key={metric.id} className="flex items-baseline justify-between gap-2">
                <dt className="truncate text-[10px] text-slate-500">{metric.label}</dt>
                <dd className="shrink-0 text-[11px] font-medium tabular-nums text-slate-900">
                  {metric.value}
                  {metric.unit ? ` ${metric.unit}` : ''}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <span className="sr-only">
          {DIAGRAM_ASSET_KIND_LABELS[node.assetKind]} · {DIAGRAM_NODE_STATUS_LABELS[node.status]}
        </span>
      </div>

      {DIAGRAM_HANDLES.map((handle) => (
        <Handle
          key={handle}
          id={handle}
          type="source"
          position={HANDLE_POSITIONS[handle]}
          isConnectable={node.editable}
          className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 hover:!bg-blue-500"
        />
      ))}
    </>
  );
}

export const AssetNode = memo(AssetNodeComponent);
