import {
  PERMISSIONS,
  type DiagramDto,
  type UpdateDiagramInput,
} from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { diagramService } from '../../services/diagram.service';
import { DiagramCanvas, type DiagramCanvasState } from './DiagramCanvas';

/** The canvas state, stripped of the server-owned fields. */
function toCanvasState(diagram: DiagramDto): DiagramCanvasState {
  return {
    nodes: diagram.nodes,
    edges: diagram.edges,
    viewport: diagram.viewport,
    gridSize: diagram.gridSize,
    snapToGrid: diagram.snapToGrid,
    timeline: diagram.timeline,
    activeStepId: diagram.activeStepId,
  };
}

function toSavePayload(name: string, state: DiagramCanvasState): UpdateDiagramInput {
  return {
    name,
    description: null,
    nodes: state.nodes.map((node) => ({ ...node, metrics: [...node.metrics] })),
    edges: [...state.edges],
    viewport: state.viewport,
    gridSize: state.gridSize,
    snapToGrid: state.snapToGrid,
    timeline: state.timeline.map((step) => ({
      ...step,
      nodeStates: step.nodeStates.map((entry) => ({
        ...entry,
        ...(entry.metrics ? { metrics: [...entry.metrics] } : {}),
      })),
      edgeStates: [...step.edgeStates],
    })),
    activeStepId: state.activeStepId,
  } as UpdateDiagramInput;
}

/**
 * The dashboard's asset diagram.
 *
 * Saving is explicit rather than automatic: the canvas changes on every drag, and a save
 * per drag would write hundreds of times a minute. Pan and zoom are the exception, since
 * they go to their own endpoint and never touch the node array.
 */
export function DashboardDiagramPanel(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();

  const canEdit = can(PERMISSIONS.DIAGRAM_MANAGE);

  const [diagram, setDiagram] = useState<DiagramDto | null>(null);
  const [state, setState] = useState<DiagramCanvasState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const viewportTimer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    diagramService
      .dashboard()
      .then((result) => {
        if (cancelled) return;
        setDiagram(result);
        setState(result ? toCanvasState(result) : null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Схем ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (viewportTimer.current !== null) window.clearTimeout(viewportTimer.current);
    };
  }, []);

  const handleChange = useCallback((patch: Partial<DiagramCanvasState>): void => {
    setState((current) => (current ? { ...current, ...patch } : current));
    setDirty(true);
  }, []);

  /**
   * Pan and zoom persist on their own, debounced.
   *
   * They fire continuously and are not worth marking the diagram dirty over: losing a
   * scroll position costs nothing, losing an edit costs work.
   */
  const handleViewportChange = useCallback(
    (viewport: DiagramCanvasState['viewport']): void => {
      setState((current) => (current ? { ...current, viewport } : current));
      if (!diagram || !canEdit) return;

      if (viewportTimer.current !== null) window.clearTimeout(viewportTimer.current);
      viewportTimer.current = window.setTimeout(() => {
        void diagramService.updateViewport(diagram.id, viewport).catch(() => undefined);
      }, 800);
    },
    [diagram, canEdit],
  );

  async function handleCreate(): Promise<void> {
    setSaving(true);
    try {
      const created = await diagramService.create({
        name: 'Цахилгааны схем',
        description: null,
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        gridSize: 16,
        snapToGrid: true,
        timeline: [],
        activeStepId: null,
      });
      setDiagram(created);
      setState(toCanvasState(created));
      notify('Схем үүслээ.', 'success');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Үүсгэж чадсангүй.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(): Promise<void> {
    if (!diagram || !state) return;
    setSaving(true);
    try {
      const saved = await diagramService.update(diagram.id, toSavePayload(diagram.name, state));
      setDiagram(saved);
      setState(toCanvasState(saved));
      setDirty(false);
      notify('Схем хадгалагдлаа.', 'success');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Хадгалж чадсангүй.', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Skeleton className="h-[560px] w-full" />;
  if (error) return <ErrorState description={error} />;

  if (!diagram || !state) {
    return (
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <EmptyState
          title="Схем зураг үүсгээгүй байна"
          description={
            canEdit
              ? 'Цахилгааны байгууламжийн схемийг эндээс эхлүүлнэ.'
              : 'Схем зураг үүсгэх эрх шаардлагатай.'
          }
        />
        {canEdit && (
          <div className="flex justify-center pb-5">
            <Button onClick={() => void handleCreate()} loading={saving}>
              Схем үүсгэх
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">{diagram.name}</h2>
          <p className="text-xs text-slate-500">
            {state.nodes.length} объект · {state.edges.length} холбоос
            {diagram.updatedByName ? ` · ${diagram.updatedByName}` : ''}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            {dirty && <span className="text-xs text-amber-700">Хадгалаагүй өөрчлөлт байна</span>}
            <Button onClick={() => void handleSave()} loading={saving} disabled={!dirty}>
              Хадгалах
            </Button>
          </div>
        )}
      </div>

      {!canEdit && (
        <Alert variant="info">
          Зөвхөн харах эрхтэй. Timeline алхам сонгож төлөвийг харж болно.
        </Alert>
      )}

      <DiagramCanvas
        state={state}
        editable={canEdit}
        onChange={handleChange}
        onViewportChange={handleViewportChange}
      />
    </div>
  );
}
