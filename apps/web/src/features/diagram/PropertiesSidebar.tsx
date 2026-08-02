import {
  DIAGRAM_ARROW_TYPES,
  DIAGRAM_ARROW_TYPE_LABELS,
  DIAGRAM_ASSET_KINDS,
  DIAGRAM_ASSET_KIND_LABELS,
  DIAGRAM_DASH_STYLES,
  DIAGRAM_DASH_STYLE_LABELS,
  DIAGRAM_EDGE_DIRECTIONS,
  DIAGRAM_EDGE_DIRECTION_LABELS,
  DIAGRAM_LIMITS,
  DIAGRAM_LINE_TYPES,
  DIAGRAM_LINE_TYPE_LABELS,
  DIAGRAM_NODE_STATUSES,
  DIAGRAM_NODE_STATUS_LABELS,
  type DiagramAssetKind,
  type DiagramEdgeDto,
  type DiagramNodeDto,
} from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '../../components/ui/Button';
import { FIELD_INPUT, FIELD_SELECT, FILTER_LABEL } from '../../components/ui/control-styles';
import { makeElementId } from './diagram-mapping';

function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <label htmlFor={htmlFor} className={FILTER_LABEL}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function ColourField({
  label,
  id,
  value,
  onChange,
  disabled,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}): ReactElement {
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-slate-300 bg-white disabled:cursor-default"
        />
        {/* The hex is editable too: picking a brand colour by eye is hopeless. */}
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          aria-label={`${label} hex`}
          className={`${FIELD_INPUT} font-mono uppercase`}
        />
      </div>
    </Field>
  );
}

function NodePanel({
  node,
  onChange,
  onDelete,
  editable,
}: {
  node: DiagramNodeDto;
  onChange: (patch: Partial<DiagramNodeDto>) => void;
  onDelete: () => void;
  editable: boolean;
}): ReactElement {
  const metrics = node.metrics;

  return (
    <div className="space-y-3">
      <Field label="Нэр" htmlFor="node-name">
        <input
          id="node-name"
          value={node.name}
          onChange={(event) => onChange({ name: event.target.value })}
          disabled={!editable}
          className={FIELD_INPUT}
        />
      </Field>

      <Field label="Дэд гарчиг" htmlFor="node-subtitle">
        <input
          id="node-subtitle"
          value={node.subtitle ?? ''}
          onChange={(event) => onChange({ subtitle: event.target.value || null })}
          disabled={!editable}
          className={FIELD_INPUT}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Төрөл" htmlFor="node-kind">
          <select
            id="node-kind"
            value={node.assetKind}
            onChange={(event) => {
              const assetKind = event.target.value as DiagramAssetKind;
              // The icon follows the kind unless it was deliberately set to something
              // else, which is the behaviour people expect when switching type.
              onChange(
                node.icon === node.assetKind ? { assetKind, icon: assetKind } : { assetKind },
              );
            }}
            disabled={!editable}
            className={FIELD_SELECT}
          >
            {DIAGRAM_ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DIAGRAM_ASSET_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Дүрс" htmlFor="node-icon">
          <select
            id="node-icon"
            value={node.icon}
            onChange={(event) => onChange({ icon: event.target.value as DiagramAssetKind })}
            disabled={!editable}
            className={FIELD_SELECT}
          >
            {DIAGRAM_ASSET_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DIAGRAM_ASSET_KIND_LABELS[kind]}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Төлөв" htmlFor="node-status">
        <select
          id="node-status"
          value={node.status}
          onChange={(event) =>
            onChange({ status: event.target.value as DiagramNodeDto['status'] })
          }
          disabled={!editable}
          className={FIELD_SELECT}
        >
          {DIAGRAM_NODE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {DIAGRAM_NODE_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </Field>

      <ColourField
        label="Өнгө"
        id="node-accent"
        value={node.accentColour}
        onChange={(accentColour) => onChange({ accentColour })}
        disabled={!editable}
      />

      <div className="grid grid-cols-2 gap-2">
        <Field label="Өргөн" htmlFor="node-width">
          <input
            id="node-width"
            type="number"
            min={DIAGRAM_LIMITS.nodeMinWidth}
            max={DIAGRAM_LIMITS.nodeMaxWidth}
            value={Math.round(node.size.width)}
            onChange={(event) =>
              onChange({ size: { ...node.size, width: Number(event.target.value) } })
            }
            disabled={!editable}
            className={FIELD_INPUT}
          />
        </Field>
        <Field label="Өндөр" htmlFor="node-height">
          <input
            id="node-height"
            type="number"
            min={DIAGRAM_LIMITS.nodeMinHeight}
            max={DIAGRAM_LIMITS.nodeMaxHeight}
            value={Math.round(node.size.height)}
            onChange={(event) =>
              onChange({ size: { ...node.size, height: Number(event.target.value) } })
            }
            disabled={!editable}
            className={FIELD_INPUT}
          />
        </Field>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-600">Үзүүлэлт</span>
          {editable && metrics.length < DIAGRAM_LIMITS.maxMetricsPerNode && (
            <button
              type="button"
              onClick={() =>
                onChange({
                  metrics: [
                    ...metrics,
                    { id: makeElementId('m'), label: 'Үзүүлэлт', value: '', unit: null },
                  ],
                })
              }
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Нэмэх
            </button>
          )}
        </div>

        {metrics.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
            Үзүүлэлт нэмээгүй байна.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {metrics.map((metric, index) => (
              <li key={metric.id} className="grid grid-cols-[1fr_70px_50px_auto] gap-1">
                <input
                  value={metric.label}
                  onChange={(event) =>
                    onChange({
                      metrics: metrics.map((entry, position) =>
                        position === index ? { ...entry, label: event.target.value } : entry,
                      ),
                    })
                  }
                  disabled={!editable}
                  aria-label={`Үзүүлэлт ${index + 1} нэр`}
                  className={`${FIELD_INPUT} !px-1.5 !py-1 !text-xs`}
                />
                <input
                  value={metric.value}
                  onChange={(event) =>
                    onChange({
                      metrics: metrics.map((entry, position) =>
                        position === index ? { ...entry, value: event.target.value } : entry,
                      ),
                    })
                  }
                  disabled={!editable}
                  aria-label={`Үзүүлэлт ${index + 1} утга`}
                  className={`${FIELD_INPUT} !px-1.5 !py-1 !text-xs`}
                />
                <input
                  value={metric.unit ?? ''}
                  onChange={(event) =>
                    onChange({
                      metrics: metrics.map((entry, position) =>
                        position === index
                          ? { ...entry, unit: event.target.value || null }
                          : entry,
                      ),
                    })
                  }
                  disabled={!editable}
                  aria-label={`Үзүүлэлт ${index + 1} нэгж`}
                  className={`${FIELD_INPUT} !px-1.5 !py-1 !text-xs`}
                />
                {editable && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({ metrics: metrics.filter((_, position) => position !== index) })
                    }
                    aria-label={`Үзүүлэлт ${index + 1} устгах`}
                    className="rounded px-1 text-xs text-slate-500 hover:bg-slate-100"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {editable && (
        <div className="border-t border-slate-200 pt-3">
          <Button variant="danger" size="sm" onClick={onDelete}>
            Объект устгах
          </Button>
        </div>
      )}
    </div>
  );
}

function EdgePanel({
  edge,
  onChange,
  onDelete,
  editable,
}: {
  edge: DiagramEdgeDto;
  onChange: (patch: Partial<DiagramEdgeDto>) => void;
  onDelete: () => void;
  editable: boolean;
}): ReactElement {
  return (
    <div className="space-y-3">
      <Field label="Шошго" htmlFor="edge-label">
        <input
          id="edge-label"
          value={edge.label ?? ''}
          onChange={(event) => onChange({ label: event.target.value || null })}
          disabled={!editable}
          className={FIELD_INPUT}
        />
      </Field>

      <Field label="Чиглэл" htmlFor="edge-direction">
        <select
          id="edge-direction"
          value={edge.direction}
          onChange={(event) =>
            onChange({ direction: event.target.value as DiagramEdgeDto['direction'] })
          }
          disabled={!editable}
          className={FIELD_SELECT}
        >
          {DIAGRAM_EDGE_DIRECTIONS.map((direction) => (
            <option key={direction} value={direction}>
              {DIAGRAM_EDGE_DIRECTION_LABELS[direction]}
            </option>
          ))}
        </select>
      </Field>

      <Field
        label="Сумны хэлбэр"
        htmlFor="edge-arrow"
        hint={edge.direction === 'NONE' ? 'Чиглэл сонгосон үед идэвхжинэ.' : undefined}
      >
        <select
          id="edge-arrow"
          value={edge.arrowType}
          onChange={(event) =>
            onChange({ arrowType: event.target.value as DiagramEdgeDto['arrowType'] })
          }
          disabled={!editable || edge.direction === 'NONE'}
          className={FIELD_SELECT}
        >
          {DIAGRAM_ARROW_TYPES.map((type) => (
            <option key={type} value={type}>
              {DIAGRAM_ARROW_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Шугамын хэлбэр" htmlFor="edge-line">
        <select
          id="edge-line"
          value={edge.lineType}
          onChange={(event) =>
            onChange({ lineType: event.target.value as DiagramEdgeDto['lineType'] })
          }
          disabled={!editable}
          className={FIELD_SELECT}
        >
          {DIAGRAM_LINE_TYPES.map((type) => (
            <option key={type} value={type}>
              {DIAGRAM_LINE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </Field>

      <ColourField
        label="Өнгө"
        id="edge-colour"
        value={edge.colour}
        onChange={(colour) => onChange({ colour })}
        disabled={!editable}
      />

      <Field label={`Зузаан (${edge.thickness}px)`} htmlFor="edge-thickness">
        <input
          id="edge-thickness"
          type="range"
          min={DIAGRAM_LIMITS.edgeMinThickness}
          max={DIAGRAM_LIMITS.edgeMaxThickness}
          step={1}
          value={edge.thickness}
          onChange={(event) => onChange({ thickness: Number(event.target.value) })}
          disabled={!editable}
          className="w-full"
        />
      </Field>

      <Field label="Тасархай хэлбэр" htmlFor="edge-dash">
        <select
          id="edge-dash"
          value={edge.dashStyle}
          onChange={(event) =>
            onChange({ dashStyle: event.target.value as DiagramEdgeDto['dashStyle'] })
          }
          disabled={!editable}
          className={FIELD_SELECT}
        >
          {DIAGRAM_DASH_STYLES.map((style) => (
            <option key={style} value={style}>
              {DIAGRAM_DASH_STYLE_LABELS[style]}
            </option>
          ))}
        </select>
      </Field>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          checked={edge.animated}
          onChange={(event) => onChange({ animated: event.target.checked })}
          disabled={!editable}
          className="h-4 w-4 rounded border-slate-300"
        />
        Хөдөлгөөнтэй
      </label>

      {editable && (
        <div className="border-t border-slate-200 pt-3">
          <Button variant="danger" size="sm" onClick={onDelete}>
            Холбоос устгах
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Properties of whatever is selected.
 *
 * Every control writes straight through to the canvas state, so the diagram updates as
 * the field changes rather than on a save button. Persisting is a separate, explicit act.
 */
export function PropertiesSidebar({
  node,
  edge,
  editable,
  onNodeChange,
  onEdgeChange,
  onDeleteNode,
  onDeleteEdge,
  onClose,
}: {
  node: DiagramNodeDto | null;
  edge: DiagramEdgeDto | null;
  editable: boolean;
  onNodeChange: (patch: Partial<DiagramNodeDto>) => void;
  onEdgeChange: (patch: Partial<DiagramEdgeDto>) => void;
  onDeleteNode: () => void;
  onDeleteEdge: () => void;
  onClose: () => void;
}): ReactElement | null {
  if (!node && !edge) return null;

  return (
    <aside
      aria-label="Шинж чанар"
      className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white"
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2.5">
        <h3 className="text-sm font-semibold text-slate-900">
          {node ? 'Объектын шинж чанар' : 'Холбоосын шинж чанар'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Хаах"
          className="rounded p-1 text-slate-500 hover:bg-slate-100"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {!editable && (
          <p className="mb-3 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-500">
            Зөвхөн харах эрхтэй тул засах боломжгүй.
          </p>
        )}
        {node && (
          <NodePanel
            node={node}
            onChange={onNodeChange}
            onDelete={onDeleteNode}
            editable={editable}
          />
        )}
        {edge && (
          <EdgePanel
            edge={edge}
            onChange={onEdgeChange}
            onDelete={onDeleteEdge}
            editable={editable}
          />
        )}
      </div>
    </aside>
  );
}
