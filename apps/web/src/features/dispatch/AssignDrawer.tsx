import {
  QUALIFICATION_LEVEL_LABELS,
  type DispatchCandidateDto,
  type ServiceRequestListItemDto,
  type ServiceRequestStatus,
  type TeamDto,
} from '@monhorus/shared';
import { useEffect, useState, type ReactElement } from 'react';

import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Drawer } from '../../components/ui/Drawer';
import { SearchField } from '../../components/ui/SearchField';
import { Skeleton } from '../../components/ui/States';
import { useToast } from '../../components/ui/ToastProvider';
import { FIELD_SELECT, FILTER_LABEL } from '../../components/ui/control-styles';
import { ApiError } from '../../lib/api-client';
import { dispatchService, serviceRequestService } from '../../services/service-request.service';

/**
 * The two statuses a request can no longer be assigned from.
 *
 * Keyed off the request's own status, not the board column it sits in: the open column
 * holds both NEW and UNASSIGNED, so a column-level test could not say "assignable" for one
 * and not the other. It lives beside the drawer rather than inside either screen because
 * the dispatch board and the request detail page both offer the same action and must not
 * be able to disagree about when it is available.
 *
 * STATED AS A REFUSAL, BECAUSE THAT IS HOW THE SERVER STATES IT. This was a six-status
 * whitelist — NEW through ACCEPTED, plus RETURNED and REVISIT_REQUIRED — while
 * `assignServiceRequest` rejects exactly COMPLETED and CANCELLED and accepts everything
 * else. The six statuses in between were the ones a handover is actually NEEDED in: a
 * technician who is ON_THE_WAY, ON_SITE, IN_PROGRESS, WAITING, whose report is with the
 * office, or whose job is in VERIFICATION. None of those cards had the control, and for a
 * while the detail page had none at all, so a technician calling in sick mid-job could not
 * be replaced from anywhere in the product — an in-flight job could only be cancelled and
 * raised again, losing its history and its SLA clock.
 *
 * A whitelist and a blacklist are not interchangeable here. The whitelist had to be
 * widened by hand every time the workflow grew and silently withheld an action when
 * nobody did; this one says the same thing the API says, so the board can only be wrong
 * about a status if the API changes which ones it refuses.
 */
const UNASSIGNABLE_STATUSES = new Set<ServiceRequestStatus>(['COMPLETED', 'CANCELLED']);

/** Whether a dispatcher may still hand this request to somebody else. */
export function isAssignable(status: ServiceRequestStatus): boolean {
  return !UNASSIGNABLE_STATUSES.has(status);
}

interface AssignDrawerProps {
  request: ServiceRequestListItemDto | null;
  onClose: () => void;
  onAssigned: () => void;
}

/**
 * Inline assignment from the dispatch board.
 *
 * Candidates come from the dispatch projection, which returns only ACTIVE employees
 * with live workload counts, so the list cannot offer someone the backend will refuse.
 * The assignment itself still goes through the validated transition service.
 */
export function AssignDrawer({ request, onClose, onAssigned }: AssignDrawerProps): ReactElement {
  const { notify } = useToast();

  const [candidates, setCandidates] = useState<DispatchCandidateDto[]>([]);
  const [teams, setTeams] = useState<TeamDto[]>([]);
  const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
  const [selectedTeam, setSelectedTeam] = useState('');
  const [leaderId, setLeaderId] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [search, setSearch] = useState('');

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = request !== null;

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      dispatchService.employeeCandidates({
        ...(search ? { search } : {}),
        ...(availableOnly ? { availableOnly: true } : {}),
      }),
      dispatchService.teamCandidates(),
    ])
      .then(([employeeResult, teamResult]) => {
        if (cancelled) return;
        setCandidates(employeeResult);
        setTeams(teamResult);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setError(caught instanceof ApiError ? caught.message : 'Ажилтны жагсаалт ачаалж чадсангүй.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, search, availableOnly]);

  function reset(): void {
    setSelectedEmployees([]);
    setSelectedTeam('');
    setLeaderId('');
    setSearch('');
    setAvailableOnly(false);
    setError(null);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  function toggleEmployee(employeeId: string): void {
    setSelectedEmployees((previous) => {
      const next = previous.includes(employeeId)
        ? previous.filter((id) => id !== employeeId)
        : [...previous, employeeId];

      // The leader must remain one of the assignees.
      if (!next.includes(leaderId)) setLeaderId('');
      return next;
    });
  }

  async function handleAssign(): Promise<void> {
    if (!request) return;

    setError(null);
    setSubmitting(true);

    try {
      await serviceRequestService.assign(request.id, {
        employeeIds: selectedEmployees,
        teamId: selectedTeam || null,
        teamLeaderEmployeeId: leaderId || null,
      });
      notify(`${request.requestNumber} хуваарилагдлаа.`, 'success');
      reset();
      onAssigned();
      onClose();
    } catch (caught) {
      // The backend is the authority; show its refusal rather than guessing.
      setError(caught instanceof ApiError ? caught.message : 'Хуваарилахад алдаа гарлаа.');
    } finally {
      setSubmitting(false);
    }
  }

  const nothingSelected = selectedEmployees.length === 0 && !selectedTeam;

  return (
    <Drawer
      open={open}
      title={request ? `${request.requestNumber} хуваарилах` : ''}
      onClose={handleClose}
      width="lg"
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            Цуцлах
          </Button>
          <Button onClick={() => void handleAssign()} loading={submitting} disabled={nothingSelected}>
            Хуваарилах
          </Button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {request && (
        <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
          <p className="font-medium text-slate-900">{request.customer?.name ?? '-'}</p>
          <p className="text-xs text-slate-600">
            {[request.building?.name, request.floor?.name].filter(Boolean).join(' · ') || '-'}
          </p>
        </div>
      )}

      <div className="mb-3">
        <label htmlFor="assign-team" className={FILTER_LABEL}>
          Баг
        </label>
        <select
          id="assign-team"
          value={selectedTeam}
          onChange={(event) => setSelectedTeam(event.target.value)}
          disabled={submitting}
          className={FIELD_SELECT}
        >
          <option value="">Баг сонгохгүй</option>
          {teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name} ({team.memberCount ?? 0} гишүүн)
            </option>
          ))}
        </select>
      </div>

      <div className="mb-2 flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label htmlFor="assign-search" className={FILTER_LABEL}>
            Ажилтан хайх
          </label>
          <SearchField
            id="assign-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Нэр эсвэл код"
            disabled={submitting}
          />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(event) => setAvailableOnly(event.target.checked)}
            disabled={submitting}
            className="h-4 w-4 rounded border-slate-300"
          />
          Зөвхөн сул
        </label>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </div>
      ) : candidates.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 ring-1 ring-slate-200">
          Хуваарилах боломжтой ажилтан олдсонгүй. Зөвхөн идэвхтэй ажилтан харагдана.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {candidates.map((candidate) => {
            const checked = selectedEmployees.includes(candidate.id);
            return (
              <li key={candidate.id}>
                <label
                  className={`flex cursor-pointer items-center gap-3 rounded-lg p-2.5 ring-1 transition-colors ${
                    checked ? 'bg-blue-50 ring-blue-300' : 'bg-white ring-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleEmployee(candidate.id)}
                    disabled={submitting}
                    className="h-4 w-4 shrink-0 rounded border-slate-300"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {candidate.lastName} {candidate.firstName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {candidate.employeeCode}
                      {candidate.team ? ` · ${candidate.team.name}` : ''}
                      {candidate.qualificationLevel
                        ? ` · ${QUALIFICATION_LEVEL_LABELS[candidate.qualificationLevel]}`
                        : ''}
                    </p>
                    {candidate.skills.length > 0 && (
                      <p className="truncate text-[11px] text-slate-400">
                        {candidate.skills.join(', ')}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${
                      candidate.isAvailable
                        ? 'bg-green-50 text-green-700 ring-green-200'
                        : 'bg-amber-50 text-amber-700 ring-amber-200'
                    }`}
                  >
                    {candidate.isAvailable ? 'Сул' : `${candidate.activeAssignments} ажилтай`}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {selectedEmployees.length > 1 && (
        <div className="mt-3">
          <label htmlFor="assign-leader" className={FILTER_LABEL}>
            Багийн ахлагч
          </label>
          <select
            id="assign-leader"
            value={leaderId}
            onChange={(event) => setLeaderId(event.target.value)}
            disabled={submitting}
            className={FIELD_SELECT}
          >
            <option value="">Сонгохгүй</option>
            {candidates
              .filter((candidate) => selectedEmployees.includes(candidate.id))
              .map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.lastName} {candidate.firstName}
                </option>
              ))}
          </select>
        </div>
      )}
    </Drawer>
  );
}
