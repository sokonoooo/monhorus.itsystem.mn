import type { DiagramTimelineStepDto } from '@monhorus/shared';
import type { ReactElement } from 'react';

/**
 * Timeline of authored operating states.
 *
 * Selecting a step applies its overrides to the diagram. It is not an edit history: the
 * structure lives in one document, a step stores only per-node and per-edge state, and no
 * previous version of the diagram is kept anywhere.
 */
export function TimelineBar({
  steps,
  activeStepId,
  editable,
  onSelect,
  onAddStep,
  onRemoveStep,
}: {
  steps: readonly DiagramTimelineStepDto[];
  activeStepId: string | null;
  editable: boolean;
  onSelect: (stepId: string | null) => void;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
}): ReactElement {
  const activeIndex = steps.findIndex((step) => step.id === activeStepId);

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Timeline</span>

        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={activeStepId === null}
          className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            activeStepId === null
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          Үндсэн төлөв
        </button>

        {steps.map((step) => (
          <span key={step.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onSelect(step.id)}
              aria-pressed={activeStepId === step.id}
              title={step.at ? `${step.label} · ${step.at}` : step.label}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                activeStepId === step.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {step.label}
              {step.at && <span className="ml-1 opacity-70">{step.at}</span>}
            </button>
            {editable && (
              <button
                type="button"
                onClick={() => onRemoveStep(step.id)}
                aria-label={`${step.label} алхам устгах`}
                className="ml-0.5 rounded px-1 text-xs text-slate-400 hover:bg-slate-100 hover:text-red-600"
              >
                ×
              </button>
            )}
          </span>
        ))}

        {editable && (
          <button
            type="button"
            onClick={onAddStep}
            className="rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-slate-400 hover:bg-slate-50"
          >
            + Алхам
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <div className="mt-2">
          {/*
            A slider as well as the chips: with more than a handful of steps, scrubbing is
            far quicker than hunting for the right chip.
          */}
          <input
            type="range"
            min={-1}
            max={steps.length - 1}
            step={1}
            value={activeIndex}
            onChange={(event) => {
              const index = Number(event.target.value);
              onSelect(index < 0 ? null : (steps[index]?.id ?? null));
            }}
            aria-label="Timeline алхам сонгох"
            className="w-full"
          />
        </div>
      )}
    </div>
  );
}
