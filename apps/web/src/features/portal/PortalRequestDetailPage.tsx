import {
  RISK_LEVEL_LABELS,
  SERVICE_REQUEST_TYPE_LABELS,
  type CustomerWorkReportDto,
  type ServiceRequestDetailDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { PortalStatusBadge, PortalUrgentBadge } from './PortalBadges';

function formatDateTime(iso: string | null): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' });
}

function Row({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value}</dd>
    </div>
  );
}

/**
 * One of the customer's own requests.
 *
 * DELIBERATELY NOT `ServiceRequestDetailPage`. That screen renders a "Хариуцагч" card
 * listing the assigned team, the assigned employees and their employee codes with no
 * permission gate on it, and it mounts the internal work-conclusion panel — the
 * DRAFT/SUBMITTED/RETURNED review surface, its materials and its return-for-fix reason.
 * Reusing it and hiding pieces would make every field added to it later customer-visible
 * by default. This screen names what it shows instead.
 *
 * NOTE THE ASYMMETRY THIS LEAVES: the request detail endpoint still SENDS the assignment
 * and the status history — the server does not narrow that payload — so this screen is a
 * presentation choice, not a boundary. It is the right thing to do here and it is not
 * sufficient on its own; narrowing that DTO server-side is a backend change and therefore
 * out of scope under the current constraints.
 */
export function PortalRequestDetailPage(): ReactElement {
  const { requestId } = useParams<{ requestId: string }>();

  const [request, setRequest] = useState<ServiceRequestDetailDto | null>(null);
  const [report, setReport] = useState<CustomerWorkReportDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!requestId) return;
    setLoading(true);
    setError(null);
    setReportError(null);

    try {
      const detail = await portalService.getRequest(requestId);
      setRequest(detail);

      /**
       * Only asked for when the record says it exists. The customer conclusion endpoint
       * answers 404 for anything unapproved — deliberately, so its state cannot be
       * inferred — and calling it speculatively would make every request detail fire a
       * request it expects to fail.
       */
      if (detail.hasApprovedReport) {
        try {
          setReport(await portalService.customerReport(requestId));
        } catch (caught) {
          // The request loaded; a conclusion that will not load is a partial failure and
          // must not blank the page that succeeded.
          setReportError(
            caught instanceof ApiError ? caught.message : 'Дүгнэлт ачаалж чадсангүй.',
          );
        }
      } else {
        setReport(null);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хүсэлт ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error || !request) {
    return (
      <ErrorState
        description={error ?? 'Хүсэлт олдсонгүй.'}
        action={<Button onClick={() => void load()}>Дахин оролдох</Button>}
      />
    );
  }

  return (
    <>
      <PageHeader
        title={request.requestNumber}
        backTo={{ to: '/portal/requests', label: 'Миний хүсэлт рүү буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Миний хүсэлт', to: '/portal/requests' },
          { label: request.requestNumber },
        ]}
      />

      <div className="space-y-4">
        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <PortalStatusBadge status={request.status} />
            {request.isUrgent && <PortalUrgentBadge />}
          </div>

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Row label="Төрөл" value={SERVICE_REQUEST_TYPE_LABELS[request.requestType]} />
            <Row
              label="Байршил"
              value={
                [request.building?.name, request.floor?.name].filter(Boolean).join(' · ') || '-'
              }
            />
            <Row label="Илгээсэн" value={formatDateTime(request.createdAt)} />
            <Row label="Холбоо барих" value={request.contactName} />
            <Row label="Утас" value={request.contactPhone} />
          </dl>

          <div className="mt-4">
            <p className="text-xs font-medium text-slate-500">Тайлбар</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
              {request.description}
            </p>
          </div>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <p className="mb-2 text-sm font-semibold text-slate-900">Дүгнэлт</p>

          {reportError && <Alert variant="warning">{reportError}</Alert>}

          {!request.hasApprovedReport && !reportError && (
            <p className="text-sm text-slate-600">
              Ажил дуусаж, дүгнэлт батлагдсаны дараа энд харагдана.
            </p>
          )}

          {report && (
            <div className="space-y-4">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                <Row label="Үнэлгээ" value={report.score === null ? '-' : `${report.score}`} />
                <Row
                  label="Эрсдэлийн түвшин"
                  value={report.riskLevel ? RISK_LEVEL_LABELS[report.riskLevel] : '-'}
                />
                <Row label="Баталсан" value={formatDateTime(report.approvedAt)} />
              </dl>

              {report.conclusion && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Дүгнэлт</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {report.conclusion}
                  </p>
                </div>
              )}

              {report.recommendation && (
                <div>
                  <p className="text-xs font-medium text-slate-500">Зөвлөмж</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-sm text-slate-800">
                    {report.recommendation}
                  </p>
                </div>
              )}

              {(report.repairRequired || report.revisitRequired) && (
                <Alert variant="warning">
                  {report.repairRequired && <span className="block">Засвар шаардлагатай.</span>}
                  {report.revisitRequired && (
                    <span className="block">
                      Дахин үзлэг шаардлагатай
                      {report.revisitDate ? `: ${formatDateTime(report.revisitDate)}` : ''}.
                    </span>
                  )}
                </Alert>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
