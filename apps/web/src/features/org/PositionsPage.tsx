import {
  PERMISSIONS,
  type OrgLookupQuery,
  type PaginatedData,
  type PositionListItemDto,
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
import { useCompanyOptions, useDepartmentOptions } from './useOrgOptions';

const PAGE_SIZE = 20;

/** What an empty department means on a position, wherever one is shown or offered. */
const ANY_DEPARTMENT = 'Бүх хэлтэс';

/**
 * Create and edit a position.
 *
 * The department is optional and its blank choice is a real answer: a position with no
 * department is valid across every department of its company. The company is fixed after
 * creation, and the code is issued by the server.
 */
function PositionDrawer({
  target,
  companies,
  onClose,
  onSaved,
}: {
  target: PositionListItemDto | null | 'new';
  companies: readonly { id: string; name: string }[];
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const isNew = target === 'new';
  const existing = target !== null && target !== 'new' ? target : null;

  const [companyId, setCompanyId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const departments = useDepartmentOptions(companyId);

  useEffect(() => {
    if (target === null) return;
    setFormError(null);
    setFieldErrors({});
    setCompanyId(existing?.companyId ?? '');
    setDepartmentId(existing?.departmentId ?? '');
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
        await orgService.createPosition({
          companyId,
          // Explicitly null rather than absent: "every department" is the choice the
          // blank option makes, not a field the form forgot to fill in.
          departmentId: departmentId || null,
          name: name.trim(),
        });
      } else if (existing) {
        await orgService.updatePosition(existing.id, {
          name: name.trim(),
          departmentId: departmentId || null,
        });
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
      title={isNew ? 'Шинэ албан тушаал' : (existing?.name ?? '')}
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
            onChange={(value) => {
              setCompanyId(value);
              // The department belonged to the old company; keeping it would submit a pair
              // the server rejects, and the option list underneath has already changed.
              setDepartmentId('');
            }}
            options={companies.map((company) => ({ value: company.id, label: company.name }))}
            placeholder="Байгууллага сонгох"
            disabled={submitting || !isNew}
          />
        </Field>
        <Field
          label="Хэлтэс"
          error={fieldErrors.departmentId}
          hint="Хоосон бол байгууллагын бүх хэлтэст хамаарна."
        >
          <SelectInput
            value={departmentId}
            onChange={setDepartmentId}
            options={departments.map((department) => ({
              value: department.id,
              label: department.name,
            }))}
            placeholder={ANY_DEPARTMENT}
            disabled={submitting || !companyId}
          />
        </Field>
        <Field label="Нэр" required error={fieldErrors.name}>
          <TextInput value={name} onChange={setName} disabled={submitting} />
        </Field>
      </div>
    </Drawer>
  );
}

export function PositionsPage(): ReactElement {
  const { can } = useAuth();
  const { notify } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const canManage = can(PERMISSIONS.ORG_MANAGE);
  const companies = useCompanyOptions();
  const filterCompanyId = searchParams.get('companyId') ?? '';
  const filterDepartments = useDepartmentOptions(filterCompanyId);

  const query = useMemo<OrgLookupQuery>(() => {
    const page = Number.parseInt(searchParams.get('page') ?? '1', 10);
    const search = searchParams.get('search');
    const companyId = searchParams.get('companyId');
    const departmentId = searchParams.get('departmentId');

    return {
      page: Number.isFinite(page) && page > 0 ? page : 1,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(companyId ? { companyId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(searchParams.get('includeInactive') === 'true' ? { includeInactive: true } : {}),
    };
  }, [searchParams]);

  const [data, setData] = useState<PaginatedData<PositionListItemDto> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(() => searchParams.get('search') ?? '');
  const [target, setTarget] = useState<PositionListItemDto | null | 'new'>(null);
  const [statusTarget, setStatusTarget] = useState<PositionListItemDto | null>(null);

  const queryKey = JSON.stringify(query);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setData(await orgService.positions(JSON.parse(queryKey) as OrgLookupQuery));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Албан тушаал ачаалж чадсангүй.');
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

  /**
   * Changing the company drops the department with it.
   *
   * The department dropdown is scoped to the company, so a department left behind would be
   * one that is no longer among its own options — an invisible filter returning nothing.
   */
  function changeCompanyFilter(value: string): void {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('companyId', value);
    else next.delete('companyId');
    next.delete('departmentId');
    next.delete('page');
    setSearchParams(next);
  }

  async function handleStatusChange(): Promise<void> {
    if (!statusTarget) return;
    const activating = !statusTarget.isActive;
    try {
      await orgService.setPositionStatus(statusTarget.id, { isActive: activating });
      notify(activating ? 'Албан тушаал идэвхжлээ.' : 'Албан тушаал идэвхгүй боллоо.', 'success');
      setStatusTarget(null);
      await load();
    } catch (caught) {
      notify(caught instanceof ApiError ? caught.message : 'Төлөв өөрчилж чадсангүй.', 'error');
      setStatusTarget(null);
    }
  }

  const columns: ReadonlyArray<Column<PositionListItemDto>> = [
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
      key: 'department',
      header: 'Хэлтэс',
      // A position with no department is not missing one; it belongs to all of them.
      render: (row) =>
        row.departmentId === null ? (
          <span className="text-slate-500">{ANY_DEPARTMENT}</span>
        ) : (
          <span className="text-slate-700">{row.departmentName ?? '-'}</span>
        ),
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

  const hasFilters = ['search', 'companyId', 'departmentId', 'includeInactive'].some((key) =>
    searchParams.get(key),
  );

  return (
    <>
      <PageHeader
        title="Албан тушаал"
        breadcrumbs={[{ label: 'Нүүр', to: '/dashboard' }, { label: 'Албан тушаал' }]}
        actions={canManage && <Button onClick={() => setTarget('new')}>Шинэ албан тушаал</Button>}
      />

      <div className={FILTER_BAR}>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="position-search" className={FILTER_LABEL}>
            Хайлт
          </label>
          <SearchField
            id="position-search"
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
          <label htmlFor="position-company" className={FILTER_LABEL}>
            Байгууллага
          </label>
          <select
            id="position-company"
            value={filterCompanyId}
            onChange={(event) => changeCompanyFilter(event.target.value)}
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

        <div>
          <label htmlFor="position-department" className={FILTER_LABEL}>
            Хэлтэс
          </label>
          <select
            id="position-department"
            value={searchParams.get('departmentId') ?? ''}
            onChange={(event) => updateParam('departmentId', event.target.value)}
            disabled={!filterCompanyId}
            className={FILTER_SELECT}
          >
            <option value="">Бүх хэлтэс</option>
            {filterDepartments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </div>

        {/* Two options only — see the note on the same filter in CompaniesPage. */}
        <div>
          <label htmlFor="position-status" className={FILTER_LABEL}>
            Төлөв
          </label>
          <select
            id="position-status"
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
          emptyTitle="Албан тушаал олдсонгүй"
          emptyDescription={
            hasFilters
              ? 'Шүүлтүүрт тохирох албан тушаал алга.'
              : 'Ажилтан бүртгэхийн өмнө албан тушаал нэмнэ үү.'
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

      <PositionDrawer
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
        title={
          statusTarget?.isActive ? 'Албан тушаал идэвхгүй болгох' : 'Албан тушаал идэвхжүүлэх'
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
