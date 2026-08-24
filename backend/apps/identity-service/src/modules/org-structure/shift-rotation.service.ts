import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

/** One step of a rotation: hold `shiftId` for `days` days before advancing. */
export interface RotationStep {
  shiftId: string;
  days: number;
}

const DAY_MS = 86_400_000;

/**
 * Rotating shift schedules. A rotation is an ordered list of steps that repeats
 * on a fixed cycle from an anchor date; the shift in effect on any given day is
 * derived deterministically, so past and future days resolve reproducibly with
 * no per-day rows.
 */
@Injectable()
export class ShiftRotationService {
  constructor(private readonly prisma: PrismaService) {}

  /** The shift that applies on `day` for a rotation whose anchor + steps are known. Pure. */
  static shiftIdOn(anchorDate: Date, steps: RotationStep[], day: Date): string | null {
    const valid = steps.filter((s) => s.shiftId && s.days > 0);
    const cycleDays = valid.reduce((sum, s) => sum + s.days, 0);
    if (cycleDays <= 0) return null;

    // Whole days between the anchor and the target (calendar-date arithmetic; both
    // are stored as @db.Date, i.e. UTC-midnight instants).
    const diffDays = Math.floor((day.getTime() - anchorDate.getTime()) / DAY_MS);
    const offset = ((diffDays % cycleDays) + cycleDays) % cycleDays; // handle dates before the anchor

    let acc = 0;
    for (const step of valid) {
      acc += step.days;
      if (offset < acc) return step.shiftId;
    }
    return valid[valid.length - 1]?.shiftId ?? null; // unreachable given the modulo
  }

  /** Resolve the active shiftId for an employee's rotation on a day (or null). */
  async resolveShiftId(rotationId: string, day: Date): Promise<string | null> {
    const rot = await this.prisma.shiftRotation.findUnique({
      where: { id: rotationId },
      select: { anchorDate: true, steps: true, status: true },
    });
    if (!rot || rot.status !== "ACTIVE") return null;
    return ShiftRotationService.shiftIdOn(rot.anchorDate, (rot.steps as unknown as RotationStep[]) ?? [], day);
  }

  // ---- CRUD ---------------------------------------------------------------

  async list() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.shiftRotation.findMany({
      where: { orgId: ctx.orgId, status: { not: "ARCHIVED" } },
      orderBy: { createdAt: "asc" },
    });
    const counts = await this.prisma.employee.groupBy({
      by: ["rotationId"],
      where: { orgId: ctx.orgId, rotationId: { not: null } },
      _count: { _all: true },
    });
    const countByRotation = new Map(counts.map((c) => [c.rotationId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      anchorDate: r.anchorDate.toISOString().slice(0, 10),
      steps: (r.steps as unknown as RotationStep[]) ?? [],
      status: r.status,
      employeeCount: countByRotation.get(r.id) ?? 0,
    }));
  }

  private async validateSteps(orgId: string, steps: RotationStep[]) {
    if (!Array.isArray(steps) || steps.length < 2) {
      throw new BadRequestException("A rotation needs at least two steps.");
    }
    const shiftIds = [...new Set(steps.map((s) => s.shiftId))];
    const found = await this.prisma.shift.findMany({ where: { id: { in: shiftIds }, orgId, status: "ACTIVE" }, select: { id: true } });
    if (found.length !== shiftIds.length) throw new BadRequestException("A step references a shift that doesn't exist in your org.");
  }

  async create(input: { name: string; anchorDate: string; steps: RotationStep[] }) {
    const ctx = requireTenantContext();
    await this.validateSteps(ctx.orgId, input.steps);
    return this.prisma.shiftRotation.create({
      data: { orgId: ctx.orgId, name: input.name, anchorDate: new Date(input.anchorDate), steps: input.steps as unknown as object },
    });
  }

  async update(id: string, input: { name?: string; anchorDate?: string; steps?: RotationStep[]; status?: "ACTIVE" | "ARCHIVED" }) {
    const ctx = requireTenantContext();
    const existing = await this.prisma.shiftRotation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Rotation not found.");
    if (input.steps) await this.validateSteps(ctx.orgId, input.steps);
    return this.prisma.shiftRotation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.anchorDate !== undefined ? { anchorDate: new Date(input.anchorDate) } : {}),
        ...(input.steps !== undefined ? { steps: input.steps as unknown as object } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
  }

  /** Archive a rotation and detach it from any employees still on it. */
  async archive(id: string) {
    const ctx = requireTenantContext();
    const existing = await this.prisma.shiftRotation.findFirst({ where: { id, orgId: ctx.orgId } });
    if (!existing) throw new NotFoundException("Rotation not found.");
    await this.prisma.$transaction([
      this.prisma.employee.updateMany({ where: { orgId: ctx.orgId, rotationId: id }, data: { rotationId: null } }),
      this.prisma.shiftRotation.update({ where: { id }, data: { status: "ARCHIVED" } }),
    ]);
    return { id };
  }
}
