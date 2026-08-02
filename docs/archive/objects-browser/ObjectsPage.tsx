import {
  OBJECT_NODE_KIND_LABELS,
  type CustomerDto,
  type ObjectNodeDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { RiskBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';

/** One level of the drill-down. The trail is an array of these. */
interface Level {
  node: ObjectNodeDto;
}

export function ObjectsPage(): ReactElement {
  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDto | null>(null);

  const [trail, setTrail] = useState<Level[]>([]);
  const [nodes, setNodes] = useState<ObjectNodeDto[]>([]);

  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ObjectNodeDto | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingCustomers(true);

    objectService
      .customers(customerSearch || undefined)
      .then((result) => {
        if (!cancelled) setCustomers(result);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Харилцагч ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoadingCustomers(false);
      });

    return () => {
      cancelled = true;
    };
  }, [customerSearch]);

  /**
   * Loads one level. With no trail it fetches the customer's projects; otherwise the
   * direct children of the deepest node. The full tree is never requested.
   */
  const loadLevel = useCallback(
    async (customer: CustomerDto | null, path: Level[]): Promise<void> => {
      if (!customer) {
        setNodes([]);
        return;
      }

      setLoadingNodes(true);
      setError(null);

      try {
        const deepest = path[path.length - 1];
        const result = deepest
          ? await objectService.children(deepest.node.id)
          : await objectService.rootNodes(customer.id, 'PROJECT');
        setNodes(result);
      } catch (caught) {
        setError(caught instanceof ApiError ? caught.message : 'Объект ачаалж чадсангүй.');
        setNodes([]);
      } finally {
        setLoadingNodes(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadLevel(selectedCustomer, trail);
  }, [selectedCustomer, trail, loadLevel]);

  function selectCustomer(customer: CustomerDto): void {
    setSelectedCustomer(customer);
    setTrail([]);
  }

  function drillInto(node: ObjectNodeDto): void {
    if (!node.hasChildren) {
      setDetail(node);
      return;
    }
    setTrail((previous) => [...previous, { node }]);
  }

  function jumpTo(index: number): void {
    setTrail((previous) => previous.slice(0, index));
  }

  const breadcrumbs = [
    { label: 'Нүүр', to: '/dashboard' },
    { label: 'Төсөл ба объект' },
  ];

  return (
    <>
      <PageHeader
        title="Төсөл ба объект"
        description="Харилцагч, төсөл, барилга, давхар, өрөө, самбар, хэлхээ, төхөөрөмжийн шатлал."
        breadcrumbs={breadcrumbs}
      />

      {error && (
        <div className="mb-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <aside className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-slate-200">
          <label htmlFor="customer-search" className="mb-1 block text-xs font-medium text-slate-600">
            Харилцагч хайх
          </label>
          <input
            id="customer-search"
            type="search"
            value={customerSearch}
            onChange={(event) => setCustomerSearch(event.target.value)}
            placeholder="Нэр эсвэл код"
            className="mb-2 block w-full rounded-lg border-0 px-2.5 py-1.5 text-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-blue-600"
          />

          {loadingCustomers ? (
            <div className="space-y-2 py-2">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-8" />
              ))}
            </div>
          ) : customers.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-slate-500">Харилцагч олдсонгүй.</p>
          ) : (
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              {customers.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    onClick={() => selectCustomer(customer)}
                    className={`w-full truncate rounded-md px-2 py-1.5 text-left text-sm ${
                      selectedCustomer?.id === customer.id
                        ? 'bg-slate-900 font-medium text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {customer.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <section className="lg:col-span-3">
          <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center gap-1 border-b border-slate-200 px-4 py-2.5 text-xs">
              {!selectedCustomer ? (
                <span className="text-slate-500">Эхлээд харилцагч сонгоно уу</span>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => jumpTo(0)}
                    className="rounded px-1.5 py-0.5 font-medium text-slate-700 hover:bg-slate-100"
                  >
                    {selectedCustomer.name}
                  </button>
                  {trail.map((level, index) => (
                    <span key={level.node.id} className="flex items-center gap-1">
                      <span className="text-slate-400">/</span>
                      <button
                        type="button"
                        onClick={() => jumpTo(index + 1)}
                        className="rounded px-1.5 py-0.5 text-slate-700 hover:bg-slate-100"
                      >
                        {level.node.name}
                      </button>
                    </span>
                  ))}
                </>
              )}
            </div>

            {!selectedCustomer ? (
              <EmptyState
                title="Харилцагч сонгогдоогүй"
                description="Зүүн талын жагсаалтаас харилцагч сонгож объектын шатлалыг үзнэ үү."
              />
            ) : loadingNodes ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }, (_, index) => (
                  <Skeleton key={index} className="h-10" />
                ))}
              </div>
            ) : error ? (
              <ErrorState
                description={error}
                action={
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void loadLevel(selectedCustomer, trail)}
                  >
                    Дахин оролдох
                  </Button>
                }
              />
            ) : nodes.length === 0 ? (
              <EmptyState
                title="Дэд объект байхгүй"
                description="Энэ түвшинд бүртгэлтэй объект алга."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      onClick={() => drillInto(node)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">{node.name}</p>
                        <p className="truncate text-xs text-slate-500">
                          {OBJECT_NODE_KIND_LABELS[node.kind]} · {node.code}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {node.riskLevel && (
                          <RiskBadge level={node.riskLevel} score={node.riskScore} />
                        )}
                        {node.hasChildren && (
                          <span className="text-xs text-slate-400" aria-hidden="true">
                            &rsaquo;
                          </span>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <Drawer
        open={detail !== null}
        title={detail?.name ?? ''}
        onClose={() => setDetail(null)}
        footer={
          <Button variant="secondary" onClick={() => setDetail(null)}>
            Хаах
          </Button>
        }
      >
        {detail && (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt className="text-xs text-slate-500">Төрөл</dt>
              <dd className="text-slate-900">{OBJECT_NODE_KIND_LABELS[detail.kind]}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt className="text-xs text-slate-500">Код</dt>
              <dd className="text-slate-900">{detail.code}</dd>
            </div>
            <div className="flex justify-between gap-3 border-b border-slate-100 py-1.5">
              <dt className="text-xs text-slate-500">Үнэлгээ</dt>
              <dd>
                {detail.riskLevel ? (
                  <RiskBadge level={detail.riskLevel} score={detail.riskScore} />
                ) : (
                  <span className="text-slate-500">Үнэлгээ хийгдээгүй</span>
                )}
              </dd>
            </div>
            <div className="flex justify-between gap-3 py-1.5">
              <dt className="text-xs text-slate-500">Төлөв</dt>
              <dd className="text-slate-900">{detail.isActive ? 'Идэвхтэй' : 'Идэвхгүй'}</dd>
            </div>
          </dl>
        )}
      </Drawer>
    </>
  );
}
