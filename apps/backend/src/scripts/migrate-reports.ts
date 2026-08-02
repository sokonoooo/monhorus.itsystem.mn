/**
 * Carries the four pre-unification report shapes into the canonical report store.
 *
 * WHY THIS EXISTS
 *
 * Before the unified store the same fact lived in four unrelated shapes — an
 * ObjectAssessment, a PlannedWorkReport, a WorkReport and an InspectionReport — so
 * nothing could be searched or compared across them, and Үзлэг ба дүгнэлт would open on
 * an empty list for an installation with years of history behind it. Every producer
 * writes a canonical Report from now on; this script carries what was written before.
 *
 * IDEMPOTENCY
 *
 * Two markers, one per situation:
 *
 *   - `legacySourceId`/`legacySourceModel` on the created Report names the exact legacy
 *     row it was carried from. It is the only possible marker for MANUAL-sourced rows
 *     (an ObjectAssessment has no source record, so the unique (customer, sourceType,
 *     sourceId) index cannot see it) and it also lets a rerun distinguish "carried by a
 *     previous run" from "written by the live producer".
 *   - the (customer, sourceType, sourceId) unique index for the sourced shapes: a
 *     planned work or service request whose report already exists — written by the new
 *     producer OR by an earlier run — is counted as a duplicate and never touched. The
 *     live row is the truth; a migration must not overwrite it with older data.
 *
 * InspectionReport is deprecated rather than migrated one-to-one. It is attached to a
 * planned work and stores only authored narrative, so when a PLANNED_WORK report already
 * exists for that work its conclusion/recommendation are folded into the EMPTY fields of
 * that report instead of creating a second one. Fold-into-empty is what makes the fold
 * rerunnable: after the first pass the field is no longer empty, so a rerun writes
 * nothing, and a canonical report that already carries its own narrative wins outright.
 *
 * Risk bands are RE-DERIVED from the thresholds in force, never copied. The thresholds
 * are a setting; a stored band from an older threshold set would describe the score by
 * rules that no longer apply and disagree with every figure beside it.
 *
 * Equipment and rollups are deliberately NOT touched. `latestAssessment` was maintained
 * by the legacy modules as they ran, so it already reflects this history; re-applying
 * old reports could only overwrite newer standing with older.
 *
 * Usage: npm run migrate:reports --workspace @monhorus/backend
 *        npm run migrate:reports --workspace @monhorus/backend -- --dry-run
 */
import { overallScoreOf, riskLevelFor, type RiskBand } from '@monhorus/shared';
import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { logger } from '../config/logger';
import { InspectionReport } from '../modules/inspection-report/inspection-report.model';
import { ObjectAssessment } from '../modules/object-master/object-master.models';
import {
  PlannedWork,
  PlannedWorkReport,
  PlannedWorkTask,
} from '../modules/planned-work/planned-work.models';
import { Report, ReportItem, nextReportNumber } from '../modules/report-record/report-record.model';
import { resolveHierarchy } from '../modules/report-record/report-record.service';
import { ServiceRequest } from '../modules/service-request/service-request.model';
import { WorkReport } from '../modules/service-request/work-report.model';
import { getRiskBands } from '../modules/settings/settings.service';

export const MIGRATED_SOURCE_MODELS = [
  'ObjectAssessment',
  'PlannedWorkReport',
  'WorkReport',
  'InspectionReport',
] as const;
export type MigratedSourceModel = (typeof MIGRATED_SOURCE_MODELS)[number];

export interface SourceModelCounts {
  /** Rows carried into the store (or that would be, on a dry run). */
  migrated: number;
  /** Rows deliberately not carried: nothing valid to carry. */
  skipped: number;
  /** Rows that could not be carried; each is listed in `failures`. */
  failed: number;
  /** Rows already represented in the store, by either idempotency marker. */
  duplicate: number;
}

export interface MigrationFailure {
  model: MigratedSourceModel;
  id: string;
  reason: string;
}

export interface MigrateReportsResult {
  dryRun: boolean;
  byModel: Record<MigratedSourceModel, SourceModelCounts>;
  failures: MigrationFailure[];
}

function emptyCounts(): SourceModelCounts {
  return { migrated: 0, skipped: 0, failed: 0, duplicate: 0 };
}

function bandOf(score: number | null | undefined, bands: readonly RiskBand[]) {
  return score === null || score === undefined ? null : riskLevelFor(score, bands);
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function carriedAlready(model: MigratedSourceModel, id: Types.ObjectId): Promise<boolean> {
  return (await Report.exists({ legacySourceId: id, legacySourceModel: model })) !== null;
}

/** One per-object finding assembled from a legacy shape, ready to become a ReportItem. */
interface LegacyFinding {
  object: Types.ObjectId;
  score: number | null;
  observation: string | null;
  conclusion: string | null;
  recommendation: string | null;
  evidenceAttachments: Types.ObjectId[];
}

/**
 * Collapses findings to one per object, worst score winning.
 *
 * A report holds one item per object (unique index), and legacy sub-tasks could name the
 * same panel twice. Worst-wins matches how every other figure in this domain is combined;
 * keeping the last row read would make the outcome depend on iteration order.
 */
function collapseByObject(findings: readonly LegacyFinding[]): LegacyFinding[] {
  const byObject = new Map<string, LegacyFinding>();
  for (const finding of findings) {
    const key = String(finding.object);
    const held = byObject.get(key);
    if (
      !held ||
      (finding.score !== null && (held.score === null || finding.score < held.score))
    ) {
      byObject.set(key, finding);
    }
  }
  return [...byObject.values()];
}

async function writeItems(
  reportId: Types.ObjectId,
  customer: Types.ObjectId | null,
  findings: readonly LegacyFinding[],
  bands: readonly RiskBand[],
  createdAt: Date,
): Promise<void> {
  for (const finding of findings) {
    const hierarchy = await resolveHierarchy(finding.object);
    await ReportItem.create({
      report: reportId,
      customer,
      object: finding.object,
      floor: hierarchy.floor,
      score: finding.score,
      riskLevel: bandOf(finding.score, bands),
      observation: finding.observation,
      conclusion: finding.conclusion,
      recommendation: finding.recommendation,
      evidenceAttachments: finding.evidenceAttachments,
      sourceReport: null,
      sourceReportItem: null,
      // Explicit so the item's history reads as when the finding was made, not when the
      // migration ran. Mongoose honours a provided createdAt.
      createdAt,
    });
  }
}

/** The per-object findings a planned work's sub-tasks recorded. */
async function findingsOfPlannedWork(plannedWorkId: Types.ObjectId): Promise<LegacyFinding[]> {
  const tasks = await PlannedWorkTask.find({ plannedWork: plannedWorkId }).lean();
  const findings: LegacyFinding[] = [];
  for (const task of tasks) {
    for (const object of task.relatedObjects ?? []) {
      findings.push({
        object,
        score: task.score ?? null,
        // The performer's Тайлбар is what was seen; Дүгнэлт never existed on a sub-task.
        observation: task.note ?? null,
        conclusion: null,
        recommendation: task.recommendation ?? null,
        evidenceAttachments: [...(task.beforePhotos ?? []), ...(task.afterPhotos ?? [])],
      });
    }
  }
  return collapseByObject(findings);
}

// -- ObjectAssessment → OBJECT_ASSESSMENT ------------------------------------

async function migrateObjectAssessments(
  result: MigrateReportsResult,
  bands: readonly RiskBand[],
): Promise<void> {
  const counts = result.byModel.ObjectAssessment;
  const assessments = await ObjectAssessment.find({}).sort({ assessedAt: 1 }).lean();

  for (const assessment of assessments) {
    try {
      if (await carriedAlready('ObjectAssessment', assessment._id)) {
        counts.duplicate += 1;
        continue;
      }

      /**
       * A report the live write-through already wrote for this same assessment.
       *
       * Once the canonical path is switched on, `recordAssessment` writes its own report
       * immediately, carrying no legacy marker because nothing was migrated. Keying
       * idempotency on the marker alone would then re-migrate exactly those assessments
       * and put the same event on the board twice. Matching on the pair that identifies
       * the event — the object and the moment it was assessed — catches them, and stamping
       * the marker on means every later run recognises it the cheap way.
       */
      const live = await Report.findOne({
        type: 'OBJECT_ASSESSMENT',
        sourceType: 'MANUAL',
        legacySourceId: null,
        occurredAt: assessment.assessedAt,
      });
      if (live) {
        const sameObject = await ReportItem.exists({
          report: live._id,
          object: assessment.object,
        });
        if (sameObject) {
          if (!result.dryRun) {
            await Report.updateOne(
              { _id: live._id },
              { $set: { legacySourceId: assessment._id, legacySourceModel: 'ObjectAssessment' } },
            );
          }
          counts.duplicate += 1;
          continue;
        }
      }
      if (result.dryRun) {
        counts.migrated += 1;
        continue;
      }

      const hierarchy = await resolveHierarchy(assessment.object);
      const createdAt = assessment.createdAt ?? assessment.assessedAt;

      const report = await Report.create({
        reportNumber: await nextReportNumber(assessment.assessedAt),
        type: 'OBJECT_ASSESSMENT',
        // An assessment is append-only, settled history that already moved the object's
        // standing when it was written, so it arrives as an approved fact rather than a
        // draft awaiting a reviewer who will never come.
        status: 'APPROVED',
        title: 'Тоноглолын үнэлгээ',
        customer: hierarchy.customer,
        project: hierarchy.project,
        building: hierarchy.building,
        sourceType: 'MANUAL',
        sourceId: null,
        sourceReference: assessment.sourceLabel ?? null,
        conclusion: assessment.conclusion ?? null,
        recommendation: assessment.recommendation ?? null,
        overallScore: assessment.newScore,
        riskLevel: bandOf(assessment.newScore, bands),
        createdBy: assessment.assessedBy ?? null,
        createdByName: assessment.assessedByName ?? null,
        // The assessor's sign-off was the approval the legacy shape had.
        approvedBy: assessment.assessedBy ?? null,
        approvedByName: assessment.assessedByName ?? null,
        approvedAt: assessment.assessedAt,
        occurredAt: assessment.assessedAt,
        legacySourceId: assessment._id,
        legacySourceModel: 'ObjectAssessment',
        createdAt,
      });

      await writeItems(
        report._id,
        hierarchy.customer,
        [
          {
            object: assessment.object,
            score: assessment.newScore,
            observation: assessment.actionTaken ?? null,
            conclusion: assessment.conclusion ?? null,
            recommendation: assessment.recommendation ?? null,
            evidenceAttachments: assessment.photos ?? [],
          },
        ],
        bands,
        createdAt,
      );

      counts.migrated += 1;
    } catch (error) {
      counts.failed += 1;
      result.failures.push({
        model: 'ObjectAssessment',
        id: String(assessment._id),
        reason: reasonOf(error),
      });
    }
  }
}

// -- PlannedWorkReport → PLANNED_WORK ----------------------------------------

async function migratePlannedWorkReports(
  result: MigrateReportsResult,
  bands: readonly RiskBand[],
  coveredPlannedWorkIds: Set<string>,
): Promise<void> {
  const counts = result.byModel.PlannedWorkReport;
  const legacyReports = await PlannedWorkReport.find({}).sort({ createdAt: 1 }).lean();

  for (const legacy of legacyReports) {
    try {
      if (await carriedAlready('PlannedWorkReport', legacy.plannedWork && legacy._id)) {
        counts.duplicate += 1;
        coveredPlannedWorkIds.add(String(legacy.plannedWork));
        continue;
      }
      if (
        await Report.exists({ sourceType: 'PLANNED_WORK', sourceId: legacy.plannedWork })
      ) {
        // The live producer (or an earlier run) already owns this work's report; older
        // data must not overwrite it.
        counts.duplicate += 1;
        coveredPlannedWorkIds.add(String(legacy.plannedWork));
        continue;
      }

      const work = await PlannedWork.findById(legacy.plannedWork).lean();
      if (!work) {
        counts.failed += 1;
        result.failures.push({
          model: 'PlannedWorkReport',
          id: String(legacy._id),
          reason: 'planned work missing',
        });
        continue;
      }

      coveredPlannedWorkIds.add(String(work._id));
      if (result.dryRun) {
        counts.migrated += 1;
        continue;
      }

      const findings = await findingsOfPlannedWork(work._id);
      const overallScore = overallScoreOf(findings.map((finding) => finding.score));
      const occurredAt = work.actualEndDate ?? legacy.approvedAt ?? legacy.createdAt;

      const report = await Report.create({
        reportNumber: await nextReportNumber(occurredAt),
        type: 'PLANNED_WORK',
        // The legacy vocabulary is a strict subset of the canonical one, so the status
        // carries over verbatim.
        status: legacy.status,
        title: work.title,
        customer: work.customer,
        project: work.project ?? null,
        building: work.building,
        sourceType: 'PLANNED_WORK',
        sourceId: work._id,
        sourceReference: work.workNumber,
        conclusion: legacy.conclusion ?? null,
        recommendation: legacy.recommendation ?? null,
        overallScore,
        riskLevel: bandOf(overallScore, bands),
        createdBy: legacy.createdBy ?? null,
        createdByName: legacy.createdByName ?? null,
        submittedBy: legacy.submittedBy ?? null,
        submittedByName: legacy.submittedByName ?? null,
        submittedAt: legacy.submittedAt ?? null,
        approvedBy: legacy.approvedBy ?? null,
        approvedByName: legacy.approvedByName ?? null,
        approvedAt: legacy.approvedAt ?? null,
        returnedBy: legacy.returnedBy ?? null,
        returnedByName: legacy.returnedByName ?? null,
        returnedAt: legacy.returnedAt ?? null,
        returnReason: legacy.returnReason ?? null,
        occurredAt,
        legacySourceId: legacy._id,
        legacySourceModel: 'PlannedWorkReport',
        createdAt: legacy.createdAt,
      });

      await writeItems(report._id, work.customer, findings, bands, legacy.createdAt);
      counts.migrated += 1;
    } catch (error) {
      counts.failed += 1;
      result.failures.push({
        model: 'PlannedWorkReport',
        id: String(legacy._id),
        reason: reasonOf(error),
      });
    }
  }
}

// -- WorkReport → SERVICE_REQUEST --------------------------------------------

async function migrateWorkReports(
  result: MigrateReportsResult,
  bands: readonly RiskBand[],
): Promise<void> {
  const counts = result.byModel.WorkReport;
  const legacyReports = await WorkReport.find({}).sort({ createdAt: 1 }).lean();

  for (const legacy of legacyReports) {
    try {
      if (await carriedAlready('WorkReport', legacy._id)) {
        counts.duplicate += 1;
        continue;
      }
      if (
        await Report.exists({ sourceType: 'SERVICE_REQUEST', sourceId: legacy.serviceRequest })
      ) {
        counts.duplicate += 1;
        continue;
      }

      const request = await ServiceRequest.findById(legacy.serviceRequest).lean();
      if (!request) {
        counts.failed += 1;
        result.failures.push({
          model: 'WorkReport',
          id: String(legacy._id),
          reason: 'service request missing',
        });
        continue;
      }

      if (result.dryRun) {
        counts.migrated += 1;
        continue;
      }

      const occurredAt = request.completedAt ?? legacy.approvedAt ?? legacy.createdAt;
      const evidence = [...(legacy.beforePhotos ?? []), ...(legacy.afterPhotos ?? [])];

      // The legacy shape carried one score and one narrative for the whole job; the
      // score is the only per-job figure there is, so each inspected object receives it
      // while the narrative stays on the report rather than being copied onto every row.
      const findings: LegacyFinding[] = collapseByObject(
        (legacy.objects ?? []).map((object) => ({
          object,
          score: legacy.score ?? null,
          observation: legacy.actionTaken ?? null,
          conclusion: null,
          recommendation: null,
          evidenceAttachments: evidence,
        })),
      );

      const report = await Report.create({
        reportNumber: await nextReportNumber(occurredAt),
        type: 'SERVICE_REQUEST',
        status: legacy.status,
        title: `Үйлчилгээний хүсэлтийн дүгнэлт ${request.requestNumber}`,
        customer: request.customer,
        project: request.project ?? null,
        building: request.building,
        sourceType: 'SERVICE_REQUEST',
        sourceId: request._id,
        sourceReference: request.requestNumber,
        conclusion: legacy.conclusion ?? null,
        recommendation: legacy.recommendation ?? null,
        overallScore: legacy.score ?? null,
        riskLevel: bandOf(legacy.score ?? null, bands),
        createdBy: legacy.createdBy ?? null,
        createdByName: legacy.createdByName ?? null,
        submittedBy: legacy.submittedBy ?? null,
        submittedByName: legacy.submittedByName ?? null,
        submittedAt: legacy.submittedAt ?? null,
        approvedBy: legacy.approvedBy ?? null,
        approvedByName: legacy.approvedByName ?? null,
        approvedAt: legacy.approvedAt ?? null,
        returnedBy: legacy.returnedBy ?? null,
        returnedByName: legacy.returnedByName ?? null,
        returnedAt: legacy.returnedAt ?? null,
        returnReason: legacy.returnReason ?? null,
        occurredAt,
        legacySourceId: legacy._id,
        legacySourceModel: 'WorkReport',
        createdAt: legacy.createdAt,
      });

      await writeItems(report._id, request.customer, findings, bands, legacy.createdAt);
      counts.migrated += 1;
    } catch (error) {
      counts.failed += 1;
      result.failures.push({
        model: 'WorkReport',
        id: String(legacy._id),
        reason: reasonOf(error),
      });
    }
  }
}

// -- InspectionReport → fold into PLANNED_WORK, else carry -------------------

async function migrateInspectionReports(
  result: MigrateReportsResult,
  bands: readonly RiskBand[],
  coveredPlannedWorkIds: Set<string>,
): Promise<void> {
  const counts = result.byModel.InspectionReport;
  const legacyReports = await InspectionReport.find({}).sort({ createdAt: 1 }).lean();

  for (const legacy of legacyReports) {
    try {
      const conclusion = legacy.conclusion?.trim() || null;
      const recommendation = legacy.recommendation?.trim() || null;

      // The shape is deprecated and everything except the authored narrative is derived
      // from the planned work on read, so a report that was never written on has nothing
      // valid to carry.
      if (!conclusion && !recommendation) {
        counts.skipped += 1;
        continue;
      }

      const existing = await Report.findOne({
        sourceType: 'PLANNED_WORK',
        sourceId: legacy.plannedWork,
      });

      if (existing) {
        // Fold into EMPTY fields only. A canonical report that already carries its own
        // narrative wins, and fold-into-empty is what makes a rerun write nothing.
        const set: Record<string, string> = {};
        if (!existing.conclusion && conclusion) set.conclusion = conclusion;
        if (!existing.recommendation && recommendation) set.recommendation = recommendation;

        if (Object.keys(set).length === 0) {
          counts.duplicate += 1;
          continue;
        }
        if (!result.dryRun) {
          await Report.updateOne({ _id: existing._id }, { $set: set });
        }
        counts.migrated += 1;
        continue;
      }

      if (coveredPlannedWorkIds.has(String(legacy.plannedWork))) {
        // Dry run only: the PlannedWorkReport pass would have created this work's report
        // in a real run, so this narrative would fold rather than create a second one.
        counts.migrated += 1;
        continue;
      }

      if (await carriedAlready('InspectionReport', legacy._id)) {
        counts.duplicate += 1;
        continue;
      }

      const work = await PlannedWork.findById(legacy.plannedWork).lean();
      if (!work) {
        counts.failed += 1;
        result.failures.push({
          model: 'InspectionReport',
          id: String(legacy._id),
          reason: 'planned work missing',
        });
        continue;
      }

      if (result.dryRun) {
        counts.migrated += 1;
        continue;
      }

      const findings = await findingsOfPlannedWork(work._id);
      const overallScore = overallScoreOf(findings.map((finding) => finding.score));
      const occurredAt = work.actualEndDate ?? legacy.approvedAt ?? legacy.createdAt;
      // FINALISED sat one step past approval in the legacy chain but never meant
      // customer release, so it lands as APPROVED rather than PUBLISHED.
      const status = legacy.status === 'FINALISED' ? 'APPROVED' : legacy.status;

      const report = await Report.create({
        reportNumber: await nextReportNumber(occurredAt),
        type: 'PLANNED_WORK',
        status,
        title: work.title,
        customer: work.customer,
        project: work.project ?? null,
        building: work.building,
        sourceType: 'PLANNED_WORK',
        sourceId: work._id,
        sourceReference: work.workNumber,
        conclusion,
        recommendation,
        overallScore,
        riskLevel: bandOf(overallScore, bands),
        createdBy: legacy.createdBy ?? null,
        createdByName: legacy.createdByName ?? null,
        submittedBy: legacy.submittedBy ?? null,
        submittedByName: legacy.submittedByName ?? null,
        submittedAt: legacy.submittedAt ?? null,
        approvedBy: legacy.approvedBy ?? legacy.finalisedBy ?? null,
        approvedByName: legacy.approvedByName ?? legacy.finalisedByName ?? null,
        approvedAt: legacy.approvedAt ?? legacy.finalisedAt ?? null,
        returnedBy: legacy.returnedBy ?? null,
        returnedByName: legacy.returnedByName ?? null,
        returnedAt: legacy.returnedAt ?? null,
        returnReason: legacy.returnReason ?? null,
        occurredAt,
        legacySourceId: legacy._id,
        legacySourceModel: 'InspectionReport',
        createdAt: legacy.createdAt,
      });

      await writeItems(report._id, work.customer, findings, bands, legacy.createdAt);
      counts.migrated += 1;
    } catch (error) {
      counts.failed += 1;
      result.failures.push({
        model: 'InspectionReport',
        id: String(legacy._id),
        reason: reasonOf(error),
      });
    }
  }
}

/**
 * Runs the whole migration. Exported so the behaviour is asserted by a test rather than
 * only by running it against a real database.
 *
 * PlannedWorkReport runs before InspectionReport on purpose: a work that has both gets
 * ONE canonical report from the former, and the latter folds its narrative in.
 */
export async function migrateReports(
  options: { dryRun?: boolean } = {},
): Promise<MigrateReportsResult> {
  const result: MigrateReportsResult = {
    dryRun: options.dryRun ?? false,
    byModel: {
      ObjectAssessment: emptyCounts(),
      PlannedWorkReport: emptyCounts(),
      WorkReport: emptyCounts(),
      InspectionReport: emptyCounts(),
    },
    failures: [],
  };

  const bands = await getRiskBands();
  // Works whose canonical report exists or would exist after this run. Carried across
  // the two planned-work passes so a dry run folds where a real run would fold.
  const coveredPlannedWorkIds = new Set<string>();

  await migrateObjectAssessments(result, bands);
  await migratePlannedWorkReports(result, bands, coveredPlannedWorkIds);
  await migrateWorkReports(result, bands);
  await migrateInspectionReports(result, bands, coveredPlannedWorkIds);

  return result;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');

  await connectDatabase();

  const result = await migrateReports({ dryRun });

  for (const model of MIGRATED_SOURCE_MODELS) {
    logger.info({ model, ...result.byModel[model] }, dryRun ? 'dry run counts' : 'migrated');
  }

  for (const failure of result.failures) {
    logger.warn(failure, 'row could not be migrated');
  }

  logger.info(
    { dryRun, failed: result.failures.length },
    dryRun ? 'Dry run: no changes written' : 'Report migration complete',
  );

  await disconnectDatabase();
}

// Only when run as a script. Importing this file from a test must not open a connection.
if (process.argv[1]?.includes('migrate-reports')) {
  main().catch((error: unknown) => {
    logger.error({ err: error }, 'Report migration failed');
    process.exit(1);
  });
}
