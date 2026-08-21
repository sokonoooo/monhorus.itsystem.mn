import {
  EMPLOYEE_STATUS_LABELS,
  EMPLOYEE_TYPE_LABELS,
  GENDER_LABELS,
  PERMISSIONS,
  QUALIFICATION_LEVEL_LABELS,
  type EmployeeDetailDto,
} from '@monhorus/shared';
import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { EmployeeStatusBadge } from '../../components/ui/DomainBadges';
import { PageHeader } from '../../components/ui/PageHeader';
import { ErrorState, Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { EmployeeDocumentsPanel } from './EmployeeDocumentsPanel';
import { EmployeeSystemAccessPanel } from './EmployeeSystemAccessPanel';

function Row({ label, value }: { label: string; value: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right text-sm text-slate-900">{value ?? '-'}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function EmployeeDetailPage(): ReactElement {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [employee, setEmployee] = useState<EmployeeDetailDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [certificateNotice, setCertificateNotice] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      setEmployee(await employeeService.getById(employeeId));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Мэдээлэл ачаалж чадсангүй.');
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handlePrintCertificate(): Promise<void> {
    if (!employeeId) return;
    setCertificateNotice(null);
    try {
      const payload = await employeeService.certificate(employeeId);
      // Server-rendered PDF is a later phase; the print dialog on a clean document
      // is the interim mechanism and produces the same content.
      const win = window.open('', '_blank', 'width=800,height=900');
      if (!win) {
        setCertificateNotice('Хөтөч цонх нээхийг хориглосон байна.');
        return;
      }
      win.document.write(`<!doctype html><html lang="mn"><head><meta charset="utf-8">
<title>Ажилтны тодорхойлолт</title>
<style>body{font-family:'Times New Roman',serif;padding:48px;line-height:1.7}
h1{font-size:18px;text-align:center;margin-bottom:28px}
table{width:100%;border-collapse:collapse}td{padding:6px 0;vertical-align:top}
td:first-child{width:220px;color:#444}.foot{margin-top:48px;font-size:13px}</style></head><body>
<h1>АЖИЛТНЫ ТОДОРХОЙЛОЛТ</h1>
<table>
<tr><td>Байгууллага</td><td>${payload.companyName ?? '-'}</td></tr>
<tr><td>Ажилтны код</td><td>${payload.employeeCode}</td></tr>
<tr><td>Овог, нэр</td><td>${payload.fullName}</td></tr>
${payload.registrationNumber ? `<tr><td>Регистрийн дугаар</td><td>${payload.registrationNumber}</td></tr>` : ''}
<tr><td>Харьяалагдах алба</td><td>${payload.departmentName ?? '-'}</td></tr>
<tr><td>Албан тушаал</td><td>${payload.positionName ?? '-'}</td></tr>
<tr><td>Ажилд орсон огноо</td><td>${payload.employmentStartDate?.slice(0, 10) ?? '-'}</td></tr>
<tr><td>Одоогийн төлөв</td><td>${EMPLOYEE_STATUS_LABELS[payload.status] ?? payload.status}</td></tr>
</table>
<div class="foot"><p>Тодорхойлолт гаргасан огноо: ${payload.generatedAt.slice(0, 10)}</p>
<p>Эрх бүхий албан тушаалтан: ${payload.generatedByName}</p></div>
</body></html>`);
      win.document.close();
      win.focus();
      win.print();
    } catch (caught) {
      setCertificateNotice(
        caught instanceof ApiError ? caught.message : 'Тодорхойлолт гаргаж чадсангүй.',
      );
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

  if (error || !employee) {
    return <ErrorState description={error ?? 'Ажилтан олдсонгүй.'} />;
  }

  return (
    <>
      <PageHeader
        title={`${employee.lastName} ${employee.firstName}`}
        description={`${employee.employeeCode} · ${employee.position?.name ?? 'Албан тушаал тодорхойгүй'}`}
        backTo={{ to: '/employees', label: 'Ажилтны жагсаалт руу буцах' }}
        breadcrumbs={[
          { label: 'Нүүр', to: '/dashboard' },
          { label: 'Ажилтан', to: '/employees' },
          { label: `${employee.lastName} ${employee.firstName}` },
        ]}
        actions={
          <>
            {can(PERMISSIONS.EMPLOYEE_PRINT_CERTIFICATE) && (
              <Button variant="secondary" onClick={() => void handlePrintCertificate()}>
                Тодорхойлолт хэвлэх
              </Button>
            )}
            {can(PERMISSIONS.EMPLOYEE_UPDATE) && (
              <Button onClick={() => navigate(`/employees/${employee.id}/edit`)}>Засах</Button>
            )}
          </>
        }
      />

      {certificateNotice && (
        <div className="mb-4">
          <Alert variant="error">{certificateNotice}</Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card title="Ерөнхий">
            <div className="mb-3 flex items-center gap-3">
              {employee.photoUrl ? (
                <img
                  src={employee.photoUrl}
                  alt=""
                  className="h-16 w-16 rounded-full object-cover ring-1 ring-slate-200"
                />
              ) : (
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-lg font-semibold text-slate-600">
                  {employee.lastName.charAt(0)}
                  {employee.firstName.charAt(0)}
                </span>
              )}
              <EmployeeStatusBadge status={employee.status} />
            </div>
            <Row label="Регистр" value={employee.registrationNumber} />
            <Row label="Утас" value={employee.phone} />
            <Row label="Имэйл" value={employee.email} />
            <Row label="Төрсөн огноо" value={employee.birthDate?.slice(0, 10)} />
            <Row label="Хүйс" value={employee.gender ? GENDER_LABELS[employee.gender] : null} />
          </Card>

          <Card title="Системийн эрх">
            <EmployeeSystemAccessPanel
              employeeId={employee.id}
              access={employee.systemAccess}
              onChanged={() => void load()}
            />
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card title="Хөдөлмөр эрхлэлт">
            <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
              <div>
                <Row label="Компани" value={employee.company?.name} />
                <Row label="Алба" value={employee.department?.name} />
                <Row label="Албан тушаал" value={employee.position?.name} />
                <Row label="Баг" value={employee.team?.name} />
              </div>
              <div>
                <Row
                  label="Ажилтны төрөл"
                  value={employee.employeeType ? EMPLOYEE_TYPE_LABELS[employee.employeeType] : null}
                />
                <Row label="Ажилд орсон" value={employee.employmentStartDate?.slice(0, 10)} />
                <Row label="Ажлын байршил" value={employee.workLocation} />
                <Row
                  label="Шууд удирдлага"
                  value={
                    employee.directManager
                      ? `${employee.directManager.lastName} ${employee.directManager.firstName}`
                      : null
                  }
                />
              </div>
            </div>
          </Card>

          <Card title="Ур чадвар, мэргэшил">
            <Row
              label="Ур чадвар"
              value={employee.skills.length > 0 ? employee.skills.join(', ') : null}
            />
            <Row
              label="Мэргэшлийн түвшин"
              value={
                employee.qualificationLevel
                  ? QUALIFICATION_LEVEL_LABELS[employee.qualificationLevel]
                  : null
              }
            />
            <Row label="Аюулгүй ажиллагааны зэрэг" value={employee.safetyGrade} />
            <Row
              label="Зөвшөөрөгдсөн ажлын төрөл"
              value={
                employee.permittedJobTypes.length > 0 ? employee.permittedJobTypes.join(', ') : null
              }
            />
            <Row label="Жолооны үнэмлэх" value={employee.hasDriverLicense ? 'Тийм' : 'Үгүй'} />
          </Card>

          {/* The key is absent, not null, when the caller lacks employee.view_salary. */}
          {'currentSalary' in employee && (
            <Card title="Одоогийн цалин">
              {employee.currentSalary ? (
                <>
                  <Row
                    label="Үндсэн цалин"
                    value={`${employee.currentSalary.baseSalary.toLocaleString('mn-MN')} ${employee.currentSalary.currency}`}
                  />
                  <Row label="Зэрэглэл" value={employee.currentSalary.grade} />
                  <Row
                    label="Хүчинтэй эхлэх"
                    value={employee.currentSalary.effectiveFrom.slice(0, 10)}
                  />
                </>
              ) : (
                <p className="text-sm text-slate-500">Цалингийн мэдээлэл бүртгэгдээгүй байна.</p>
              )}
            </Card>
          )}

          <Card title="Баримт бичиг">
            <EmployeeDocumentsPanel employeeId={employee.id} />
          </Card>

          <Card title="Төлөвийн түүх">
            {employee.statusHistory.length === 0 ? (
              <p className="text-sm text-slate-500">Түүх байхгүй байна.</p>
            ) : (
              <ol className="space-y-2">
                {employee.statusHistory.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3 text-sm">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400" />
                    <div className="min-w-0">
                      <p className="text-slate-900">
                        {entry.fromStatus ? `${entry.fromStatus} → ` : ''}
                        {entry.toStatus}
                      </p>
                      <p className="text-xs text-slate-500">
                        {new Date(entry.changedAt).toLocaleString('mn-MN', {
                          timeZone: 'Asia/Ulaanbaatar',
                        })}
                        {entry.changedByName ? ` · ${entry.changedByName}` : ''}
                        {entry.reason ? ` · ${entry.reason}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
