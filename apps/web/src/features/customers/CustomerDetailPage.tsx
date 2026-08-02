import {
  PERMISSIONS,
  type PermissionKey,
  SERVICE_AGREEMENT_STATUS_LABELS,
  SERVICE_FREQUENCY_LABELS,
  type CustomerDto,
  type ServiceAgreementDto,
  type ServiceRequestListItemDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { RequestStatusBadge, SlaBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { CustomerInvoicesTab } from './CustomerInvoicesTab';
import { CustomerPortalAccessTab } from './CustomerPortalAccessTab';
import { CustomerObjectsTab } from './CustomerObjectsTab';
import { CustomerPlannedWorkTab } from './CustomerPlannedWorkTab';
import { objectService } from '../../services/object.service';
import { serviceAgreementService } from '../../services/service-agreement.service';
import { serviceRequestService } from '../../services/service-request.service';
import { AgreementDrawer } from './AgreementDrawer';

type TabKey =
  | 'general'
  | 'objects'
  | 'agreements'
  | 'plannedWork'
  | 'requests'
  | 'invoices'
  | 'portalAccess';

/**
 * Requirements 6.1 tab structure, in order.
 *
 * The Мэдэгдэл ба Audit log tab was removed on the product owner's instruction: both are
 * available in their own modules and neither was answering a question anyone asked here.
 */
const TABS: ReadonlyArray<{ key: TabKey; label: string; permission?: PermissionKey }> = [
  { key: 'general', label: 'Ерөнхий мэдээлэл' },
  { key: 'objects', label: 'Төсөл ба объект' },
  { key: 'agreements', label: 'Үйлчилгээний нөхцөл' },
  { key: 'plannedWork', label: 'Төлөвлөгөөт ажил' },
  { key: 'requests', label: 'Хүсэлт ба үйлчилгээний түүх' },
  { key: 'invoices', label: 'Нэхэмжлэл ба төлбөр' },
  // Only for a caller who can read the user directory. A tab whose whole content is a
  // permission error is worse than no tab: it advertises a screen and then refuses it.
  { key: 'portalAccess', label: 'Нэвтрэх эрх', permission: PERMISSIONS.USER_VIEW },
];

function Row({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-slate-900">{value ?? '-'}</span>
    </div>
  );
}

export function CustomerDetailPage(): ReactElement {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();
  const visibleTabs = TABS.filter((tab) => !tab.permission || can(tab.permission));

  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [customer, setCustomer] = useState<CustomerDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [agreements, setAgreements] = useState<ServiceAgreementDto[] | null>(null);
  const [requests, setRequests] = useState<ServiceRequestListItemDto[] | null>(null);
  const [tabError, setTabError] = useState<string | null>(null);
  const [agreementDrawerOpen, setAgreementDrawerOpen] = useState(false);

  const loadCustomer = useCallback(async (): Promise<void> => {
    if (!customerId) return;
    setLoading(true);
    setError(null);
    try {
      setCustomer(await objectService.getCustomer(customerId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Харилцагч ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void loadCustomer();
  }, [loadCustomer]);

  const loadAgreements = useCallback(async (): Promise<void> => {
    if (!customerId) return;
    setTabError(null);
    try {
      setAgreements(await serviceAgreementService.listForCustomer(customerId));
    } catch (caught) {
      setTabError(caught instanceof ApiError ? caught.message : 'Нөхцөл ачаалж чадсангүй.');
    }
  }, [customerId]);

  // Each tab loads on first open rather than all at once on mount.
  useEffect(() => {
    if (activeTab === 'agreements' && agreements === null) void loadAgreements();

    if (activeTab === 'requests' && requests === null && customerId) {
      setTabError(null);
      serviceRequestService
        .list({ customerId, limit: 20 })
        .then((page) => setRequests(page.items))
        .catch((caught: unknown) =>
          setTabError(caught instanceof ApiError ? caught.message : 'Хүсэлт ачаалж чадсангүй.'),
        );
    }
  }, [activeTab, agreements, requests, customerId, loadAgreements]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !customer) {
    return <ErrorState description={error ?? 'Харилцагч олдсонгүй.'} />;
  }

  return (
    <>
      <PageHeader
        title={customer.name}
        description={`${customer.code}${customer.registrationNumber ? ` · РД ${customer.registrationNumber}` : ''}`}
        backTo={{ to: '/customers', label: 'Харилцагчийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Харилцагч', to: '/customers' },
          { label: customer.name },
        ]}
        actions={
          can(PERMISSIONS.CUSTOMER_MANAGE) ? (
            <Button onClick={() => navigate(`/customers/${customer.id}/edit`)}>Засах</Button>
          ) : null
        }
      />

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <div
          role="tablist"
          aria-label="Харилцагчийн дэлгэрэнгүй"
          className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 pt-2"
        >
          {visibleTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tabError && (
            <div className="mb-4">
              <Alert variant="error">{tabError}</Alert>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="grid grid-cols-1 gap-x-8 md:grid-cols-2">
              <div>
                <Row label="Байгууллагын нэр" value={customer.name} />
                <Row label="Код" value={customer.code} />
                <Row label="Регистрийн дугаар" value={customer.registrationNumber} />
                <Row label="Татвар төлөгчийн дугаар" value={customer.taxNumber} />
                <Row label="Төлөв" value={customer.isActive ? 'Идэвхтэй' : 'Идэвхгүй'} />
              </div>
              <div>
                <Row label="Холбоо барих хүн" value={customer.contactPerson} />
                <Row label="Утас" value={customer.phone} />
                <Row label="Имэйл" value={customer.email} />
                <Row label="Хаяг" value={customer.address} />
                <Row label="Хариуцсан ажилтан" value={customer.responsibleEmployeeName} />
              </div>
              {customer.notes && (
                <div className="md:col-span-2 mt-3">
                  <p className="mb-1 text-xs text-slate-500">Тэмдэглэл</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-900">
                    {customer.notes}
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'objects' && <CustomerObjectsTab customerId={customer.id} />}

          {activeTab === 'agreements' && (
            <div>
              {can(PERMISSIONS.CUSTOMER_MANAGE) && (
                <div className="mb-3">
                  <Button size="sm" onClick={() => setAgreementDrawerOpen(true)}>
                    Шинэ нөхцөл нэмэх
                  </Button>
                </div>
              )}

              {agreements === null ? (
                <Skeleton className="h-32 w-full" />
              ) : agreements.length === 0 ? (
                <EmptyState
                  title="Үйлчилгээний нөхцөл байхгүй"
                  description="Идэвхтэй нөхцөл байхгүй тохиолдолд calendar болон нэхэмжлэл үүсэхгүй."
                />
              ) : (
                <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Дугаар</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Хугацаа</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Төрөл</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">SLA</th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Давтамж</th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700">
                          Сарын төлбөр
                        </th>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">Төлөв</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {agreements.map((agreement) => (
                        <tr key={agreement.id}>
                          <td className="px-3 py-2 font-medium">{agreement.agreementNumber}</td>
                          <td className="whitespace-nowrap px-3 py-2">
                            {agreement.startDate.slice(0, 10)} - {agreement.endDate.slice(0, 10)}
                          </td>
                          <td className="px-3 py-2">{agreement.serviceType}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs">
                            Яаралтай {agreement.slaUrgentHours}ц / Энгийн{' '}
                            {agreement.slaStandardHours}ц
                          </td>
                          <td className="px-3 py-2">
                            {agreement.frequency
                              ? SERVICE_FREQUENCY_LABELS[agreement.frequency]
                              : '-'}
                          </td>
                          <td className="px-3 py-2 text-right font-medium">
                            {agreement.monthlyFee.toLocaleString('mn-MN')} {agreement.currency}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                                agreement.status === 'ACTIVE'
                                  ? 'bg-green-50 text-green-700 ring-green-200'
                                  : agreement.status === 'CANCELLED' ||
                                      agreement.status === 'EXPIRED'
                                    ? 'bg-slate-100 text-slate-600 ring-slate-200'
                                    : 'bg-amber-50 text-amber-700 ring-amber-200'
                              }`}
                            >
                              {SERVICE_AGREEMENT_STATUS_LABELS[agreement.status]}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === 'requests' && (
            <div>
              {requests === null ? (
                <Skeleton className="h-32 w-full" />
              ) : requests.length === 0 ? (
                <EmptyState
                  title="Хүсэлт байхгүй"
                  description="Энэ харилцагчид бүртгэгдсэн үйлчилгээний хүсэлт алга."
                />
              ) : (
                <ul className="divide-y divide-slate-100 rounded-lg ring-1 ring-slate-200">
                  {requests.map((entry) => (
                    <li key={entry.id}>
                      <Link
                        to={`/service-requests/${entry.id}`}
                        className="flex items-center justify-between gap-3 px-3 py-2.5 hover:bg-slate-50"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {entry.requestNumber}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {[entry.building?.name, entry.floor?.name].filter(Boolean).join(' · ') ||
                              '-'}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <RequestStatusBadge status={entry.status} />
                          <SlaBadge
                            state={entry.slaState}
                            remainingMinutes={entry.slaRemainingMinutes}
                          />
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'plannedWork' && <CustomerPlannedWorkTab customerId={customer.id} />}
          {activeTab === 'invoices' && <CustomerInvoicesTab customerId={customer.id} />}
          {activeTab === 'portalAccess' && <CustomerPortalAccessTab customerId={customer.id} />}
        </div>
      </div>

      <AgreementDrawer
        open={agreementDrawerOpen}
        customerId={customer.id}
        onClose={() => setAgreementDrawerOpen(false)}
        onSaved={() => {
          setAgreementDrawerOpen(false);
          setAgreements(null);
          void loadAgreements();
          void loadCustomer();
        }}
      />
    </>
  );
}
