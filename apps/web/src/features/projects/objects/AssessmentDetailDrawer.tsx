import type { ObjectAssessmentDto, ObjectPhotoDto } from '@monhorus/shared';
import type { ReactElement, ReactNode } from 'react';

import { Button } from '../../../components/ui/Button';
import { Drawer } from '../../../components/ui/Drawer';
import { LoadMeasurementList } from './LoadMeasurements';
import { ScoreBar } from './ObjectBadges';

interface AssessmentDetailDrawerProps {
  assessment: ObjectAssessmentDto | null;
  /**
   * Object URLs for the evidence, keyed by photo id.
   *
   * The download route is authenticated, so the page fetches every attachment once and owns
   * the URLs. The drawer only reads them: a panel that fetched on open would download the
   * same file twice and leave a second URL to revoke.
   */
  photoUrls: Record<string, string>;
  onPreview: (photo: ObjectPhotoDto) => void;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function DetailRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/**
 * One stored assessment, read-only (requirement 10.1).
 *
 * The history table lists what can be scanned in a column; everything else about an
 * assessment is read here, including the evidence that used to squeeze into a table cell as
 * a thumbnail. Nothing in the panel can change a recorded assessment: the history is
 * append-only, so the only control is the one that enlarges a photo.
 *
 * Who recorded it and when opens the panel rather than closing it. An assessment is a
 * person's judgement, and the reader's first question about a judgement is whose it was.
 */
export function AssessmentDetailDrawer({
  assessment,
  photoUrls,
  onPreview,
  onClose,
}: AssessmentDetailDrawerProps): ReactElement {
  return (
    <Drawer
      open={assessment !== null}
      title="Үнэлгээний дэлгэрэнгүй"
      onClose={onClose}
      width="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      {assessment && (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <ScoreBar level={assessment.riskLevel} score={assessment.newScore} showPill />
              {assessment.previousScore !== null && (
                <span className="text-xs text-slate-500">
                  Өмнөх оноо {assessment.previousScore}
                </span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-3">
              {/* The person who wrote the verdict, where one was recorded per piece of
                  equipment. "Бүртгэгдээгүй" rather than the approver's name: this row is
                  not a claim that nobody judged it, only that no author was captured, and
                  the sign-off below is the name to read in that case. */}
              <DetailRow label="Дүгнэлт бичсэн">
                {assessment.judgedByName ?? 'Бүртгэгдээгүй'}
              </DetailRow>
              {/* A null name is a legacy row: the user record behind it was never
                  denormalised, and saying so is honest where a dash reads as a bug. */}
              <DetailRow label="Баталгаажуулсан">
                {assessment.assessedByName ?? 'Тодорхойгүй'}
              </DetailRow>
              <DetailRow label="Үнэлсэн огноо">{formatDateTime(assessment.assessedAt)}</DetailRow>
            </dl>
          </div>

          <dl className="space-y-3">
            <DetailRow label="Тайлбар">{assessment.conclusion ?? '-'}</DetailRow>
            <DetailRow label="Зөвлөмж">{assessment.recommendation ?? '-'}</DetailRow>
            <DetailRow label="Арга хэмжээ">{assessment.actionTaken ?? '-'}</DetailRow>
          </dl>

          {/* Read next to the kW figure, not merged with it: only the kW figure is what
              any total adds up, and the amps are what explain it. */}
          {assessment.measurements.length > 0 && (
            <div className="border-t border-slate-200 pt-4">
              <h3 className="mb-1.5 text-xs text-slate-500">Хэмжилтүүд</h3>
              <LoadMeasurementList measurements={assessment.measurements} />
            </div>
          )}

          <dl className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-4">
            <DetailRow label="Хэмжсэн ачаалал">
              {assessment.measuredLoadKw === null ? '-' : `${assessment.measuredLoadKw} kW`}
            </DetailRow>
            <DetailRow label="Засвар шаардлагатай">
              {assessment.repairRequired ? 'Тийм' : 'Үгүй'}
            </DetailRow>
            <DetailRow label="Дахин үзлэг">
              {assessment.revisitRequired ? 'Тийм' : 'Үгүй'}
            </DetailRow>
            <DetailRow label="Дахин үзлэгийн огноо">
              {assessment.revisitDate === null ? '-' : assessment.revisitDate.slice(0, 10)}
            </DetailRow>
            <DetailRow label="Дахин үзлэг хариуцагч">
              {assessment.revisitOwnerName ?? '-'}
            </DetailRow>
            <DetailRow label="Эх сурвалж">{assessment.sourceLabel ?? '-'}</DetailRow>
            <DetailRow label="Бүртгэсэн">{formatDateTime(assessment.createdAt)}</DetailRow>
          </dl>

          <div className="border-t border-slate-200 pt-4">
            <h3 className="mb-1.5 text-xs font-medium text-slate-600">Нотлох зураг</h3>
            {assessment.photos.length === 0 ? (
              // Assessments recorded before evidence was required have none; they still read.
              <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500 ring-1 ring-inset ring-slate-200">
                Зураг хавсаргаагүй.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {assessment.photos.map((photo) => {
                  const url = photoUrls[photo.id] ?? null;
                  return (
                    <li
                      key={photo.id}
                      className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-inset ring-slate-200"
                    >
                      <button
                        type="button"
                        onClick={() => onPreview(photo)}
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
                      <div className="space-y-0.5 p-2">
                        <p
                          className="truncate text-xs font-medium text-slate-800"
                          title={photo.name}
                        >
                          {photo.name}
                        </p>
                        <p className="text-[11px] text-slate-500">{photo.uploadedByName ?? '-'}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
