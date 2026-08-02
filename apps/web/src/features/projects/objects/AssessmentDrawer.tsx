import {
  createObjectAssessmentSchema,
  type DispatchCandidateDto,
  type ObjectDetailDto,
  type ObjectPhotoDto,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Drawer } from '../../../components/ui/Drawer';
import { Modal } from '../../../components/ui/Modal';
import { useToast } from '../../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../../components/ui/control-styles';
import { ApiError } from '../../../lib/api-client';
import { authorisedFileUrl } from '../../../lib/file-url';
import { objectMasterService } from '../../../services/object-master.service';
import { dispatchService } from '../../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../../employees/FormControls';

interface AssessmentDrawerProps {
  object: ObjectDetailDto | null;
  onClose: () => void;
  onSaved: () => void;
}

/** Matches the mime types the storage service accepts for an image. */
const ACCEPTED_PHOTO_TYPES = 'image/png,image/jpeg,image/webp';

const MISSING_EVIDENCE = 'Нотлох зураг хавсаргах хүртэл үнэлгээ бүртгэх боломжгүй.';

/**
 * Records a new assessment (requirements 9.2 and 10.1).
 *
 * Append-only: this always creates a new entry and never edits the previous one. The
 * band-conditional requirements are enforced by the backend against the configured
 * thresholds, and its rejections are surfaced field by field rather than guessed at here.
 *
 * A score with no picture behind it is not an assessment, so at least one photo is
 * required. The photos are uploaded as they are chosen and the assessment claims them on
 * save; the backend refuses an entry with no evidence regardless of what this form does.
 *
 * The download route is authenticated, so a stored photo cannot be used as a bare `src`.
 * Each attachment is fetched once with the bearer token and turned into an object URL that
 * backs its thumbnail and its enlarged preview alike, and every URL is revoked when the
 * drawer moves to another object or unmounts.
 */
export function AssessmentDrawer({
  object,
  onClose,
  onSaved,
}: AssessmentDrawerProps): ReactElement {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrls = useRef<string[]>([]);

  const [newScore, setNewScore] = useState('');
  const [conclusion, setConclusion] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [actionTaken, setActionTaken] = useState('');
  const [measuredLoadKw, setMeasuredLoadKw] = useState('');
  const [repairRequired, setRepairRequired] = useState(false);
  const [revisitRequired, setRevisitRequired] = useState(false);
  const [revisitDate, setRevisitDate] = useState('');
  const [revisitOwnerEmployeeId, setRevisitOwnerEmployeeId] = useState('');
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);

  const [photos, setPhotos] = useState<ObjectPhotoDto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<ObjectPhotoDto | null>(null);
  const [uploading, setUploading] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /** Anything still held when the drawer leaves the page has to be released. */
  useEffect(() => {
    return () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current = [];
    };
  }, []);

  useEffect(() => {
    if (!object) return undefined;

    // Evidence belongs to one assessment, so nothing carries over to the next object.
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current = [];
    setPhotos([]);
    setPhotoUrls({});
    setPreview(null);

    setNewScore('');
    setConclusion('');
    setRecommendation('');
    setActionTaken('');
    setMeasuredLoadKw('');
    setRepairRequired(false);
    setRevisitRequired(false);
    setRevisitDate('');
    setRevisitOwnerEmployeeId('');
    setFormError(null);
    setFieldErrors({});

    let cancelled = false;
    dispatchService
      .employeeCandidates({})
      .then((result) => {
        if (!cancelled) setEmployees(result);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [object]);

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    setFieldErrors((current) => ({ ...current, photoIds: '' }));

    try {
      const photo = await objectMasterService.uploadAssessmentPhoto(file);
      setPhotos((current) => [...current, photo]);

      try {
        const url = await authorisedFileUrl(photo.downloadUrl);
        objectUrls.current.push(url);
        setPhotoUrls((current) => ({ ...current, [photo.id]: url }));
      } catch {
        // A thumbnail that will not load must not lose the attachment behind it.
      }
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Зураг хуулж чадсангүй.');
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(): Promise<void> {
    if (!object) return;
    setFormError(null);
    setFieldErrors({});

    const parsed = createObjectAssessmentSchema.safeParse({
      newScore: Number(newScore || '-1'),
      conclusion: conclusion.trim() || null,
      recommendation: recommendation.trim() || null,
      actionTaken: actionTaken.trim() || null,
      measuredLoadKw: measuredLoadKw.trim() === '' ? null : Number(measuredLoadKw),
      repairRequired,
      revisitRequired,
      revisitDate: revisitDate ? `${revisitDate}T00:00:00.000Z` : null,
      revisitOwnerEmployeeId: revisitOwnerEmployeeId || null,
      photoIds: photos.map((photo) => photo.id),
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
      await objectMasterService.recordAssessment(object.id, parsed.data);
      notify('Үнэлгээ бүртгэгдлээ.', 'success');
      onSaved();
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

  const hasEvidence = photos.length > 0;
  // The thumbnail and the enlarged preview share one object URL, so there is a single
  // fetch per attachment and a single URL to revoke.
  const previewUrl = preview ? (photoUrls[preview.id] ?? null) : null;

  return (
    <>
      <Drawer
        open={object !== null}
        title={object ? `${object.name} - үнэлгээ` : ''}
        onClose={onClose}
        width="lg"
        footer={
          <>
            {/* The reason the action is unavailable is read beside it, not hunted for. */}
            {!hasEvidence && <span className="mr-auto text-xs text-slate-500">{MISSING_EVIDENCE}</span>}
            <Button variant="secondary" onClick={onClose} disabled={submitting}>
              Цуцлах
            </Button>
            <Button
              onClick={() => void handleSubmit()}
              loading={submitting}
              disabled={!hasEvidence}
            >
              Бүртгэх
            </Button>
          </>
        }
      >
        {object && (
          <div className="space-y-4">
            {formError && <Alert variant="error">{formError}</Alert>}

            <Alert variant="info">
              Үнэлгээний түүх устгагдахгүй. Шинэ үнэлгээ бүр өмнөх оноог хадгалж, дээр нь
              нэмэгдэнэ.
              {object.latestAssessment
                ? ` Одоогийн оноо: ${object.latestAssessment.score}.`
                : ' Энэ нь анхны үнэлгээ болно.'}
            </Alert>

            <div>
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-medium text-slate-600">Нотлох зураг*</span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  loading={uploading}
                  disabled={submitting}
                >
                  Зураг хавсаргах
                </Button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_PHOTO_TYPES}
                className="hidden"
                aria-label="Нотлох зураг сонгох"
                onChange={(event) => {
                  void handleUpload(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />

              {hasEvidence ? (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {photos.map((photo) => {
                    const url = photoUrls[photo.id] ?? null;
                    return (
                      <li
                        key={photo.id}
                        className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
                      >
                        <button
                          type="button"
                          onClick={() => setPreview(photo)}
                          disabled={url === null}
                          aria-label={`${photo.name} томруулж харах`}
                          className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
                        >
                          {url ? (
                            <img src={url} alt={photo.name} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="h-24 w-full animate-pulse bg-slate-200" />
                          )}
                        </button>
                        <div className="flex items-center gap-1 px-2 py-1">
                          <p className="min-w-0 flex-1 truncate text-[11px] text-slate-600" title={photo.name}>
                            {photo.name}
                          </p>
                          {/* Evidence is mandatory, so a wrongly chosen photo must be
                              removable before saving. The assessment itself stays
                              append-only: this only edits what has not been recorded yet. */}
                          <button
                            type="button"
                            onClick={() => setPhotos((current) => current.filter((entry) => entry.id !== photo.id))}
                            aria-label={`${photo.name} хасах`}
                            className="shrink-0 rounded px-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                          >
                            Хасах
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                  {MISSING_EVIDENCE}
                </p>
              )}

              {fieldErrors.photoIds && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.photoIds}</p>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="Шинэ оноо"
                required
                error={fieldErrors.newScore}
                hint="0-100. Түвшин болон шаардлагатай талбарыг сервер тодорхойлно."
              >
                <TextInput type="number" value={newScore} onChange={setNewScore} disabled={submitting} />
              </Field>

              <Field
                label="Хэмжсэн ачаалал (kW)"
                error={fieldErrors.measuredLoadKw}
                hint="Тооцоолсон ачаалалтай тусад нь хадгалагдана"
              >
                <TextInput
                  type="number"
                  value={measuredLoadKw}
                  onChange={setMeasuredLoadKw}
                  disabled={submitting}
                />
              </Field>
            </div>

            <div>
              <label htmlFor="assess-conclusion" className={FILTER_LABEL}>
                Дүгнэлт
              </label>
              <textarea
                id="assess-conclusion"
                rows={3}
                value={conclusion}
                onChange={(event) => setConclusion(event.target.value)}
                disabled={submitting}
                className={FIELD_TEXTAREA}
              />
              {fieldErrors.conclusion && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.conclusion}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="assess-recommendation"
                className={FILTER_LABEL}
              >
                Зөвлөмж
              </label>
              <textarea
                id="assess-recommendation"
                rows={3}
                value={recommendation}
                onChange={(event) => setRecommendation(event.target.value)}
                disabled={submitting}
                className={FIELD_TEXTAREA}
              />
              {fieldErrors.recommendation && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.recommendation}</p>
              )}
            </div>

            <div>
              <label htmlFor="assess-action" className={FILTER_LABEL}>
                Авсан арга хэмжээ
              </label>
              <textarea
                id="assess-action"
                rows={2}
                value={actionTaken}
                onChange={(event) => setActionTaken(event.target.value)}
                disabled={submitting}
                className={FIELD_TEXTAREA}
              />
              {fieldErrors.actionTaken && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.actionTaken}</p>
              )}
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={repairRequired}
                onChange={(event) => setRepairRequired(event.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-slate-300"
              />
              Засвар шаардлагатай
            </label>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={revisitRequired}
                onChange={(event) => setRevisitRequired(event.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-slate-300"
              />
              Дахин үзлэг шаардлагатай
            </label>

            {revisitRequired && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Дахин очих огноо" required error={fieldErrors.revisitDate}>
                  <TextInput type="date" value={revisitDate} onChange={setRevisitDate} disabled={submitting} />
                </Field>
                <Field label="Хариуцагч" required error={fieldErrors.revisitOwnerEmployeeId}>
                  <SelectInput
                    value={revisitOwnerEmployeeId}
                    onChange={setRevisitOwnerEmployeeId}
                    placeholder="Ажилтан сонгох"
                    options={employees.map((employee) => ({
                      value: employee.id,
                      label: `${employee.lastName} ${employee.firstName}`,
                    }))}
                    disabled={submitting}
                  />
                </Field>
              </div>
            )}
          </div>
        )}
      </Drawer>

      <Modal open={preview !== null} title={preview?.name ?? ''} onClose={() => setPreview(null)}>
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={preview?.name ?? ''}
            className="mx-auto max-h-[60vh] w-auto max-w-full"
          />
        ) : (
          <div className="h-48 animate-pulse rounded bg-slate-200" />
        )}
      </Modal>
    </>
  );
}
