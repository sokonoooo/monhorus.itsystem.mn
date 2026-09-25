/**
 * Development seed data.
 *
 * Creates a realistic but clearly fictional dataset so the Web Admin screens can be
 * reviewed with content rather than empty states. Safe to re-run: every insert is
 * keyed on a stable code and skipped when it already exists.
 *
 * Refuses to run against NODE_ENV=production. This is a review aid, not a fixture
 * the application depends on, and nothing here is referenced by application code.
 *
 * It DOES create logins, which the rest of the seed does not: every ACTIVE seeded employee
 * gets a technician account linked to its card, because without that link the employee mobile
 * app has nothing to sign in as and `GET /employees/me` 404s. See `seedEmployeeLogins`.
 * The password comes from `SEED_DEV_PASSWORD`; the accounts it prints are the credentials to
 * use, and section 37 of `docs/WEB_ADMIN_PHASE_1.md` lists them.
 *
 * Usage: npm run seed:dev --workspace @monhorus/backend
 */
import {
  SYSTEM_ROLE_DEFAULT_PERMISSIONS,
  SYSTEM_ROLE_KEYS,
  type PermissionKey,
  type SystemRoleKey,
} from '@monhorus/shared';
import { Types } from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../config/database';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { recordAudit } from '../modules/audit/audit.service';
import { Employee } from '../modules/employee/employee.model';
import { Invoice, nextInvoiceNumber } from '../modules/invoice/invoice.model';
import { EmployeeSalary } from '../modules/employee/employee-salary.model';
import { Company, Department, Position, Team } from '../modules/org/org.models';
import { Customer, ObjectNode } from '../modules/objects/object.models';
import { ObjectRecord, ObjectType } from '../modules/object-master/object-master.models';
import { resolveDefaultRoleIds, seedRbac } from '../modules/rbac/rbac.service';
import { Role } from '../modules/rbac/role.model';
import { ServiceAgreement } from '../modules/service-agreement/service-agreement.model';
import { computeSlaDueAt } from '../modules/service-request/sla.service';
import { ServiceRequest, nextRequestNumber } from '../modules/service-request/service-request.model';
import { User } from '../modules/user/user.model';
import { hashPassword } from '../utils/password.util';

async function seedOrganisation(): Promise<{
  companyId: Types.ObjectId;
  departments: Record<string, Types.ObjectId>;
  positions: Record<string, Types.ObjectId>;
  teams: Record<string, Types.ObjectId>;
}> {
  const company =
    (await Company.findOne({ code: 'MH' })) ??
    (await Company.create({
      code: 'MH',
      name: 'Монхорус Электрик ХХК',
      registrationNumber: '6012345',
      address: 'Улаанбаатар, СБД, 1-р хороо',
      isActive: true,
    }));

  const departmentSeed = [
    { code: 'ELEC', name: 'Цахилгааны хэлтэс' },
    { code: 'MAINT', name: 'Засвар үйлчилгээний хэлтэс' },
    { code: 'ADMIN', name: 'Захиргаа, санхүү' },
  ];

  const departments: Record<string, Types.ObjectId> = {};
  for (const entry of departmentSeed) {
    const existing =
      (await Department.findOne({ company: company._id, code: entry.code })) ??
      (await Department.create({ company: company._id, ...entry, isActive: true }));
    departments[entry.code] = existing._id;
  }

  const positionSeed = [
    { code: 'ENG', name: 'Цахилгааны инженер', department: 'ELEC' },
    { code: 'TECH', name: 'Цахилгаанчин', department: 'ELEC' },
    { code: 'SUPER', name: 'Ахлах инженер', department: 'ELEC' },
    { code: 'DISP', name: 'Диспетчер', department: 'MAINT' },
    { code: 'ACC', name: 'Нягтлан бодогч', department: 'ADMIN' },
  ];

  const positions: Record<string, Types.ObjectId> = {};
  for (const entry of positionSeed) {
    const existing =
      (await Position.findOne({ company: company._id, code: entry.code })) ??
      (await Position.create({
        company: company._id,
        department: departments[entry.department],
        code: entry.code,
        name: entry.name,
        isActive: true,
      }));
    positions[entry.code] = existing._id;
  }

  const teamSeed = [
    { code: 'TEAM-A', name: 'А баг', department: 'ELEC' },
    { code: 'TEAM-B', name: 'Б баг', department: 'ELEC' },
    { code: 'TEAM-EMG', name: 'Яаралтай дуудлагын баг', department: 'MAINT' },
  ];

  const teams: Record<string, Types.ObjectId> = {};
  for (const entry of teamSeed) {
    const existing =
      (await Team.findOne({ company: company._id, code: entry.code })) ??
      (await Team.create({
        company: company._id,
        department: departments[entry.department],
        code: entry.code,
        name: entry.name,
        isActive: true,
      }));
    teams[entry.code] = existing._id;
  }

  return { companyId: company._id, departments, positions, teams };
}

/**
 * The seeded workforce.
 *
 * Module-level rather than local to `seedEmployees` because the login pass below reads it
 * too: it has to know which cards this script owns, and which of them are ACTIVE, without
 * guessing from the contents of a database a developer may have edited by hand.
 */
const EMPLOYEE_SEED = [
  {
    employeeCode: 'EMP-0001', firstName: 'Энхтөр', lastName: 'Батаа',
    registrationNumber: 'УХ89041215', phone: '9911-2233', email: 'b.enkhtur@monhorus.mn',
    position: 'SUPER', team: 'TEAM-A', status: 'ACTIVE' as const,
    skills: ['Самбар угсралт', 'Кабель татах', 'Хэмжилт'],
    qualificationLevel: 'LEAD' as const, safetyGrade: 'IV' as const, salary: 3_200_000,
  },
  {
    employeeCode: 'EMP-0002', firstName: 'Ganbold', lastName: 'Дорж',
    registrationNumber: 'УХ92110854', phone: '9955-4411', email: 'd.ganbold@monhorus.mn',
    position: 'ENG', team: 'TEAM-A', status: 'ACTIVE' as const,
    skills: ['Оношилгоо', 'Чадлын тооцоо'],
    qualificationLevel: 'SENIOR' as const, safetyGrade: 'III' as const, salary: 2_600_000,
  },
  {
    employeeCode: 'EMP-0003', firstName: 'Сараа', lastName: 'Пүрэв',
    registrationNumber: 'УЮ95073322', phone: '8811-9922', email: 'p.saraa@monhorus.mn',
    position: 'TECH', team: 'TEAM-B', status: 'ACTIVE' as const,
    skills: ['Гэрэл суурилуулах', 'Залгуур солих'],
    qualificationLevel: 'MIDDLE' as const, safetyGrade: 'III' as const, salary: 1_900_000,
  },
  {
    employeeCode: 'EMP-0004', firstName: 'Тэмүүлэн', lastName: 'Батбаяр',
    registrationNumber: 'УХ97120441', phone: '9090-1122', email: 'b.temuulen@monhorus.mn',
    position: 'TECH', team: 'TEAM-EMG', status: 'ACTIVE' as const,
    skills: ['Яаралтай засвар', 'UPS'],
    qualificationLevel: 'MIDDLE' as const, safetyGrade: 'III' as const, salary: 2_000_000,
  },
  {
    employeeCode: 'EMP-0005', firstName: 'Оюунаа', lastName: 'Сүхбаатар',
    registrationNumber: 'УЮ90050977', phone: '9500-3344', email: 's.oyunaa@monhorus.mn',
    position: 'DISP', team: 'TEAM-EMG', status: 'ON_LEAVE' as const,
    skills: ['Dispatch', 'Хуваарилалт'],
    qualificationLevel: 'SENIOR' as const, safetyGrade: 'II' as const, salary: 2_100_000,
  },
  {
    employeeCode: 'EMP-0006', firstName: 'Батзориг', lastName: 'Нэргүй',
    registrationNumber: 'УХ88031160', phone: '9611-7788', email: 'n.batzorig@monhorus.mn',
    position: 'TECH', team: 'TEAM-B', status: 'TERMINATED' as const,
    skills: ['Кабель татах'],
    qualificationLevel: 'JUNIOR' as const, safetyGrade: 'II' as const, salary: 1_500_000,
  },
  {
    employeeCode: 'EMP-0007', firstName: 'Мөнхзул', lastName: 'Чулуун',
    registrationNumber: 'УЮ99081733', phone: '9422-6655', email: 'ch.munkhzul@monhorus.mn',
    position: 'ACC', team: null, status: 'DRAFT' as const,
    skills: [], qualificationLevel: null, safetyGrade: null, salary: null,
  },
];

async function seedEmployees(org: Awaited<ReturnType<typeof seedOrganisation>>): Promise<void> {
  for (const entry of EMPLOYEE_SEED) {
    if (await Employee.findOne({ employeeCode: entry.employeeCode })) continue;

    const employee = await Employee.create({
      employeeCode: entry.employeeCode,
      firstName: entry.firstName,
      lastName: entry.lastName,
      registrationNumber: entry.registrationNumber,
      email: entry.email,
      phone: entry.phone,
      gender: null,
      company: entry.status === 'DRAFT' ? null : org.companyId,
      department: entry.status === 'DRAFT' ? null : org.departments.ELEC,
      position: entry.status === 'DRAFT' ? null : org.positions[entry.position],
      team: entry.team ? org.teams[entry.team] : null,
      workLocation: 'Улаанбаатар',
      employmentStartDate: entry.status === 'DRAFT' ? null : new Date('2023-03-01'),
      employeeType: entry.status === 'DRAFT' ? null : 'FULL_TIME',
      status: entry.status,
      ...(entry.status === 'TERMINATED'
        ? { terminationDate: new Date('2025-11-30'), terminationReason: 'Өөрийн хүсэлтээр' }
        : {}),
      skills: entry.skills,
      qualificationLevel: entry.qualificationLevel,
      safetyGrade: entry.safetyGrade,
      permittedJobTypes: ['Үзлэг', 'Засвар'],
      hasDriverLicense: true,
      gpsVerificationEnabled: true,
    });

    if (entry.salary !== null) {
      await EmployeeSalary.create({
        employee: employee._id,
        grade: 'A',
        baseSalary: entry.salary,
        currency: 'MNT',
        calculationType: 'MONTHLY',
        bankName: 'Хаан банк',
        socialInsurance: true,
        personalIncomeTax: true,
        transportAllowance: 80_000,
        mealAllowance: 120_000,
        phoneAllowance: 30_000,
        otherAllowance: 0,
        effectiveFrom: new Date('2024-01-01'),
        effectiveTo: null,
      });
    }
  }
}

/**
 * A WORKING mobile login for every ACTIVE seeded employee, linked to its employee card.
 *
 * WHY THIS EXISTS. `Employee` and `User` are separate entities and the ONLY thing that
 * joins them is `Employee.systemUser`. `authenticate.middleware.ts` resolves it once per
 * request into `req.auth.employeeId`, and `GET /employees/me` — the first call the employee
 * mobile app makes, and the one that decides whether the shell renders at all — 404s when
 * that link is absent. The Flutter client reads that 404 as `notLinked` and shows
 * "ажилтны карттай холбогдоогүй" on every tab.
 *
 * This script used to create seven employees and no accounts at all, while
 * `bootstrap-head-admin` creates the one out-of-the-box login and gives it no employee card.
 * So a freshly bootstrapped and seeded environment GUARANTEED that state for every account
 * that existed: the app was unusable out of the box and looked broken rather than unseeded.
 * That is a seeding defect, not an app defect, and it is fixed here rather than by loosening
 * the endpoint.
 *
 * The link itself is written exactly as `manageSystemAccess` writes it in
 * `employee-access.service.ts` — the same `employee.systemUser = user._id`, behind the same
 * one-user-maps-to-at-most-one-employee check that gives a readable refusal instead of a
 * duplicate-key error from the unique partial index. The roles come from
 * `resolveDefaultRoleIds('technician')`, which is the same function the runtime uses when an
 * account is provisioned without an explicit selection, so a seeded technician holds exactly
 * what a technician provisioned through the admin screen holds. Nothing about the permission
 * model is restated here.
 *
 * TWO DELIBERATE DIFFERENCES from the CREATE_NEW path, both because there is no administrator
 * present to finish the job:
 *
 *   status is `active`, not `must_change_password`. An admin-issued passcode must be replaced
 *   at first login, and `enforcePasswordChange` refuses every route except `/auth/me` and
 *   `/auth/change-password` until it is. A seeded account in that state would sign in and
 *   then be refused by `/employees/me` with a 403, which is the same blank shell by another
 *   route. The seed's password is not a secret, so there is nothing to force a change of.
 *
 *   `createdBy` is null, the spelling `bootstrap-head-admin` already uses for an account no
 *   administrator provisioned.
 *
 * SAFETY. Re-runnable, and it never silently overwrites a developer's own work:
 *   - an employee that already has a `systemUser` is left alone entirely, hand-made or not;
 *   - an account that already exists under the same email is REUSED and its password is NOT
 *     reset, which is logged so the developer knows the seed password does not apply to it;
 *   - a user already linked to a different employee is refused, not stolen.
 */
async function seedEmployeeLogins(): Promise<void> {
  // Same lookup-by-key the runtime performs, and it throws with "RBAC seed ажиллаагүй" if the
  // catalogue is missing rather than writing a permissionless account.
  const technicianRoleIds = await resolveDefaultRoleIds('technician');
  const passwordHash = await hashPassword(env.SEED_DEV_PASSWORD);

  // Collected so the run ends with the whole credential list in one place, rather than making
  // a developer scroll back through the per-employee lines to find what to sign in as.
  const usable: string[] = [];

  for (const entry of EMPLOYEE_SEED) {
    // Only ACTIVE cards get a login. A terminated, on-leave or draft employee holding a
    // working account would misrepresent the lifecycle the admin screens are reviewed against.
    if (entry.status !== 'ACTIVE') continue;

    const employee = await Employee.findOne({ employeeCode: entry.employeeCode });
    if (!employee) continue;

    const email = entry.email.toLowerCase();

    if (employee.systemUser) {
      const linked = await User.findById(employee.systemUser).select('email status');
      if (linked) {
        usable.push(`${employee.employeeCode} -> ${linked.email} (pre-existing link)`);
        logger.info(
          { employeeCode: employee.employeeCode, email: linked.email, status: linked.status },
          'Employee already has a system login; left untouched',
        );
        continue;
      }
      // The link points at an account that no longer exists, which is the one case worth
      // repairing: the middleware would resolve an employeeId whose user is gone.
      logger.warn(
        { employeeCode: employee.employeeCode, userId: String(employee.systemUser) },
        'Employee is linked to a user that no longer exists; relinking',
      );
    }

    let user = await User.findOne({ email });
    let created = false;

    if (user) {
      logger.warn(
        { employeeCode: employee.employeeCode, email },
        'An account already exists for this email; reusing it and NOT resetting its password. ' +
          `SEED_DEV_PASSWORD does not apply to ${email}.`,
      );
    } else {
      user = await User.create({
        fullName: `${employee.lastName} ${employee.firstName}`.trim(),
        email,
        password: passwordHash,
        phone: employee.phone,
        role: 'technician',
        roles: technicianRoleIds,
        status: 'active',
        passwordChangedAt: new Date(),
        createdBy: null,
      });
      created = true;
    }

    // One user maps to at most one employee. `employee.model.ts` has a unique partial index
    // over `systemUser`; checking first turns a duplicate-key crash into a skip a developer
    // can read.
    const alreadyLinked = await Employee.findOne({
      systemUser: user._id,
      _id: { $ne: employee._id },
    }).select('employeeCode');
    if (alreadyLinked) {
      logger.warn(
        { employeeCode: employee.employeeCode, email, linkedTo: alreadyLinked.employeeCode },
        'Account is already linked to a different employee; leaving the link alone',
      );
      continue;
    }

    employee.systemUser = user._id;
    await employee.save();

    await recordAudit({
      entityType: 'Employee',
      entityId: employee._id,
      action: 'Updated',
      reason: created ? 'dev seed: system access created' : 'dev seed: system user linked',
      newValue: { userId: String(user._id), email: user.email, role: user.role },
    });

    usable.push(
      `${employee.employeeCode} -> ${email}` +
        (created ? '' : ' (pre-existing account, SEED_DEV_PASSWORD does not apply)'),
    );

    logger.info(
      { employeeCode: employee.employeeCode, email, role: user.role, accountStatus: user.status },
      created
        ? 'Technician login created and linked to employee card'
        : 'Existing account linked to employee card',
    );
  }

  // The password is named rather than printed: `password` is a redacted path in
  // `config/logger.ts` and weakening that policy for a dev script's convenience would be
  // exactly the wrong trade.
  logger.info(
    { logins: usable, passwordFrom: 'SEED_DEV_PASSWORD (default: Monhorus.dev2026)' },
    'Employee mobile logins ready — sign the Flutter app in with any of these emails',
  );
}

/**
 * Builds Project -> Building -> Floor in the hierarchy, then the section 4.1 type registry
 * and the master-data Objects the floors link to.
 *
 * Objects are no longer hierarchy nodes: they live in their own collection and a floor
 * references them. The chain panel -> circuit -> equipment is wired so the section 11.5
 * load figures have something real to compute, and one device is deliberately left without
 * a circuit so the "excluded from the floor total" case is visible in the UI.
 */
async function seedObjectTypes(): Promise<Record<string, Types.ObjectId>> {
  const seed = [
    { code: 'DB', name: 'Түгээх самбар', category: 'PANEL' as const, icon: 'PANEL' as const, insidePanel: false },
    { code: 'LINE', name: 'Хэлхээ/шугам', category: 'CIRCUIT' as const, icon: 'CABLE' as const, insidePanel: false },
    { code: 'LAMP', name: 'Гэрэлтүүлэг', category: 'EQUIPMENT' as const, icon: 'LIGHT' as const, insidePanel: false },
    { code: 'SOCKET', name: 'Залгуур', category: 'EQUIPMENT' as const, icon: 'SOCKET' as const, insidePanel: false },
    { code: 'HVAC', name: 'Агааржуулагч', category: 'EQUIPMENT' as const, icon: 'HVAC' as const, insidePanel: false },
    { code: 'UPS', name: 'UPS', category: 'EQUIPMENT' as const, icon: 'UPS' as const, insidePanel: false },
    { code: 'MCB', name: 'Автомат таслуур', category: 'EQUIPMENT' as const, icon: 'BREAKER' as const, insidePanel: true },
  ];

  const byCode: Record<string, Types.ObjectId> = {};
  for (const entry of seed) {
    const existing = await ObjectType.findOne({ code: entry.code });
    if (existing) {
      byCode[entry.code] = existing._id;
      continue;
    }
    const created = await ObjectType.create({
      code: entry.code,
      name: entry.name,
      category: entry.category,
      icon: entry.icon,
      insidePanel: entry.insidePanel,
      showOnPlan: true,
      generatesConclusion: true,
      isActive: true,
    });
    byCode[entry.code] = created._id;
  }
  return byCode;
}

async function seedHierarchy(): Promise<void> {
  const types = await seedObjectTypes();

  const customerSeed = [
    { code: 'CT', name: 'Central Tower ХХК', contact: 'Б. Болд' },
    { code: 'BZ', name: 'Blue Sky Zone ХХК', contact: 'Д. Мөнх' },
  ];

  for (const entry of customerSeed) {
    const customer =
      (await Customer.findOne({ code: entry.code })) ??
      (await Customer.create({
        code: entry.code,
        name: entry.name,
        registrationNumber: '2712345',
        phone: '7711-0000',
        email: `info@${entry.code.toLowerCase()}.mn`,
        address: 'Улаанбаатар',
        contactPerson: entry.contact,
        isActive: true,
      }));

    const projectCode = `${entry.code}-PRJ-1`;
    const project =
      (await ObjectNode.findOne({ customer: customer._id, code: projectCode })) ??
      (await ObjectNode.create({
        kind: 'PROJECT',
        code: projectCode,
        name: 'Урьдчилан сэргийлэх үйлчилгээ',
        parent: null,
        customer: customer._id,
        ancestors: [],
        description: 'Жилийн урьдчилан сэргийлэх үзлэг, засвар үйлчилгээ.',
        attributes: {
          contractNumber: `C-2026-${entry.code}`,
          startDate: new Date('2026-01-01'),
          endDate: new Date('2026-12-31'),
        },
      }));

    const buildingCode = `${entry.code}-B1`;
    const building =
      (await ObjectNode.findOne({ customer: customer._id, code: buildingCode })) ??
      (await ObjectNode.create({
        kind: 'BUILDING',
        code: buildingCode,
        name: 'Төв байр',
        parent: project._id,
        customer: customer._id,
        ancestors: [project._id],
        attributes: {
          address: 'Улаанбаатар, Олимпийн гудамж 15',
          gpsLatitude: 47.9175,
          gpsLongitude: 106.9172,
        },
      }));

    for (const floorNumber of [1, 2]) {
      const floorCode = `${entry.code}-F${floorNumber}`;
      const floor =
        (await ObjectNode.findOne({ customer: customer._id, code: floorCode })) ??
        (await ObjectNode.create({
          kind: 'FLOOR',
          code: floorCode,
          name: `${floorNumber}-р давхар`,
          parent: building._id,
          customer: customer._id,
          ancestors: [project._id, building._id],
          attributes: { floorNumber, areaSqm: 1245, purpose: 'Оффис' },
        }));

      // Objects are keyed on their own code, so a database seeded before this module
      // existed picks them up on the next run without duplicating the hierarchy above.
      if (await ObjectRecord.findOne({ customer: customer._id, code: `${entry.code}-LDB-${floorNumber}` })) {
        continue;
      }

      const panel = await ObjectRecord.create({
        code: `${entry.code}-LDB-${floorNumber}`,
        name: `Гэрэлтүүлгийн самбар ${floorNumber}F`,
        category: 'PANEL',
        objectType: types.DB,
        customer: customer._id,
        floor: floor._id,
        status: 'ACTIVE',
        panel: { capacityKw: 25, location: 'Цахилгааны өрөө', protection: 'IP54' },
      });

      const circuit = await ObjectRecord.create({
        code: `${entry.code}-C${floorNumber}-1`,
        name: `Хэлхээ ${floorNumber}-01`,
        category: 'CIRCUIT',
        objectType: types.LINE,
        customer: customer._id,
        floor: floor._id,
        status: 'ACTIVE',
        circuit: {
          panel: panel._id,
          breakerRating: 'MCB 16A',
          cableType: 'VVG 3x2.5',
          cableSectionMm2: 2.5,
          cableLengthM: 38,
          permittedCapacityKw: 12,
        },
      });

      // Scores span the documented bands so the dashboard and the floor roll-up show range.
      const equipmentSeed = [
        { code: 'L', name: 'Гэрлийн цэг L-01', type: types.LAMP, kw: 0.06, qty: 40, coefficient: 0.9, score: 92 },
        { code: 'R', name: 'Розетка R-04', type: types.SOCKET, kw: 0.3, qty: 12, coefficient: 0.5, score: 68 },
        { code: 'AC', name: 'Агааржуулагч AC-02', type: types.HVAC, kw: 2.5, qty: 2, coefficient: 0.8, score: 47 },
      ];

      for (const [index, device] of equipmentSeed.entries()) {
        await ObjectRecord.create({
          code: `${entry.code}-F${floorNumber}-D${index + 1}`,
          name: device.name,
          category: 'EQUIPMENT',
          objectType: device.type,
          customer: customer._id,
          floor: floor._id,
          status: 'ACTIVE',
          equipment: {
            circuit: circuit._id,
            ratedPowerKw: device.kw,
            quantity: device.qty,
            usageCoefficient: device.coefficient,
          },
        });
      }

      // Deliberately circuit-less: section 11.5 counts panels only, so this device is
      // reported separately rather than folded into the floor total.
      await ObjectRecord.create({
        code: `${entry.code}-F${floorNumber}-UPS`,
        name: 'UPS-01 (хэлхээнд холбоогүй)',
        category: 'EQUIPMENT',
        objectType: types.UPS,
        customer: customer._id,
        floor: floor._id,
        status: 'ACTIVE',
        equipment: { circuit: null, ratedPowerKw: 3, quantity: 1, usageCoefficient: null },
      });
    }
  }
}

/**
 * A service agreement per customer and one invoice in each interesting state.
 *
 * Guarded per entity so the script stays additive and re-runnable, matching the rest of
 * this file. The overdue example is issued with a due date in the past: OVERDUE is derived
 * from the clock rather than stored, so it needs no separate status.
 */
async function seedBilling(): Promise<void> {
  const customers = await Customer.find().limit(2);
  if (customers.length === 0) return;

  const now = new Date();
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

  for (const [index, customer] of customers.entries()) {
    const agreementNumber = `AGR-${customer.code}`;
    const agreement =
      (await ServiceAgreement.findOne({ agreementNumber })) ??
      (await ServiceAgreement.create({
        agreementNumber,
        customer: customer._id,
        startDate: new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
        endDate: new Date(Date.UTC(now.getUTCFullYear(), 11, 31)),
        serviceType: 'Урьдчилан сэргийлэх засвар үйлчилгээ',
        slaUrgentHours: 6,
        slaStandardHours: 24,
        frequency: 'MONTHLY',
        monthlyFee: index === 0 ? 1_500_000 : 850_000,
        currency: 'MNT',
        status: 'ACTIVE',
      }));

    if (await Invoice.findOne({ customer: customer._id })) continue;

    const fee = agreement.monthlyFee;
    const overdue = index === 0;
    const issueDate = new Date(now);
    issueDate.setUTCDate(1);
    const dueDate = new Date(issueDate);
    dueDate.setUTCDate(overdue ? issueDate.getUTCDate() - 15 : issueDate.getUTCDate() + 30);

    await Invoice.create({
      invoiceNumber: await nextInvoiceNumber(now),
      customer: customer._id,
      serviceAgreement: agreement._id,
      billingType: 'MONTHLY_SERVICE',
      billingPeriod: period,
      issueDate,
      dueDate,
      lines: [
        {
          source: 'AGREEMENT_MONTHLY_FEE',
          description: `Сарын тогтмол төлбөр · ${agreementNumber} · ${period}`,
          quantity: 1,
          unitPrice: fee,
          amount: fee,
        },
      ],
      subtotal: fee,
      taxPercent: 0,
      taxAmount: 0,
      total: fee,
      currency: 'MNT',
      status: overdue ? 'SENT' : 'DRAFT',
      sentAt: overdue ? issueDate : null,
      statusHistory: [
        { fromStatus: null, toStatus: 'DRAFT', reason: null, changedAt: issueDate },
        ...(overdue
          ? [{ fromStatus: 'DRAFT', toStatus: 'SENT', reason: null, changedAt: issueDate }]
          : []),
      ],
    });
  }
}

async function seedServiceRequests(): Promise<void> {
  if ((await ServiceRequest.countDocuments()) > 0) return;

  const customer = await Customer.findOne({ code: 'CT' });
  if (!customer) return;

  const building = await ObjectNode.findOne({ customer: customer._id, kind: 'BUILDING' });
  const floor = await ObjectNode.findOne({ customer: customer._id, kind: 'FLOOR' });
  const project = await ObjectNode.findOne({ customer: customer._id, kind: 'PROJECT' });
  if (!building || !project) return;

  const employees = await Employee.find({ status: 'ACTIVE' }).limit(3);

  const requestSeed = [
    { urgent: true, status: 'UNASSIGNED' as const,
      description: 'LDB-2F-01 самбар дээр хэт ачаалал илэрч, таслуур байнга унтарч байна.',
      ageHours: 5, assign: false,
    },
    { urgent: true, status: 'IN_PROGRESS' as const,
      description: 'UPS-01 төхөөрөмжийн зайн хүчин чадал шалгах шаардлагатай.',
      ageHours: 3, assign: true,
    },
    { urgent: false, status: 'ASSIGNED' as const,
      description: '2-р давхрын гэрлийн цэгүүд анивчиж байна.',
      ageHours: 8, assign: true,
    },
    { urgent: false, status: 'ON_SITE' as const,
      description: 'Улирлын төлөвлөгөөт үзлэг, самбар болон хэлхээний хэмжилт.',
      ageHours: 20, assign: true,
    },
    { urgent: false, status: 'COMPLETED' as const,
      description: 'Розетка R-04 солих ажил.',
      ageHours: 40, assign: true,
    },
    { urgent: false, status: 'NEW' as const,
      description: 'Агааржуулагчийн тэжээлийн шугам шалгуулах хүсэлт.',
      ageHours: 1, assign: false,
    },
  ];

  for (const entry of requestSeed) {
    const createdAt = new Date(Date.now() - entry.ageHours * 60 * 60 * 1000);
    const assigned = entry.assign ? employees.slice(0, 2).map((employee) => employee._id) : [];

    await ServiceRequest.create({
      requestNumber: await nextRequestNumber(createdAt),
      customer: customer._id,
      branch: 'Төв салбар',
      project: project._id,
      building: building._id,
      floor: floor?._id ?? null,
      isUrgent: entry.urgent,
      description: entry.description,
      contactName: 'Б. Болд',
      contactPhone: '9911-0000',
      status: entry.status,
      assignedEmployees: assigned,
      slaStartedAt: createdAt,
      slaDueAt: computeSlaDueAt(createdAt, entry.urgent),
      completedAt: entry.status === 'COMPLETED' ? new Date() : null,
      statusHistory: [
        {
          _id: new Types.ObjectId(),
          fromStatus: null,
          toStatus: entry.status,
          reason: null,
          changedByName: 'Seed',
          changedAt: createdAt,
        },
      ],
      createdByName: 'Seed',
      createdAt,
    });
  }
}

/**
 * Aligns the system roles with their declared defaults, in BOTH directions.
 *
 * The production seed deliberately never widens an existing role, because an
 * administrator may have removed a permission on purpose and an upgrade must not quietly
 * hand it back. Nor does it narrow one. That leaves a long-lived development database
 * describing a permission model nobody wrote: short of any key introduced after its roles
 * were first created, and still holding any key that has since been withdrawn — including
 * ones a developer PATCHed in by hand to unblock an afternoon.
 *
 * A development database that disagrees with `SYSTEM_ROLE_DEFAULT_PERMISSIONS` is worse
 * than useless for judging a permission change: `employee.view` lingering on TECHNICIAN in
 * dev is exactly what made a directory-wide leak look like correct behaviour. So this
 * script, which is a development aid and refuses to run in production, makes the system
 * roles equal their defaults.
 *
 * Only the roles in `SYSTEM_ROLE_KEYS` are touched. A custom role built in dev is left
 * alone, as it would be in production.
 */
async function alignSystemRoles(): Promise<Record<string, { granted: number; revoked: number }>> {
  const changes: Record<string, { granted: number; revoked: number }> = {};

  for (const key of Object.values(SYSTEM_ROLE_KEYS)) {
    const role = await Role.findOne({ key });
    if (!role) continue;

    const defaults = SYSTEM_ROLE_DEFAULT_PERMISSIONS[key as SystemRoleKey];
    const declared = new Set<PermissionKey>(defaults);

    const missing = defaults.filter((entry) => !role.permissions.includes(entry));
    const extra = role.permissions.filter((entry) => !declared.has(entry));
    if (missing.length === 0 && extra.length === 0) continue;

    role.permissions = [...defaults];
    await role.save();
    changes[key] = { granted: missing.length, revoked: extra.length };
  }

  return changes;
}

async function main(): Promise<void> {
  if (env.isProduction) {
    logger.error('seed-dev-data refuses to run with NODE_ENV=production.');
    process.exit(1);
  }

  await connectDatabase();

  // The server runs this on every boot, but the seed must not depend on the server having
  // been started: `seedEmployeeLogins` needs the TECHNICIAN role to exist before it can put
  // an account on it, and `alignSystemRoles` below only adjusts roles that are already
  // there. Idempotent by contract, so running it here costs nothing on a warm database.
  await seedRbac();

  const roleChanges = await alignSystemRoles();
  if (Object.keys(roleChanges).length > 0) {
    logger.info({ roleChanges }, 'System roles realigned with their default permissions');
  }

  const org = await seedOrganisation();
  await seedEmployees(org);
  // Separate pass, deliberately: `seedEmployees` skips a card that already exists, so a
  // database seeded before logins were part of this script still gets them on the next run.
  await seedEmployeeLogins();
  await seedHierarchy();
  await seedServiceRequests();
  await seedBilling();

  const counts = {
    companies: await Company.countDocuments(),
    departments: await Department.countDocuments(),
    positions: await Position.countDocuments(),
    teams: await Team.countDocuments(),
    employees: await Employee.countDocuments(),
    employeesWithLogin: await Employee.countDocuments({ systemUser: { $ne: null } }),
    customers: await Customer.countDocuments(),
    objectNodes: await ObjectNode.countDocuments(),
    objectTypes: await ObjectType.countDocuments(),
    objects: await ObjectRecord.countDocuments(),
    serviceRequests: await ServiceRequest.countDocuments(),
    serviceAgreements: await ServiceAgreement.countDocuments(),
    invoices: await Invoice.countDocuments(),
  };

  logger.info(counts, 'Development seed data ready');

  await disconnectDatabase();
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, 'Seeding failed');
  process.exit(1);
});
