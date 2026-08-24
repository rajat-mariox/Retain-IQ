import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { PrismaService } from "../../common/database/prisma.service.js";

type Direction = "EARNING" | "DEDUCTION";

/** The batch context the calculation needs; loaded once by the batch service. */
export interface BatchCalcContext {
  id: string;
  periodId: string;
  currencyCode: string;
  countryCode: string | null;
  periodStart: Date;
  periodEnd: Date;
}

/** Aggregated totals a single employee's calculation contributes to the batch. */
export interface CalcResult {
  employeeId: string;
  recordId: string;
  status: string;
  grossEarnings: Prisma.Decimal;
  netPayable: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  employerCost: Prisma.Decimal;
  errors: string[];
  warnings: string[];
}

const ZERO = new Prisma.Decimal(0);
const D = (v: number | string | Prisma.Decimal): Prisma.Decimal => new Prisma.Decimal(v);
/** Money rounded to 2dp, half-up — the storage column keeps 4dp but we normalize. */
const money = (d: Prisma.Decimal): Prisma.Decimal => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** One computed payslip line, with the explainability metadata §26 requires. */
interface CalcLine {
  code: string;
  name: string;
  direction: Direction;
  category: string;
  amount: Prisma.Decimal;
  taxable: boolean;
  statutory: boolean;
  employerPaid: boolean;
  payslipVisible: boolean;
  calcType: string | null;
  formula: string | null;
  inputs: Prisma.InputJsonValue;
  componentVersionId: string | null;
  sortOrder: number;
}

/**
 * The deterministic payroll calculation pipeline (§26). For one employee in one
 * batch it resolves the effective PayrollProfileVersion, reads the frozen
 * PayrollInputSnapshot, and produces a PayrollRecord plus a fully explainable set
 * of PayrollRecordComponent lines. The same inputs and the same versions always
 * yield the same result — no wall-clock, no randomness — so a run is reproducible.
 *
 * Base pay follows the payment basis (§11): FIXED = period amount × proration
 * factor; HOURLY = approved regular hours × hourly rate; DAILY = payable days ×
 * daily rate. Proration is driven by the profile's `prorationPolicy`, never a
 * hard-coded /30. Config-driven earning/deduction components are applied on top,
 * then approved variable pay (bonus/incentive/reimbursement) and approved PAID
 * overtime — each claimed to this batch so it is never double-paid. Tax and
 * statutory deductions are Phase 2 and are left at 0 with a TODO.
 */
@Injectable()
export class PayrollCalcService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calculate one employee's record for a batch and persist it (idempotently:
   * re-running replaces the record and its lines). Runs in a transaction so the
   * record, its lines, and the claiming of variable pay/overtime commit together.
   */
  async calculateEmployee(orgId: string, batch: BatchCalcContext, employeeId: string): Promise<CalcResult> {
    const snapshot = await this.prisma.payrollInputSnapshot.findUnique({
      where: { batchId_employeeId: { batchId: batch.id, employeeId } },
    });
    if (!snapshot || snapshot.orgId !== orgId) {
      throw new BadRequestException("Inputs are not frozen for this employee; freeze the batch before calculating.");
    }

    // Resolve the profile version in force for the period end (compensation as it
    // stood at the close of the window). No profile → a failed record, surfaced
    // by validation rather than silently paying 0.
    const profile = await this.prisma.payrollProfile.findUnique({
      where: { orgId_employeeId: { orgId, employeeId } },
      select: { id: true },
    });
    const version = profile
      ? await this.prisma.payrollProfileVersion.findFirst({
          where: {
            orgId,
            profileId: profile.id,
            effectiveFrom: { lte: batch.periodEnd },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: batch.periodStart } }],
          },
          orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        })
      : null;

    if (!version) {
      return this.writeFailedRecord(orgId, batch, employeeId, "No effective payroll profile version for this period.");
    }
    if (version.currencyCode !== batch.currencyCode) {
      return this.writeFailedRecord(
        orgId,
        batch,
        employeeId,
        `Profile currency ${version.currencyCode} does not match batch currency ${batch.currencyCode}.`,
      );
    }

    const warnings: string[] = [];
    const lines: CalcLine[] = [];
    let order = 0;

    // ---- Snapshot facts (Decimal-safe) ----
    const scheduledDays = D(snapshot.scheduledDays ?? 0);
    const workingDays = D(snapshot.workingDays ?? 0);
    const unpaidLeaveDays = D(snapshot.unpaidLeaveDays ?? 0);
    const payableDays = D(snapshot.payableDays ?? 0);
    const regularHours = D(snapshot.regularHours ?? 0);

    // Absent working days (not present, not on any leave) also cause loss of pay.
    const absentDays = Prisma.Decimal.max(ZERO, workingDays.minus(payableDays).minus(unpaidLeaveDays));
    const lopDays = unpaidLeaveDays.plus(absentDays);

    // ---- Proration factor (§11 — policy-driven, never a hard /30) ----
    const { factor: prorationFactor, divisorDays, policy: prorationPolicy } = this.prorationFactor(
      version.prorationPolicy,
      { scheduledDays, workingDays, lopDays },
      version.paymentBasis,
      warnings,
    );

    // ---- Base pay by payment basis (§11) ----
    const base = D(version.baseAmount);
    let baseEarning: Prisma.Decimal;
    let baseFormula: string;
    let baseInputs: Record<string, unknown>;
    if (version.paymentBasis === "HOURLY") {
      baseEarning = money(base.times(regularHours));
      baseFormula = "approvedRegularHours × hourlyRate";
      baseInputs = { approvedRegularHours: Number(regularHours), hourlyRate: Number(base) };
    } else if (version.paymentBasis === "DAILY") {
      baseEarning = money(base.times(payableDays));
      baseFormula = "payableDays × dailyRate";
      baseInputs = { payableDays: Number(payableDays), dailyRate: Number(base) };
    } else {
      // FIXED: the period amount, prorated for the paid portion of the period.
      baseEarning = money(base.times(prorationFactor));
      baseFormula = "periodAmount × prorationFactor";
      baseInputs = {
        periodAmount: Number(base),
        prorationFactor: Number(prorationFactor),
        prorationPolicy,
        divisorDays: Number(divisorDays),
        lopDays: Number(lopDays),
        lopAmount: Number(money(base.times(divisorDays.isZero() ? ZERO : lopDays.div(divisorDays)))),
      };
      if (lopDays.greaterThan(0)) warnings.push(`Loss of pay applied for ${Number(lopDays)} day(s).`);
    }

    lines.push({
      code: "BASE",
      name: "Base pay",
      direction: "EARNING",
      category: "BASIC",
      amount: baseEarning,
      taxable: true,
      statutory: false,
      employerPaid: false,
      payslipVisible: true,
      calcType: version.paymentBasis,
      formula: baseFormula,
      inputs: baseInputs as Prisma.InputJsonValue,
      componentVersionId: null,
      sortOrder: order++,
    });

    // ---- Config-driven earning/deduction components (§10, §26) ----
    const componentVersions = await this.resolveComponentVersions(orgId, batch);
    for (const cv of componentVersions) {
      const line = this.computeComponentLine(cv, baseEarning, prorationFactor, version.paymentBasis, order++, warnings);
      if (line) lines.push(line);
    }

    // Claim variable pay/overtime, compute totals and persist the record + its lines
    // in ONE transaction, so a failure can never leave variable pay marked as
    // included-in-payroll without a matching record (and vice versa).
    const persisted = await this.prisma.$transaction(async (tx) => {
      const variable = await this.claimVariableAndOvertime(tx, orgId, batch, employeeId, order);
      const allLines = [...lines, ...variable.lines];
      const totals = this.computeTotals(allLines);
      if (totals.netPayable.lessThan(0)) warnings.push("Net payable is negative — deductions exceed earnings.");

      const record = await tx.payrollRecord.upsert({
        where: { batchId_employeeId: { batchId: batch.id, employeeId } },
        create: {
          orgId,
          batchId: batch.id,
          employeeId,
          periodId: batch.periodId,
          currencyCode: batch.currencyCode,
          profileVersionId: version.id,
          regularEarnings: money(totals.regularEarnings),
          variableEarnings: money(totals.variableEarnings),
          overtimeAmount: money(totals.overtimeAmount),
          reimbursements: money(totals.reimbursements),
          grossEarnings: totals.grossEarnings,
          preTaxDeductions: money(totals.preTaxDeductions),
          taxableIncome: money(totals.taxableIncome),
          taxDeduction: totals.taxDeduction,
          employeeStatutory: money(totals.employeeStatutory),
          postTaxDeductions: totals.postTaxDeductions,
          adjustments: ZERO,
          netPayable: totals.netPayable,
          employerContrib: money(totals.employerContrib),
          employerCost: totals.employerCost,
          prorationFactor,
          status: "CALCULATED",
          warnings: warnings as Prisma.InputJsonValue,
          errors: [] as Prisma.InputJsonValue,
          calculatedAt: new Date(),
        },
        update: {
          periodId: batch.periodId,
          currencyCode: batch.currencyCode,
          profileVersionId: version.id,
          regularEarnings: money(totals.regularEarnings),
          variableEarnings: money(totals.variableEarnings),
          overtimeAmount: money(totals.overtimeAmount),
          reimbursements: money(totals.reimbursements),
          grossEarnings: totals.grossEarnings,
          preTaxDeductions: money(totals.preTaxDeductions),
          taxableIncome: money(totals.taxableIncome),
          taxDeduction: totals.taxDeduction,
          employeeStatutory: money(totals.employeeStatutory),
          postTaxDeductions: totals.postTaxDeductions,
          adjustments: ZERO,
          netPayable: totals.netPayable,
          employerContrib: money(totals.employerContrib),
          employerCost: totals.employerCost,
          prorationFactor,
          status: "CALCULATED",
          warnings: warnings as Prisma.InputJsonValue,
          errors: [] as Prisma.InputJsonValue,
          calculatedAt: new Date(),
          calcVersion: { increment: 1 },
        },
        select: { id: true },
      });

      await tx.payrollRecordComponent.deleteMany({ where: { orgId, recordId: record.id } });
      for (const l of allLines) {
        await tx.payrollRecordComponent.create({
          data: {
            orgId,
            recordId: record.id,
            code: l.code,
            name: l.name,
            direction: l.direction,
            category: l.category,
            amount: money(l.amount),
            taxable: l.taxable,
            statutory: l.statutory,
            employerPaid: l.employerPaid,
            payslipVisible: l.payslipVisible,
            calcType: l.calcType,
            formula: l.formula,
            inputs: l.inputs,
            componentVersionId: l.componentVersionId,
            sortOrder: l.sortOrder,
          },
        });
      }
      return { recordId: record.id, totals };
    });

    return {
      employeeId,
      recordId: persisted.recordId,
      status: "CALCULATED",
      grossEarnings: persisted.totals.grossEarnings,
      netPayable: persisted.totals.netPayable,
      totalDeductions: money(persisted.totals.totalDeductions),
      employerCost: persisted.totals.employerCost,
      errors: [],
      warnings,
    };
  }

  /**
   * Fold the computed lines into the record totals (§8), Decimal-safe. Employer-paid
   * lines are the employer's cost only and never touch the employee's gross or net.
   * Tax and statutory tax withholding are Phase 2 and stay 0 (TODO).
   */
  private computeTotals(lines: CalcLine[]) {
    let regularEarnings = ZERO;
    let variableEarnings = ZERO;
    let overtimeAmount = ZERO;
    let reimbursements = ZERO;
    let preTaxDeductions = ZERO;
    let employeeStatutory = ZERO;
    let employerContrib = ZERO;
    let taxableIncome = ZERO;

    for (const l of lines) {
      if (l.employerPaid) {
        employerContrib = employerContrib.plus(l.amount);
        continue;
      }
      if (l.direction === "EARNING") {
        if (l.code === "BONUS" || l.code === "INCENTIVE") variableEarnings = variableEarnings.plus(l.amount);
        else if (l.code === "OVERTIME") overtimeAmount = overtimeAmount.plus(l.amount);
        else if (l.code === "REIMBURSEMENT") reimbursements = reimbursements.plus(l.amount);
        else regularEarnings = regularEarnings.plus(l.amount); // BASE + structural allowances
        if (l.taxable) taxableIncome = taxableIncome.plus(l.amount);
      } else if (l.statutory) {
        employeeStatutory = employeeStatutory.plus(l.amount);
      } else {
        preTaxDeductions = preTaxDeductions.plus(l.amount);
      }
    }

    const taxDeduction = ZERO; // TODO(phase-2): compute from taxRegime + taxableIncome.
    const postTaxDeductions = ZERO;
    const totalDeductions = preTaxDeductions.plus(employeeStatutory).plus(taxDeduction).plus(postTaxDeductions);
    const grossEarnings = money(regularEarnings.plus(variableEarnings).plus(overtimeAmount).plus(reimbursements));
    const netPayable = money(grossEarnings.minus(totalDeductions));
    const employerCost = money(grossEarnings.plus(employerContrib));
    return {
      regularEarnings, variableEarnings, overtimeAmount, reimbursements, grossEarnings,
      preTaxDeductions, employeeStatutory, taxDeduction, postTaxDeductions, totalDeductions,
      taxableIncome, netPayable, employerContrib, employerCost,
    };
  }

  // ---- Proration (§11) ----

  /**
   * The fraction of the period that is payable, under the profile's proration
   * policy. The divisor is the policy's day base — calendar days in the period,
   * scheduled working days, or a fixed 30/26 — and the numerator removes loss-of-pay
   * days. HOURLY/DAILY basis is inherently usage-based, so its factor is 1.
   */
  private prorationFactor(
    policy: string,
    days: { scheduledDays: Prisma.Decimal; workingDays: Prisma.Decimal; lopDays: Prisma.Decimal },
    paymentBasis: string,
    warnings: string[],
  ): { factor: Prisma.Decimal; divisorDays: Prisma.Decimal; policy: string } {
    if (paymentBasis !== "FIXED") {
      return { factor: new Prisma.Decimal(1), divisorDays: ZERO, policy: `${policy} (n/a for ${paymentBasis})` };
    }
    let divisorDays: Prisma.Decimal;
    switch (policy) {
      case "WORKING_DAYS":
        divisorDays = days.workingDays;
        break;
      case "FIXED_30":
        divisorDays = new Prisma.Decimal(30);
        break;
      case "FIXED_26":
        divisorDays = new Prisma.Decimal(26);
        break;
      case "CUSTOM":
        // No custom-divisor config in Phase 1 — fall back to working days.
        divisorDays = days.workingDays;
        warnings.push("CUSTOM proration has no configured divisor; using working days.");
        break;
      case "CALENDAR_DAYS":
      default:
        divisorDays = days.scheduledDays;
        break;
    }
    if (divisorDays.lessThanOrEqualTo(0)) {
      warnings.push("Proration divisor is zero; treating the period as fully payable.");
      return { factor: new Prisma.Decimal(1), divisorDays: ZERO, policy };
    }
    const raw = divisorDays.minus(days.lopDays).div(divisorDays);
    const factor = Prisma.Decimal.min(new Prisma.Decimal(1), Prisma.Decimal.max(ZERO, raw)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    return { factor, divisorDays, policy };
  }

  // ---- Components (§10) ----

  /** The active component versions effective in the period, latest version per component, matching batch country/currency. */
  private async resolveComponentVersions(orgId: string, batch: BatchCalcContext) {
    const rows = await this.prisma.payrollComponentVersion.findMany({
      where: {
        orgId,
        status: "ACTIVE",
        effectiveFrom: { lte: batch.periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: batch.periodStart } }],
        component: { archived: false },
      },
      orderBy: [{ componentId: "asc" }, { version: "desc" }],
      include: { component: { select: { code: true, name: true } } },
    });
    // Keep only the highest-version row per component, and only those whose country/
    // currency are unset (global) or match this batch.
    const seen = new Set<string>();
    const chosen: typeof rows = [];
    for (const r of rows) {
      if (seen.has(r.componentId)) continue;
      seen.add(r.componentId);
      const countryOk = !r.countryCode || r.countryCode === batch.countryCode;
      const currencyOk = !r.currencyCode || r.currencyCode === batch.currencyCode;
      if (countryOk && currencyOk) chosen.push(r);
    }
    return chosen;
  }

  /** Compute one component line from its version config. Returns null to skip (zero/unsupported handled inline). */
  private computeComponentLine(
    cv: {
      id: string;
      category: string;
      direction: Direction;
      calcType: string;
      config: Prisma.JsonValue;
      taxable: boolean;
      statutory: boolean;
      employerPaid: boolean;
      proratable: boolean;
      payslipVisible: boolean;
      minAmount: Prisma.Decimal | null;
      maxAmount: Prisma.Decimal | null;
      component: { code: string; name: string };
    },
    baseEarning: Prisma.Decimal,
    prorationFactor: Prisma.Decimal,
    paymentBasis: string,
    sortOrder: number,
    warnings: string[],
  ): CalcLine | null {
    const cfg = (cv.config ?? {}) as Record<string, unknown>;
    const numFrom = (v: unknown): number => {
      const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
      return Number.isFinite(n) ? n : 0;
    };

    let amount = ZERO;
    let formula: string;
    const inputs: Record<string, unknown> = {};

    switch (cv.calcType) {
      case "FIXED": {
        amount = D(numFrom(cfg.amount));
        formula = "fixed amount";
        inputs.amount = numFrom(cfg.amount);
        break;
      }
      case "PERCENTAGE": {
        const pct = numFrom(cfg.percent ?? cfg.percentage);
        amount = money(baseEarning.times(pct).div(100));
        formula = `${pct}% of base pay`;
        inputs.percent = pct;
        inputs.basis = Number(baseEarning);
        break;
      }
      // FORMULA / INPUT_BASED / PER_UNIT need the Phase-2 rule engine; emit a
      // zero line so the component is visible and its absence is explained.
      default: {
        formula = `${cv.calcType} (unsupported in Phase 1)`;
        inputs.note = "calcType requires the Phase 2 rule engine; contributed 0.";
        warnings.push(`Component ${cv.component.code} uses ${cv.calcType}, unsupported in Phase 1 — treated as 0.`);
        break;
      }
    }

    // Proration only applies to a FIXED-basis salary; usage-based pay already reflects effort.
    let prorated = amount;
    if (cv.proratable && paymentBasis === "FIXED" && cv.calcType !== "PERCENTAGE") {
      prorated = money(amount.times(prorationFactor));
      inputs.prorationFactor = Number(prorationFactor);
    }

    // Clamp to configured bounds.
    if (cv.minAmount !== null && prorated.lessThan(cv.minAmount)) prorated = D(cv.minAmount);
    if (cv.maxAmount !== null && prorated.greaterThan(cv.maxAmount)) prorated = D(cv.maxAmount);

    return {
      code: cv.component.code,
      name: cv.component.name,
      direction: cv.direction,
      category: cv.category,
      amount: prorated,
      taxable: cv.taxable,
      statutory: cv.statutory,
      employerPaid: cv.employerPaid,
      payslipVisible: cv.payslipVisible,
      calcType: cv.calcType,
      formula,
      inputs: inputs as Prisma.InputJsonValue,
      componentVersionId: cv.id,
      sortOrder,
    };
  }

  // ---- Variable pay + overtime (§13, §14) ----

  /**
   * Claim the employee's APPROVED bonuses, incentives, reimbursements and PAID
   * overtime into this batch and turn them into lines. Idempotent: items already
   * marked INCLUDED_IN_PAYROLL for THIS batch are re-read (not re-claimed elsewhere),
   * so a recalculation yields the same set and nothing is ever double-paid.
   */
  private async claimVariableAndOvertime(
    tx: Prisma.TransactionClient,
    orgId: string,
    batch: BatchCalcContext,
    employeeId: string,
    startOrder: number,
  ): Promise<{ lines: CalcLine[]; nextOrder: number }> {
    let order = startOrder;
    const lines: CalcLine[] = [];
    const periodMatch = [{ periodId: null }, { periodId: batch.periodId }];
    const claimable = [
      { status: "APPROVED", batchId: null },
      { status: "INCLUDED_IN_PAYROLL", batchId: batch.id },
    ] as const;

    // Bonuses.
    const bonuses = await tx.payrollBonus.findMany({
      where: { orgId, employeeId, AND: [{ OR: [...claimable] }, { OR: periodMatch }] },
      select: { id: true, amount: true, bonusType: true },
    });
    if (bonuses.length > 0) {
      await tx.payrollBonus.updateMany({ where: { id: { in: bonuses.map((b) => b.id) } }, data: { status: "INCLUDED_IN_PAYROLL", batchId: batch.id } });
      const total = bonuses.reduce((acc, b) => acc.plus(D(b.amount)), ZERO);
      lines.push({
        code: "BONUS", name: "Bonus", direction: "EARNING", category: "BONUS", amount: money(total),
        taxable: true, statutory: false, employerPaid: false, payslipVisible: true,
        calcType: "VARIABLE", formula: "sum of approved bonuses",
        inputs: { ids: bonuses.map((b) => b.id), types: bonuses.map((b) => b.bonusType) } as Prisma.InputJsonValue,
        componentVersionId: null, sortOrder: order++,
      });
    }

    // Incentives.
    const incentives = await tx.payrollIncentive.findMany({
      where: { orgId, employeeId, AND: [{ OR: [...claimable] }, { OR: periodMatch }] },
      select: { id: true, amount: true, incentiveType: true },
    });
    if (incentives.length > 0) {
      await tx.payrollIncentive.updateMany({ where: { id: { in: incentives.map((i) => i.id) } }, data: { status: "INCLUDED_IN_PAYROLL", batchId: batch.id } });
      const total = incentives.reduce((acc, i) => acc.plus(D(i.amount)), ZERO);
      lines.push({
        code: "INCENTIVE", name: "Incentive", direction: "EARNING", category: "BONUS", amount: money(total),
        taxable: true, statutory: false, employerPaid: false, payslipVisible: true,
        calcType: "VARIABLE", formula: "sum of approved incentives",
        inputs: { ids: incentives.map((i) => i.id), types: incentives.map((i) => i.incentiveType) } as Prisma.InputJsonValue,
        componentVersionId: null, sortOrder: order++,
      });
    }

    // Reimbursements — approvedAmount when set, else claimedAmount. Taxable per row.
    const reimbursements = await tx.payrollReimbursement.findMany({
      where: { orgId, employeeId, AND: [{ OR: [...claimable] }, { OR: periodMatch }] },
      select: { id: true, claimedAmount: true, approvedAmount: true, category: true, taxable: true },
    });
    if (reimbursements.length > 0) {
      await tx.payrollReimbursement.updateMany({ where: { id: { in: reimbursements.map((r) => r.id) } }, data: { status: "INCLUDED_IN_PAYROLL", batchId: batch.id } });
      const anyTaxable = reimbursements.some((r) => r.taxable);
      const total = reimbursements.reduce((acc, r) => acc.plus(D(r.approvedAmount ?? r.claimedAmount)), ZERO);
      lines.push({
        code: "REIMBURSEMENT", name: "Reimbursement", direction: "EARNING", category: "REIMBURSEMENT", amount: money(total),
        taxable: anyTaxable, statutory: false, employerPaid: false, payslipVisible: true,
        calcType: "VARIABLE", formula: "sum of approved reimbursements",
        inputs: { ids: reimbursements.map((r) => r.id), categories: reimbursements.map((r) => r.category) } as Prisma.InputJsonValue,
        componentVersionId: null, sortOrder: order++,
      });
    }

    // Approved PAID overtime within the period (COMP_OFF overtime is not money).
    const overtime = await tx.payrollOvertime.findMany({
      where: {
        orgId, employeeId, mode: "PAID", approvedBy: { not: null },
        workDate: { gte: batch.periodStart, lte: batch.periodEnd },
        OR: [{ batchId: null }, { batchId: batch.id }],
      },
      select: { id: true, hours: true, amount: true },
    });
    if (overtime.length > 0) {
      await tx.payrollOvertime.updateMany({ where: { id: { in: overtime.map((o) => o.id) } }, data: { batchId: batch.id } });
      const total = overtime.reduce((acc, o) => acc.plus(D(o.amount)), ZERO);
      const hours = overtime.reduce((acc, o) => acc.plus(D(o.hours)), ZERO);
      lines.push({
        code: "OVERTIME", name: "Overtime", direction: "EARNING", category: "ALLOWANCE", amount: money(total),
        taxable: true, statutory: false, employerPaid: false, payslipVisible: true,
        calcType: "PER_UNIT", formula: "sum of approved paid overtime",
        inputs: { ids: overtime.map((o) => o.id), hours: Number(hours) } as Prisma.InputJsonValue,
        componentVersionId: null, sortOrder: order++,
      });
    }

    return { lines, nextOrder: order };
  }

  // ---- Failure record ----

  /** Persist a record that could not be calculated, with a validation error and zero money. */
  private async writeFailedRecord(orgId: string, batch: BatchCalcContext, employeeId: string, error: string): Promise<CalcResult> {
    const recordId = await this.prisma.$transaction(async (tx) => {
      const record = await tx.payrollRecord.upsert({
        where: { batchId_employeeId: { batchId: batch.id, employeeId } },
        create: {
          orgId, batchId: batch.id, employeeId, periodId: batch.periodId, currencyCode: batch.currencyCode,
          status: "VALIDATION_FAILED", errors: [error] as Prisma.InputJsonValue, calculatedAt: new Date(),
        },
        update: {
          status: "VALIDATION_FAILED", errors: [error] as Prisma.InputJsonValue, calculatedAt: new Date(),
          regularEarnings: ZERO, variableEarnings: ZERO, overtimeAmount: ZERO, reimbursements: ZERO,
          grossEarnings: ZERO, preTaxDeductions: ZERO, taxableIncome: ZERO, taxDeduction: ZERO,
          employeeStatutory: ZERO, postTaxDeductions: ZERO, adjustments: ZERO, netPayable: ZERO,
          employerContrib: ZERO, employerCost: ZERO, prorationFactor: new Prisma.Decimal(1),
        },
        select: { id: true },
      });
      await tx.payrollRecordComponent.deleteMany({ where: { orgId, recordId: record.id } });
      return record.id;
    });
    return {
      employeeId, recordId, status: "VALIDATION_FAILED",
      grossEarnings: ZERO, netPayable: ZERO, totalDeductions: ZERO, employerCost: ZERO,
      errors: [error], warnings: [],
    };
  }
}
