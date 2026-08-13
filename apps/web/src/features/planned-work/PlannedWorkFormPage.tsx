import {
  createPlannedWorkSchema,
  updatePlannedWorkSchema,
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
import { plannedWorkService } from '../../services/planned-work.service';
import { portalService } from '../../services/portal.service';
import { dispatchService } from '../../services/service-request.service';
import { Field, SelectInput, TextInput } from '../employees/FormControls';

/** Trims a UTC timestamp to the yyyy-mm-dd form a date input expects. */
function toDateInput(iso: string): string {
  return iso.slice(0, 10);
}

/** A dropdown entry. Project, building and customer DTOs all reduce to this. */
interface Choice {
  id: string;
  name: string;
}

/**
 * Which console this form is rendered in.
 *
 * NOT A COSMETIC FLAG. It selects the endpoints the dropdowns are filled from, and those
 * differ because the permissions differ: the staff chain walks `/objects/customers` and
 * `/objects/nodes` behind `customer.view` and `object.view`, neither of which a customer
 * holds — `/objects/nodes` was deliberately closed back to the staff key. The portal reads
 * the same places through `/projects` and `/buildings`, which accept a `portal.*` key and
 * bound the answer to the caller's own organisation server-side.
 */
export type PlannedWorkFormVariant = 'staff' | 'portal';

/**
 * Create and edit a planned work — one form for both consoles.
 *
 * ONE COMPONENT ON PURPOSE. A customer raising planned work is filling in the same record,
 * against the same `createPlannedWorkSchema`, posting to the same `POST /planned-work`. The
 * portal previously had a hand-copied second form, which meant every field, every validation
 * message and every date-format decision existed twice and could drift apart silently. What
 * genuinely differs between the two is small and is marked `variant === 'portal'` below.
 *
 * The differences are all consequences of two facts, not of taste:
 *   - A portal caller has exactly one organisation, taken from their account, so there is no
 *     customer to pick. The server ignores any organisation the client sends.
 *   - A portal caller may not name a crew. The server forces an empty crew on their work and
 *     refuses assignment until it is approved, so the crew control is not merely hidden — it
 *     would have nothing to show, since the employee roster is behind `dispatch.view`.
 *
 * In edit mode the planned END date is deliberately not offered: extending a deadline is
 * a reschedule, which needs its own permission, a mandatory reason and an audit record,
 * and is performed from the detail screen.
 *
 * BOTH CONSOLES EDIT. A customer corrects their own draft here, and corrects a request that
 * came back to them, before submitting it again. Whether this particular caller may edit
 * this particular record is the server's decision, not this component's: a customer is
 * refused once their request has been approved.
 */
export function PlannedWorkFormPage({
  variant = 'staff',
}: {
  variant?: PlannedWorkFormVariant;
} = {}): ReactElement {
  const isPortal = variant === 'portal';
  const { plannedWorkId } = useParams<{ plannedWorkId: string }>();
  // Both consoles edit now: a customer corrects their own draft, and a returned request is
  // corrected and submitted again. The server decides whether this particular caller may —
  // `findRawForOwnerEdit` refuses a customer once their request has been approved.
  const isEdit = Boolean(plannedWorkId);
  const navigate = useNavigate();
  const { notify } = useToast();

  const listPath = isPortal ? '/portal/planned-work' : '/planned-work';

  const [customers, setCustomers] = useState<CustomerDto[]>([]);
  const [projects, setProjects] = useState<Choice[]>([]);
  const [buildings, setBuildings] = useState<Choice[]>([]);
  const [employees, setEmployees] = useState<DispatchCandidateDto[]>([]);

  const [customerId, setCustomerId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');
  const [assignedEmployeeIds, setAssignedEmployeeIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * Whether a location may be chosen yet.
   *
   * Staff must pick a customer first, because the project and building queries are keyed on
   * one. A portal caller's organisation is implicit, so the same gate would leave their
   * building field permanently disabled and the form impossible to submit.
   */
  const locationReady = isPortal || Boolean(customerId);

  // Reference data plus, in edit mode, the record itself.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap(): Promise<void> {
      setLoading(true);
      setLoadError(null);
      try {
        if (isPortal) {
          // No customer list and no roster: one is implicit, the other is staff-only.
          const projectList = await portalService.listProjects();
          if (cancelled) return;
          setProjects(projectList.items.map((item) => ({ id: item.id, name: item.name })));
        } else {
          const [customerList, candidates] = await Promise.all([
            objectService.customers(),
            dispatchService.employeeCandidates({}).catch(() => []),
          ]);
          if (cancelled) return;
          setCustomers(customerList);
          setEmployees(candidates);
        }

        if (isEdit && plannedWorkId) {
          const work = isPortal
            ? await portalService.getPlannedWork(plannedWorkId)
            : await plannedWorkService.getById(plannedWorkId);
          if (cancelled) return;
          setCustomerId(work.customer.id);
          setProjectId(work.project?.id ?? '');
          setBuildingId(work.building.id);
          setTitle(work.title);
          setDescription(work.description ?? '');
          setPlannedStartDate(toDateInput(work.plannedStartDate));
          setPlannedEndDate(toDateInput(work.plannedEndDate));
          setAssignedEmployeeIds(work.assignedEmployees.map((employee) => employee.id));
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
  }, [isEdit, isPortal, plannedWorkId]);

  // Projects belong to a customer. The portal's own projects are loaded once, above.
  useEffect(() => {
    if (isPortal) return undefined;
    if (!customerId) {
      setProjects([]);
      return undefined;
    }
    let cancelled = false;
    objectService
      .rootNodes(customerId, 'PROJECT')
      .then((nodes) => {
        if (!cancelled) setProjects(nodes.map((node) => ({ id: node.id, name: node.name })));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId, isPortal]);

  // The project is optional. With one chosen the buildings are its children (the backend
  // enforces the same containment rule); without one, every building of the customer is
  // offered — the same customer-plus-kind query the service-request form relies on. The
  // portal asks the same two questions of `/buildings`, which scopes them to its own org.
  useEffect(() => {
    if (!locationReady) {
      setBuildings([]);
      return undefined;
    }
    let cancelled = false;
    const load: Promise<Choice[]> = isPortal
      ? portalService
          .listBuildingsIn(projectId || undefined)
          .then((page) => page.items.map((item) => ({ id: item.id, name: item.name })))
      : (projectId
          ? objectService
              .children(projectId)
              .then((nodes) => nodes.filter((node) => node.kind === 'BUILDING'))
          : objectService.rootNodes(customerId, 'BUILDING')
        ).then((nodes) => nodes.map((node) => ({ id: node.id, name: node.name })));
    load
      .then((choices) => {
        if (!cancelled) setBuildings(choices);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [customerId, isPortal, locationReady, projectId]);

  function collectIssues(issues: { path: (string | number)[]; message: string }[]): void {
    const errors: Record<string, string> = {};
    for (const issue of issues) {
      const key = issue.path.join('.') || '_';
      if (!errors[key]) errors[key] = issue.message;
    }
    setFieldErrors(errors);
    setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
  }

  async function handleSubmit(): Promise<void> {
    setFormError(null);
    setFieldErrors({});

    if (isEdit && plannedWorkId) {
      const parsed = updatePlannedWorkSchema.safeParse({
        title: title.trim(),
        description: description.trim() || null,
        plannedStartDate: `${plannedStartDate}T00:00:00.000Z`,
        buildingId,
        assignedEmployeeIds,
        assignedTeamId: null,
      });
      if (!parsed.success) {
        collectIssues(parsed.error.issues);
        return;
      }

      setSubmitting(true);
      try {
        if (isPortal) {
          await portalService.updatePlannedWork(plannedWorkId, parsed.data);
        } else {
          await plannedWorkService.update(plannedWorkId, parsed.data);
        }
        notify('Төлөвлөгөөт ажил шинэчлэгдлээ.', 'success');
        navigate(`${listPath}/${plannedWorkId}`);
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
      return;
    }

    // The same schema for both consoles. A portal caller sends an empty crew because the
    // control is not rendered; the server would force one regardless.
    const parsed = createPlannedWorkSchema.safeParse({
      projectId: projectId || null,
      buildingId,
      title: title.trim(),
      description: description.trim() || null,
      plannedStartDate: plannedStartDate ? `${plannedStartDate}T00:00:00.000Z` : '',
      plannedEndDate: plannedEndDate ? `${plannedEndDate}T00:00:00.000Z` : '',
      assignedEmployeeIds,
      assignedTeamId: null,
    });
    if (!parsed.success) {
      collectIssues(parsed.error.issues);
      return;
    }

    setSubmitting(true);
    try {
      const created = isPortal
        ? await portalService.createPlannedWork(parsed.data)
        : await plannedWorkService.create(parsed.data);
      notify(
        isPortal
          ? 'Ноорог хадгалагдлаа. Дэд ажлаа нэмээд «Төлөвлөх» дарж илгээнэ үү.'
          : 'Төлөвлөгөөт ажил үүслээ. Дэд ажлуудыг нэмнэ үү.',
        'success',
      );
      navigate(`${listPath}/${created.id}`);
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
        title={isEdit ? 'Төлөвлөгөөт ажил засах' : 'Шинэ төлөвлөгөөт ажил'}
        backTo={{ to: listPath, label: 'Төлөвлөгөөт ажлын жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: isPortal ? '/portal' : '/dashboard' },
          { label: 'Төлөвлөгөөт ажил', to: listPath },
          { label: isEdit ? 'Засах' : 'Шинэ' },
        ]}
      />

      <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        {formError && <Alert variant="error">{formError}</Alert>}

        {isPortal && (
          <Alert variant="info">
            Энэ хүсэлт эхлээд «Ноорог» болж хадгалагдана — хадгалснаар илгээгдэхгүй. Дэд
            ажлаа нэмж, мэдээллээ гүйцээсний дараа «Төлөвлөх» дарж батлуулахаар илгээнэ үү.
            Огноог санал болгож буй хугацаа гэж үзнэ.
          </Alert>
        )}

        {isEdit && (
          <Alert variant="info">
            Дуусах огноог энэ хэлбэрээр өөрчилж болохгүй. Хугацаа сунгах нь тусдаа эрх,
            шалтгаан шаардах үйлдэл бөгөөд дэлгэрэнгүй хуудсаас хийгдэнэ.
          </Alert>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {/* The organisation is implicit in the portal — it comes from the account. */}
          {!isPortal && (
            <Field label="Харилцагч" required error={fieldErrors.customerId}>
              <SelectInput
                value={customerId}
                onChange={(value) => {
                  setCustomerId(value);
                  setProjectId('');
                  setBuildingId('');
                }}
                placeholder="Харилцагч сонгох"
                options={customers.map((customer) => ({
                  value: customer.id,
                  label: customer.name,
                }))}
                disabled={submitting || isEdit}
              />
            </Field>
          )}

          <Field
            label="Төсөл"
            error={fieldErrors.projectId}
            hint="Заавал биш — сонговол барилгыг тухайн төслөөс шүүнэ."
          >
            <SelectInput
              value={projectId}
              onChange={(value) => {
                setProjectId(value);
                setBuildingId('');
              }}
              placeholder="Төсөлгүй"
              options={projects.map((project) => ({ value: project.id, label: project.name }))}
              disabled={submitting || !locationReady || isEdit}
            />
          </Field>

          <Field label="Барилга" required error={fieldErrors.buildingId}>
            <SelectInput
              value={buildingId}
              onChange={setBuildingId}
              placeholder="Барилга сонгох"
              options={buildings.map((building) => ({
                value: building.id,
                label: building.name,
              }))}
              disabled={submitting || !locationReady}
            />
          </Field>

          <Field label="Ажлын нэр" required error={fieldErrors.title}>
            <TextInput value={title} onChange={setTitle} disabled={submitting} />
          </Field>

          <Field label="Эхлэх огноо" required error={fieldErrors.plannedStartDate}>
            <TextInput
              type="date"
              value={plannedStartDate}
              onChange={setPlannedStartDate}
              disabled={submitting}
            />
          </Field>

          {!isEdit && (
            <Field label="Дуусах огноо" required error={fieldErrors.plannedEndDate}>
              <TextInput
                type="date"
                value={plannedEndDate}
                onChange={setPlannedEndDate}
                disabled={submitting}
              />
            </Field>
          )}
        </div>

        <div>
          <label htmlFor="pw-description" className={FILTER_LABEL}>
            Тайлбар
          </label>
          <textarea
            id="pw-description"
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={submitting}
            className={FIELD_TEXTAREA}
          />
        </div>

        {/*
          Staff only, and not merely hidden from customers: the roster behind this control is
          served by `/dispatch/employee-candidates` under `dispatch.view`, so for a portal
          caller it would render permanently empty. The server also forces an empty crew on
          customer-raised work and refuses assignment until it is approved.
        */}
        {!isPortal && (
          <fieldset aria-label="Хариуцах ажилтан">
            <p className="mb-2 text-xs font-medium text-slate-600">Хариуцах ажилтан</p>
            <div className="grid max-h-52 grid-cols-1 gap-1 overflow-y-auto rounded-lg p-2 ring-1 ring-inset ring-slate-200 sm:grid-cols-2">
              {employees.length === 0 && (
                <p className="text-xs text-slate-500">Ажилтны мэдээлэл ачаалагдсангүй.</p>
              )}
              {employees.map((employee) => (
                <label key={employee.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={assignedEmployeeIds.includes(employee.id)}
                    onChange={(event) =>
                      setAssignedEmployeeIds((current) =>
                        event.target.checked
                          ? [...current, employee.id]
                          : current.filter((id) => id !== employee.id),
                      )
                    }
                    disabled={submitting}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  <span className="truncate">
                    {employee.lastName} {employee.firstName}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
          <Button variant="secondary" onClick={() => navigate(listPath)} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleSubmit()} loading={submitting}>
            Хадгалах
          </Button>
        </div>
      </div>
    </>
  );
}
