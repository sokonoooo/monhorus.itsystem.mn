import {
  PERMISSIONS,
  type DepartmentListItemDto,
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
import { Field, SelectInput, TextInput } from '../employees/FormControls';
import { useCompanyOptions } from './useOrgOptions';

const PAGE_SIZE = 20;

/**
 * Create and edit a department.
 *
 * The company is chosen once and then fixed: moving a department between companies would
 * rewrite the org chart under everyone already assigned to it, which is why the update
 * payload carries a name and nothing else. The code is issued by the server.
 */
function DepartmentDrawer({
  target,
  companies,
  onClose,
  onSaved,
}: {
  target: DepartmentListItemDto | null | 'new';
  companies: readonly { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});
    setCompanyId(existing?.companyId ?? '');
    setName(existing?.name ?? '');
  }, [target, existing]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (isNew && !companyId) errors.companyId = 'Байгууллага сонгоно уу.';
    if (!name.trim()) errors.name = 'Нэр оруулна уу.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      if (isNew) {
        await orgService.createDepartment({ companyId, name: name.trim() });
      } else if (existing) {
        await orgService.updateDepartment(existing.id, { name: name.trim() });
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
      title={isNew ? 'Шинэ хэлтэс' : (existing?.name ?? '')}
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

        <Field label="Байгууллага" required error={fieldErrors.companyId}>
          <SelectInput
            value={companyId}
            onChange={setCompanyId}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            placeholder="Байгууллага сонгох"
            disabled={submitting || !isNew}
          />
        </Field>
        <Field label="Нэр" required error={fieldErrors.name}>
          <TextInput value={name} onChange={setName} disabled={submitting} />
        </Field>
      </div>
    </Drawer>
  );
}

export function DepartmentsPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.ORG_MANAGE);
  const companies = useCompanyOptions();

  const query = useMemo<OrgLookupQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const search = searchParams.get('search');
    const companyId = searchParams.get('companyId');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(companyId ? { companyId } : {}),
      ...(searchParams.get('includeInactive') === 'true' ? { includeInactive: true } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<DepartmentListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [target, setTarget] = useState<DepartmentListItemDto | null | 'new'>(null);
  const [statusTarget, setStatusTarget] = useState<DepartmentListItemDto | null>(null);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await orgService.departments(JSON.parse(queryKey) as OrgLookupQuery));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Хэлтэс ачаалж чадсангүй.');
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
      await orgService.setDepartmentStatus(statusTarget.id, { isActive: activating });
      notify(activating ? 'Хэлтэс идэвхжлээ.' : 'Хэлтэс идэвхгүй боллоо.', 'success');
      setStatusTarget(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Төлөв өөрчилж чадсангүй.', 'error');
      setStatusTarget(null);
    }
  }

  const columns: ReadonlyArray<Column<DepartmentListItemDto>> = [
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
      key: 'company',
      header: 'Байгууллага',
      render: (row) => <span className="text-slate-700">{row.companyName ?? '-'}</span>,
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
        const items: RowActionItem[] = [];
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

  const hasFilters = ['search', 'companyId', 'includeInactive'].some((key) =>
    searchParams.get(key),
  );

  return (
    <>
      <PageHeader
        title="Хэлтэс"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Хэлтэс' }]}
        actions={canManage && <Button onClick={() => setTarget('new')}>Шинэ хэлтэс</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="department-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="department-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') updateParam('search', searchDraft.trim());
            }}
            onBlur={() => updateParam('search', searchDraft.trim())}
            placeholder="Нэр эсвэл код"
          />
        </div>

        <div>
          <label htmlFor="department-company" className={FILTER_LABEL}>
            Байгууллага
          </label>
          <select
            id="department-company"
            value={searchParams.get('companyId') ?? ''}
            onChange={(event) => updateParam('companyId', event.target.value)}
            className={FILTER_SELECT}
          >
            <option value="">Бүх байгууллага</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        </div>

        {/* Two options only — see the note on the same filter in CompaniesPage. */}
        <div>
          <label htmlFor="department-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="department-status"
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
          emptyTitle="Хэлтэс олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох хэлтэс алга.'
              : 'Байгууллагадаа хэлтэс нэмнэ үү.'
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

      <DepartmentDrawer
        target={target}
        companies={companies}
        onClose={() => setTarget(null)}
        onSaved={() => {
          setTarget(null);
          void load();
        }}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title={statusTarget?.isActive ? 'Хэлтэс идэвхгүй болгох' : 'Хэлтэс идэвхжүүлэх'}
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
