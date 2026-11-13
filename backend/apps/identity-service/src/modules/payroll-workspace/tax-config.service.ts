import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

const D = (v: number) => new Prisma.Decimal(v);
const parseDate = (s: string) => new Date(`${s}T00:00:00.000Z`);

export interface CreateRuleSetInput {
  countryCode: string;
  regime?: string;
  taxYear: string;
  name: string;
  currencyCode?: string;
  standardDeduction?: number;
  fiscalYearStartMonth?: number;
  rebateLimit?: number | null;
  rebateMaxAmount?: number | null;
  surchargePercent?: number;
  cessPercent?: number;
  effectiveFrom: string;
  source?: string | null;
  slabs: { lowerBound: number; upperBound?: number | null; ratePercent: number }[];
}

export interface CreateStatutoryInput {
  countryCode: string;
  kind: string;
  name: string;
  employeeRate?: number;
  employerRate?: number;
  wageCeiling?: number | null;
  applicableUpto?: number | null;
  flatAmount?: number | null;
  baseComponents?: string[];
  effectiveFrom: string;
  source?: string | null;
}

/**
 * Admin configuration for the tax/statutory engine (§13/§38.11). Slabs and rates
 * are DATA, entered here by an authorised admin (never invented by the engine).
 * Rule sets and statutory rules are effective-dated + versioned: editing "rates"
 * means opening a NEW version, so historical payroll stays reproducible. Org rows
 * (orgId set) override the platform-global pack (orgId null). Reads may return the
 * global pack; writes are always org-scoped unless done by the platform.
 */
@Injectable()
export class TaxConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- Org opt-in for the tax/statutory flow (owner setting) ----
  async getSettings() {
    const { orgId } = requireTenantContext();
    const s = await this.prisma.payrollSetting.findUnique({ where: { orgId }, select: { taxEnabled: true } });
    return { taxEnabled: s?.taxEnabled ?? false };
  }

  async setTaxEnabled(enabled: boolean) {
    const { orgId, userId } = requireTenantContext();
    await this.prisma.payrollSetting.upsert({
      where: { orgId },
      create: { orgId, taxEnabled: enabled },
      update: { taxEnabled: enabled },
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "PayrollSetting", resourceId: orgId, action: "payroll.tax.configure", after: { taxEnabled: enabled } });
    return { taxEnabled: enabled };
  }

  // ---- Income-tax rule sets ----
  async listRuleSets(opts?: { countryCode?: string; regime?: string; includeGlobal?: boolean }) {
    const { orgId } = requireTenantContext();
    const orgFilter = opts?.includeGlobal === false ? { orgId } : { OR: [{ orgId }, { orgId: null }] };
    return this.prisma.taxRuleSet.findMany({
      where: { ...orgFilter, ...(opts?.countryCode ? { countryCode: opts.countryCode.toUpperCase() } : {}), ...(opts?.regime ? { regime: opts.regime } : {}) },
      orderBy: [{ countryCode: "asc" }, { effectiveFrom: "desc" }, { version: "desc" }],
      include: { slabs: { orderBy: { seq: "asc" } } },
    });
  }

  async createRuleSet(input: CreateRuleSetInput) {
    const { orgId, userId } = requireTenantContext();
    if (!input.slabs?.length) throw new BadRequestException("At least one tax slab is required.");
    const effectiveFrom = parseDate(input.effectiveFrom);
    const latest = await this.prisma.taxRuleSet.findFirst({
      where: { orgId, countryCode: input.countryCode.toUpperCase(), regime: input.regime ?? "DEFAULT" },
      orderBy: { version: "desc" },
      select: { version: true, id: true, effectiveTo: true, effectiveFrom: true },
    });
    const version = (latest?.version ?? 0) + 1;

    const created = await this.prisma.$transaction(async (tx) => {
      // Close the currently-open version so windows never overlap.
      if (latest && latest.effectiveTo === null) {
        const close = new Date(effectiveFrom.getTime() - 86_400_000);
        await tx.taxRuleSet.update({ where: { id: latest.id }, data: { effectiveTo: close < latest.effectiveFrom ? latest.effectiveFrom : close } });
      }
      const rs = await tx.taxRuleSet.create({
        data: {
          orgId, countryCode: input.countryCode.toUpperCase(), regime: input.regime ?? "DEFAULT", taxYear: input.taxYear,
          name: input.name, currencyCode: (input.currencyCode ?? "INR").toUpperCase(),
          standardDeduction: D(input.standardDeduction ?? 0),
          fiscalYearStartMonth: input.fiscalYearStartMonth ?? 4,
          rebateLimit: input.rebateLimit != null ? D(input.rebateLimit) : null,
          rebateMaxAmount: input.rebateMaxAmount != null ? D(input.rebateMaxAmount) : null,
          surchargePercent: D(input.surchargePercent ?? 0), cessPercent: D(input.cessPercent ?? 0),
          effectiveFrom, version, status: "ACTIVE", source: input.source ?? null, createdBy: userId,
        },
      });
      await tx.taxSlab.createMany({
        data: input.slabs.map((s, i) => ({ ruleSetId: rs.id, seq: i + 1, lowerBound: D(s.lowerBound), upperBound: s.upperBound != null ? D(s.upperBound) : null, ratePercent: D(s.ratePercent) })),
      });
      return rs;
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "TaxRuleSet", resourceId: created.id, action: "payroll.tax.configure", after: { countryCode: created.countryCode, regime: created.regime, version } });
    return this.prisma.taxRuleSet.findUnique({ where: { id: created.id }, include: { slabs: { orderBy: { seq: "asc" } } } });
  }

  async archiveRuleSet(id: string) {
    const { orgId, userId } = requireTenantContext();
    const rs = await this.prisma.taxRuleSet.findFirst({ where: { id, orgId }, select: { id: true } });
    if (!rs) throw new NotFoundException("Tax rule set not found (or it's a platform-global pack you can't edit).");
    await this.prisma.taxRuleSet.update({ where: { id }, data: { status: "ARCHIVED" } });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "TaxRuleSet", resourceId: id, action: "payroll.tax.configure", after: { status: "ARCHIVED" } });
    return { id };
  }

  // ---- Statutory rules ----
  async listStatutory(opts?: { countryCode?: string }) {
    const { orgId } = requireTenantContext();
    return this.prisma.statutoryRule.findMany({
      where: { OR: [{ orgId }, { orgId: null }], ...(opts?.countryCode ? { countryCode: opts.countryCode.toUpperCase() } : {}) },
      orderBy: [{ countryCode: "asc" }, { kind: "asc" }, { effectiveFrom: "desc" }, { version: "desc" }],
    });
  }

  async createStatutory(input: CreateStatutoryInput) {
    const { orgId, userId } = requireTenantContext();
    const latest = await this.prisma.statutoryRule.findFirst({
      where: { orgId, countryCode: input.countryCode.toUpperCase(), kind: input.kind.toUpperCase() },
      orderBy: { version: "desc" }, select: { version: true, id: true, effectiveTo: true, effectiveFrom: true },
    });
    const version = (latest?.version ?? 0) + 1;
    const effectiveFrom = parseDate(input.effectiveFrom);
    const created = await this.prisma.$transaction(async (tx) => {
      if (latest && latest.effectiveTo === null) {
        const close = new Date(effectiveFrom.getTime() - 86_400_000);
        await tx.statutoryRule.update({ where: { id: latest.id }, data: { effectiveTo: close < latest.effectiveFrom ? latest.effectiveFrom : close } });
      }
      return tx.statutoryRule.create({
        data: {
          orgId, countryCode: input.countryCode.toUpperCase(), kind: input.kind.toUpperCase(), name: input.name,
          employeeRate: D(input.employeeRate ?? 0), employerRate: D(input.employerRate ?? 0),
          wageCeiling: input.wageCeiling != null ? D(input.wageCeiling) : null,
          applicableUpto: input.applicableUpto != null ? D(input.applicableUpto) : null,
          flatAmount: input.flatAmount != null ? D(input.flatAmount) : null,
          baseComponents: input.baseComponents ?? [], effectiveFrom, version, status: "ACTIVE", source: input.source ?? null, createdBy: userId,
        },
      });
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "StatutoryRule", resourceId: created.id, action: "payroll.statutory.configure", after: { kind: created.kind, version } });
    return created;
  }

  // ---- Per-employee declaration (regime + exemptions) ----
  async getDeclaration(employeeId: string, taxYear: string) {
    const { orgId } = requireTenantContext();
    return this.prisma.employeeTaxProfile.findUnique({ where: { orgId_employeeId_taxYear: { orgId, employeeId, taxYear } } });
  }

  async upsertDeclaration(input: { employeeId: string; taxYear: string; regime?: string; exemptions?: number; metadata?: unknown }) {
    const { orgId, userId } = requireTenantContext();
    const emp = await this.prisma.employee.findFirst({ where: { orgId, id: input.employeeId }, select: { id: true } });
    if (!emp) throw new NotFoundException("Employee not found.");
    const metadata = (input.metadata == null ? Prisma.JsonNull : input.metadata) as Prisma.InputJsonValue;
    const row = await this.prisma.employeeTaxProfile.upsert({
      where: { orgId_employeeId_taxYear: { orgId, employeeId: input.employeeId, taxYear: input.taxYear } },
      create: { orgId, employeeId: input.employeeId, taxYear: input.taxYear, regime: input.regime ?? "DEFAULT", exemptions: D(input.exemptions ?? 0), metadata, createdBy: userId },
      update: { regime: input.regime ?? "DEFAULT", exemptions: D(input.exemptions ?? 0), metadata },
    });
    await this.audit.record({ orgId, actorUserId: userId, resourceType: "EmployeeTaxProfile", resourceId: row.id, action: "payroll.tax.configure", after: { employeeId: input.employeeId, taxYear: input.taxYear, regime: row.regime } });
    return row;
  }
}
