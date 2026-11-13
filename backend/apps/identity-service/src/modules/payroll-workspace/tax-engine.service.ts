import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { PrismaService } from "../../common/database/prisma.service.js";
import type { CalcLine } from "./calc.service.js";

const ZERO = new Prisma.Decimal(0);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Pay periods in a year, for annualising a period's taxable income (§12). */
const PERIODS_PER_YEAR: Record<string, number> = {
  MONTHLY: 12, SEMI_MONTHLY: 24, BIWEEKLY: 26, WEEKLY: 52, DAILY: 260, CUSTOM: 12,
};

/**
 * The tax-year label a date falls in, given the country's fiscal-year start
 * month (1-12). Calendar-year countries (start = January) get "2025"; an
 * April-start fiscal year (India/UK) gets "2025-26".
 */
function taxYearOf(date: Date, fiscalStartMonth = 4): string {
  const y = date.getUTCFullYear();
  const startYear = date.getUTCMonth() + 1 >= fiscalStartMonth ? y : y - 1;
  if (fiscalStartMonth === 1) return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export interface TaxComputeInput {
  orgId: string;
  employeeId: string;
  onDate: Date; // a date inside the pay period
  countryCode: string | null;
  fallbackRegime: string | null; // from the profile version's taxRegime
  payFrequency: string;
  periodTaxable: Prisma.Decimal; // this period's taxable earnings
  statutoryBase: Prisma.Decimal; // wage the PF/ESI base is drawn from (prorated basic)
}

export interface TaxComputeResult {
  lines: CalcLine[];
  warnings: string[];
  meta: { taxRuleSetId: string | null; regime: string; taxYear: string; annualTax: number; periodTds: number };
}

/**
 * Phase-2 tax + statutory engine (§12/§13/§38.11). Income tax (TDS) and PF/ESI/PT
 * are computed ENTIRELY from versioned, effective-dated config tables — TaxRuleSet
 * / TaxSlab / StatutoryRule — set by an authorised admin. NO slab, rate or
 * threshold is hard-coded here; if no rule set is in force for the employee's
 * country/regime/date the engine simply contributes nothing and says so, rather
 * than inventing a number. Every output line is deterministic and stamps the
 * rule-set version it came from, so a recompute reproduces the same figures.
 */
@Injectable()
export class TaxEngineService {
  private readonly log = new Logger(TaxEngineService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the tax rule set in force for a country/regime on a date (org override beats global). */
  private async resolveTaxRuleSet(orgId: string, countryCode: string, regime: string, onDate: Date) {
    const where = (org: string | null): Prisma.TaxRuleSetWhereInput => ({
      orgId: org,
      countryCode,
      regime,
      status: "ACTIVE",
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    });
    const pick = (org: string | null) =>
      this.prisma.taxRuleSet.findFirst({
        where: where(org),
        orderBy: [{ effectiveFrom: "desc" }, { version: "desc" }],
        include: { slabs: { orderBy: { seq: "asc" } } },
      });
    return (await pick(orgId)) ?? (await pick(null));
  }

  /** Resolve the active statutory rules (PF/ESI/PT/...) for a country on a date. */
  private async resolveStatutoryRules(orgId: string, countryCode: string, onDate: Date) {
    const rows = await this.prisma.statutoryRule.findMany({
      where: {
        countryCode,
        status: "ACTIVE",
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
        AND: { OR: [{ orgId }, { orgId: null }] },
      },
      orderBy: [{ kind: "asc" }, { effectiveFrom: "desc" }, { version: "desc" }],
    });
    // Latest effective org-override-or-global per kind.
    const byKind = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      const cur = byKind.get(r.kind);
      if (!cur) byKind.set(r.kind, r);
      else if (cur.orgId === null && r.orgId !== null) byKind.set(r.kind, r); // prefer org override
    }
    return [...byKind.values()];
  }

  /** Progressive slab tax on an annual taxable income. */
  private slabTax(annualTaxable: Prisma.Decimal, slabs: { lowerBound: Prisma.Decimal; upperBound: Prisma.Decimal | null; ratePercent: Prisma.Decimal }[]): Prisma.Decimal {
    let tax = ZERO;
    for (const s of slabs) {
      const lo = D(s.lowerBound);
      if (annualTaxable.lessThanOrEqualTo(lo)) continue;
      const hi = s.upperBound == null ? annualTaxable : Prisma.Decimal.min(annualTaxable, D(s.upperBound));
      const bandBase = hi.minus(lo);
      if (bandBase.greaterThan(0)) tax = tax.plus(bandBase.times(D(s.ratePercent)).div(100));
    }
    return tax;
  }

  private line(partial: Partial<CalcLine> & { code: string; name: string; category: string; amount: Prisma.Decimal; sortOrder: number }): CalcLine {
    return {
      direction: "DEDUCTION",
      taxable: false,
      statutory: false,
      employerPaid: false,
      payslipVisible: true,
      calcType: null,
      formula: null,
      inputs: {},
      componentVersionId: null,
      ...partial,
    };
  }

  async compute(input: TaxComputeInput): Promise<TaxComputeResult> {
    const warnings: string[] = [];
    const lines: CalcLine[] = [];
    const country = (input.countryCode ?? "").trim().toUpperCase();
    let sortOrder = 900;

    // Org opt-in (§13): tax + statutory run ONLY when the org owner enabled it.
    // Off (or no setting row) → payroll keeps earnings/components with no TDS or
    // statutory deductions.
    const setting = await this.prisma.payrollSetting.findUnique({ where: { orgId: input.orgId }, select: { taxEnabled: true } });
    if (!setting?.taxEnabled) {
      return { lines, warnings, meta: { taxRuleSetId: null, regime: "DISABLED", taxYear: taxYearOf(input.onDate), annualTax: 0, periodTds: 0 } };
    }

    if (!country) {
      warnings.push("No payroll country set — income tax and statutory deductions skipped.");
      return { lines, warnings, meta: { taxRuleSetId: null, regime: "NONE", taxYear: taxYearOf(input.onDate), annualTax: 0, periodTds: 0 } };
    }

    // Resolve the country's rule set FIRST — it carries the fiscal-year start, so
    // the tax-year label (and the per-employee declaration lookup) is right per
    // country (India Apr-Mar "2025-26" vs US calendar-year "2025").
    let regime = input.fallbackRegime && input.fallbackRegime !== "DEFAULT" ? input.fallbackRegime : "DEFAULT";
    let ruleSet = await this.resolveTaxRuleSet(input.orgId, country, regime, input.onDate);
    const taxYear = taxYearOf(input.onDate, ruleSet?.fiscalYearStartMonth ?? 4);

    // Per-employee declaration: regime override + declared exemptions for that year.
    const decl = await this.prisma.employeeTaxProfile.findUnique({
      where: { orgId_employeeId_taxYear: { orgId: input.orgId, employeeId: input.employeeId, taxYear } },
      select: { regime: true, exemptions: true },
    });
    if (decl?.regime && decl.regime !== "DEFAULT" && decl.regime !== regime) {
      regime = decl.regime;
      ruleSet = await this.resolveTaxRuleSet(input.orgId, country, regime, input.onDate);
    }
    const exemptions = decl?.exemptions ? D(decl.exemptions) : ZERO;

    // ---- Income tax (TDS) from versioned slabs ----
    const ppy = PERIODS_PER_YEAR[input.payFrequency] ?? 12;
    let annualTax = ZERO;
    let ruleSetId: string | null = null;
    if (!ruleSet) {
      warnings.push(`No income-tax rules configured for ${country}/${regime} on ${input.onDate.toISOString().slice(0, 10)} — TDS not applied.`);
    } else {
      ruleSetId = ruleSet.id;
      const annualTaxable = Prisma.Decimal.max(
        ZERO,
        input.periodTaxable.times(ppy).minus(D(ruleSet.standardDeduction)).minus(exemptions),
      );
      let tax = this.slabTax(annualTaxable, ruleSet.slabs);
      // Full rebate (87A-style): tax → 0 up to the configured taxable ceiling.
      if (ruleSet.rebateLimit && annualTaxable.lessThanOrEqualTo(D(ruleSet.rebateLimit))) {
        const rebate = ruleSet.rebateMaxAmount ? Prisma.Decimal.min(tax, D(ruleSet.rebateMaxAmount)) : tax;
        tax = tax.minus(rebate);
      }
      if (ruleSet.surchargePercent && D(ruleSet.surchargePercent).greaterThan(0)) tax = tax.plus(tax.times(D(ruleSet.surchargePercent)).div(100));
      if (ruleSet.cessPercent && D(ruleSet.cessPercent).greaterThan(0)) tax = tax.plus(tax.times(D(ruleSet.cessPercent)).div(100));
      annualTax = Prisma.Decimal.max(ZERO, tax);
      const periodTds = money(annualTax.div(ppy));
      if (periodTds.greaterThan(0)) {
        lines.push(this.line({
          code: "TDS", name: "Income Tax (TDS)", category: "TAX", amount: periodTds, sortOrder: sortOrder++,
          formula: `annual tax ${money(annualTax)} ÷ ${ppy} periods`,
          inputs: { regime, taxYear, annualTaxable: Number(annualTaxable), annualTax: Number(money(annualTax)), ruleSetVersion: ruleSet.version },
        }));
      }
    }

    // ---- Statutory (PF / ESI / PT ...) ----
    const statutory = await this.resolveStatutoryRules(input.orgId, country, input.onDate);
    for (const r of statutory) {
      // Applicability gate (e.g. ESI only when wage <= a ceiling).
      if (r.applicableUpto && input.statutoryBase.greaterThan(D(r.applicableUpto))) continue;
      const base = r.wageCeiling ? Prisma.Decimal.min(input.statutoryBase, D(r.wageCeiling)) : input.statutoryBase;

      // Flat-amount contribution (Professional Tax).
      if (r.flatAmount && D(r.flatAmount).greaterThan(0)) {
        lines.push(this.line({
          code: r.kind, name: r.name, category: "STATUTORY", statutory: true, amount: money(D(r.flatAmount)),
          sortOrder: sortOrder++, formula: "flat statutory amount", inputs: { kind: r.kind, ruleVersion: r.version },
        }));
        continue;
      }
      // Percentage contribution: employee (deduction) + employer (cost).
      const empAmt = money(base.times(D(r.employeeRate)).div(100));
      const erAmt = money(base.times(D(r.employerRate)).div(100));
      if (empAmt.greaterThan(0)) {
        lines.push(this.line({
          code: `${r.kind}_EE`, name: `${r.name} (Employee)`, category: "STATUTORY", statutory: true, amount: empAmt,
          sortOrder: sortOrder++, formula: `${r.employeeRate}% of ${money(base)}`, inputs: { kind: r.kind, base: Number(money(base)), ruleVersion: r.version },
        }));
      }
      if (erAmt.greaterThan(0)) {
        lines.push(this.line({
          code: `${r.kind}_ER`, name: `${r.name} (Employer)`, category: "STATUTORY", statutory: true, employerPaid: true, amount: erAmt,
          sortOrder: sortOrder++, formula: `${r.employerRate}% of ${money(base)}`, inputs: { kind: r.kind, base: Number(money(base)), ruleVersion: r.version },
        }));
      }
    }

    return { lines, warnings, meta: { taxRuleSetId: ruleSetId, regime, taxYear, annualTax: Number(money(annualTax)), periodTds: Number(lines.find((l) => l.code === "TDS")?.amount ?? 0) } };
  }
}
