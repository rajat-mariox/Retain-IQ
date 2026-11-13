import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const money = (v: Prisma.Decimal) => v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const ZERO = new Prisma.Decimal(0);

export type FilingKind = "FORM24Q" | "FORM16" | "PF_ECR" | "ESI" | "PT";

// How each return draws its numbers from a payroll record. `tax` kinds read the
// record's TDS/taxable income; the rest sum the matching statutory component lines.
const KIND: Record<FilingKind, { label: string; tax?: boolean; eeCode?: string; erCode?: string }> = {
  FORM24Q: { label: "Form 24Q — Quarterly TDS return", tax: true },
  FORM16: { label: "Form 16 — Annual TDS certificate", tax: true },
  PF_ECR: { label: "PF ECR (EPFO)", eeCode: "PF_EE", erCode: "PF_ER" },
  ESI: { label: "ESI contribution (ESIC)", eeCode: "ESI_EE", erCode: "ESI_ER" },
  PT: { label: "Professional Tax return", eeCode: "PT" },
};

export interface GenerateInput {
  kind: FilingKind;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
  periodLabel?: string;
  countryCode?: string;
}

/**
 * Phase-3 statutory filing (§14). A filing aggregates finalized (APPROVED/PAID)
 * payroll records for a period into the return an employer submits — Form-24Q /
 * Form-16 (TDS), PF ECR, ESI, PT. The AMOUNTS come straight from the reproducible
 * PayrollRecords/components, so a filing always reconciles to the payroll it was
 * generated from. Lifecycle mirrors the batch with separation of duties: whoever
 * generated a filing cannot approve it. The CSV export layout is best-effort and
 * flagged for verification — statutory portal formats change and are authoritative.
 */
@Injectable()
export class PayrollFilingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(kind?: string) {
    const { orgId } = requireTenantContext();
    const rows = await this.prisma.payrollFiling.findMany({
      where: { orgId, ...(kind ? { kind } : {}) },
      orderBy: [{ periodStart: "desc" }, { generatedAt: "desc" }],
      include: { _count: { select: { lines: true } } },
    });
    return rows.map((r) => this.serialize(r, (r as { _count?: { lines: number } })._count?.lines));
  }

  async get(id: string) {
    const { orgId } = requireTenantContext();
    const f = await this.prisma.payrollFiling.findFirst({ where: { id, orgId }, include: { lines: true } });
    if (!f) throw new NotFoundException("Filing not found.");
    return {
      ...this.serialize(f, f.lines.length),
      lines: f.lines.map((l) => ({
        employeeId: l.employeeId,
        wageBase: Number(l.wageBase),
        employeeAmt: Number(l.employeeAmt),
        employerAmt: Number(l.employerAmt),
        taxAmt: Number(l.taxAmt),
      })),
    };
  }

  /** Aggregate finalized records for the period into a new filing + its lines. */
  async generate(input: GenerateInput) {
    const { orgId, userId } = requireTenantContext();
    const cfg = KIND[input.kind];
    if (!cfg) throw new BadRequestException(`Unknown filing kind: ${input.kind}`);
    const start = parseDate(input.periodStart);
    const end = parseDate(input.periodEnd);
    if (end < start) throw new BadRequestException("periodEnd must be on or after periodStart.");

    // Records whose period falls inside the filing window, and that are finalized.
    const periods = await this.prisma.payrollPeriod.findMany({
      where: { orgId, periodStart: { gte: start }, periodEnd: { lte: end } },
      select: { id: true },
    });
    const periodIds = periods.map((p) => p.id);
    const records = periodIds.length
      ? await this.prisma.payrollRecord.findMany({
          where: { orgId, periodId: { in: periodIds }, status: { in: ["APPROVED", "PAID"] } },
          include: { components: true },
        })
      : [];

    // Aggregate per employee (a quarter/year rolls several periods together).
    const byEmp = new Map<string, { wageBase: Prisma.Decimal; employeeAmt: Prisma.Decimal; employerAmt: Prisma.Decimal; taxAmt: Prisma.Decimal }>();
    for (const rec of records) {
      const agg = byEmp.get(rec.employeeId) ?? { wageBase: ZERO, employeeAmt: ZERO, employerAmt: ZERO, taxAmt: ZERO };
      if (cfg.tax) {
        agg.taxAmt = agg.taxAmt.plus(D(rec.taxDeduction));
        agg.wageBase = agg.wageBase.plus(D(rec.taxableIncome));
      } else {
        const ee = rec.components.find((c) => c.code === cfg.eeCode);
        const er = cfg.erCode ? rec.components.find((c) => c.code === cfg.erCode) : null;
        if (ee) {
          agg.employeeAmt = agg.employeeAmt.plus(D(ee.amount));
          const base = (ee.inputs as { base?: number } | null)?.base;
          agg.wageBase = agg.wageBase.plus(base != null ? D(base) : D(ee.amount));
        }
        if (er) agg.employerAmt = agg.employerAmt.plus(D(er.amount));
      }
      byEmp.set(rec.employeeId, agg);
    }

    // Keep only employees this return actually covers (a non-zero relevant amount).
    const entries = [...byEmp.entries()].filter(([, a]) => (cfg.tax ? a.taxAmt : a.employeeAmt).greaterThan(0));

    let totalWages = ZERO, totalEmployee = ZERO, totalEmployer = ZERO, totalTax = ZERO;
    for (const [, a] of entries) {
      totalWages = totalWages.plus(a.wageBase);
      totalEmployee = totalEmployee.plus(a.employeeAmt);
      totalEmployer = totalEmployer.plus(a.employerAmt);
      totalTax = totalTax.plus(a.taxAmt);
    }

    const filing = await this.prisma.$transaction(async (tx) => {
      const f = await tx.payrollFiling.create({
        data: {
          orgId, kind: input.kind, countryCode: (input.countryCode ?? "IN").toUpperCase(),
          periodStart: start, periodEnd: end, periodLabel: input.periodLabel ?? input.periodStart.slice(0, 7),
          status: "PREPARED", employeeCount: entries.length,
          totalWages: money(totalWages), totalEmployee: money(totalEmployee), totalEmployer: money(totalEmployer), totalTax: money(totalTax),
          generatedBy: userId,
        },
      });
      if (entries.length) {
        await tx.payrollFilingLine.createMany({
          data: entries.map(([employeeId, a]) => ({
            orgId, filingId: f.id, employeeId,
            wageBase: money(a.wageBase), employeeAmt: money(a.employeeAmt), employerAmt: money(a.employerAmt), taxAmt: money(a.taxAmt),
          })),
        });
      }
      return f;
    });

    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollFiling", resourceId: filing.id, action: "payroll.filing.prepare", after: { kind: input.kind, employees: entries.length } });
    return this.get(filing.id);
  }

  /** Approve a prepared filing (SoD: the generator cannot approve). */
  async approve(id: string) {
    const { orgId, userId } = requireTenantContext();
    const f = await this.load(orgId, id);
    if (!["PREPARED", "REVIEWED"].includes(f.status)) throw new ConflictException(`A ${f.status} filing cannot be approved.`);
    if (f.generatedBy && f.generatedBy === userId) throw new ForbiddenException("The person who generated a filing cannot approve it.");
    await this.prisma.payrollFiling.update({ where: { id }, data: { status: "APPROVED", approvedBy: userId } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollFiling", resourceId: id, action: "payroll.filing.approve" });
    return this.get(id);
  }

  /** Mark an approved filing as submitted to the statutory portal. */
  async submit(id: string, input: { reference?: string } = {}) {
    const { orgId, userId } = requireTenantContext();
    const f = await this.load(orgId, id);
    if (f.status !== "APPROVED") throw new ConflictException("Only an approved filing can be submitted.");
    await this.prisma.payrollFiling.update({ where: { id }, data: { status: "SUBMITTED", submittedBy: userId, submittedAt: new Date(), reference: input.reference ?? null } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollFiling", resourceId: id, action: "payroll.filing.submit", after: { reference: input.reference ?? null } });
    return this.get(id);
  }

  async reject(id: string, input: { reason?: string } = {}) {
    const { orgId, userId } = requireTenantContext();
    const f = await this.load(orgId, id);
    if (["SUBMITTED", "FILED"].includes(f.status)) throw new ConflictException(`A ${f.status} filing cannot be rejected.`);
    await this.prisma.payrollFiling.update({ where: { id }, data: { status: "REJECTED", notes: input.reason ?? null } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollFiling", resourceId: id, action: "payroll.filing.review", after: { status: "REJECTED", reason: input.reason ?? null } });
    return this.get(id);
  }

  /** A CSV of the filing's per-employee lines. Layout is best-effort — verify against the portal spec. */
  async exportCsv(id: string): Promise<{ filename: string; body: string }> {
    const f = await this.get(id);
    const rows = [
      ["employeeId", "wageBase", "employeeAmount", "employerAmount", "tax"].join(","),
      ...f.lines.map((l) => [l.employeeId, l.wageBase, l.employeeAmt, l.employerAmt, l.taxAmt].join(",")),
      ["TOTAL", f.totalWages, f.totalEmployee, f.totalEmployer, f.totalTax].join(","),
    ];
    return { filename: `${f.kind}_${f.periodLabel}.csv`, body: rows.join("\n") };
  }

  private async load(orgId: string, id: string) {
    const f = await this.prisma.payrollFiling.findFirst({ where: { id, orgId }, select: { id: true, status: true, generatedBy: true } });
    if (!f) throw new NotFoundException("Filing not found.");
    return f;
  }

  private serialize(f: { id: string; kind: string; countryCode: string; periodLabel: string; periodStart: Date; periodEnd: Date; status: string; employeeCount: number; totalWages: Prisma.Decimal; totalEmployee: Prisma.Decimal; totalEmployer: Prisma.Decimal; totalTax: Prisma.Decimal; reference: string | null; notes: string | null; generatedAt: Date; submittedAt: Date | null }, lineCount?: number) {
    return {
      id: f.id, kind: f.kind, label: KIND[f.kind as FilingKind]?.label ?? f.kind, countryCode: f.countryCode,
      periodLabel: f.periodLabel, periodStart: f.periodStart.toISOString().slice(0, 10), periodEnd: f.periodEnd.toISOString().slice(0, 10),
      status: f.status, employeeCount: f.employeeCount, lineCount,
      totalWages: Number(f.totalWages), totalEmployee: Number(f.totalEmployee), totalEmployer: Number(f.totalEmployer), totalTax: Number(f.totalTax),
      reference: f.reference, notes: f.notes, generatedAt: f.generatedAt.toISOString(), submittedAt: f.submittedAt?.toISOString() ?? null,
    };
  }
}
