import {
  createProjectSchema,
  updateProjectSchema,
  type CustomerDto,
  type DispatchCandidateDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { objectService } from '../../services/object.service';
import { projectService } from '../../services/project.service';
import { dispatchService } from '../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

/**
 * Project create and edit, section 4.2 fields.
 *
 * There is no code field on either half of this form. `PRJ-001` is drawn by the server
 * from a per-customer counter, so on create there is nothing for the browser to say, and
 * on edit `updateProjectSchema` is `.strict()` — sending a code is refused outright rather
 * than ignored. The code is still shown wherever the project is read.
 */
export function ProjectFormPage(): ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const isEdit = Boolean(projectId);
  const navigate = useNavigate();
  const { notify } = useToast();

  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [name, setName] = useState('');
  const [contractNumber, setContractNumber] = useState('');
  const [responsibleEmployeeId, setResponsibleEmployeeId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      setLoading(true);
      try {
        const [customerList, candidates] = await Promise.all([
          objectService.customers(),
          dispatchService.employeeCandidates({}).catch(() => []),
        ]);
        if (cancelled) return;
        setCustomers(customerList);
        setEmployees(candidates);

        if (projectId) {
          const project = await projectService.getProject(projectId);
          if (cancelled) return;
          setCustomerId(project.customerId);
          setName(project.name);
          setContractNumber(project.contractNumber ?? '');
          setResponsibleEmployeeId(project.responsibleEmployeeId ?? '');
          setStartDate(project.startDate?.slice(0, 10) ?? '');
          setEndDate(project.endDate?.slice(0, 10) ?? '');
          setDescription(project.description ?? '');
          setIsActive(project.isActive);
        }
      } catch (caught) {
        if (!cancelled) {
          setLoadError(caught instanceof ApiError ? caught.message : 'Мэдээлэл ачаалж чадсангүй.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    const shared = {
      name: name.trim(),
      contractNumber: contractNumber.trim() || null,
      responsibleEmployeeId: responsibleEmployeeId || null,
      startDate: startDate ? `${startDate}T00:00:00.000Z` : null,
      endDate: endDate ? `${endDate}T00:00:00.000Z` : null,
      description: description.trim() || null,
    };

    const parsed = isEdit
      ? updateProjectSchema.safeParse({ ...shared, isActive })
      : createProjectSchema.safeParse({ ...shared, customerId });

    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSubmitting(true);
    try {
      if (isEdit && projectId) {
        await projectService.updateProject(
          projectId,
          parsed.data as Parameters<typeof projectService.updateProject>[1],
        );
        notify('Төсөл шинэчлэгдлээ.', 'success');
        navigate(`/projects/${projectId}`);
      } else {
        const created = await projectService.createProject(
          parsed.data as Parameters<typeof projectService.createProject>[0],
        );
        notify('Төсөл үүслээ. Барилга нэмнэ үү.', 'success');
        navigate(`/projects/${created.id}`);
      }
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

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }
  if (loadError) return <ErrorState description={loadError} />;

  return (
    <>
      <PageHeader
        title={isEdit ? 'Төсөл засах' : 'Шинэ төсөл'}
        backTo={{ to: '/projects', label: 'Төслийн жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Төсөл', to: '/projects' },
          { label: isEdit ? 'Засах' : 'Шинэ' },
        ]}
      />

      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {formError && <Alert variant="error">{formError}</Alert>}

        {isEdit && (
          <Alert variant="info">
            Байгууллагыг өөрчлөхгүй. Доор бүртгэгдсэн барилга, давхар, объектууд тухайн
            байгууллагад хамаарна.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Байгууллага" required error={fieldErrors.customerId}>
            <SelectInput
              value={customerId}
              onChange={setCustomerId}
              placeholder="Байгууллага сонгох"
              options={customers.map((customer) => ({ value: customer.id, label: customer.name }))}
              disabled={submitting || isEdit}
            />
          </Field>

          <Field label="Төслийн нэр" required error={fieldErrors.name}>
            <TextInput value={name} onChange={setName} disabled={submitting} />
          </Field>

          <Field label="Гэрээний дугаар" error={fieldErrors.contractNumber}>
            <TextInput value={contractNumber} onChange={setContractNumber} disabled={submitting} />
          </Field>

          <Field label="Хариуцагч" error={fieldErrors.responsibleEmployeeId}>
            <SelectInput
              value={responsibleEmployeeId}
              onChange={setResponsibleEmployeeId}
              placeholder="Ажилтан сонгох"
              options={employees.map((employee) => ({
                value: employee.id,
                label: `${employee.lastName} ${employee.firstName}`,
              }))}
              disabled={submitting}
            />
          </Field>

          <Field label="Эхлэх огноо" error={fieldErrors.startDate}>
            <TextInput type="date" value={startDate} onChange={setStartDate} disabled={submitting} />
          </Field>

          <Field label="Дуусах огноо" error={fieldErrors.endDate}>
            <TextInput type="date" value={endDate} onChange={setEndDate} disabled={submitting} />
          </Field>

          {isEdit && (
            <Field label="Төлөв">
              <SelectInput
                value={isActive ? 'true' : 'false'}
                onChange={(value) => setIsActive(value === 'true')}
                options={[
                  { value: 'true', label: 'Идэвхтэй' },
                  { value: 'false', label: 'Архивласан' },
                ]}
                disabled={submitting}
              />
            </Field>
          )}
        </div>

        <div>
          <label htmlFor="prj-description" className={FILTER_LABEL}>
            Тайлбар
          </label>
          <textarea
            id="prj-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={() => navigate('/projects')} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            {isEdit ? 'Хадгалах' : 'Хадгалаад барилга нэмэх'}
          </Button>
        </div>
      </div>
    </>
  );
}
