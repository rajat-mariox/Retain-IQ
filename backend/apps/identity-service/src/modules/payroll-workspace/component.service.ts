import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@retainiq/database/identity";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AuditService } from "../../common/audit/audit.service.js";

/** Parse a "YYYY-MM-DD" calendar date into a UTC-midnight Date (a @db.Date column). */
function parseDate(value: string): Date {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`Invalid date: ${value}`);
  return d;
}

function dayBefore(d: Date): Date {
  return new Date(d.getTime() - 24 * 60 * 60 * 1000);
}

const ALLOWED_FUNCTIONS = new Set(["MIN", "MAX", "ROUND"]);
// Only identifiers, decimals, arithmetic operators, parentheses, commas, whitespace.
const SAFE_FORMULA_CHARS = /^[A-Za-z0-9_+\-*/(),.\s]+$/;

/**
 * Validate a FORMULA component's expression is a SAFE restricted expression — no
 * arbitrary code (§10). Allows variable identifiers, numeric literals, the
 * arithmetic operators + - * /, parentheses/commas, and only the MIN/MAX/ROUND
 * functions. Anything else (member access, assignment, other calls, brackets,
 * quotes) is rejected so a component config can never smuggle in executable code.
 */
export function assertSafeFormula(expression: unknown): string {
  if (typeof expression !== "string" || expression.trim() === "") {
    throw new BadRequestException("A FORMULA component requires a non-empty 'expression' string in config.");
  }
  const expr = expression.trim();
  if (expr.length > 500) throw new BadRequestException("Formula expression is too long (max 500 chars).");
  if (!SAFE_FORMULA_CHARS.test(expr)) throw new BadRequestException("Formula contains unsupported characters.");

  // Every identifier immediately followed by "(" is a function call — restrict to the allowlist.
  const callMatches = expr.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*\(/g);
  for (const m of callMatches) {
    const fn = m[1] ?? "";
    if (!ALLOWED_FUNCTIONS.has(fn)) {
      throw new BadRequestException(`Formula may only call MIN, MAX, or ROUND — found '${fn}('.`);
    }
  }

  // Balanced parentheses.
  let depth = 0;
  for (const ch of expr) {
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth < 0) throw new BadRequestException("Formula has unbalanced parentheses.");
    }
  }
  if (depth !== 0) throw new BadRequestException("Formula has unbalanced parentheses.");

  return expr;
}

export type ComponentDirectionInput = "EARNING" | "DEDUCTION";
export type ComponentCalcTypeInput = "FIXED" | "PERCENTAGE" | "FORMULA" | "INPUT_BASED" | "PER_UNIT";

export interface ComponentVersionFields {
  category: string;
  direction: ComponentDirectionInput;
  calcType: ComponentCalcTypeInput;
  config?: unknown;
  countryCode?: string | null;
  legalEntityId?: string | null;
  currencyCode?: string | null;
  taxable?: boolean;
  statutory?: boolean;
  employerPaid?: boolean;
  proratable?: boolean;
  minAmount?: number | null;
  maxAmount?: number | null;
  rounding?: string;
  payslipVisible?: boolean;
  effectiveFrom: string; // YYYY-MM-DD
  status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
}

export interface CreateComponentInput extends ComponentVersionFields {
  code: string;
  name: string;
}

/**
 * Earning/deduction components (§10). A component is config-driven data, never
 * hard-coded: each PayrollComponentVersion carries its calc type + config and is
 * effective-dated so past runs stay reproducible. FORMULA configs are validated
 * against a safe restricted grammar (no arbitrary code). Tenant-isolated on orgId.
 */
@Injectable()
export class PayrollComponentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listComponents(opts?: { includeArchived?: boolean }) {
    const { orgId } = requireTenantContext();
    const components = await this.prisma.payrollComponent.findMany({
      where: { orgId, ...(opts?.includeArchived ? {} : { archived: false }) },
      orderBy: { code: "asc" },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    return components.map((c) => ({
      id: c.id,
      code: c.code,
      name: c.name,
      archived: c.archived,
      latestVersion: c.versions[0] ? this.serializeVersion(c.versions[0]) : null,
      createdAt: c.createdAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
    }));
  }

  async getComponent(id: string) {
    const { orgId } = requireTenantContext();
    const component = await this.prisma.payrollComponent.findFirst({
      where: { orgId, id },
      include: { versions: { orderBy: { version: "desc" } } },
    });
    if (!component) throw new NotFoundException("Payroll component not found.");
    return {
      id: component.id,
      code: component.code,
      name: component.name,
      archived: component.archived,
      versions: component.versions.map((v) => this.serializeVersion(v)),
      createdAt: component.createdAt.toISOString(),
      updatedAt: component.updatedAt.toISOString(),
    };
  }

  /** Create a component and its first (version 1) definition. */
  async createComponent(input: CreateComponentInput) {
    const { orgId, userId } = requireTenantContext();
    const code = input.code.trim().toUpperCase();
    if (!code) throw new BadRequestException("Component code is required.");

    const config = this.validateConfig(input.calcType, input.config);
    const effectiveFrom = parseDate(input.effectiveFrom);

    const existing = await this.prisma.payrollComponent.findUnique({ where: { orgId_code: { orgId, code } } });
    if (existing) throw new BadRequestException(`A component with code '${code}' already exists.`);

    const created = await this.prisma.$transaction(async (tx) => {
      const component = await tx.payrollComponent.create({ data: { orgId, code, name: input.name.trim() } });
      const version = await tx.payrollComponentVersion.create({
        data: this.buildVersionData(orgId, component.id, 1, input, config, effectiveFrom),
      });
      return { component, version };
    });

    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollComponent",
      resourceId: created.component.id,
      action: "payroll.component.create",
      after: { code, name: input.name, versionId: created.version.id },
    });
    return {
      id: created.component.id,
      code: created.component.code,
      name: created.component.name,
      archived: created.component.archived,
      latestVersion: this.serializeVersion(created.version),
    };
  }

  /** Add the next effective-dated version to an existing component, closing the prior one. */
  async addVersion(componentId: string, input: ComponentVersionFields) {
    const { orgId, userId } = requireTenantContext();
    const component = await this.prisma.payrollComponent.findFirst({ where: { orgId, id: componentId } });
    if (!component) throw new NotFoundException("Payroll component not found.");

    const config = this.validateConfig(input.calcType, input.config);
    const effectiveFrom = parseDate(input.effectiveFrom);

    const version = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.payrollComponentVersion.findFirst({
        where: { orgId, componentId },
        orderBy: { version: "desc" },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      if (latest && latest.effectiveTo === null) {
        const close = dayBefore(effectiveFrom);
        await tx.payrollComponentVersion.update({
          where: { id: latest.id },
          data: { effectiveTo: close < latest.effectiveFrom ? latest.effectiveFrom : close },
        });
      }
      return tx.payrollComponentVersion.create({
        data: this.buildVersionData(orgId, componentId, nextVersion, input, config, effectiveFrom),
      });
    });

    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollComponentVersion",
      resourceId: version.id,
      action: "payroll.component.version.create",
      after: { componentId, version: version.version, calcType: version.calcType },
    });
    return this.serializeVersion(version);
  }

  async archiveComponent(id: string) {
    const { orgId, userId } = requireTenantContext();
    const component = await this.prisma.payrollComponent.findFirst({ where: { orgId, id } });
    if (!component) throw new NotFoundException("Payroll component not found.");
    if (component.archived) return { id: component.id, archived: true };

    const updated = await this.prisma.payrollComponent.update({ where: { id: component.id }, data: { archived: true } });
    await this.audit.record({
      orgId,
      actorUserId: userId,
      resourceType: "PayrollComponent",
      resourceId: updated.id,
      action: "payroll.component.archive",
      before: { archived: false },
      after: { archived: true },
    });
    return { id: updated.id, archived: updated.archived };
  }

  // ---- Helpers ----

  /** FORMULA configs must carry a safe 'expression'; other calc types pass through. */
  private validateConfig(calcType: ComponentCalcTypeInput, config?: unknown): Prisma.InputJsonValue {
    const base: Record<string, unknown> =
      config && typeof config === "object" && !Array.isArray(config) ? { ...(config as Record<string, unknown>) } : {};
    if (calcType === "FORMULA") {
      base.expression = assertSafeFormula(base.expression);
    }
    return base as Prisma.InputJsonValue;
  }

  private buildVersionData(
    orgId: string,
    componentId: string,
    version: number,
    input: ComponentVersionFields,
    config: Prisma.InputJsonValue,
    effectiveFrom: Date,
  ): Prisma.PayrollComponentVersionUncheckedCreateInput {
    return {
      orgId,
      componentId,
      version,
      category: input.category.trim(),
      direction: input.direction,
      calcType: input.calcType,
      config,
      countryCode: input.countryCode?.trim() || null,
      legalEntityId: input.legalEntityId ?? null,
      currencyCode: input.currencyCode?.trim().toUpperCase() || null,
      taxable: input.taxable ?? true,
      statutory: input.statutory ?? false,
      employerPaid: input.employerPaid ?? false,
      proratable: input.proratable ?? true,
      minAmount: input.minAmount != null ? new Prisma.Decimal(input.minAmount) : null,
      maxAmount: input.maxAmount != null ? new Prisma.Decimal(input.maxAmount) : null,
      rounding: input.rounding ?? "HALF_UP",
      payslipVisible: input.payslipVisible ?? true,
      effectiveFrom,
      status: input.status ?? "ACTIVE",
    };
  }

  private serializeVersion(v: {
    id: string;
    componentId: string;
    version: number;
    category: string;
    direction: string;
    calcType: string;
    config: Prisma.JsonValue;
    countryCode: string | null;
    legalEntityId: string | null;
    currencyCode: string | null;
    taxable: boolean;
    statutory: boolean;
    employerPaid: boolean;
    proratable: boolean;
    minAmount: Prisma.Decimal | null;
    maxAmount: Prisma.Decimal | null;
    rounding: string;
    payslipVisible: boolean;
    effectiveFrom: Date;
    effectiveTo: Date | null;
    status: string;
    createdAt: Date;
  }) {
    return {
      id: v.id,
      componentId: v.componentId,
      version: v.version,
      category: v.category,
      direction: v.direction,
      calcType: v.calcType,
      config: v.config,
      countryCode: v.countryCode,
      legalEntityId: v.legalEntityId,
      currencyCode: v.currencyCode,
      taxable: v.taxable,
      statutory: v.statutory,
      employerPaid: v.employerPaid,
      proratable: v.proratable,
      minAmount: v.minAmount != null ? Number(v.minAmount) : null,
      maxAmount: v.maxAmount != null ? Number(v.maxAmount) : null,
      rounding: v.rounding,
      payslipVisible: v.payslipVisible,
      effectiveFrom: v.effectiveFrom.toISOString().slice(0, 10),
      effectiveTo: v.effectiveTo ? v.effectiveTo.toISOString().slice(0, 10) : null,
      status: v.status,
      createdAt: v.createdAt.toISOString(),
    };
  }
}
