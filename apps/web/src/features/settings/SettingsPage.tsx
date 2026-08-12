import { MAX_COMPANY_LOGO_BYTES } from '@monhorus/shared';
import type { SettingEntryDto, SettingKey, SettingValue, SettingsDto } from '@monhorus/shared';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { settingsService } from '../../services/settings.service';

import {
  FIELD_INPUT,
  FIELD_INPUT_DIRTY,
  FIELD_INPUT_ERROR,
} from '../../components/ui/control-styles';

/**
 * System settings (requirements 16.1).
 *
 * Every control is driven by the catalogue the backend publishes: label, hint, type,
 * bounds and unit all arrive with the value, so adding a setting needs no change here.
 * The form is dirty-tracked and submits only the keys that actually changed, which is
 * what keeps the audit trail free of no-op rows.
 */

/**
 * Whether this entry is a stored file rather than a value somebody types.
 *
 * The value is still a string as far as the catalogue and the API are concerned — it holds
 * the id of an uploaded file — so this is the only thing that separates the picker from a
 * text box, and it is asked in three places: the dirty check, the payload and the control.
 */
function isFileEntry(entry: SettingEntryDto): boolean {
  return entry.type === 'file';
}

/**
 * Whether the draft for this entry travels as text rather than as a number.
 *
 * `file` holds the id of a stored file. It is only incidentally a string of digits and
 * letters — `Number('507f1f77bcf86cd799439199')` is NaN — so it has to take the same path
 * as a `string` setting all the way from the dirty check to the request body. Everything
 * else on the catalogue is numeric and is parsed as such.
 */
function isTextValued(entry: SettingEntryDto): boolean {
  return entry.type === 'string' || isFileEntry(entry);
}

function isChanged(entry: SettingEntryDto, draft: string): boolean {
  // A file compares like a string, and notably an empty draft IS a change: clearing the
  // logo is expressed by saving '' over the id, so the numeric branch's "blank means the
  // user is mid-edit, not finished" rule must not apply to it.
  if (isTextValued(entry)) return draft !== String(entry.value);
  return draft !== '' && Number(draft) !== Number(entry.value);
}

/** What the logo endpoint accepts. Stated for both the picker filter and the check below. */
const LOGO_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg'];

/**
 * Client-side ceiling for a logo, in bytes.
 *
 * A letterhead is drawn a few centimetres wide on a report, so anything past this is a
 * photograph somebody picked by mistake, and telling them so in the form beats a round
 * trip. The server has its own cap and its own content-type check; if the two numbers ever
 * disagree the server's answer is the one that decides, and its message is shown as-is.
 */
// The server's own cap, imported rather than restated: a client limit that disagrees
// with the server either rejects uploads that would work or promises ones that will not.
const MAX_LOGO_BYTES = MAX_COMPANY_LOGO_BYTES;
const LOGO_LIMIT_MB = Math.round(MAX_LOGO_BYTES / (1024 * 1024));

/**
 * Why a chosen file cannot be the logo, or null when nothing is obviously wrong with it.
 *
 * THIS IS NOT A SECURITY CHECK, and nothing downstream may be simplified on the strength of
 * it. Both rules are the browser's word for what the user picked: a `File.type` is whatever
 * the OS guessed from the extension, and a size is a number this page could not verify.
 * `POST /files/settings-logo` re-checks both, refuses anything but PNG and JPEG, and is
 * gated on `settings.manage`. Anything posted straight at the endpoint meets all of that and
 * none of this. What this buys is a user who is told "that is a PDF" in the form.
 */
function logoFileProblem(file: File): string | null {
  if (!LOGO_MIME_TYPES.includes(file.type)) {
    return 'Зөвхөн PNG эсвэл JPEG зураг байршуулна уу.';
  }
  if (file.size > MAX_LOGO_BYTES) {
    return `Лого ${LOGO_LIMIT_MB}MB-аас хэтрэхгүй байх ёстой.`;
  }
  return null;
}

/**
 * The control for a `file`-typed setting: a preview, a picker and a way to clear it.
 *
 * Two-phase, and that is the whole design. Picking a file uploads it immediately and puts
 * the returned id into the page's drafts map, so the id rides the existing dirty tracking
 * and is committed by the same Хадгалах that saves every other changed key. Nothing about
 * the save path is special-cased for it. Removing sets the draft to '', which is what the
 * catalogue's default is and what the backend reads as "no logo".
 *
 * The consequence worth knowing: an admin who uploads and then hits Буцаах has parked a
 * file the settings never named. That is the same as an object-type icon abandoned in a
 * drawer, and it is preferable to the alternative, which would be a multipart PATCH of the
 * settings document.
 */
function LogoField({
  inputId,
  value,
  onChange,
  readOnly,
  saving,
}: {
  inputId: string;
  /** The draft value: a stored-file id, or '' for no logo. */
  value: string;
  onChange: (next: string) => void;
  readOnly: boolean;
  saving: boolean;
}): ReactElement {
  /** The file picked in this session, kept beside the id the upload gave it. */
  const [uploaded, setUploaded] = useState<{ id: string; url: string } | null>(null);
  /** Object url for the logo the settings already name, when it is not the one just picked. */
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const disabled = readOnly || saving;
  /** True while the draft still names the file this session uploaded. */
  const showsUploaded = uploaded !== null && uploaded.id === value;

  /**
   * The stored logo, fetched with the session's token.
   *
   * `GET /files/:id` requires the bearer token, so a private file cannot be a bare `img
   * src` — that request goes out without the header and comes back 401. It is fetched into
   * an object url instead, which is revoked when the value changes or the page unmounts.
   *
   * The setting holds only the id, so the canonical download path is reconstructed here;
   * `authorisedFileUrl` strips the `/api/v1` the client's baseURL adds back.
   */
  useEffect(() => {
    // Nothing to fetch for a blank setting, and nothing worth fetching when the bytes are
    // already in the page: a file just picked is previewed from itself.
    if (!value || showsUploaded) {
      setStoredUrl(null);
      return undefined;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    void authorisedFileUrl(`/api/v1/files/${value}`)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setStoredUrl(url);
      })
      // A logo that will not load is not worth an error banner on a page about numbers;
      // the placeholder says as much, and the report simply prints without one.
      .catch(() => setStoredUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value, showsUploaded]);

  /**
   * A locally previewed file lives as long as the document unless it is let go of.
   *
   * The cleanup runs when `uploaded` is replaced as well as on unmount, so picking a second
   * file releases the first one's blob rather than leaking it.
   */
  useEffect(
    () => () => {
      if (uploaded) URL.revokeObjectURL(uploaded.url);
    },
    [uploaded],
  );

  const previewUrl = showsUploaded ? uploaded.url : storedUrl;

  async function handlePicked(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);

    const problem = logoFileProblem(file);
    if (problem) {
      setError(problem);
      // The rejected file is dropped, so picking the same one again re-runs the check.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const result = await settingsService.uploadLogo(file);
      // Previewed from the local file rather than by fetching back what was just sent: the
      // bytes are already here, and the round trip would tell the user nothing new.
      setUploaded({ id: result.id, url: URL.createObjectURL(file) });
      onChange(result.id);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Лого хуулж чадсангүй.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function handleRemoved(): void {
    setUploaded(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = '';
    // '' is the catalogue default for this key, so this both clears the logo and takes the
    // setting back to un-overridden once it is saved.
    onChange('');
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 text-[10px] text-slate-400 ring-1 ring-inset ring-slate-200">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt="Байгууллагын лого"
            className="max-h-10 max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <span>Лого алга</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={LOGO_MIME_TYPES.join(',')}
          disabled={disabled || uploading}
          onChange={(event) => void handlePicked(event.target.files?.[0])}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:text-slate-700"
        />
        <p className="text-xs text-slate-500">PNG эсвэл JPEG, хамгийн ихдээ {LOGO_LIMIT_MB}MB.</p>
        {uploading && <p className="text-xs text-slate-500">Лого хуулж байна…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {value !== '' && !readOnly && (
          <Button variant="ghost" size="sm" onClick={handleRemoved} disabled={disabled || uploading}>
            Лого устгах
          </Button>
        )}
      </div>
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const { notify } = useToast();

  const [data, setData] = useState<SettingsDto | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  function seedDrafts(next: SettingsDto): void {
    const seeded: Record<string, string> = {};
    for (const group of next.groups) {
      for (const entry of group.entries) {
        seeded[entry.key] = String(entry.value);
      }
    }
    setDrafts(seeded);
  }

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const next = await settingsService.get();
      setData(next);
      seedDrafts(next);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Тохиргоо ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = data?.groups.flatMap((group) => group.entries) ?? [];
  const changedKeys = entries
    .filter((entry) => isChanged(entry, drafts[entry.key] ?? ''))
    .map((entry) => entry.key);

  function describe(caught: unknown): string {
    if (caught instanceof ApiError) {
      setFieldErrors(caught.fieldErrors);
      return caught.message;
    }
    return 'Гэнэтийн алдаа гарлаа.';
  }

  async function handleSave(): Promise<void> {
    if (!data || changedKeys.length === 0) return;

    setSaving(true);
    setFormError(null);
    setFieldErrors({});

    const payload: Partial<Record<SettingKey, SettingValue>> = {};
    for (const entry of entries) {
      if (!changedKeys.includes(entry.key)) continue;
      // `isTextValued`, not `type === 'string'`: a file id put through `Number(...)` is NaN,
      // which serialises as null and would clear the logo instead of setting it.
      payload[entry.key] = isTextValued(entry)
        ? (drafts[entry.key] ?? '')
        : Number(drafts[entry.key]);
    }

    try {
      const next = await settingsService.update(payload);
      setData(next);
      seedDrafts(next);
      notify(`${changedKeys.length} тохиргоо хадгалагдлаа.`, 'success');
    } catch (caught) {
      setFormError(describe(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleReset(key: SettingKey): Promise<void> {
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const next = await settingsService.reset(key);
      setData(next);
      seedDrafts(next);
      notify('Анхны утгад буцаалаа.', 'success');
    } catch (caught) {
      setFormError(describe(caught));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) return <ErrorState description={error ?? 'Тохиргоо олдсонгүй.'} />;

  const readOnly = !data.canManage;

  return (
    <>
      <PageHeader
        title="Тохиргоо"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Тохиргоо' }]}
        actions={
          !readOnly && (
            <>
              <Button
                variant="secondary"
                onClick={() => data && seedDrafts(data)}
                disabled={saving || changedKeys.length === 0}
              >
                Буцаах
              </Button>
              <Button
                onClick={() => void handleSave()}
                loading={saving}
                disabled={changedKeys.length === 0}
              >
                Хадгалах
                {changedKeys.length > 0 ? ` (${changedKeys.length})` : ''}
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        {readOnly && (
          <Alert variant="info">
            Танд тохиргоо өөрчлөх эрх байхгүй тул зөвхөн харах горимд байна.
          </Alert>
        )}

        {data.groups.map((group) => (
          <section
            key={group.group}
            className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
          >
            <h2 className="text-sm font-semibold text-slate-900">{group.label}</h2>
            <p className="mb-4 text-xs text-slate-500">{group.description}</p>

            <div className="space-y-4">
              {group.entries.map((entry) => {
                const draft = drafts[entry.key] ?? '';
                const dirty = isChanged(entry, draft);
                const fieldError = fieldErrors[entry.key];

                return (
                  <div
                    key={entry.key}
                    className="grid grid-cols-1 gap-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0 md:grid-cols-[minmax(0,1fr)_260px]"
                  >
                    <div className="min-w-0">
                      <label
                        htmlFor={`setting-${entry.key}`}
                        className="block break-words text-sm font-medium text-slate-800"
                      >
                        {entry.label}
                      </label>
                      <p className="mt-0.5 break-words text-xs text-slate-500">{entry.hint}</p>
                      {entry.isOverridden && (
                        <p className="mt-1 text-xs text-amber-700">
                          Анхны утга {String(entry.defaultValue)}
                          {entry.unit ? ` ${entry.unit}` : ''}. Өөрчилсөн:{' '}
                          {entry.updatedByName ?? '-'}
                        </p>
                      )}
                      {fieldError && <p className="mt-1 text-xs text-red-600">{fieldError}</p>}
                    </div>

                    <div className="flex items-start gap-2">
                      <div className="flex-1">
                        {/*
                          A file is the one type that is not a box you type into, so it is
                          the one branch here. It writes to the same drafts map as every
                          other control, which is what lets the dirty count, Буцаах and
                          Хадгалах stay entirely unaware of it.
                        */}
                        {isFileEntry(entry) ? (
                          <LogoField
                            inputId={`setting-${entry.key}`}
                            value={draft}
                            onChange={(next) =>
                              setDrafts((current) => ({ ...current, [entry.key]: next }))
                            }
                            readOnly={readOnly}
                            saving={saving}
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              id={`setting-${entry.key}`}
                              type={entry.type === 'string' ? 'text' : 'number'}
                              step={entry.type === 'ratio' ? '0.01' : '1'}
                              {...(entry.min === undefined ? {} : { min: entry.min })}
                              {...(entry.max === undefined ? {} : { max: entry.max })}
                              value={draft}
                              onChange={(event) =>
                                setDrafts((current) => ({
                                  ...current,
                                  [entry.key]: event.target.value,
                                }))
                              }
                              disabled={readOnly || saving}
                              aria-invalid={fieldError ? true : undefined}
                              className={
                                fieldError
                                  ? FIELD_INPUT_ERROR
                                  : dirty
                                    ? FIELD_INPUT_DIRTY
                                    : FIELD_INPUT
                              }
                            />
                            {entry.unit && (
                              <span className="whitespace-nowrap text-xs text-slate-500">
                                {entry.unit}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {!readOnly && entry.isOverridden && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleReset(entry.key)}
                          disabled={saving}
                        >
                          Анхны утга
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
