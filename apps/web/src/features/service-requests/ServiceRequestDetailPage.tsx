import {
  PERMISSIONS,
  SERVICE_REQUEST_STATUS_LABELS,
  SERVICE_REQUEST_TRANSITIONS,
  SERVICE_REQUEST_TYPE_LABELS,
  isReasonRequired,
  type ServiceRequestDetailDto,
  type ServiceRequestStatus,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { WorkReportPanel } from './WorkReportPanel';
import { RequestStatusBadge, SlaBadge, UrgentBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { serviceRequestService } from '../../services/service-request.service';

function Row({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-slate-900">{value ?? '-'}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function ServiceRequestDetailPage(): ReactElement {
  const { requestId } = useParams<{ requestId: string }>();
  const { can } = useAuth();
  const { notify } = useToast();

  const [request, setRequest] = useState<ServiceRequestDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<ServiceRequestStatus | null>(null);
  const [slaDialogOpen, setSlaDialogOpen] = useState(false);

  useEffect(() => {
    if (!requestId) return undefined;

    let cancelled = false;
    setLoading(true);

    serviceRequestService
      .getById(requestId)
      .then((result) => {
        if (!cancelled) setRequest(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Хүсэлт ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [requestId]);

  async function applyStatus(status: ServiceRequestStatus, reason: string): Promise<void> {
    if (!requestId) return;

    try {
      const updated = await serviceRequestService.changeStatus(requestId, {
        status,
        ...(reason ? { reason } : {}),
      });
      setRequest(updated);
      notify(`Төлөв "${SERVICE_REQUEST_STATUS_LABELS[status]}" болж өөрчлөгдлөө.`, 'success');
    } catch (caught) {
      // The backend is the authority on transitions; surface its refusal verbatim.
      notify(caught instanceof ApiError ? caught.message : 'Төлөв өөрчилж чадсангүй.', 'error');
    } finally {
      setPendingStatus(null);
    }
  }

  async function extendSla(reason: string): Promise<void> {
    if (!requestId) return;

    try {
      const updated = await serviceRequestService.extendSla(requestId, {
        additionalMinutes: 120,
        reason,
      });
      setRequest(updated);
      notify('SLA 2 цагаар сунгагдлаа.', 'success');
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'SLA сунгаж чадсангүй.', 'error');
    } finally {
      setSlaDialogOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !request) {
    return <ErrorState description={error ?? 'Хүсэлт олдсонгүй.'} />;
  }

  // Only transitions the backend will accept are offered.
  const allowedTransitions = SERVICE_REQUEST_TRANSITIONS[request.status];
  const canChangeStatus = can(PERMISSIONS.SERVICE_REQUEST_CHANGE_STATUS);

  return (
    <>
      <PageHeader
        title={request.requestNumber}
        description={SERVICE_REQUEST_TYPE_LABELS[request.requestType]}
        backTo={{ to: '/service-requests', label: 'Хүсэлтийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Үйлчилгээний хүсэлт', to: '/service-requests' },
          { label: request.requestNumber },
        ]}
        actions={
          can(PERMISSIONS.DISPATCH_EXTEND_SLA) && request.status !== 'COMPLETED' ? (
            <Button variant="secondary" onClick={() => setSlaDialogOpen(true)}>
              SLA сунгах
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Төлөв">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <RequestStatusBadge status={request.status} />
              {request.isUrgent && <UrgentBadge />}
              <SlaBadge state={request.slaState} remainingMinutes={request.slaRemainingMinutes} />
            </div>
            <Row
              label="SLA дуусах"
              value={
                request.slaDueAt
                  ? new Date(request.slaDueAt).toLocaleString('mn-MN', {
                      timeZone: 'Asia/Ulaanbaatar',
                    })
                  : null
              }
            />
            <Row
              label="Сунгасан"
              value={request.slaExtendedMinutes > 0 ? `${request.slaExtendedMinutes} минут` : null}
            />
            <Row label="Сунгах шалтгаан" value={request.slaExtensionReason} />

            {canChangeStatus && allowedTransitions.length > 0 && (
              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="mb-2 text-xs font-medium text-slate-600">Төлөв өөрчлөх</p>
                <div className="flex flex-wrap gap-1.5">
                  {allowedTransitions.map((status) => (
                    <Button
                      key={status}
                      size="sm"
                      variant={status === 'CANCELLED' ? 'danger' : 'secondary'}
                      onClick={() => setPendingStatus(status)}
                    >
                      {SERVICE_REQUEST_STATUS_LABELS[status]}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </Card>

          <Card title="Хариуцагч">
            {request.assignedTeam && <Row label="Баг" value={request.assignedTeam.name} />}
            {request.assignedEmployees.length === 0 ? (
              <p className="text-sm text-slate-500">Хуваарилагдаагүй байна.</p>
            ) : (
              <ul className="space-y-1.5">
                {request.assignedEmployees.map((employee) => (
                  <li key={employee.id} className="text-sm text-slate-900">
                    {employee.lastName} {employee.firstName}
                    <span className="ml-1.5 text-xs text-slate-500">{employee.employeeCode}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <WorkReportPanel requestId={request.id} buildingId={request.building?.id ?? null} />

          <Card title="Байршил">
            <Row label="Харилцагч" value={request.customer?.name} />
            <Row label="Салбар" value={request.branch} />
            <Row label="Төсөл" value={request.project?.name} />
            <Row label="Барилга/объект" value={request.building?.name} />
            <Row label="Давхар" value={request.floor?.name} />
            <Row label="Өрөө/бүс" value={request.room?.name} />
            <Row label="Самбар" value={request.panel?.name} />
            <Row label="Хэлхээ/шугам" value={request.circuit?.name} />
            <Row label="Төхөөрөмж" value={request.device?.name} />
          </Card>

          <Card title="Хүсэлтийн агуулга">
            <Row label="Холбоо барих" value={`${request.contactName} · ${request.contactPhone}`} />
            <Row
              label="Үүсгэсэн"
              value={`${request.createdByName ?? '-'} · ${new Date(request.createdAt).toLocaleString('mn-MN', { timeZone: 'Asia/Ulaanbaatar' })}`}
            />
            <div className="pt-2">
              <p className="mb-1 text-xs text-slate-500">Тайлбар</p>
              <p className="whitespace-pre-wrap break-words text-sm text-slate-900">
                {request.description}
              </p>
            </div>
          </Card>

          <Card title="Төлөвийн түүх">
            {request.statusHistory.length === 0 ? (
              <p className="text-sm text-slate-500">Түүх байхгүй байна.</p>
            ) : (
              <ol className="space-y-2">
                {request.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <div className="min-w-0">
                      <p className="text-slate-900">
                        {entry.fromStatus
                          ? `${SERVICE_REQUEST_STATUS_LABELS[entry.fromStatus]} → `
                          : ''}
                        {SERVICE_REQUEST_STATUS_LABELS[entry.toStatus]}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(entry.changedAt).toLocaleString('mn-MN', {
                          timeZone: 'Asia/Ulaanbaatar',
                        })}
                        {entry.changedByName ? ` · ${entry.changedByName}` : ''}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={pendingStatus !== null}
        title="Төлөв өөрчлөх"
        message={
          pendingStatus
            ? `Хүсэлтийн төлөвийг "${SERVICE_REQUEST_STATUS_LABELS[pendingStatus]}" болгох уу?`
            : ''
        }
        confirmLabel="Өөрчлөх"
        danger={pendingStatus === 'CANCELLED'}
        requireReason={pendingStatus !== null && isReasonRequired(pendingStatus)}
        onCancel={() => setPendingStatus(null)}
        onConfirm={(reason) => (pendingStatus ? applyStatus(pendingStatus, reason) : undefined)}
      />

      <ConfirmDialog
        open={slaDialogOpen}
        title="SLA сунгах"
        message="SLA хугацааг 2 цагаар сунгах уу? Шалтгаан audit log-д хадгалагдана."
        confirmLabel="Сунгах"
        requireReason
        onCancel={() => setSlaDialogOpen(false)}
        onConfirm={extendSla}
      />
    </>
  );
}
