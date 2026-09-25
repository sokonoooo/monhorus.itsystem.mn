import { useEffect, useRef, useState, type ReactElement } from 'react';

import { ApiError } from '../../lib/api-client';
import { authorisedFileUrl } from '../../lib/file-url';
import { Button } from './Button';

/**
 * Picking a logo, previewing it, and clearing it — for any form that holds one.
 *
 * WHAT MAKES THIS A COMPONENT rather than a file input is the two-phase upload. A logo is
 * bytes, but the field that holds it is a stored-file id: choosing a file POSTs it
 * immediately and the form's value becomes the id that came back, which then rides the
 * form's ordinary save. That means a picked-and-abandoned logo leaves an unreferenced file
 * behind, which is deliberate — the alternative is a multipart save of the whole record,
 * and an orphaned image in a drawer is cheaper than that.
 *
 * The preview is fetched rather than linked. `GET /files/:id` requires the session's
 * bearer token, so a private file cannot be a bare `img src`: that request goes out
 * without the header and comes back 401. It is read into an object url instead, revoked
 * when the value changes or the form unmounts.
 */
export function LogoPicker({
  inputId,
  value,
  onChange,
  upload,
  accept,
  maxBytes,
  label,
  emptyLabel,
  removeLabel,
  disabled = false,
}: {
  inputId: string;
  /** The field's value: a stored-file id, or null for no logo. */
  value: string | null;
  onChange: (next: string | null) => void;
  /** Sends the bytes and answers with the id they were stored under. */
  upload: (file: File) => Promise<{ id: string }>;
  /** The MIME types the endpoint accepts, for the picker's filter and the local check. */
  accept: readonly string[];
  maxBytes: number;
  /** Alternative text for the preview image. */
  label: string;
  /** What the empty preview box says. */
  emptyLabel: string;
  removeLabel: string;
  disabled?: boolean;
}): ReactElement {
  /** The file picked in this session, kept beside the id the upload gave it. */
  const [uploaded, setUploaded] = useState<{ id: string; url: string } | null>(null);
  /** Object url for the logo the record already names, when it is not the one just picked. */
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /** True while the field still names the file this session uploaded. */
  const showsUploaded = uploaded !== null && uploaded.id === value;

  useEffect(() => {
    // Nothing to fetch for an empty field, and nothing worth fetching when the bytes are
    // already in the page: a file just picked is previewed from itself.
    if (value === null || value === '' || showsUploaded) {
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
      // A logo that will not load is not worth an error banner on the form around it; the
      // placeholder says as much, and the report simply prints without one.
      .catch(() => setStoredUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [value, showsUploaded]);

  /**
   * A locally previewed file lives as long as the document unless it is let go of.
   *
   * The cleanup runs when `uploaded` is replaced as well as on unmount, so picking a
   * second file releases the first one's blob rather than leaking it.
   */
  useEffect(
    () => () => {
      if (uploaded) URL.revokeObjectURL(uploaded.url);
    },
    [uploaded],
  );

  const previewUrl = showsUploaded ? uploaded.url : storedUrl;
  const limitMb = Math.round(maxBytes / (1024 * 1024));

  /**
   * Why a chosen file cannot be the logo, or null when nothing is obviously wrong.
   *
   * NOT A SECURITY CHECK. `File.type` is whatever the browser inferred from the name, and
   * the size is read from the same untrusted place. The upload endpoint re-checks both and
   * decodes the bytes besides; this only saves a doomed round trip.
   */
  function problemWith(file: File): string | null {
    if (!accept.includes(file.type)) return 'PNG эсвэл JPEG зураг сонгоно уу.';
    if (file.size > maxBytes) return `Зураг ${limitMb}MB-аас бага байна.`;
    return null;
  }

  async function handlePicked(file: File | undefined): Promise<void> {
    if (!file) return;
    setError(null);

    const problem = problemWith(file);
    if (problem) {
      setError(problem);
      // The rejected file is dropped, so picking the same one again re-runs the check.
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setUploading(true);
    try {
      const result = await upload(file);
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
    onChange(null);
  }

  return (
    <div className="flex items-start gap-3">
      <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50 text-[10px] text-slate-400 ring-1 ring-inset ring-slate-200">
        {previewUrl ? (
          <img
            src={previewUrl}
            alt={label}
            className="max-h-10 max-w-full object-contain"
            draggable={false}
          />
        ) : (
          <span>{emptyLabel}</span>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={accept.join(',')}
          disabled={disabled || uploading}
          onChange={(event) => void handlePicked(event.target.files?.[0])}
          className="block w-full text-xs text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-xs file:text-slate-700"
        />
        <p className="text-xs text-slate-500">PNG эсвэл JPEG, хамгийн ихдээ {limitMb}MB.</p>
        {uploading && <p className="text-xs text-slate-500">Лого хуулж байна…</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {value !== null && value !== '' && (
          <Button variant="ghost" size="sm" onClick={handleRemoved} disabled={disabled || uploading}>
            {removeLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
