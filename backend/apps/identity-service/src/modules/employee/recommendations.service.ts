import { Injectable, NotFoundException } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { AttendanceInsightsService } from "../attendance/attendance-insights.service.js";

type RecKind = "PROMOTION_READINESS" | "SKILL_GAP" | "CERTIFICATION_RENEWAL" | "RETENTION_RISK" | "CONFIRMATION_DUE";
interface Recommendation {
  kind: RecKind;
  signal: string; // the evidence behind it (plain language)
  suggestion: string; // what a human should consider
  confidence: "LOW" | "MEDIUM" | "HIGH";
  /** ALWAYS human review — AI never performs a sensitive HR action itself. */
  actionRequired: "HUMAN_REVIEW";
}

const PROMOTION_MIN_MONTHS = 12; // months in role before a promotion is even suggested
const MS_PER_MONTH = 30 * 86_400_000;

/**
 * Per-employee HR recommendations — deterministic, read-only intelligence derived
 * from data the org already has (attendance health, skills, certifications, career
 * timeline, probation). Every recommendation is advisory: it surfaces a signal and
 * suggests a human review, and its actionRequired is always HUMAN_REVIEW. The AI
 * NEVER promotes, confirms, or exits anyone — those go through the existing
 * approval workflows. Nothing here writes to the employee.
 */
@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
    private readonly attendanceInsights: AttendanceInsightsService,
  ) {}

  private async assertEmployee(orgId: string, employeeId: string) {
    const ctx = requireTenantContext();
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permissions.employeeRead);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  async forEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId);

    const [emp, skills, verifiedSkills, certs, lastPromotion, probation, scores] = await Promise.all([
      this.prisma.employee.findUnique({ where: { id: employeeId }, select: { joinedAt: true, lifecycleStage: true, probationEndsAt: true, status: true } }),
      this.prisma.employeeSkill.count({ where: { orgId: ctx.orgId, employeeId } }),
      this.prisma.employeeSkill.count({ where: { orgId: ctx.orgId, employeeId, verification: "VERIFIED" } }),
      this.prisma.employeeCertification.findMany({ where: { orgId: ctx.orgId, employeeId, expiresAt: { not: null } }, select: { name: true, expiresAt: true } }),
      this.prisma.employeeCareerHistory.findFirst({ where: { orgId: ctx.orgId, employeeId, changeType: "PROMOTION" }, orderBy: { effectiveFrom: "desc" }, select: { effectiveFrom: true } }),
      this.prisma.probationRecord.findFirst({ where: { orgId: ctx.orgId, employeeId, status: { in: ["ACTIVE", "EXTENDED"] } }, select: { endDate: true } }),
      this.attendanceInsights.attendanceScores(3).catch(() => null),
    ]);
    if (!emp) throw new NotFoundException("Employee not found.");

    const recs: Recommendation[] = [];
    const now = Date.now();
    const scoreRow = scores?.rows.find((r) => r.employeeId === employeeId) ?? null;

    // 1) Promotion readiness — good attendance health + enough tenure in role + skills.
    if (emp.lifecycleStage === "CONFIRMED" && emp.status === "ACTIVE" && scoreRow?.hasData) {
      const sinceRole = lastPromotion?.effectiveFrom ? now - lastPromotion.effectiveFrom.getTime() : emp.joinedAt ? now - emp.joinedAt.getTime() : 0;
      const monthsInRole = Math.floor(sinceRole / MS_PER_MONTH);
      if (monthsInRole >= PROMOTION_MIN_MONTHS && scoreRow.score >= 80 && verifiedSkills >= 3) {
        recs.push({
          kind: "PROMOTION_READINESS",
          signal: `${monthsInRole} months in role, attendance health ${scoreRow.score}/100, ${verifiedSkills} verified skills.`,
          suggestion: "Appears ready for a promotion review. Start a promotion request if you agree.",
          confidence: scoreRow.score >= 90 ? "HIGH" : "MEDIUM",
          actionRequired: "HUMAN_REVIEW",
        });
      }
    }

    // 2) Skill gap — few or unverified skills recorded.
    if (skills === 0) {
      recs.push({ kind: "SKILL_GAP", signal: "No skills recorded.", suggestion: "Capture this person's skills so gaps and growth can be tracked.", confidence: "MEDIUM", actionRequired: "HUMAN_REVIEW" });
    } else if (verifiedSkills === 0 && skills > 0) {
      recs.push({ kind: "SKILL_GAP", signal: `${skills} skill(s) recorded, none verified.`, suggestion: "Verify the recorded skills so proficiency data is trustworthy.", confidence: "LOW", actionRequired: "HUMAN_REVIEW" });
    }

    // 3) Certification renewal — anything expiring within 60 days or already expired.
    const soon = certs.filter((c) => c.expiresAt && c.expiresAt.getTime() - now <= 60 * 86_400_000);
    if (soon.length > 0) {
      const names = soon.map((c) => c.name).slice(0, 3).join(", ");
      recs.push({ kind: "CERTIFICATION_RENEWAL", signal: `${soon.length} certification(s) expiring soon or expired: ${names}.`, suggestion: "Prompt the employee to renew before lapse.", confidence: "HIGH", actionRequired: "HUMAN_REVIEW" });
    }

    // 4) Retention risk — poor attendance health / high risk band.
    if (scoreRow && (scoreRow.risk === "high" || scoreRow.risk === "critical")) {
      recs.push({ kind: "RETENTION_RISK", signal: `Attendance risk is ${scoreRow.risk} (${scoreRow.reason ?? "declining engagement"}).`, suggestion: "Consider a check-in — this can be an early disengagement signal.", confidence: scoreRow.risk === "critical" ? "HIGH" : "MEDIUM", actionRequired: "HUMAN_REVIEW" });
    }

    // 5) Confirmation due — probation ending within 30 days.
    if (probation?.endDate) {
      const daysLeft = Math.round((probation.endDate.getTime() - now) / 86_400_000);
      if (daysLeft <= 30) {
        recs.push({ kind: "CONFIRMATION_DUE", signal: `Probation ends in ${daysLeft} day(s).`, suggestion: "Run the probation review to confirm, extend, or decide next steps.", confidence: "HIGH", actionRequired: "HUMAN_REVIEW" });
      }
    }

    return {
      employeeId,
      generatedAt: new Date().toISOString(),
      disclaimer: "AI-derived suggestions. No action is taken automatically — every item needs human review through the normal workflow.",
      recommendations: recs,
    };
  }
}
