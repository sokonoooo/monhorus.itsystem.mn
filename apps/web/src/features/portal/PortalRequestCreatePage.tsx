import {
  SERVICE_REQUEST_TYPES,
  SERVICE_REQUEST_TYPE_LABELS,
  createServiceRequestSchema,
  type BuildingDto,
  type CreateServiceRequestInput,
  type FloorDto,
  type ProjectDto,
  type ServiceRequestAttachmentDto,
  type ServiceRequestType,
} from '@monhorus/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_TEXTAREA, FILTER_LABEL } from '../../components/ui/control-styles';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { portalService } from '../../services/portal.service';
import { Field, Section, SelectInput, TextInput } from '../employees/FormControls';

/** Mirrors ALLOWED_MIME_TYPES and MAX_FILE_BYTES in the storage service. */
const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,application/pdf,application/msword,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Raising a request from the portal, including scheduled maintenance.
 *
 * SCHEDULED MAINTENANCE IS A REQUEST TYPE, NOT A SECOND FORM. `PLANNED_INSPECTION`
 * («Төлөвлөгөөт үзлэг») already exists in `SERVICE_REQUEST_TYPES` and
 * `POST /service-requests` already accepts `portal.service_request.create`, so a customer
 * asking for planned work needs no new endpoint, no new permission and no new status. The
 * request lands UNASSIGNED — nobody is on it until staff act — which is the
 * "not assigned until it has been approved" property, already true, enforced by the
 * existing dispatch flow rather than by anything invented here.
 *
 * The organisation is pinned from the signed-in account. The staff form opens with a
 * select of every customer organisation; asking a customer which tenant they belong to
 * would be both a disclosure and a nonsense question, and the lookup behind it needs a
 * staff key they do not hold. The pin is a convenience, not the boundary:
 * `resolveOwnerCustomerId` refuses a customer naming anyone but themselves, and
 * `validateLocationChain` re-checks every node in the chain belongs to them.
 */
export function PortalRequestCreatePage(): ReactElement {
  const navigate = useNavigate();
  const { notify } = useToast();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();

  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [buildings, setBuildings] = useState<BuildingDto[]>([]);
  const [floors, setFloors] = useState<FloorDto[]>([]);
  const [refDataError, setRefDataError] = useState<string | null>(null);

  const [projectId, setProjectId] = useState('');
  const [buildingId, setBuildingId] = useState(searchParams.get('buildingId') ?? '');
  const [floorId, setFloorId] = useState(searchParams.get('floorId') ?? '');
  // Prefilled from the type in the query so "request scheduled maintenance" can be one
  // click from elsewhere in the portal.
  const [requestType, setRequestType] = useState<ServiceRequestType | ''>(
    (searchParams.get('type') as ServiceRequestType | null) ?? '',
  );
  const [isUrgent, setIsUrgent] = useState(false);
  const [description, setDescription] = useState('');
  const [contactName, setContactName] = useState(user?.fullName ?? '');
  const [contactPhone, setContactPhone] = useState(user?.phone ?? '');
  const [attachments, setAttachments] = useState<ServiceRequestAttachmentDto[]>([]);

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Projects are optional in this hierarchy, so they are offered but never required.
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

  /**
   * Buildings, narrowed by the chosen project or — when none is chosen — every building the
   * organisation has. Without that fallback a customer whose buildings hang off the
   * organisation rather than off a project could never fill the required field.
   */
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

  useEffect(() => {
    if (!buildingId) {
      setFloors([]);
      return undefined;
    }
    let cancelled = false;
    portalService
      .listFloors(buildingId)
      .then((page) => {
        if (!cancelled) setFloors([...page.items]);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRefDataError(
            caught instanceof ApiError ? caught.message : 'Давхрын жагсаалт ачаалж чадсангүй.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildingId]);

  async function handleUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setUploading(true);
    setFormError(null);
    try {
      const uploaded = await portalService.uploadAttachment(file);
      setAttachments((current) => [...current, uploaded]);
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Файл хуулж чадсангүй.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!user?.customerId) {
      // Mirrors the server, which answers 403 for a customer account with no organisation
      // rather than defaulting one. Said here so the person is told why.
      setFormError('Таны бүртгэл байгууллагад холбогдоогүй байна. Админд хандана уу.');
      return;
    }

    const payload: CreateServiceRequestInput = {
      customerId: user.customerId,
      branch: null,
      projectId: projectId || null,
      buildingId,
      floorId: floorId || null,
      requestType: requestType as ServiceRequestType,
      isUrgent,
      description: description.trim(),
      contactName: contactName.trim(),
      contactPhone: contactPhone.trim(),
      attachmentIds: attachments.map((attachment) => attachment.id),
    };

    // The same shared schema the API validates against, so the two cannot drift.
    const parsed = createServiceRequestSchema.safeParse(payload);
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
      const created = await portalService.createRequest(parsed.data);
      notify(`${created.requestNumber} хүсэлт илгээгдлээ.`, 'success');
      navigate(`/portal/requests/${created.id}`, { replace: true });
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

  const isScheduled = requestType === 'PLANNED_INSPECTION';

  return (
    <>
      <PageHeader
        title="Шинэ хүсэлт"
        description="Гэмтэл мэдэгдэх, эсвэл төлөвлөгөөт үзлэг хүсэх."
        backTo={{ to: '/portal/requests', label: 'Миний хүсэлт рүү буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/portal' },
          { label: 'Миний хүсэлт', to: '/portal/requests' },
          { label: 'Шинэ' },
        ]}
      />

      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          {formError && <Alert variant="error">{formError}</Alert>}
          {refDataError && <Alert variant="warning">{refDataError}</Alert>}

          <Section title="Байршил">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Төсөл" error={fieldErrors.projectId} hint="Заавал биш.">
                <SelectInput
                  value={projectId}
                  onChange={(value) => {
                    setProjectId(value);
                    setBuildingId('');
                    setFloorId('');
                  }}
                  placeholder="Бүх барилга"
                  options={projects.map((project) => ({ value: project.id, label: project.name }))}
                  disabled={submitting}
                />
              </Field>

              <Field label="Барилга" required error={fieldErrors.buildingId}>
                <SelectInput
                  value={buildingId}
                  onChange={(value) => {
                    setBuildingId(value);
                    setFloorId('');
                  }}
                  placeholder="Барилга сонгох"
                  options={buildings.map((building) => ({
                    value: building.id,
                    label: building.name,
                  }))}
                  disabled={submitting}
                />
              </Field>

              <Field label="Давхар" error={fieldErrors.floorId}>
                <SelectInput
                  value={floorId}
                  onChange={setFloorId}
                  placeholder="Давхар сонгох"
                  options={floors.map((floor) => ({ value: floor.id, label: floor.name }))}
                  disabled={submitting || !buildingId}
                />
              </Field>
            </div>
          </Section>

          <Section title="Хүсэлт">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Field label="Төрөл" required error={fieldErrors.requestType}>
                <SelectInput
                  value={requestType}
                  onChange={(value) => setRequestType(value as ServiceRequestType)}
                  placeholder="Төрөл сонгох"
                  options={SERVICE_REQUEST_TYPES.map((value) => ({
                    value,
                    label: SERVICE_REQUEST_TYPE_LABELS[value],
                  }))}
                  disabled={submitting}
                />
              </Field>

              <Field label="Холбоо барих хүн" required error={fieldErrors.contactName}>
                <TextInput value={contactName} onChange={setContactName} disabled={submitting} />
              </Field>

              <Field label="Утас" required error={fieldErrors.contactPhone}>
                <TextInput value={contactPhone} onChange={setContactPhone} disabled={submitting} />
              </Field>
            </div>

            {isScheduled && (
              <div className="mt-3">
                <Alert variant="info">
                  Төлөвлөгөөт үзлэгийн хүсэлт манай багт очно. Хүлээн авч баталсны дараа
                  ажилтан хуваарилагдаж, товлосон хугацаа тодорхой болно.
                </Alert>
              </div>
            )}

            <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={isUrgent}
                onChange={(event) => setIsUrgent(event.target.checked)}
                disabled={submitting}
                className="h-4 w-4 rounded border-slate-300"
              />
              Яаралтай
            </label>

            <div className="mt-3">
              <label htmlFor="portal-description" className={FILTER_LABEL}>
                Тайлбар
              </label>
              <textarea
                id="portal-description"
                rows={4}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={submitting}
                className={FIELD_TEXTAREA}
              />
              {fieldErrors.description && (
                <p className="mt-1 text-xs text-red-600">{fieldErrors.description}</p>
              )}
            </div>
          </Section>

          <Section title="Хавсралт">
            <p className="mb-2 text-xs text-slate-500">
              Зураг, PDF, Word, Excel - хамгийн ихдээ 10MB.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_TYPES}
              onChange={(event) => void handleUpload(event.target.files?.[0])}
              disabled={submitting || uploading}
              className="block text-sm text-slate-700"
            />
            {attachments.length > 0 && (
              <ul className="mt-3 space-y-1">
                {attachments.map((attachment) => (
                  <li
                    key={attachment.id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"
                  >
                    <span className="truncate text-slate-700">{attachment.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setAttachments((current) =>
                          current.filter((entry) => entry.id !== attachment.id),
                        )
                      }
                      disabled={submitting}
                      className="shrink-0 text-xs font-medium text-red-600 hover:underline"
                    >
                      Хасах
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/portal/requests')}
              disabled={submitting}
            >
              Цуцлах
            </Button>
            <Button type="submit" loading={submitting} disabled={uploading}>
              Илгээх
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
