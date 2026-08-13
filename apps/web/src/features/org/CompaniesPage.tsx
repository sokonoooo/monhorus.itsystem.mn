import {
  PERMISSIONS,
  type CompanyDto,
  type OrgLookupQuery,
  type PaginatedData,
} from '@monhorus/shared';
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { DataTable, Pagination, type Column } from '../../components/ui/DataTable';
import { Drawer } from '../../components/ui/Drawer';
import { PageHeader } from '../../components/ui/PageHeader';
import { RowActions, type RowActionItem } from '../../components/ui/RowActions';
import { SearchField } from '../../components/ui/SearchField';
import { useToast } from '../../components/ui/ToastProvider';
import { FILTER_BAR, FILTER_LABEL, FILTER_SELECT } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { orgService } from '../../services/org.service';
import { Field, TextInput } from '../employees/FormControls';

const PAGE_SIZE = 20;

/**
 * Create and edit a company.
 *
 * There is no code field. `COM-001` comes from the server's counter, so a code that could
 * be typed here could collide with one issued a moment earlier, and a code that could be
 * edited would stop identifying the company already referred to by it.
 */
function CompanyDrawer({
  target,
  onClose,
  onSaved,
}: {
  target: CompanyDto | null | 'new';
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [address, setAddress] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});
    setName(existing?.name ?? '');
    setRegistrationNumber(existing?.registrationNumber ?? '');
    setAddress(existing?.address ?? '');
  }, [target, existing]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    if (!name.trim()) {
      setFieldErrors({ name: 'Нэр оруулна уу.' });
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    const payload = {
      name: name.trim(),
      registrationNumber: registrationNumber.trim() || null,
      address: address.trim() || null,
    };

    setSubmitting(true);
    try {
      if (isNew) {
        await orgService.createCompany(payload);
      } else if (existing) {
        await orgService.updateCompany(existing.id, payload);
      }
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

  return (
    <Drawer
      open={target !== null}
      title={isNew ? 'Шинэ байгууллага' : (existing?.name ?? '')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {formError && <Alert variant="error">{formError}</Alert>}

        <Field label="Нэр" required error={fieldErrors.name}>
          <TextInput value={name} onChange={setName} disabled={submitting} />
        </Field>
        <Field label="Регистрийн дугаар" error={fieldErrors.registrationNumber}>
          <TextInput
            value={registrationNumber}
            onChange={setRegistrationNumber}
            disabled={submitting}
          />
        </Field>
        <Field label="Хаяг" error={fieldErrors.address}>
          <TextInput value={address} onChange={setAddress} disabled={submitting} />
        </Field>
      </div>
    </Drawer>
  );
}

/**
 * A company's own fields, read-only.
 *
 * A drawer rather than a route: a company is five fields with nothing hanging off it, so a
 * page of its own would be a navigation step that lost the reader's place in the table for
 * no more information than this shows.
 */
function CompanyDetailsDrawer({
  company,
  onClose,
}: {
  company: CompanyDto | null;
  onClose: () => void;
}): ReactElement {
  const rows: ReadonlyArray<[string, string]> = company
    ? [
        ['Код', company.code],
        ['Нэр', company.name],
        ['Регистрийн дугаар', company.registrationNumber ?? '-'],
        ['Хаяг', company.address ?? '-'],
        ['Төлөв', company.isActive ? 'Идэвхтэй' : 'Идэвхгүй'],
      ]
    : [];

  return (
    <Drawer
      open={company !== null}
      title={company?.name ?? ''}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Хаах
        </Button>
      }
    >
      <dl className="divide-y divide-slate-200">
        {rows.map(([label, value]) => (
          <div key={label} className="flex gap-3 py-2.5">
            <dt className="w-40 shrink-0 text-xs font-medium text-slate-500">{label}</dt>
            <dd className="min-w-0 flex-1 break-words text-sm text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

export function CompaniesPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.ORG_MANAGE);

  const query = useMemo<OrgLookupQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const search = searchParams.get('search');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(searchParams.get('includeInactive') === 'true' ? { includeInactive: true } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<CompanyDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [target, setTarget] = useState<CompanyDto | null | 'new'>(null);
  const [details, setDetails] = useState<CompanyDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<CompanyDto | null>(null);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await orgService.companies(JSON.parse(queryKey) as OrgLookupQuery));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Байгууллага ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [queryKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateParam(key: string, value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  }

  async function handleStatusChange(): Promise<void> {
    if (!statusTarget) return;
    const activating = !statusTarget.isActive;
    try {
      await orgService.setCompanyStatus(statusTarget.id, { isActive: activating });
      notify(activating ? 'Байгууллага идэвхжлээ.' : 'Байгууллага идэвхгүй боллоо.', 'success');
      setStatusTarget(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Төлөв өөрчилж чадсангүй.', 'error');
      setStatusTarget(null);
    }
  }

  const columns: ReadonlyArray<Column<CompanyDto>> = [
    {
      key: 'name',
      header: 'Нэр',
      render: (row) => <span className="truncate font-medium text-slate-900">{row.name}</span>,
    },
    {
      key: 'code',
      header: 'Код',
      render: (row) => <span className="whitespace-nowrap text-slate-600">{row.code}</span>,
    },
    {
      key: 'registrationNumber',
      header: 'Регистрийн дугаар',
      render: (row) => (
        <span className="whitespace-nowrap text-slate-700">{row.registrationNumber ?? '-'}</span>
      ),
    },
    {
      key: 'address',
      header: 'Хаяг',
      render: (row) => <span className="text-slate-700">{row.address ?? '-'}</span>,
    },
    {
      key: 'status',
      header: 'Төлөв',
      render: (row) =>
        row.isActive ? (
          <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
            Идэвхтэй
          </span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 ring-1 ring-inset ring-slate-200">
            Идэвхгүй
          </span>
        ),
    },
    {
      key: 'actions',
      header: 'Үйлдэл',
      align: 'right',
      render: (row) => {
        const items: RowActionItem[] = [{ label: 'Харах', onSelect: () => setDetails(row) }];
        if (canManage) {
          items.push({ label: 'Засах', onSelect: () => setTarget(row) });
          items.push({
            label: row.isActive ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх',
            onSelect: () => setStatusTarget(row),
            ...(row.isActive ? { tone: 'danger' as const } : {}),
          });
        }
        return <RowActions items={items} />;
      },
    },
  ];

  const hasFilters = ['search', 'includeInactive'].some((key) => searchParams.get(key));

  return (
    <>
      <PageHeader
        title="Байгууллага"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Байгууллага' }]}
        actions={canManage && <Button onClick={() => setTarget('new')}>Шинэ байгууллага</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="company-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="company-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр эсвэл код"
          />
        </div>

        {/*
          Two options, not three, because the endpoint takes `includeInactive` and nothing
          else. "Идэвхгүй" alone would have to be produced by asking for everything and
          dropping the active rows here, which would print a total counting rows the reader
          cannot see — the one thing server-side filtering exists to prevent.
        */}
        <div>
          <label htmlFor="company-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="company-status"
            value={searchParams.get('includeInactive') ?? ''}
            onChange={(event) => updateParam('includeInactive', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Идэвхтэй</option>
            <option value="true">Бүгд</option>
          </select>
        </div>

        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearchDraft('');
              setSearchParams(new URLSearchParams());
            }}
          >
            Шүүлтүүр цэвэрлэх
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          // Numbered off the response rather than the query, so a request in flight can
          // never number the rows on screen against the page they did not come from.
          numbering={{ page: data?.page ?? 1, limit: data?.limit ?? PAGE_SIZE }}
          loading={loading}
          error={error}
          onRetry={() => void load()}
          emptyTitle="Байгууллага олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох байгууллага алга.'
              : 'Хэлтэс бүртгэхийн өмнө байгууллага нэмнэ үү.'
          }
        />
        {data && (
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            total={data.total}
            onPageChange={(page) => updateParam('page', String(page))}
          />
        )}
      </div>

      <CompanyDrawer
        target={target}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          void load();
        }}
      />

      <CompanyDetailsDrawer company={details} onClose={() => setDetails(null)} />

      <ConfirmDialog
        open={statusTarget !== null}
        title={
          statusTarget?.isActive ? 'Байгууллага идэвхгүй болгох' : 'Байгууллага идэвхжүүлэх'
        }
        message={
          statusTarget === null
            ? ''
            : statusTarget.isActive
              ? `"${statusTarget.name}"-г идэвхгүй болгох уу? Шинээр сонгох боломжгүй болно.`
              : `"${statusTarget.name}"-г идэвхжүүлэх үү?`
        }
        confirmLabel={statusTarget?.isActive ? 'Идэвхгүй болгох' : 'Идэвхжүүлэх'}
        danger={statusTarget?.isActive ?? false}
        onCancel={() => setStatusTarget(null)}
        onConfirm={() => handleStatusChange()}
      />
    </>
  );
}
