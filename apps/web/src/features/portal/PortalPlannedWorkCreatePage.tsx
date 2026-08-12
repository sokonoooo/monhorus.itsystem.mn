import {
  createPlannedWorkSchema,
  type BuildingDto,
  type CreatePlannedWorkInput,
  type ProjectDto,
} from '@monhorus/shared';
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { Field, Section, SelectInput, TextInput } from '../employees/FormControls';

/**
 * A customer raising planned work.
 *
 * THIS CREATES A REAL PLANNED WORK, not a service request wearing one's clothes. It posts
 * the same `POST /planned-work` with the same shared `createPlannedWorkSchema` that staff
 * use, and the record it makes is the record a planner later opens, assigns and reports
 * on.
 *
 * What the customer does NOT get is a crew field, and that absence is not what enforces
 * anything: the server forces an empty crew and PENDING_APPROVAL for a portal caller
 * whatever this form sends. Leaving the field out is honesty about what the screen can do,
 * not the mechanism.
 *
 * The dates are a REQUEST. `plannedStartDate`/`plannedEndDate` are required by the schema
 * so something has to be sent, and an approver can move them with the existing reschedule
 * action — which is why the copy calls them proposed rather than agreed.
 */
export function PortalPlannedWorkCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [buildings, setBuildings] = useState<BuildingDto[]>([]);
  const [refDataError, setRefDataError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [plannedStartDate, setPlannedStartDate] = useState('');
  const [plannedEndDate, setPlannedEndDate] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    portalService
      .listProjects()
      .then((page) => {
        if (!cancelled) setProjects([...page.items]);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRefDataError(
            caught instanceof ApiError ? caught.message : 'Төслийн жагсаалт ачаалж чадсангүй.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Without a project this answers the organisation's buildings, so a customer whose
  // buildings hang off the organisation can still fill the required field.
  useEffect(() => {
    let cancelled = false;
    portalService
      .listBuildingsIn(projectId || undefined)
      .then((page) => {
        if (!cancelled) setBuildings([...page.items]);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRefDataError(
            caught instanceof ApiError ? caught.message : 'Барилгын жагсаалт ачаалж чадсангүй.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const payload: CreatePlannedWorkInput = {
      projectId: projectId || null,
      buildingId,
      title: title.trim(),
      description: description.trim() || null,
      plannedStartDate: plannedStartDate ? `${plannedStartDate}T00:00:00.000Z` : '',
      plannedEndDate: plannedEndDate ? `${plannedEndDate}T00:00:00.000Z` : '',
      // Sent empty and forced empty server-side. Named here rather than omitted so the
      // schema is satisfied by the same shape staff send.
      assignedEmployeeIds: [],
      assignedTeamId: null,
    };

    // The same schema the API validates against, so the rules cannot drift.
    const parsed = createPlannedWorkSchema.safeParse(payload);
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
      const created = await portalService.createPlannedWork(parsed.data);
      notify(`${created.workNumber} хүсэлт илгээгдлээ. Батлагдахыг хүлээнэ үү.`, 'success');
      navigate(`/portal/planned-work/${created.id}`, { replace: true });
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
    <>
      <PageHeader
        title="Шинэ төлөвлөгөөт ажил"
        description="Урьдчилан сэргийлэх үзлэг, засварын хүсэлт илгээх."
        backTo={{ to: '/portal/planned-work', label: 'Төлөвлөгөөт ажил руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Төлөвлөгөөт ажил', to: '/portal/planned-work' },
          { label: 'Шинэ' },
        ]}
      />

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {formError && <Alert variant="error">{formError}</Alert>}
          {refDataError && <Alert variant="warning">{refDataError}</Alert>}

          <Alert variant="info">
            Хүсэлт илгээснээр ажил «Хүлээгдэж буй» төлөвт орно. Эрх бүхий ажилтан хянаж
            баталсны дараа гүйцэтгэх ажилтан томилогдоно. Батлагдтал хэн ч томилогдохгүй.
          </Alert>

          <Section title="Байршил">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Төсөл" error={fieldErrors.projectId} hint="Заавал биш.">
                <SelectInput
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    setBuildingId('');
                  }}
                  placeholder="Бүх барилга"
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                  disabled={submitting}
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
                  disabled={submitting}
                />
              </Field>
            </div>
          </Section>

          <Section title="Ажил">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Ажлын нэр" required error={fieldErrors.title}>
                <TextInput value={title} onChange={setTitle} disabled={submitting} />
              </Field>

              <Field
                label="Санал болгож буй эхлэх огноо"
                required
                error={fieldErrors.plannedStartDate}
              >
                <TextInput
                  type="date"
                  value={plannedStartDate}
                  onChange={setPlannedStartDate}
                  disabled={submitting}
                />
              </Field>

              <Field
                label="Санал болгож буй дуусах огноо"
                required
                error={fieldErrors.plannedEndDate}
              >
                <TextInput
                  type="date"
                  value={plannedEndDate}
                  onChange={setPlannedEndDate}
                  disabled={submitting}
                />
              </Field>
            </div>

            <div className="mt-3">
              <label htmlFor="portal-work-description" className={FILTER_LABEL}>
                Тайлбар
              </label>
              <textarea
                id="portal-work-description"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                className={FIELD_TEXTAREA}
              />
            </div>
          </Section>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/portal/planned-work')}
              disabled={submitting}
            >
              Цуцлах
            </Button>
            <Button type="submit" loading={submitting}>
              Илгээх
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
