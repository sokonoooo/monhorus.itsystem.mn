import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SERVICE_REQUEST_STAGES,
  stageByKey,
  stageOfStatus,
  validateStages,
  type ServiceRequestStage,
} from './service-request-stage';
import { SERVICE_REQUEST_STATUSES, type ServiceRequestStatus } from './service-request';

const clone = (): ServiceRequestStage[] =>
  DEFAULT_SERVICE_REQUEST_STAGES.map((stage) => ({ ...stage, statuses: [...stage.statuses] }));

describe('service request stages', () => {
  it('covers every engine status exactly once', () => {
    const seen = DEFAULT_SERVICE_REQUEST_STAGES.flatMap((stage) => stage.statuses);
    expect([...seen].sort()).toEqual([...SERVICE_REQUEST_STATUSES].sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('ships the nine stages the business recognises', () => {
    expect(DEFAULT_SERVICE_REQUEST_STAGES.map((stage) => stage.key)).toEqual([
      'OPEN',
      'ASSIGNED',
      'ON_THE_WAY',
      'IN_PROGRESS',
      'WAITING',
      'COMPLETED',
      'REVISIT',
      'RETURNED',
      'CANCELLED',
    ]);
  });

  it('groups the statuses an operator treats as one step', () => {
    const stageFor = (status: ServiceRequestStatus): string =>
      stageOfStatus(status, DEFAULT_SERVICE_REQUEST_STAGES)?.key ?? '';

    expect(stageFor('NEW')).toBe('OPEN');
    expect(stageFor('UNASSIGNED')).toBe('OPEN');
    expect(stageFor('ASSIGNED')).toBe('ASSIGNED');
    expect(stageFor('ACCEPTED')).toBe('ASSIGNED');
    expect(stageFor('ON_SITE')).toBe('IN_PROGRESS');
    expect(stageFor('IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(stageFor('REPORT_SUBMITTED')).toBe('COMPLETED');
    expect(stageFor('VERIFICATION')).toBe('COMPLETED');
    expect(stageFor('COMPLETED')).toBe('COMPLETED');
  });

  it('keeps cancellation out of the working flow', () => {
    expect(stageOfStatus('CANCELLED', DEFAULT_SERVICE_REQUEST_STAGES)?.key).toBe('CANCELLED');
  });

  it('enters a grouped stage at the status the engine can actually be moved to', () => {
    for (const stage of DEFAULT_SERVICE_REQUEST_STAGES) {
      expect(stage.statuses).toContain(stage.entryStatus);
    }
    // Approving the conclusion is what reaches COMPLETED; selecting the stage cannot.
    expect(stageByKey('COMPLETED', DEFAULT_SERVICE_REQUEST_STAGES)?.entryStatus).toBe(
      'REPORT_SUBMITTED',
    );
  });

  it('accepts the shipped default', () => {
    expect(validateStages(DEFAULT_SERVICE_REQUEST_STAGES)).toEqual([]);
  });

  it('rejects a configuration that orphans a status', () => {
    const stages = clone();
    const waiting = stages.find((stage) => stage.key === 'WAITING');
    if (waiting) waiting.statuses = [];
    const issues = validateStages(stages);
    expect(issues.some((issue) => issue.includes('WAITING'))).toBe(true);
  });

  it('rejects a status claimed by two stages', () => {
    const stages = clone();
    stages[0]!.statuses = [...stages[0]!.statuses, 'WAITING'];
    expect(validateStages(stages).some((issue) => issue.includes('WAITING'))).toBe(true);
  });

  it('rejects duplicate keys and empty names', () => {
    const stages = clone();
    stages[1]!.key = stages[0]!.key;
    stages[2]!.label = '   ';
    const issues = validateStages(stages);
    expect(issues.some((issue) => issue.includes('давхардсан'))).toBe(true);
    expect(issues.some((issue) => issue.includes('нэр хоосон'))).toBe(true);
  });

  it('rejects an entry status the stage does not own', () => {
    const stages = clone();
    stages[0]!.entryStatus = 'COMPLETED';
    expect(validateStages(stages).some((issue) => issue.includes('эхлэх төлөв'))).toBe(true);
  });

  it('refuses an empty stage list rather than hiding every request', () => {
    expect(validateStages([]).length).toBeGreaterThan(0);
  });
});
