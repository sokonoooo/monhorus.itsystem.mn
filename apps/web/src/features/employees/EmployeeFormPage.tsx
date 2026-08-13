import {
  EMPLOYEE_STATUSES,
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_TYPES,
  EMPLOYEE_TYPE_LABELS,
  GENDERS,
  GENDER_LABELS,
  MARITAL_STATUSES,
  MARITAL_STATUS_LABELS,
  PERMISSIONS,
  QUALIFICATION_LEVELS,
  QUALIFICATION_LEVEL_LABELS,
  SAFETY_GRADES,
  createEmployeeSchema,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { EmployeeSalaryTab } from './EmployeeSalaryTab';
import { Field, Section, TextInput, SelectInput } from './FormControls';
import { useOrgSelectors } from './useOrgSelectors';

type TabKey = 'general' | 'profile' | 'salary';

const TABS: ReadonlyArray<{ key: TabKey; label: string }> = [
  { key: 'general', label: 'Ерөнхий мэдээлэл' },
  { key: 'profile', label: 'Анкет' },
  { key: 'salary', label: 'Цалингийн мэдээлэл' },
];

/** Form state keeps every field as a string, which is what inputs produce. */
interface FormState {
  employeeCode: string;
  firstName: string;
  lastName: string;
  registrationNumber: string;
  email: string;
  phone: string;
  birthDate: string;
  gender: string;

  companyId: string;
  departmentId: string;
  positionId: string;
  teamId: string;
  workLocation: string;
  employmentStartDate: string;
  employeeType: string;
  status: string;
  terminationDate: string;
  terminationReason: string;

  icCardNumber: string;
  attendanceNumber: string;
  skills: string;
  qualificationLevel: string;
  safetyGrade: string;
  permittedJobTypes: string;
  hasDriverLicense: boolean;
  gpsVerificationEnabled: boolean;

  mealDiscountPercent: string;
  dailyMealCount: string;
  mealConfigEnabled: boolean;

  birthProvince: string;
  birthDistrict: string;
  currentAddress: string;
  residentialAddress: string;
  maritalStatus: string;
  familySize: string;
  emergencyContactName: string;
  emergencyContactRelation: string;
  emergencyContactPhone: string;
}

const EMPTY_FORM: FormState = {
  employeeCode: '', firstName: '', lastName: '', registrationNumber: '', email: '', phone: '',
  birthDate: '', gender: '',
  companyId: '', departmentId: '', positionId: '', teamId: '', workLocation: '',
  employmentStartDate: '', employeeType: '', status: 'DRAFT', terminationDate: '', terminationReason: '',
  icCardNumber: '', attendanceNumber: '', skills: '', qualificationLevel: '', safetyGrade: '',
  permittedJobTypes: '', hasDriverLicense: false, gpsVerificationEnabled: true,
  mealDiscountPercent: '', dailyMealCount: '', mealConfigEnabled: false,
  birthProvince: '', birthDistrict: '', currentAddress: '', residentialAddress: '',
  maritalStatus: '', familySize: '', emergencyContactName: '', emergencyContactRelation: '',
  emergencyContactPhone: '',
};

/** Blank optional inputs are sent as null, not as empty strings. */
function nullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function csvToArray(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export function EmployeeFormPage(): ReactElement {
  const { employeeId } = useParams<{ employeeId: string }>();
  const isEdit = Boolean(employeeId);
  const navigate = useNavigate();
  const { can } = useAuth();

  const [activeTab, setActiveTab] = useState<TabKey>('general');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);

  const canViewSalary = can(PERMISSIONS.EMPLOYEE_VIEW_SALARY);
  const visibleTabs = TABS.filter((tab) => tab.key !== 'salary' || canViewSalary);

  const org = useOrgSelectors(form.companyId, form.departmentId);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((previous) => {
      const next = { ...previous, [key]: value };

      // Changing a parent invalidates its children, so stale ids can never be
      // submitted. The backend rejects mismatches too; this keeps the UI honest.
      if (key === 'companyId') {
        next.departmentId = '';
        next.positionId = '';
        next.teamId = '';
      }
      if (key === 'departmentId') {
        next.positionId = '';
        next.teamId = '';
      }

      return next;
    });
    setDirty(true);
  }, []);

  useEffect(() => {
    if (!employeeId) return;

    let cancelled = false;
    setLoading(true);

    employeeService
      .getById(employeeId)
      .then((employee) => {
        if (cancelled) return;
        setForm({
          employeeCode: employee.employeeCode,
          firstName: employee.firstName,
          lastName: employee.lastName,
          registrationNumber: employee.registrationNumber ?? '',
          email: employee.email ?? '',
          phone: employee.phone ?? '',
          birthDate: employee.birthDate?.slice(0, 10) ?? '',
          gender: employee.gender ?? '',
          companyId: employee.company?.id ?? '',
          departmentId: employee.department?.id ?? '',
          positionId: employee.position?.id ?? '',
          teamId: employee.team?.id ?? '',
          workLocation: employee.workLocation ?? '',
          employmentStartDate: employee.employmentStartDate?.slice(0, 10) ?? '',
          employeeType: employee.employeeType ?? '',
          status: employee.status,
          terminationDate: employee.terminationDate?.slice(0, 10) ?? '',
          terminationReason: employee.terminationReason ?? '',
          icCardNumber: employee.icCardNumber ?? '',
          attendanceNumber: employee.attendanceNumber ?? '',
          skills: employee.skills.join(', '),
          qualificationLevel: employee.qualificationLevel ?? '',
          safetyGrade: employee.safetyGrade ?? '',
          permittedJobTypes: employee.permittedJobTypes.join(', '),
          hasDriverLicense: employee.hasDriverLicense,
          gpsVerificationEnabled: employee.gpsVerificationEnabled,
          mealDiscountPercent: employee.mealDiscountPercent?.toString() ?? '',
          dailyMealCount: employee.dailyMealCount?.toString() ?? '',
          mealConfigEnabled: employee.mealConfigEnabled,
          birthProvince: employee.birthProvince ?? '',
          birthDistrict: employee.birthDistrict ?? '',
          currentAddress: employee.currentAddress ?? '',
          residentialAddress: employee.residentialAddress ?? '',
          maritalStatus: employee.maritalStatus ?? '',
          familySize: employee.familySize?.toString() ?? '',
          emergencyContactName: employee.emergencyContactName ?? '',
          emergencyContactRelation: employee.emergencyContactRelation ?? '',
          emergencyContactPhone: employee.emergencyContactPhone ?? '',
        });
        setDirty(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setFormError(
          caught instanceof ApiError ? caught.message : 'Ажилтны мэдээлэл ачаалж чадсангүй.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  // Unsaved-change warning on tab close or reload.
  useEffect(() => {
    if (!dirty) return undefined;

    function warn(event: BeforeUnloadEvent): void {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function buildPayload(): CreateEmployeeInput {
    return {
      employeeCode: form.employeeCode.trim().toUpperCase(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      registrationNumber: nullable(form.registrationNumber),
      email: nullable(form.email),
      phone: nullable(form.phone),
      birthDate: nullable(form.birthDate),
      gender: (nullable(form.gender) as CreateEmployeeInput['gender']) ?? null,
      companyId: nullable(form.companyId),
      departmentId: nullable(form.departmentId),
      positionId: nullable(form.positionId),
      teamId: nullable(form.teamId),
      directManagerId: null,
      workLocation: nullable(form.workLocation),
      employmentStartDate: nullable(form.employmentStartDate),
      employeeType: (nullable(form.employeeType) as CreateEmployeeInput['employeeType']) ?? null,
      status: form.status as CreateEmployeeInput['status'],
      terminationDate: nullable(form.terminationDate),
      terminationReason: nullable(form.terminationReason),
      icCardNumber: nullable(form.icCardNumber),
      attendanceNumber: nullable(form.attendanceNumber),
      skills: csvToArray(form.skills),
      qualificationLevel:
        (nullable(form.qualificationLevel) as CreateEmployeeInput['qualificationLevel']) ?? null,
      safetyGrade: (nullable(form.safetyGrade) as CreateEmployeeInput['safetyGrade']) ?? null,
      permittedJobTypes: csvToArray(form.permittedJobTypes),
      hasDriverLicense: form.hasDriverLicense,
      gpsVerificationEnabled: form.gpsVerificationEnabled,
      mealDiscountPercent: numberOrNull(form.mealDiscountPercent),
      dailyMealCount: numberOrNull(form.dailyMealCount),
      mealConfigEnabled: form.mealConfigEnabled,
      birthProvince: nullable(form.birthProvince),
      birthDistrict: nullable(form.birthDistrict),
      currentAddress: nullable(form.currentAddress),
      residentialAddress: nullable(form.residentialAddress),
      maritalStatus: (nullable(form.maritalStatus) as CreateEmployeeInput['maritalStatus']) ?? null,
      familySize: numberOrNull(form.familySize),
      emergencyContactName: nullable(form.emergencyContactName),
      emergencyContactRelation: nullable(form.emergencyContactRelation),
      emergencyContactPhone: nullable(form.emergencyContactPhone),
      // A brand new employee genuinely has no anket records yet, so [] is honest here.
      // It is NOT honest on an edit — see `toUpdatePayload` below.
      education: [],
      workHistory: [],
      certificates: [],
    };
  }

  /**
   * The edit payload, with the three anket lists removed.
   *
   * This form has no UI for education, work history or certificates — they are entered
   * elsewhere and read by the employee mobile app. `buildPayload` still has to supply them
   * because `createEmployeeSchema` requires them, and even omitting them there would not
   * help: `safeParse` re-injects `[]` from each field's `.default([])`.
   *
   * Sent on an update they are not "no change", they are "delete everything" — the backend
   * applies any key that is present (`if (input.education !== undefined)`), so saving a
   * phone-number correction wiped the employee's entire education, work history and
   * certificate record, with nothing on screen to show it had happened.
   *
   * `updateEmployeeSchema` is `.partial()`, so an ABSENT key is left untouched server-side.
   * Dropping the keys is therefore the whole fix, and it deliberately keeps an explicit []
   * meaningful for a future screen that does manage these lists.
   */
  function toUpdatePayload(parsed: CreateEmployeeInput): UpdateEmployeeInput {
    const { education: _education, workHistory: _workHistory, certificates: _certificates, ...rest } = parsed;
    return rest;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const payload = buildPayload();

    // Validate with the exact schema the backend uses, so the user sees the same
    // rules locally instead of a round trip for an obvious miss.
    const parsed = createEmployeeSchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setFormError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      setActiveTab('general');
      return;
    }

    setSubmitting(true);
    try {
      const saved = isEdit && employeeId
        ? await employeeService.update(employeeId, toUpdatePayload(parsed.data))
        : await employeeService.create(parsed.data);
      setDirty(false);
      navigate(`/employees/${saved.id}`, { replace: true });
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

  function handleCancel(): void {
    if (dirty && !window.confirm('Хадгалаагүй өөрчлөлт байна. Гарах уу?')) return;
    navigate(isEdit && employeeId ? `/employees/${employeeId}` : '/employees');
  }

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title={isEdit ? 'Ажилтны мэдээлэл засах' : 'Шинэ ажилтан бүртгэх'}
        backTo={{ to: '/employees', label: 'Ажилтны жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Ажилтан', to: '/employees' },
          { label: isEdit ? 'Засах' : 'Шинэ' },
        ]}
      />

      <form onSubmit={handleSubmit} noValidate>
        <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
          <div role="tablist" aria-label="Ажилтны маягт" className="flex gap-1 border-b border-slate-200 px-3 pt-2">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-t-md px-3 py-2 text-sm font-medium transition-colors ${
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
            {formError && (
              <div className="mb-4">
                <Alert variant="error">{formError}</Alert>
              </div>
            )}
            {org.error && (
              <div className="mb-4">
                <Alert variant="warning">{org.error}</Alert>
              </div>
            )}

            {activeTab === 'general' && (
              <div className="space-y-6">
                <Section title="Хувийн мэдээлэл">
                  <Field label="Ажилтны код" required error={fieldErrors.employeeCode}>
                    <TextInput
                      value={form.employeeCode}
                      onChange={(value) => update('employeeCode', value)}
                      placeholder="EMP-0001"
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Овог" required error={fieldErrors.lastName}>
                    <TextInput value={form.lastName} onChange={(v) => update('lastName', v)} disabled={submitting} />
                  </Field>
                  <Field label="Нэр" required error={fieldErrors.firstName}>
                    <TextInput value={form.firstName} onChange={(v) => update('firstName', v)} disabled={submitting} />
                  </Field>
                  <Field label="Регистрийн дугаар" error={fieldErrors.registrationNumber} hint="Жишээ: АА12345678">
                    <TextInput
                      value={form.registrationNumber}
                      onChange={(v) => update('registrationNumber', v.toUpperCase())}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Цахим шуудан" error={fieldErrors.email}>
                    <TextInput type="email" value={form.email} onChange={(v) => update('email', v)} disabled={submitting} />
                  </Field>
                  <Field label="Утас" error={fieldErrors.phone} hint="Жишээ: 9911-2233">
                    <TextInput value={form.phone} onChange={(v) => update('phone', v)} disabled={submitting} />
                  </Field>
                  <Field label="Төрсөн огноо" error={fieldErrors.birthDate}>
                    <TextInput type="date" value={form.birthDate} onChange={(v) => update('birthDate', v)} disabled={submitting} />
                  </Field>
                  <Field label="Хүйс" error={fieldErrors.gender}>
                    <SelectInput
                      value={form.gender}
                      onChange={(v) => update('gender', v)}
                      placeholder="Сонгох"
                      options={GENDERS.map((g) => ({ value: g, label: GENDER_LABELS[g] }))}
                      disabled={submitting}
                    />
                  </Field>
                </Section>

                <Section title="Хөдөлмөр эрхлэлт">
                  <Field label="Компани" error={fieldErrors.companyId} required={form.status === 'ACTIVE'}>
                    <SelectInput
                      value={form.companyId}
                      onChange={(v) => update('companyId', v)}
                      placeholder="Компани сонгох"
                      options={org.companies.map((c) => ({ value: c.id, label: c.name }))}
                      disabled={submitting}
                    />
                  </Field>
                  <Field
                    label="Харьяалагдах алба"
                    error={fieldErrors.departmentId}
                    required={form.status === 'ACTIVE'}
                    hint={!form.companyId ? 'Эхлээд компани сонгоно уу' : undefined}
                  >
                    <SelectInput
                      value={form.departmentId}
                      onChange={(v) => update('departmentId', v)}
                      placeholder="Алба сонгох"
                      options={org.departments.map((d) => ({ value: d.id, label: d.name }))}
                      disabled={submitting || !form.companyId}
                    />
                  </Field>
                  <Field
                    label="Албан тушаал"
                    error={fieldErrors.positionId}
                    required={form.status === 'ACTIVE'}
                    hint={!form.companyId ? 'Эхлээд компани сонгоно уу' : undefined}
                  >
                    <SelectInput
                      value={form.positionId}
                      onChange={(v) => update('positionId', v)}
                      placeholder="Албан тушаал сонгох"
                      options={org.positions.map((p) => ({ value: p.id, label: p.name }))}
                      disabled={submitting || !form.companyId}
                    />
                  </Field>
                  <Field label="Баг" error={fieldErrors.teamId}>
                    <SelectInput
                      value={form.teamId}
                      onChange={(v) => update('teamId', v)}
                      placeholder="Баг сонгох"
                      options={org.teams.map((t) => ({ value: t.id, label: t.name }))}
                      disabled={submitting || !form.companyId}
                    />
                  </Field>
                  <Field label="Ажлын байршил" error={fieldErrors.workLocation}>
                    <TextInput value={form.workLocation} onChange={(v) => update('workLocation', v)} disabled={submitting} />
                  </Field>
                  <Field label="Ажиллаж эхэлсэн огноо" error={fieldErrors.employmentStartDate} required={form.status === 'ACTIVE'}>
                    <TextInput type="date" value={form.employmentStartDate} onChange={(v) => update('employmentStartDate', v)} disabled={submitting} />
                  </Field>
                  <Field label="Ажилтны төрөл" error={fieldErrors.employeeType} required={form.status === 'ACTIVE'}>
                    <SelectInput
                      value={form.employeeType}
                      onChange={(v) => update('employeeType', v)}
                      placeholder="Төрөл сонгох"
                      options={EMPLOYEE_TYPES.map((t) => ({ value: t, label: EMPLOYEE_TYPE_LABELS[t] }))}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Ажилтны төлөв" required error={fieldErrors.status}>
                    <SelectInput
                      value={form.status}
                      onChange={(v) => update('status', v)}
                      options={EMPLOYEE_STATUSES.map((s) => ({ value: s, label: EMPLOYEE_STATUS_LABELS[s] }))}
                      disabled={submitting}
                    />
                  </Field>
                  {form.status === 'TERMINATED' && (
                    <>
                      <Field label="Ажлаас гарсан огноо" required error={fieldErrors.terminationDate}>
                        <TextInput type="date" value={form.terminationDate} onChange={(v) => update('terminationDate', v)} disabled={submitting} />
                      </Field>
                      <Field label="Ажлаас гарсан шалтгаан" required error={fieldErrors.terminationReason}>
                        <TextInput value={form.terminationReason} onChange={(v) => update('terminationReason', v)} disabled={submitting} />
                      </Field>
                    </>
                  )}
                </Section>

                <Section title="Үйл ажиллагааны мэдээлэл">
                  <Field label="IC карт" error={fieldErrors.icCardNumber}>
                    <TextInput value={form.icCardNumber} onChange={(v) => update('icCardNumber', v)} disabled={submitting} />
                  </Field>
                  <Field label="Цаг бүртгэлийн дугаар" error={fieldErrors.attendanceNumber}>
                    <TextInput value={form.attendanceNumber} onChange={(v) => update('attendanceNumber', v)} disabled={submitting} />
                  </Field>
                  <Field label="Ур чадвар" error={fieldErrors.skills} hint="Таслалаар тусгаарлана">
                    <TextInput value={form.skills} onChange={(v) => update('skills', v)} disabled={submitting} />
                  </Field>
                  <Field label="Мэргэшлийн түвшин" error={fieldErrors.qualificationLevel}>
                    <SelectInput
                      value={form.qualificationLevel}
                      onChange={(v) => update('qualificationLevel', v)}
                      placeholder="Сонгох"
                      options={QUALIFICATION_LEVELS.map((q) => ({ value: q, label: QUALIFICATION_LEVEL_LABELS[q] }))}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Цахилгааны аюулгүй ажиллагааны зэрэг" error={fieldErrors.safetyGrade}>
                    <SelectInput
                      value={form.safetyGrade}
                      onChange={(v) => update('safetyGrade', v)}
                      placeholder="Сонгох"
                      options={SAFETY_GRADES.map((g) => ({ value: g, label: `${g} зэрэг` }))}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Зөвшөөрөгдсөн ажлын төрөл" error={fieldErrors.permittedJobTypes} hint="Таслалаар тусгаарлана">
                    <TextInput value={form.permittedJobTypes} onChange={(v) => update('permittedJobTypes', v)} disabled={submitting} />
                  </Field>
                  <Field label="Жолооны үнэмлэхтэй эсэх">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.hasDriverLicense}
                        onChange={(e) => update('hasDriverLicense', e.target.checked)}
                        disabled={submitting}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Тийм
                    </label>
                  </Field>
                  <Field label="GPS баталгаажуулалт ашиглах эсэх">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.gpsVerificationEnabled}
                        onChange={(e) => update('gpsVerificationEnabled', e.target.checked)}
                        disabled={submitting}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Идэвхтэй
                    </label>
                  </Field>
                </Section>

                <Section title="Хоол, хөнгөлөлтийн тохиргоо">
                  <Field label="Хоолны хөнгөлөлтийн хувь" error={fieldErrors.mealDiscountPercent} hint="0-100">
                    <TextInput type="number" value={form.mealDiscountPercent} onChange={(v) => update('mealDiscountPercent', v)} disabled={submitting} />
                  </Field>
                  <Field label="Өдрийн хоол захиалах тоо" error={fieldErrors.dailyMealCount}>
                    <TextInput type="number" value={form.dailyMealCount} onChange={(v) => update('dailyMealCount', v)} disabled={submitting} />
                  </Field>
                  <Field label="Хоолны тохиргоо идэвхтэй эсэх">
                    <label className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={form.mealConfigEnabled}
                        onChange={(e) => update('mealConfigEnabled', e.target.checked)}
                        disabled={submitting}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      Идэвхтэй
                    </label>
                  </Field>
                </Section>
              </div>
            )}

            {activeTab === 'profile' && (
              <div className="space-y-6">
                <Section title="Хувийн байдал">
                  <Field label="Төрсөн аймаг/хот" error={fieldErrors.birthProvince}>
                    <TextInput value={form.birthProvince} onChange={(v) => update('birthProvince', v)} disabled={submitting} />
                  </Field>
                  <Field label="Төрсөн сум/дүүрэг" error={fieldErrors.birthDistrict}>
                    <TextInput value={form.birthDistrict} onChange={(v) => update('birthDistrict', v)} disabled={submitting} />
                  </Field>
                  <Field label="Одоогийн хаяг" error={fieldErrors.currentAddress}>
                    <TextInput value={form.currentAddress} onChange={(v) => update('currentAddress', v)} disabled={submitting} />
                  </Field>
                  <Field label="Оршин суугаа хаяг" error={fieldErrors.residentialAddress}>
                    <TextInput value={form.residentialAddress} onChange={(v) => update('residentialAddress', v)} disabled={submitting} />
                  </Field>
                  <Field label="Гэр бүлийн байдал" error={fieldErrors.maritalStatus}>
                    <SelectInput
                      value={form.maritalStatus}
                      onChange={(v) => update('maritalStatus', v)}
                      placeholder="Сонгох"
                      options={MARITAL_STATUSES.map((m) => ({ value: m, label: MARITAL_STATUS_LABELS[m] }))}
                      disabled={submitting}
                    />
                  </Field>
                  <Field label="Ам бүлийн тоо" error={fieldErrors.familySize}>
                    <TextInput type="number" value={form.familySize} onChange={(v) => update('familySize', v)} disabled={submitting} />
                  </Field>
                </Section>

                <Section title="Яаралтай холбоо барих">
                  <Field label="Яаралтай холбоо барих хүний нэр" error={fieldErrors.emergencyContactName}>
                    <TextInput value={form.emergencyContactName} onChange={(v) => update('emergencyContactName', v)} disabled={submitting} />
                  </Field>
                  <Field label="Хамаарал" error={fieldErrors.emergencyContactRelation}>
                    <TextInput value={form.emergencyContactRelation} onChange={(v) => update('emergencyContactRelation', v)} disabled={submitting} />
                  </Field>
                  <Field label="Яаралтай холбоо барих утас" error={fieldErrors.emergencyContactPhone}>
                    <TextInput value={form.emergencyContactPhone} onChange={(v) => update('emergencyContactPhone', v)} disabled={submitting} />
                  </Field>
                </Section>

                <Alert variant="info">
                  Боловсрол, өмнөх ажлын түүх, сертификатыг ажилтныг үүсгэсний дараа
                  дэлгэрэнгүй хуудаснаас нэмнэ.
                </Alert>
              </div>
            )}

            {activeTab === 'salary' && canViewSalary && (
              <EmployeeSalaryTab employeeId={employeeId ?? null} />
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3">
            <Button type="button" variant="secondary" onClick={handleCancel} disabled={submitting}>
              Цуцлах
            </Button>
            <Button type="submit" loading={submitting}>
              {isEdit ? 'Хадгалах' : 'Ажилтан үүсгэх'}
            </Button>
          </div>
        </div>
      </form>
    </>
  );
}
