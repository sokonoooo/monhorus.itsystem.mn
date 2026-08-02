import {
  DASHBOARD_CUSTOM_WIDGET_KEY,
  DASHBOARD_INSIGHT_CHARTS,
  DASHBOARD_INSIGHT_CHART_LABELS,
  DASHBOARD_INSIGHT_DIMENSIONS,
  DASHBOARD_INSIGHT_DIMENSION_LABELS,
  DASHBOARD_INSIGHT_METRICS,
  DASHBOARD_INSIGHT_METRIC_LABELS,
  DASHBOARD_INSIGHT_RANGES,
  DASHBOARD_INSIGHT_RANGE_LABELS,
  DASHBOARD_WIDGET_DESCRIPTIONS,
  DASHBOARD_WIDGET_LABELS,
  DASHBOARD_WIDGET_SIZES,
  DASHBOARD_WIDGET_SIZE_LABELS,
  PERMISSIONS,
  type DashboardCustomWidgetDto,
  type DashboardInsightChart,
  type DashboardInsightDimension,
  type DashboardInsightMetric,
  type DashboardInsightRange,
  type DashboardWidgetPreference,
  type DashboardWidgetSize,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { COMPACT_SELECT, FIELD_SELECT, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { dashboardService } from '../../services/org.service';

/**
 * Dashboard arrangement.
 *
 * Reordering uses explicit up and down buttons rather than drag and drop: this list is
 * eleven rows on a settings panel, and a keyboard user gets the same control as a mouse
 * user for none of the cost.
 */
/**
 * What a row is called.
 *
 * A built-in is named by the catalogue; a user-built one shares its key with every other
 * and is named by its own definition, so neither lookup can serve both.
 */
function labelOf(
  entry: DashboardWidgetPreference,
  customWidgets: readonly DashboardCustomWidgetDto[],
): string {
  if (entry.key !== DASHBOARD_CUSTOM_WIDGET_KEY) return DASHBOARD_WIDGET_LABELS[entry.key];
  const definition = customWidgets.find((widget) => widget.id === entry.customWidgetId);
  return definition?.title ?? 'Устгагдсан хэсэг';
}

function descriptionOf(
  entry: DashboardWidgetPreference,
  customWidgets: readonly DashboardCustomWidgetDto[],
): string {
  if (entry.key !== DASHBOARD_CUSTOM_WIDGET_KEY) return DASHBOARD_WIDGET_DESCRIPTIONS[entry.key];
  const definition = customWidgets.find((widget) => widget.id === entry.customWidgetId);
  if (!definition) return '';
  return `${DASHBOARD_INSIGHT_METRIC_LABELS[definition.metric]} · ${
    DASHBOARD_INSIGHT_DIMENSION_LABELS[definition.dimension]
  } · ${DASHBOARD_INSIGHT_RANGE_LABELS[definition.range]}`;
}

export function CustomiseDashboardDrawer({
  open,
  widgets,
  customWidgets,
  onClose,
  onSaved,
  onWidgetsChanged,
}: {
  open: boolean;
  widgets: readonly DashboardWidgetPreference[];
  customWidgets: readonly DashboardCustomWidgetDto[];
  onClose: () => void;
  onSaved: (widgets: readonly DashboardWidgetPreference[]) => void;
  /** A definition was created or deleted, so the board must reload rather than patch. */
  onWidgetsChanged: () => void;
}): ReactElement {
  const { notify } = useToast();
  const { can } = useAuth();
  const [draft, setDraft] = useState<DashboardWidgetPreference[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDraft(widgets.map((entry) => ({ ...entry })));
      setError(null);
    }
  }, [open, widgets]);

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction;
    if (target < 0 || target >= draft.length) return;

    const next = [...draft];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    setDraft(next);
  }

  function patch(index: number, change: Partial<DashboardWidgetPreference>): void {
    setDraft((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...change } : entry)),
    );
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const saved = await dashboardService.saveLayout(draft);
      notify('Хяналтын самбар хадгалагдлаа.', 'success');
      onSaved(saved.widgets);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хадгалж чадсангүй.');
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      const reset = await dashboardService.resetLayout();
      notify('Үндсэн байрлал сэргээгдлээ.', 'success');
      onSaved(reset.widgets);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Сэргээж чадсангүй.');
    } finally {
      setSaving(false);
    }
  }

  const visibleCount = draft.filter((entry) => entry.visible).length;

  return (
    <Drawer
      open={open}
      title="Хяналтын самбар тохируулах"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => void handleReset()} disabled={saving}>
            Үндсэн байдалд
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSave()} loading={saving}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Alert variant="error">{error}</Alert>}

        <p className="text-xs text-slate-500">
          Харагдах хэсгээ сонгож, дарааллыг нь өөрчилнө. Эрх байхгүй хэсэг ямар ч тохиолдолд
          харагдахгүй.
        </p>

        {visibleCount === 0 && (
          <Alert variant="warning">Бүх хэсгийг нуувал самбар хоосон харагдана.</Alert>
        )}

        <ul className="space-y-2">
          {draft.map((entry, index) => (
            <li
              key={`${entry.key}-${entry.customWidgetId ?? ''}`}
              className={`rounded-lg p-2.5 ring-1 ring-inset ${
                entry.visible ? 'bg-white ring-slate-200' : 'bg-slate-50 ring-slate-200'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  id={`widget-${entry.key}-${entry.customWidgetId ?? index}`}
                  checked={entry.visible}
                  onChange={(event) => patch(index, { visible: event.target.checked })}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                />
                <label htmlFor={`widget-${entry.key}-${entry.customWidgetId ?? index}`} className="min-w-0 flex-1 cursor-pointer">
                  <span className="block text-sm font-medium text-slate-900">
                    {labelOf(entry, customWidgets)}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {descriptionOf(entry, customWidgets)}
                  </span>
                </label>

                <div className="flex shrink-0 gap-0.5">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`${labelOf(entry, customWidgets)} дээш`}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    disabled={index === draft.length - 1}
                    aria-label={`${labelOf(entry, customWidgets)} доош`}
                    className="rounded px-1.5 py-0.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </div>
              </div>

              {entry.visible && (
                <div className="mt-2 pl-6">
                  <label
                    htmlFor={`size-${entry.key}`}
                    className="mr-2 text-[11px] text-slate-500"
                  >
                    Өргөн
                  </label>
                  {/* Four widths on a six-column row; narrow screens ignore the choice. */}
                  <select
                    id={`size-${entry.key}`}
                    value={entry.size}
                    onChange={(event) =>
                      patch(index, { size: event.target.value as DashboardWidgetSize })
                    }
                    className={COMPACT_SELECT}
                  >
                    {DASHBOARD_WIDGET_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {DASHBOARD_WIDGET_SIZE_LABELS[size]}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </li>
          ))}
        </ul>

        {can(PERMISSIONS.DASHBOARD_CUSTOMISE) && (
          <CustomWidgetBuilder
            customWidgets={customWidgets}
            onChanged={onWidgetsChanged}
          />
        )}
      </div>
    </Drawer>
  );
}

/**
 * Builds a saved question.
 *
 * Four choosers and a name, and every one of them a closed list: the server maps a
 * dimension onto a field, so the form can never describe a query the backend would not
 * already accept. It is deliberately not a field picker — see the dimension enum.
 */
function CustomWidgetBuilder({
  customWidgets,
  onChanged,
}: {
  customWidgets: readonly DashboardCustomWidgetDto[];
  onChanged: () => void;
}): ReactElement {
  const { notify } = useToast();

  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState<DashboardInsightMetric>('COUNT');
  const [dimension, setDimension] = useState<DashboardInsightDimension>('BUILDING');
  const [range, setRange] = useState<DashboardInsightRange>('LAST_2_MONTHS');
  const [chart, setChart] = useState<DashboardInsightChart>('BAR');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    setError(null);
    if (title.trim().length === 0) {
      setError('Нэр оруулна уу.');
      return;
    }

    setBusy(true);
    try {
      await dashboardService.createCustomWidget({
        title: title.trim(),
        metric,
        dimension,
        range,
        chart,
      });
      setTitle('');
      notify('Хэсэг үүслээ.', 'success');
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Гэнэтийн алдаа гарлаа.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(widgetId: string): Promise<void> {
    setBusy(true);
    try {
      await dashboardService.deleteCustomWidget(widgetId);
      notify('Хэсэг устгагдлаа.', 'success');
      onChanged();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.', 'error');
    } finally {
      setBusy(false);
    }
  }


  return (
    <section className="mt-5 border-t border-slate-200 pt-4">
      <h3 className="text-sm font-semibold text-slate-900">Шинэ хэсэг үүсгэх</h3>
      <p className="mt-0.5 text-xs text-slate-500">
        Үйлчилгээний хүсэлтийг сонгосон ангилал, хугацаагаар тоолж харуулна.
      </p>

      {error && (
        <div className="mt-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div>
          <label htmlFor="insight-title" className={FILTER_LABEL}>
            Нэр
          </label>
          <input
            id="insight-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Барилгаар ирсэн хүсэлт"
            maxLength={60}
            disabled={busy}
            className={FIELD_SELECT}
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="insight-metric" className={FILTER_LABEL}>
              Үзүүлэлт
            </label>
            <select
              id="insight-metric"
              value={metric}
              onChange={(event) => setMetric(event.target.value as DashboardInsightMetric)}
              disabled={busy}
              className={FIELD_SELECT}
            >
              {DASHBOARD_INSIGHT_METRICS.map((entry) => (
                <option key={entry} value={entry}>
                  {DASHBOARD_INSIGHT_METRIC_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="insight-dimension"
              className={FILTER_LABEL}
            >
              Ангилал
            </label>
            <select
              id="insight-dimension"
              value={dimension}
              onChange={(event) => setDimension(event.target.value as DashboardInsightDimension)}
              disabled={busy}
              className={FIELD_SELECT}
            >
              {DASHBOARD_INSIGHT_DIMENSIONS.map((entry) => (
                <option key={entry} value={entry}>
                  {DASHBOARD_INSIGHT_DIMENSION_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="insight-range" className={FILTER_LABEL}>
              Хугацаа
            </label>
            <select
              id="insight-range"
              value={range}
              onChange={(event) => setRange(event.target.value as DashboardInsightRange)}
              disabled={busy}
              className={FIELD_SELECT}
            >
              {DASHBOARD_INSIGHT_RANGES.map((entry) => (
                <option key={entry} value={entry}>
                  {DASHBOARD_INSIGHT_RANGE_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="insight-chart" className={FILTER_LABEL}>
              Хэлбэр
            </label>
            <select
              id="insight-chart"
              value={chart}
              onChange={(event) => setChart(event.target.value as DashboardInsightChart)}
              disabled={busy}
              className={FIELD_SELECT}
            >
              {DASHBOARD_INSIGHT_CHARTS.map((entry) => (
                <option key={entry} value={entry}>
                  {DASHBOARD_INSIGHT_CHART_LABELS[entry]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <Button size="sm" onClick={() => void handleCreate()} loading={busy}>
          Үүсгэх
        </Button>
      </div>

      {customWidgets.length > 0 && (
        <ul className="mt-3 space-y-1">
          {customWidgets.map((widget) => (
            <li
              key={widget.id}
              className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{widget.title}</span>
              <button
                type="button"
                onClick={() => void handleDelete(widget.id)}
                disabled={busy}
                className="shrink-0 text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
              >
                Устгах
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
