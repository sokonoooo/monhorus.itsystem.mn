import {
  KVA_UNAVAILABLE_NOTE,
  equipmentLoadKw,
  loadPercent,
  loadVarianceKw,
  reserveKw,
  sumLoads,
  type FloorLoadSummaryDto,
  type LoadValueDto,
  type RiskLevel,
  type RiskLevelCountDto,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import {
  assertInCustomerScope,
  customerScopeFilter,
  type ResolvedCustomerScope,
} from '../../common/security/customer-scope';
import { ObjectNode } from '../objects/object.models';
import { ObjectRecord, type IObject } from './object-master.models';

/**
 * Load calculation, requirements section 11.5 and nothing beyond it.
 *
 * Implemented formulas, verbatim:
 *   equipment  Σ (нэрлэсэн чадал × тоо ширхэг × ашиглалтын коэффициент), default 1.0
 *   circuit    хэлхээний нийт ачаалал ÷ зөвшөөрөгдөх хүчин чадал × 100
 *   panel      самбарын нийт ачаалал ÷ хүчин чадал × 100
 *   floor      давхарт бүртгэлтэй самбаруудын ачааллын нийлбэр
 *   reserve    самбарын хүчин чадал - одоогийн тооцоолсон ачаалал
 *
 * Deliberately absent: the section 11.6 dangerous-connection checks, which compare against
 * cable, breaker, RCD and wet-environment standard tables that section 19.2 leaves
 * unapproved. No ampacity table, no breaker sizing rule and no phase-balance threshold is
 * invented here. kVA is also absent: it needs a power factor that section 4.2 never
 * records on a panel.
 *
 * Rule 17.17 excludes a decommissioned object. Rule 17.18 reports an incomplete
 * calculation as "Бүрэн бус" carrying the reason, rather than as a zero.
 */

type Doc<T> = T & { _id: Types.ObjectId };

function toDto(result: ReturnType<typeof equipmentLoadKw>): LoadValueDto {
  return { valueKw: result.valueKw, complete: result.complete, reasons: result.reasons };
}

/** Calculated load of a single equipment object. */
export function equipmentLoad(object: Pick<IObject, 'equipment' | 'status'>): LoadValueDto {
  return toDto(
    equipmentLoadKw({
      ratedPowerKw: object.equipment?.ratedPowerKw ?? null,
      quantity: object.equipment?.quantity ?? null,
      usageCoefficient: object.equipment?.usageCoefficient ?? null,
      status: object.status,
    }),
  );
}

/**
 * Calculated load of one object.
 *
 * A circuit's load is the sum of the equipment it feeds; a panel's is the sum of its
 * circuits. Both walk the stored graph rather than a denormalised total, so a change to a
 * single device is reflected everywhere on the next read without a rebuild step.
 */
export async function calculatedLoadOf(object: Doc<IObject>): Promise<LoadValueDto> {
  if (object.category === 'EQUIPMENT') return equipmentLoad(object);

  if (object.category === 'CIRCUIT') {
    const fed = await ObjectRecord.find({
      category: 'EQUIPMENT',
      'equipment.circuit': object._id,
    }).select('equipment status');
    if (fed.length === 0) {
      return { valueKw: null, complete: false, reasons: ['NO_EQUIPMENT'] };
    }
    return toDto(sumLoads(fed.map((entry) => equipmentLoad(entry))));
  }

  // PANEL: the sum of its circuits' loads.
  const circuits = await ObjectRecord.find({
    category: 'CIRCUIT',
    'circuit.panel': object._id,
  }).select('_id');

  if (circuits.length === 0) {
    return { valueKw: null, complete: false, reasons: ['NO_EQUIPMENT'] };
  }

  const circuitIds = circuits.map((entry) => entry._id);
  const equipment = await ObjectRecord.find({
    category: 'EQUIPMENT',
    'equipment.circuit': { $in: circuitIds },
  }).select('equipment status');

  if (equipment.length === 0) {
    return { valueKw: null, complete: false, reasons: ['NO_EQUIPMENT'] };
  }

  return toDto(sumLoads(equipment.map((entry) => equipmentLoad(entry))));
}

/** Capacity the load is measured against, by category. Null for equipment. */
export function capacityOf(object: Pick<IObject, 'category' | 'panel' | 'circuit'>): number | null {
  if (object.category === 'PANEL') return object.panel?.capacityKw ?? null;
  if (object.category === 'CIRCUIT') return object.circuit?.permittedCapacityKw ?? null;
  return null;
}

export interface ObjectLoadFigures {
  calculated: LoadValueDto;
  percent: LoadValueDto;
  reserve: LoadValueDto;
  variance: LoadValueDto;
}

export async function loadFiguresOf(object: Doc<IObject>): Promise<ObjectLoadFigures> {
  const calculated = await calculatedLoadOf(object);
  const capacity = capacityOf(object);

  return {
    calculated,
    percent: toDto(loadPercent(calculated, capacity)),
    reserve: toDto(reserveKw(calculated, capacity)),
    // Rule 17.16: measured is stored separately and only the difference is derived.
    variance: toDto(loadVarianceKw(calculated, object.measuredLoadKw)),
  };
}

/**
 * Floor roll-up.
 *
 * Section 11.5 defines the floor total as the sum of the panel loads, so equipment linked
 * to the floor without a feeding circuit is counted in its own figure and excluded from
 * `totalKw`. Adding it in would be a formula the requirements do not define.
 *
 * No single aggregate risk score is produced: section 19.2 leaves the aggregation method
 * (worst, average or weighted) unapproved, so only counts per level are reported.
 *
 * The scope is required rather than optional: this is a customer-owned read, and a summary
 * is as much a disclosure as the rows behind it. A staff scope resolves to no predicate, so
 * their existing cross-tenant access is unchanged.
 */
export async function floorLoadSummary(
  floorId: Types.ObjectId,
  scope: ResolvedCustomerScope,
): Promise<FloorLoadSummaryDto> {
  // Asserted on the fetched owner rather than queried, so a staff caller keeps today's
  // behaviour of returning an empty summary for a floor that does not exist.
  if (scope.mode === 'CUSTOMER') {
    const floor = await ObjectNode.findById(floorId).select('customer kind');
    assertInCustomerScope(
      scope,
      floor?.kind === 'FLOOR' ? floor.customer : null,
      'Давхар олдсонгүй.',
    );
  }

  const objects = await ObjectRecord.find({ floor: floorId, ...customerScopeFilter(scope) });

  const panels = objects.filter((entry) => entry.category === 'PANEL');
  const circuits = objects.filter((entry) => entry.category === 'CIRCUIT');
  const equipment = objects.filter((entry) => entry.category === 'EQUIPMENT');

  const panelLoads = await Promise.all(panels.map((panel) => calculatedLoadOf(panel)));
  const totalKw = toDto(sumLoads(panelLoads));

  // Equipment with no circuit is not reachable from any panel, so section 11.5 never
  // counts it. Reported on its own so the omission is visible rather than silent.
  const unattached = equipment.filter((entry) => !entry.equipment?.circuit);
  const unattachedKw = toDto(sumLoads(unattached.map((entry) => equipmentLoad(entry))));

  const measuredReadings = panels
    .map((panel) => panel.measuredLoadKw)
    .filter((value): value is number => value !== null && value !== undefined);
  const measuredTotalKw =
    measuredReadings.length > 0 ? measuredReadings.reduce((sum, value) => sum + value, 0) : null;

  const counts = new Map<RiskLevel, number>();
  let unassessedCount = 0;
  for (const entry of objects) {
    const level = entry.latestAssessment?.riskLevel;
    if (!level) {
      unassessedCount += 1;
      continue;
    }
    counts.set(level, (counts.get(level) ?? 0) + 1);
  }

  const riskCounts: RiskLevelCountDto[] = [...counts.entries()].map(([level, count]) => ({
    level,
    count,
  }));

  return {
    panelCount: panels.length,
    circuitCount: circuits.length,
    equipmentCount: equipment.length,
    totalKw,
    measuredTotalKw,
    variance: toDto(
      loadVarianceKw(
        { valueKw: totalKw.valueKw, complete: totalKw.complete, reasons: [...totalKw.reasons] },
        measuredTotalKw,
      ),
    ),
    unattachedEquipmentCount: unattached.length,
    unattachedEquipmentKw: unattachedKw,
    riskCounts,
    unassessedCount,
    kvaNote: KVA_UNAVAILABLE_NOTE,
  };
}
