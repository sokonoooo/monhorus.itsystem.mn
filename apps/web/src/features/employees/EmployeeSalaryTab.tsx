import {
  DEFAULT_CURRENCY,
  PERMISSIONS,
  SALARY_CALCULATION_TYPES,
  SALARY_CALCULATION_TYPE_LABELS,
  SUPPORTED_CURRENCIES,
  employeeSalarySchema,
  type EmployeeSalaryDto,
  type EmployeeSalaryInput,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Skeleton } from '../../components/ui/States';
import { useAuth } from '../../contexts/auth-context';
import { ApiError } from '../../lib/api-client';
import { employeeService } from '../../services/employee.service';
import { Field, Section, SelectInput, TextInput } from './FormControls';

/**
 * Salary tab. Rendered only for a holder of employee.view_salary, and the backend
 * independently omits the salary payload and rejects both salary endpoints for
 * anyone else, so hiding this tab is a convenience rather than the control.
 *
 * Saving never overwrites history: the backend closes the open period and appends a
 * new effective-dated record.
 *
 * That append is what makes seeding the form mandatory rather than a convenience. The
 * backend writes every field of the new row from the payload — there is no merge with the
 * period being closed — so a blank field is a written zero, not an unchanged value. The
 * four allowances started at `'0'` and were never seeded from the loaded record, so
 * raising somebody's base salary silently zeroed their transport, meal, phone and other
 * allowances from the new effective date onward. Every field is therefore carried forward
 * from the most recent record and only the dates are left for the user to supply.
 */
export function EmployeeSalaryTab({ employeeId }: { employeeId: string | null }): ReactElement {
  const { can } = useAuth();
  const canManage = can(PERMISSIONS.EMPLOYEE_MANAGE_SALARY);

  const [history, setHistory] = useState<EmployeeSalaryDto[]>([]);
  const [loading, setLoading] = useState(Boolean(employeeId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [grade, setGrade] = useState('');
  const [baseSalary, setBaseSalary] = useState('');
  const [currency, setCurrency] = useState<string>(DEFAULT_CURRENCY);
  const [calculationType, setCalculationType] = useState<string>('MONTHLY');
  const [bankName, setBankName] = useState('');
  const [bankAccountName, setBankAccountName] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [socialInsurance, setSocialInsurance] = useState(true);
  const [personalIncomeTax, setPersonalIncomeTax] = useState(true);
  const [transportAllowance, setTransportAllowance] = useState('0');
  const [mealAllowance, setMealAllowance] = useState('0');
  const [phoneAllowance, setPhoneAllowance] = useState('0');
  const [otherAllowance, setOtherAllowance] = useState('0');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [effectiveTo, setEffectiveTo] = useState('');

  useEffect(() => {
    if (!employeeId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    employeeService
      .salaryHistory(employeeId)
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);

        /*
         * The most recent record seeds the form.
         *
         * `listSalaryHistory` sorts by `effectiveFrom` descending, so the open period is
         * first; `isCurrent` is preferred where present so a future-dated row cannot be
         * mistaken for the one in force. The dates are deliberately not seeded: a new
         * period must start strictly after the open one, and copying its start date would
         * only produce a rejection.
         */
        const latest = rows.find((row) => row.isCurrent) ?? rows[0];
        if (!latest) return;

        setGrade(latest.grade ?? '');
        setBaseSalary(String(latest.baseSalary));
        setCurrency(latest.currency);
        setCalculationType(latest.calculationType);
        setBankName(latest.bankName ?? '');
        setBankAccountName(latest.bankAccountName ?? '');
        setBankAccountNumber(latest.bankAccountNumber ?? '');
        setSocialInsurance(latest.socialInsurance);
        setPersonalIncomeTax(latest.personalIncomeTax);
        setTransportAllowance(String(latest.transportAllowance));
        setMealAllowance(String(latest.mealAllowance));
        setPhoneAllowance(String(latest.phoneAllowance));
        setOtherAllowance(String(latest.otherAllowance));
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Цалингийн түүх ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId]);

  async function handleSave(): Promise<void> {
    if (!employeeId) return;

    setError(null);
    setNotice(null);
    setFieldErrors({});

    const payload: EmployeeSalaryInput = {
      grade: grade.trim() || null,
      baseSalary: Number(baseSalary || '0'),
      currency: currency as EmployeeSalaryInput['currency'],
      calculationType: calculationType as EmployeeSalaryInput['calculationType'],
      bankName: bankName.trim() || null,
      bankAccountName: bankAccountName.trim() || null,
      bankAccountNumber: bankAccountNumber.trim() || null,
      socialInsurance,
      personalIncomeTax,
      transportAllowance: Number(transportAllowance || '0'),
      mealAllowance: Number(mealAllowance || '0'),
      phoneAllowance: Number(phoneAllowance || '0'),
      otherAllowance: Number(otherAllowance || '0'),
      effectiveFrom,
      effectiveTo: effectiveTo || null,
    };

    const parsed = employeeSalarySchema.safeParse(payload);
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      setError('Оруулсан мэдээлэл шаардлага хангахгүй байна.');
      return;
    }

    setSaving(true);
    try {
      const saved = await employeeService.saveSalary(employeeId, parsed.data);
      setHistory((previous) => [saved, ...previous.map((row) => ({ ...row, isCurrent: false }))]);
      setNotice('Цалингийн шинэ хугацаа бүртгэгдлээ. Өмнөх бичлэг хадгалагдсан.');
    } catch (caught) {
      if (caught instanceof ApiError) {
        setError(caught.message);
        setFieldErrors(caught.fieldErrors);
      } else {
        setError('Гэнэтийн алдаа гарлаа.');
      }
    } finally {
      setSaving(false);
    }
  }

  if (!employeeId) {
    return (
      <Alert variant="info">
        Цалингийн мэдээллийг ажилтныг үүсгэсний дараа бүртгэнэ.
      </Alert>
    );
  }

  if (loading) {
    return <Skeleton className="h-64 w-full" />;
  }

  return (
    <div className="space-y-6">
      {error && <Alert variant="error">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <Alert variant="info">
        Цалингийн түүх хүчин төгөлдөр огноогоор хадгалагдана. Шинэ утга оруулахад өмнөх
        бичлэг устахгүй, харин хугацаа нь хаагдана.
        {history.length > 0 && ' Талбарууд одоогийн бичлэгээс дүүргэгдсэн: өөрчлөөгүй утга хэвээр шилжинэ.'}
      </Alert>

      <Section title="Цалингийн мэдээлэл">
        <Field label="Цалингийн зэрэглэл" error={fieldErrors.grade}>
          <TextInput value={grade} onChange={setGrade} disabled={!canManage || saving} />
        </Field>
        <Field label="Үндсэн цалин" required error={fieldErrors.baseSalary}>
          <TextInput type="number" value={baseSalary} onChange={setBaseSalary} disabled={!canManage || saving} />
        </Field>
        <Field label="Валют" error={fieldErrors.currency}>
          <SelectInput
            value={currency}
            onChange={setCurrency}
            options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
            disabled={!canManage || saving}
          />
        </Field>
        <Field label="Цалин бодох төрөл" error={fieldErrors.calculationType}>
          <SelectInput
            value={calculationType}
            onChange={setCalculationType}
            options={SALARY_CALCULATION_TYPES.map((t) => ({
              value: t,
              label: SALARY_CALCULATION_TYPE_LABELS[t],
            }))}
            disabled={!canManage || saving}
          />
        </Field>
        <Field label="Банк" error={fieldErrors.bankName}>
          <TextInput value={bankName} onChange={setBankName} disabled={!canManage || saving} />
        </Field>
        <Field label="Дансны нэр" error={fieldErrors.bankAccountName}>
          <TextInput value={bankAccountName} onChange={setBankAccountName} disabled={!canManage || saving} />
        </Field>
        <Field label="Банкны дансны дугаар" error={fieldErrors.bankAccountNumber}>
          <TextInput value={bankAccountNumber} onChange={setBankAccountNumber} disabled={!canManage || saving} />
        </Field>
        <Field label="НДШ төлөх эсэх">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={socialInsurance}
              onChange={(e) => setSocialInsurance(e.target.checked)}
              disabled={!canManage || saving}
              className="h-4 w-4 rounded border-slate-300"
            />
            Тийм
          </label>
        </Field>
        <Field label="ХХОАТ тооцох эсэх">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={personalIncomeTax}
              onChange={(e) => setPersonalIncomeTax(e.target.checked)}
              disabled={!canManage || saving}
              className="h-4 w-4 rounded border-slate-300"
            />
            Тийм
          </label>
        </Field>
      </Section>

      <Section title="Нэмэгдэл">
        <Field label="Унааны нэмэгдэл" error={fieldErrors.transportAllowance}>
          <TextInput type="number" value={transportAllowance} onChange={setTransportAllowance} disabled={!canManage || saving} />
        </Field>
        <Field label="Хоолны нэмэгдэл" error={fieldErrors.mealAllowance}>
          <TextInput type="number" value={mealAllowance} onChange={setMealAllowance} disabled={!canManage || saving} />
        </Field>
        <Field label="Утасны нэмэгдэл" error={fieldErrors.phoneAllowance}>
          <TextInput type="number" value={phoneAllowance} onChange={setPhoneAllowance} disabled={!canManage || saving} />
        </Field>
        <Field label="Бусад тогтмол нэмэгдэл" error={fieldErrors.otherAllowance}>
          <TextInput type="number" value={otherAllowance} onChange={setOtherAllowance} disabled={!canManage || saving} />
        </Field>
        <Field label="Хүчин төгөлдөр эхлэх огноо" required error={fieldErrors.effectiveFrom}>
          <TextInput type="date" value={effectiveFrom} onChange={setEffectiveFrom} disabled={!canManage || saving} />
        </Field>
        <Field label="Хүчин төгөлдөр дуусах огноо" error={fieldErrors.effectiveTo}>
          <TextInput type="date" value={effectiveTo} onChange={setEffectiveTo} disabled={!canManage || saving} />
        </Field>
      </Section>

      {canManage && (
        <div>
          <Button type="button" onClick={() => void handleSave()} loading={saving}>
            Цалингийн мэдээлэл хадгалах
          </Button>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900">Цалингийн түүх</h3>
        {history.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 ring-1 ring-slate-200">
            Бүртгэгдсэн цалингийн мэдээлэл байхгүй байна.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Эхлэх</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Дуусах</th>
                  <th className="px-3 py-2 text-right font-semibold text-slate-700">Үндсэн цалин</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Төрөл</th>
                  <th className="px-3 py-2 text-left font-semibold text-slate-700">Төлөв</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">{row.effectiveFrom.slice(0, 10)}</td>
                    <td className="px-3 py-2">{row.effectiveTo?.slice(0, 10) ?? '-'}</td>
                    <td className="px-3 py-2 text-right font-medium">
                      {row.baseSalary.toLocaleString('mn-MN')} {row.currency}
                    </td>
                    <td className="px-3 py-2">
                      {SALARY_CALCULATION_TYPE_LABELS[row.calculationType]}
                    </td>
                    <td className="px-3 py-2">
                      {row.isCurrent ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-200">
                          Хүчинтэй
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">Хаагдсан</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
