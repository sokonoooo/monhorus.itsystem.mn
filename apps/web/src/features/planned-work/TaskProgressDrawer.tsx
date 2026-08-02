import {
  MATERIAL_UNIT_LABELS,
  recordTaskProgressSchema,
  type PlannedWorkDto,
  type PlannedWorkPhotoDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { plannedWorkService } from '../../services/planned-work.service';
import { Field, TextInput } from '../employees/FormControls';
import { ScoreBar } from '../projects/objects/ObjectBadges';
import { TaskMaterialsPanel } from './TaskMaterialsPanel';
import { ProgressBar, TaskStatusBadge } from './PlannedWorkBadges';

interface TaskProgressDrawerProps {
  work: PlannedWorkDto;
  task: PlannedWorkTaskDto | null;
  onClose: () => void;
  onSaved: (work: PlannedWorkDto) => void;
}

/**
 * Records progress on a sub-task.
 *
 * The inputs are quantity, the Тайлбар note, the 0-100 evaluation, the recommendation and
 * the two photo sets. `Дүгнэлт` is deliberately absent: it belongs to the consolidated
 * report. Neither the task status nor the risk band is chosen here - the backend derives
 * both - so the drawer shows what is still missing rather than letting a user declare the
 * task finished or label its band.
 */
export function TaskProgressDrawer({
  work,
  task,
  onClose,
  onSaved,
}: TaskProgressDrawerProps): ReactElement {
  const { notify } = useToast();

  const [completedQuantity, setCompletedQuantity] = useState('');
  const [note, setNote] = useState('');
  const [score, setScore] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [skipped, setSkipped] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState<'BEFORE' | 'AFTER' | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!task) return;
    setCompletedQuantity(String(task.completedQuantity));
    setNote(task.note ?? '');
    setScore(task.score === null ? '' : String(task.score));
    setRecommendation(task.recommendation ?? '');
    setSkipped(task.status === 'SKIPPED');
    setFormError(null);
    setFieldErrors({});
  }, [task]);

  async function handleSubmit(): Promise<void> {
    if (!task) return;
    setFormError(null);
    setFieldErrors({});

    const parsed = recordTaskProgressSchema.safeParse({
      completedQuantity: Number(completedQuantity || '0'),
      skipped,
      note: note.trim() || null,
      score: score.trim() === '' ? null : Number(score),
      recommendation: recommendation.trim() || null,
    });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      const updated = await plannedWorkService.recordProgress(work.id, task.id, parsed.data);
      notify('Биелэлт бүртгэгдлээ.', 'success');
      onSaved(updated);
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFormError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setFormError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(kind: 'BEFORE' | 'AFTER', file: File | undefined): Promise<void> {
    if (!task || !file) return;
    setUploading(kind);
    setFormError(null);
    try {
      const updated = await plannedWorkService.uploadTaskPhoto(work.id, task.id, kind, file);
      notify('Зураг хавсаргагдлаа.', 'success');
      onSaved(updated);
    } catch (caught) {
      setFormError(
        caught instanceof ApiError ? caught.message : 'Зураг хуулж чадсангүй.',
      );
    } finally {
      setUploading(null);
    }
  }

  async function handleRemovePhoto(photo: PlannedWorkPhotoDto): Promise<void> {
    if (!task) return;
    setFormError(null);
    try {
      const updated = await plannedWorkService.deleteTaskPhoto(work.id, task.id, photo.id);
      notify('Зураг устгагдлаа.', 'success');
      onSaved(updated);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Зураг устгаж чадсангүй.');
    }
  }

  function photoSection(
    kind: 'BEFORE' | 'AFTER',
    label: string,
    photos: readonly PlannedWorkPhotoDto[],
    inputRef: React.RefObject<HTMLInputElement>,
  ): ReactElement {
    return (
      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-slate-600">{label}</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => inputRef.current?.click()}
            loading={uploading === kind}
            disabled={uploading !== null}
          >
            Зураг нэмэх
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          aria-label={`${label} нэмэх`}
          onChange={(event) => {
            void handleUpload(kind, event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        {photos.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
            Зураг хавсаргаагүй.
          </p>
        ) : (
          <ul className="space-y-1">
            {photos.map((photo) => (
              <li
                key={photo.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs ring-1 ring-inset ring-slate-200"
              >
                <span className="min-w-0 truncate text-slate-700">{photo.name}</span>
                <button
                  type="button"
                  onClick={() => void handleRemovePhoto(photo)}
                  className="shrink-0 rounded px-1.5 py-0.5 font-medium text-red-600 hover:bg-red-50"
                >
                  Устгах
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  const parsedScore = score.trim() === '' ? null : Number(score);

  return (
    <Drawer
      open={task !== null}
      title={task ? `${task.title} - биелэлт` : ''}
      onClose={onClose}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Хаах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Бүртгэх
          </Button>
        </>
      }
    >
      {task && (
        <div className="space-y-4">
          {formError && <Alert variant="error">{formError}</Alert>}

          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="mb-2 flex items-center justify-between gap-2">
              <TaskStatusBadge status={task.status} />
              <span className="text-xs text-slate-500">
                {task.floorName ?? 'Давхар заагаагүй'}
              </span>
            </div>
            <ProgressBar
              percent={task.progressPercent}
              completedQuantity={task.completedQuantity}
              totalQuantity={task.totalQuantity}
              unitLabel={MATERIAL_UNIT_LABELS[task.unit]}
            />
          </div>

          {task.missingEvidence.length > 0 && (
            <Alert variant="warning" title="Дуусгахад дараах нь шаардлагатай">
              <ul className="ml-4 list-disc space-y-0.5">
                {task.missingEvidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </Alert>
          )}

          <Field
            label="Биелэсэн тоо хэмжээ"
            required
            error={fieldErrors.completedQuantity}
            hint={`Дээд хэмжээ: ${task.totalQuantity} ${MATERIAL_UNIT_LABELS[task.unit]}`}
          >
            <TextInput
              type="number"
              value={completedQuantity}
              onChange={setCompletedQuantity}
              disabled={submitting}
            />
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={skipped}
              onChange={(event) => setSkipped(event.target.checked)}
              disabled={submitting}
              className="h-4 w-4 rounded border-slate-300"
            />
            Хийгдэхгүй ажил (биелэлтийн тооцоонд орохгүй)
          </label>

          {/* What the sub-task CONSUMED, next to but never mixed with the equipment it
              assessed: the objects receive the finding, these are spent doing the work. */}
          <TaskMaterialsPanel
            plannedWorkId={work.id}
            taskId={task.id}
            editable={task.status !== 'DONE' && task.status !== 'SKIPPED'}
          />

          <div>
            <label htmlFor="task-note" className={FILTER_LABEL}>
              Тайлбар
            </label>
            <textarea
              id="task-note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={submitting}
              className={FIELD_TEXTAREA}
            />
          </div>

          <Field label="Үнэлгээ (0-100)" error={fieldErrors.score}>
            <TextInput type="number" value={score} onChange={setScore} disabled={submitting} />
          </Field>

          <div>
            <span className={FILTER_LABEL}>Эрсдэлийн түвшин</span>
            <div className="rounded-lg bg-slate-50 px-2.5 py-2 ring-1 ring-inset ring-slate-200">
              {/* Shown only while the entered score still matches the saved one, so a band is
                  never displayed against a score the backend has not banded yet. */}
              <ScoreBar
                level={parsedScore === task.score ? task.riskLevel : null}
                score={parsedScore}
                showPill
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="task-recommendation"
              className={FILTER_LABEL}
            >
              Зөвлөмж
            </label>
            <textarea
              id="task-recommendation"
              rows={3}
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value)}
              disabled={submitting}
              className={FIELD_TEXTAREA}
            />
          </div>

          {photoSection('BEFORE', 'Ажлын өмнөх зураг', task.beforePhotos, beforeInputRef)}
          {photoSection('AFTER', 'Ажлын дараах зураг', task.afterPhotos, afterInputRef)}
        </div>
      )}
    </Drawer>
  );
}
