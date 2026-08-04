import {
  MATERIAL_UNIT_LABELS,
  type PlannedWorkPhotoDto,
  type PlannedWorkTaskDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Drawer } from '../../components/ui/Drawer';
import { Modal } from '../../components/ui/Modal';
import { formatMinutes } from '../../lib/duration';
import { authorisedFileUrl } from '../../lib/file-url';
import { ScoreBar } from '../projects/objects/ObjectBadges';
import { ProgressBar, TaskStatusBadge } from './PlannedWorkBadges';

interface TaskDetailDrawerProps {
  task: PlannedWorkTaskDto | null;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}

/**
 * Who signed the Дүгнэлт, and when. Name and stamp on one line rather than two rows,
 * because neither half means much alone.
 */
function conclusionAuthor(task: PlannedWorkTaskDto): string {
  if (!task.conclusionByName && !task.conclusionAt) return '-';
  const name = task.conclusionByName ?? 'Тодорхойгүй';
  return task.conclusionAt ? `${name} · ${formatDateTime(task.conclusionAt)}` : name;
}

function DetailRow({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">{value}</dd>
    </div>
  );
}

/**
 * Read-only sub-task detail for a reviewing administrator.
 *
 * Attachments are fetched with the caller's bearer token and turned into object URLs,
 * because the download route is authenticated and a private file therefore cannot be used
 * as a bare `src` or `href`. The same object URL backs the thumbnail, the enlarged preview
 * and the download link, so one fetch serves all three and there is a single URL to revoke.
 */
export function TaskDetailDrawer({ task, onClose }: TaskDetailDrawerProps): ReactElement {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<PlannedWorkPhotoDto | null>(null);

  useEffect(() => {
    if (!task) {
      setUrls({});
      return undefined;
    }

    let cancelled = false;
    const created: string[] = [];
    const photos = [...task.beforePhotos, ...task.afterPhotos];

    void Promise.all(
      photos.map(async (photo) => {
        try {
          const url = await authorisedFileUrl(photo.downloadUrl);
          created.push(url);
          return [photo.id, url] as const;
        } catch {
          // One unreadable attachment must not blank out the rest of the set.
          return null;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setUrls(Object.fromEntries(entries.filter((entry) => entry !== null)));
    });

    return () => {
      cancelled = true;
      for (const url of created) URL.revokeObjectURL(url);
    };
  }, [task]);

  function attachment(photo: PlannedWorkPhotoDto): ReactElement {
    const url = urls[photo.id] ?? null;
    const isImage = photo.mimeType.startsWith('image/');

    return (
      <li
        key={photo.id}
        className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
      >
        {isImage ? (
          <button
            type="button"
            onClick={() => setPreview(photo)}
            disabled={url === null}
            aria-label={`${photo.name} томруулж харах`}
            className="block w-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-600"
          >
            {url ? (
              <img src={url} alt={photo.name} className="h-28 w-full object-cover" />
            ) : (
              <div className="h-28 w-full animate-pulse bg-slate-200" />
            )}
          </button>
        ) : (
          <div className="flex h-28 items-center justify-center bg-slate-100 px-2 text-center text-xs text-slate-500">
            {photo.mimeType}
          </div>
        )}

        <div className="space-y-0.5 p-2">
          <p className="truncate text-xs font-medium text-slate-800" title={photo.name}>
            {photo.name}
          </p>
          <p className="text-[11px] text-slate-500">
            {formatSize(photo.sizeBytes)} · {photo.uploadedByName ?? '-'}
          </p>
          {url ? (
            <a
              href={url}
              download={photo.name}
              className="text-xs font-medium text-blue-600 hover:underline"
            >
              Татах
            </a>
          ) : (
            <span className="text-xs text-slate-400">Ачаалж байна</span>
          )}
        </div>
      </li>
    );
  }

  function attachmentSection(
    label: string,
    photos: readonly PlannedWorkPhotoDto[],
  ): ReactElement {
    return (
      <div>
        <h3 className="mb-1.5 text-xs font-medium text-slate-600">{label}</h3>
        {photos.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
            Хавсралт байхгүй.
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">{photos.map(attachment)}</ul>
        )}
      </div>
    );
  }

  const previewUrl = preview ? (urls[preview.id] ?? null) : null;

  return (
    <>
      <Drawer
        open={task !== null}
        title={task ? `${task.title} - дэлгэрэнгүй` : ''}
        onClose={onClose}
        width="lg"
      >
        {task && (
          <div className="space-y-4">
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

            <div>
              <span className="mb-1 block text-xs text-slate-500">Үнэлгээ</span>
              <ScoreBar level={task.riskLevel} score={task.score} showPill />
            </div>

            <dl className="space-y-3">
              <DetailRow label="Тайлбар" value={task.note ?? '-'} />
              <DetailRow label="Дүгнэлт" value={task.conclusion ?? '-'} />
              {/*
                Directly under the verdict, because the two are read together: any member
                of the assigned team can write over this field, so the sentence alone does
                not say whose judgement it is.
              */}
              <DetailRow label="Дүгнэлт бичсэн" value={conclusionAuthor(task)} />
              <DetailRow label="Зөвлөмж" value={task.recommendation ?? '-'} />
              <DetailRow
                label="Хамрах тоноглол"
                value={
                  task.relatedObjects.length === 0
                    ? 'Сонгоогүй'
                    : task.relatedObjects.map((object) => object.name).join(', ')
                }
              />
              <DetailRow label="Ажилтан" value={task.assignedEmployeeName ?? '-'} />
              <DetailRow label="Дууссан" value={formatDateTime(task.completedAt)} />
              {/*
                Wall clock from the first reported start to the instant the quantity was
                finished — server-computed, and a dash while it cannot yet be stated. It is
                not the gap to `Дууссан` above: that one waits for the evidence gate, so a
                job finished on Monday and photographed on Wednesday would read as two days.
              */}
              <DetailRow label="Гүйцэтгэсэн хугацаа" value={formatMinutes(task.durationMinutes)} />
            </dl>

            {attachmentSection('Ажлын өмнөх хавсралт', task.beforePhotos)}
            {attachmentSection('Ажлын дараах хавсралт', task.afterPhotos)}
          </div>
        )}
      </Drawer>

      <Modal
        open={preview !== null}
        title={preview?.name ?? ''}
        onClose={() => setPreview(null)}
      >
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
