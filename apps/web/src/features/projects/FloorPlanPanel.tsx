import { floorPlanMetaSchema, type FloorPlanDto } from '@monhorus/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Drawer } from '../../components/ui/Drawer';
import { EmptyState } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { projectService } from '../../services/project.service';
import { Field, TextInput } from '../employees/FormControls';

interface FloorPlanPanelProps {
  floorId: string;
  plan: FloorPlanDto | null;
  canManage: boolean;
  onChanged: () => void;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

/**
 * Accepted formats and the real ceiling.
 *
 * The size matches MAX_FILE_BYTES in the storage service rather than the figure in the
 * prototype, so the hint states the limit that is actually enforced.
 */
const ACCEPTED_HINT = 'PNG, JPG, WEBP, PDF - хамгийн ихдээ 10MB';

/**
 * Floor plan image (requirements 11.1, rule 17.3).
 *
 * One current image, shown immediately. There is deliberately no version list, no version
 * switch and no coordinate overlay: section 19.2 leaves the plan editor format and
 * coordinate system unapproved, so the image is stored and displayed and every change is
 * written to the audit log instead.
 */
export function FloorPlanPanel({
  floorId,
  plan,
  canManage,
  onChanged,
}: FloorPlanPanelProps): ReactElement {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metaOpen, setMetaOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!metaOpen) return;
    setTitle(plan?.title ?? '');
    setDescription(plan?.description ?? '');
  }, [metaOpen, plan]);

  /**
   * The download route is authenticated, so the image cannot be used as a bare `src`.
   * It is fetched with the bearer token and turned into an object URL, which is revoked
   * when the plan changes or the panel unmounts.
   */
  useEffect(() => {
    if (!plan) {
      setPreviewUrl(null);
      return undefined;
    }

    let revoked = false;
    let objectUrl: string | null = null;

    void authorisedFileUrl(plan.downloadUrl)
      .then((url) => {
        if (revoked) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setPreviewUrl(url);
      })
      .catch(() => setPreviewUrl(null));

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [plan]);

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await projectService.uploadFloorPlan(floorId, file);
      notify(plan ? 'План зураг солигдлоо.' : 'План зураг хавсаргагдлаа.', 'success');
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'План зураг хуулж чадсангүй.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveMeta(): Promise<void> {
    const parsed = floorPlanMetaSchema.safeParse({
      title: title.trim() || null,
      description: description.trim() || null,
    });
    if (!parsed.success) return;

    setSavingMeta(true);
    setError(null);
    try {
      await projectService.updateFloorPlanMeta(floorId, parsed.data);
      notify('План зургийн мэдээлэл шинэчлэгдлээ.', 'success');
      setMetaOpen(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хадгалж чадсангүй.');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleRemove(): Promise<void> {
    setError(null);
    try {
      await projectService.removeFloorPlan(floorId);
      notify('План зураг устгагдлаа.', 'success');
      setRemoveOpen(false);
      onChanged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Устгаж чадсангүй.');
      setRemoveOpen(false);
    }
  }

  const hiddenInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,application/pdf"
      className="hidden"
      aria-label="План зураг сонгох"
      onChange={(event) => {
        void handleUpload(event.target.files?.[0]);
        event.target.value = '';
      }}
    />
  );

  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-semibold text-slate-900">План зураг</h2>
        {canManage && plan && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              loading={uploading}
            >
              Зураг солих
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setMetaOpen(true)}>
              Мэдээлэл засах
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setRemoveOpen(true)}>
              Устгах
            </Button>
          </div>
        )}
      </div>

      <div className="p-5">
        {error && (
          <div className="mb-3">
            <Alert variant="error">{error}</Alert>
          </div>
        )}

        {!plan ? (
          canManage ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                void handleUpload(event.dataTransfer.files?.[0]);
              }}
              className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
                dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-slate-50'
              }`}
            >
              <svg
                className="mb-3 h-10 w-10 text-slate-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3 16.5V18a3 3 0 003 3h12a3 3 0 003-3v-1.5M7.5 9L12 4.5 16.5 9M12 4.5V16"
                />
              </svg>
              <p className="text-sm font-medium text-slate-900">План зураг хавсаргаагүй байна</p>
              {/* The drag target is not discoverable without saying so; the sentence
                  explaining what a plan is for has gone. */}
              <p className="mt-1 text-xs text-slate-500">Файл чирж оруулна уу эсвэл сонгоно уу.</p>
              <p className="mt-1 text-xs text-slate-400">{ACCEPTED_HINT}</p>
              <div className="mt-4">
                <Button onClick={() => fileInputRef.current?.click()} loading={uploading}>
                  План зураг хуулах
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="План зураг хавсаргаагүй байна"
              description="Энэ давхарт план зураг хавсаргаагүй байна."
            />
          )
        ) : (
          <div className="space-y-3">
            {plan.title && <p className="text-sm font-medium text-slate-900">{plan.title}</p>}
            {plan.description && <p className="text-xs text-slate-600">{plan.description}</p>}

            <div className="overflow-auto rounded-lg bg-slate-50 p-2 ring-1 ring-inset ring-slate-200">
              {plan.mimeType === 'application/pdf' ? (
                <div className="flex flex-col items-start gap-2 p-4">
                  <p className="text-sm text-slate-700">{plan.fileName}</p>
                  {previewUrl && (
                    <a
                      href={previewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline"
                    >
                      PDF нээх
                    </a>
                  )}
                </div>
              ) : previewUrl ? (
                <img
                  src={previewUrl}
                  alt={plan.title ?? 'Давхарын план зураг'}
                  className="mx-auto max-h-[520px] w-auto max-w-full"
                />
              ) : (
                <div className="h-48 animate-pulse rounded bg-slate-200" />
              )}
            </div>

            <p className="text-xs text-slate-500">
              {plan.fileName} · {(plan.sizeBytes / 1024).toFixed(0)} KB ·{' '}
              {plan.uploadedByName ?? '-'} · {formatDateTime(plan.uploadedAt)}
            </p>
            {canManage && <p className="text-xs text-slate-400">{ACCEPTED_HINT}</p>}
          </div>
        )}

        {hiddenInput}
      </div>

      <Drawer
        open={metaOpen}
        title="План зургийн мэдээлэл"
        onClose={() => setMetaOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setMetaOpen(false)} disabled={savingMeta}>
              Цуцлах
            </Button>
            <Button onClick={() => void handleSaveMeta()} loading={savingMeta}>
              Хадгалах
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Гарчиг">
            <TextInput value={title} onChange={setTitle} disabled={savingMeta} />
          </Field>
          <div>
            <label htmlFor="plan-description" className={FILTER_LABEL}>
              Тайлбар
            </label>
            <textarea
              id="plan-description"
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={savingMeta}
              className={FIELD_TEXTAREA}
            />
          </div>
        </div>
      </Drawer>

      <ConfirmDialog
        open={removeOpen}
        title="План зураг устгах"
        message="Давхарын план зургийг устгах уу? Энэ үйлдэл audit log-д бүртгэгдэнэ."
        confirmLabel="Устгах"
        danger
        onCancel={() => setRemoveOpen(false)}
        onConfirm={() => handleRemove()}
      />
    </div>
  );
}
