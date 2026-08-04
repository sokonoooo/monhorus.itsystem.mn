import type { ServiceRequestAttachmentDto } from '@monhorus/shared';
import { useState, type ReactElement } from 'react';

import { Modal } from '../../components/ui/Modal';
import { useAuthorisedFileUrls } from '../../lib/use-authorised-file-urls';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The photographs and files a request was raised with.
 *
 * A customer attaches the picture that explains the fault, so on the admin side it is
 * evidence rather than decoration: the thumbnails open full size in a modal, the same way
 * work-report evidence and inspection attachments already do.
 *
 * Only images go through a thumbnail. Anything else — a PDF quote, a spreadsheet — is
 * listed by name with a download link, because pushing it into an `img` would render a
 * broken icon and say nothing about what the file is.
 *
 * `onRemove` is supplied while a request is being drafted, where the attachments are still
 * the author's to take back. On a saved request they are part of the record.
 */
export function RequestAttachments({
  attachments,
  onRemove,
  disabled = false,
}: {
  attachments: readonly ServiceRequestAttachmentDto[];
  onRemove?: (attachmentId: string) => void;
  disabled?: boolean;
}): ReactElement {
  const urls = useAuthorisedFileUrls(attachments);
  const [preview, setPreview] = useState<ServiceRequestAttachmentDto | null>(null);

  if (attachments.length === 0) {
    return <p className="text-sm text-slate-500">Хавсралт байхгүй байна.</p>;
  }

  const previewUrl = preview ? (urls[preview.id] ?? null) : null;

  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {attachments.map((attachment) => {
          const url = urls[attachment.id] ?? null;
          const isImage = attachment.mimeType.startsWith('image/');

          return (
            <li
              key={attachment.id}
              className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
            >
              {isImage ? (
                <button
                  type="button"
                  onClick={() => setPreview(attachment)}
                  disabled={url === null}
                  aria-label={`${attachment.name} томруулж харах`}
                  className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
                >
                  {url ? (
                    <img src={url} alt={attachment.name} className="h-24 w-full object-cover" />
                  ) : (
                    <div className="h-24 w-full animate-pulse bg-slate-200" />
                  )}
                </button>
              ) : (
                <div className="flex h-24 items-center justify-center bg-slate-100 px-2 text-center text-xs text-slate-500">
                  {attachment.mimeType}
                </div>
              )}

              <div className="space-y-0.5 p-2">
                <p
                  className="truncate text-[11px] font-medium text-slate-800"
                  title={attachment.name}
                >
                  {attachment.name}
                </p>
                <p className="text-[11px] text-slate-500">{formatSize(attachment.sizeBytes)}</p>
                <div className="flex items-center gap-2">
                  {url ? (
                    <a
                      href={url}
                      download={attachment.name}
                      className="text-[11px] font-medium text-blue-600 hover:underline"
                    >
                      Татах
                    </a>
                  ) : (
                    <span className="text-[11px] text-slate-400">Ачаалж байна</span>
                  )}
                  {onRemove && (
                    <button
                      type="button"
                      onClick={() => onRemove(attachment.id)}
                      disabled={disabled}
                      aria-label={`${attachment.name} хасах`}
                      className="rounded px-1 text-[11px] font-medium text-red-600 hover:bg-red-50"
                    >
                      Хасах
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {/* Reuses the object URL the thumbnail already resolved, so opening a preview costs
          no second download and there is a single URL per file to revoke. */}
      <Modal
        open={preview !== null}
        title={preview?.name ?? ''}
        onClose={() => setPreview(null)}
      >
        {previewUrl ? (
          <img src={previewUrl} alt={preview?.name ?? ''} className="mx-auto max-h-[70vh] w-auto" />
        ) : (
          <p className="py-6 text-center text-sm text-slate-500">Зураг ачаалж чадсангүй.</p>
        )}
      </Modal>
    </>
  );
}
