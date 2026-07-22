import { Injectable } from "@nestjs/common";
import { requireTenantContext } from "../context/request-context.store.js";
import { PrismaService } from "../database/prisma.service.js";
import { DEFAULT_PRODUCTIVITY_RULES, type ProductivityRules } from "./classify.js";

export interface UpdateProductivityRulesInput {
  productiveApps?: string[];
  productiveDomains?: string[];
  distractingApps?: string[];
  distractingDomains?: string[];
}

@Injectable()
export class ProductivitySettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Effective rules for an org — the stored row, or the platform defaults if none. */
  async getRules(orgId: string): Promise<ProductivityRules> {
    const row = await this.prisma.productivitySetting.findUnique({ where: { orgId } });
    if (!row) return DEFAULT_PRODUCTIVITY_RULES;
    return {
      productiveApps: row.productiveApps,
      productiveDomains: row.productiveDomains,
      distractingApps: row.distractingApps,
      distractingDomains: row.distractingDomains,
    };
  }

  /** For the admin UI — always returns a concrete rule set (defaults when unset). */
  async getSettings() {
    const ctx = requireTenantContext();
    const rules = await this.getRules(ctx.orgId);
    const row = await this.prisma.productivitySetting.findUnique({ where: { orgId: ctx.orgId }, select: { updatedAt: true } });
    return { ...rules, customized: Boolean(row), updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null };
  }

  async updateSettings(input: UpdateProductivityRulesInput) {
    const ctx = requireTenantContext();
    const current = await this.getRules(ctx.orgId);
    const clean = (v: string[] | undefined, fallback: string[]) =>
      (v ?? fallback).map((s) => s.trim().toLowerCase()).filter(Boolean);
    const data = {
      productiveApps: clean(input.productiveApps, current.productiveApps),
      productiveDomains: clean(input.productiveDomains, current.productiveDomains),
      distractingApps: clean(input.distractingApps, current.distractingApps),
      distractingDomains: clean(input.distractingDomains, current.distractingDomains),
    };
    await this.prisma.productivitySetting.upsert({
      where: { orgId: ctx.orgId },
      create: { orgId: ctx.orgId, ...data },
      update: data,
    });
    return this.getSettings();
  }
}
