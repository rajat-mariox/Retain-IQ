import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@retainiq/database/billing";
import type { Logger } from "@retainiq/observability";
import { z } from "zod";

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB hex color");

const createPlanSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,38}[a-z0-9]$/, "lowercase slug (e.g. 'team')"),
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  pricePerSeat: z.coerce.number().int().min(0), // USD cents
  billingPeriod: z.enum(["monthly", "yearly"]).default("monthly"),
  seatLimit: z.coerce.number().int().min(1).nullable().optional(),
  storageLimitMb: z.coerce.number().int().min(0).nullable().optional(),
  features: z.array(z.string().min(1).max(40)).default([]),
  color: hex,
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

// Update: everything optional, id is immutable (path param).
const updatePlanSchema = createPlanSchema.partial().omit({ id: true });

const updateSubscriptionSchema = z
  .object({
    planId: z.string().min(1).max(40).optional(),
    seats: z.coerce.number().int().min(1).max(100000).optional(),
    autoRenew: z.boolean().optional(),
  })
  .refine((v) => v.planId !== undefined || v.seats !== undefined || v.autoRenew !== undefined, {
    message: "Provide at least one field to change.",
  });

interface PlatformClaims {
  scope?: string;
  sub?: string;
  role?: string;
}

/**
 * Platform-admin HTTP API for managing the plan catalog. billing-service owns the
 * Plan table, so plan writes live here (identity only reads billing-db). Guarded
 * by the platform JWT (PLATFORM_JWT_SECRET + scope:"platform"), the same token
 * identity issues to super-admins.
 *
 * NOTE: verifies signature + scope + expiry only; logout-denylist revocation is a
 * future hardening (would couple this to Redis, which kafka-mode deployments lack).
 */
export async function startPlanApi(opts: { prisma: PrismaClient; port: number; jwtSecret: string; logger: Logger }): Promise<FastifyInstance> {
  const { prisma, port, jwtSecret, logger } = opts;
  const app = Fastify({ logger: false });

  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : null;
    if (!token) return reply.code(401).send({ message: "Authentication is required." });
    try {
      const claims = jwt.verify(token, jwtSecret) as PlatformClaims;
      if (claims.scope !== "platform") return reply.code(403).send({ message: "Platform scope required." });
    } catch {
      return reply.code(401).send({ message: "Invalid or expired token." });
    }
  });

  app.get("/v1/admin/plans", async () => {
    const plans = await prisma.plan.findMany({ orderBy: { sortOrder: "asc" } });
    return { items: plans };
  });

  app.post("/v1/admin/plans", async (req, reply) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid plan." });
    const existing = await prisma.plan.findUnique({ where: { id: parsed.data.id } });
    if (existing) return reply.code(409).send({ message: `A plan with id "${parsed.data.id}" already exists.` });
    const plan = await prisma.plan.create({ data: parsed.data });
    return reply.code(201).send(plan);
  });

  app.patch<{ Params: { id: string } }>("/v1/admin/plans/:id", async (req, reply) => {
    const parsed = updatePlanSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid plan." });
    const exists = await prisma.plan.findUnique({ where: { id: req.params.id } });
    if (!exists) return reply.code(404).send({ message: "Plan not found." });
    const plan = await prisma.plan.update({ where: { id: req.params.id }, data: parsed.data });
    return plan;
  });

  app.delete<{ Params: { id: string } }>("/v1/admin/plans/:id", async (req, reply) => {
    const inUse = await prisma.subscription.count({ where: { planId: req.params.id } });
    if (inUse > 0) return reply.code(409).send({ message: `Cannot delete: ${inUse} subscription(s) are on this plan.` });
    const deleted = await prisma.plan.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return reply.code(404).send({ message: "Plan not found." });
    return { id: req.params.id, deleted: true };
  });

  // Change an org's subscription (plan / seats / auto-renew). The new rate takes
  // effect at the next renewal — no mid-cycle proration (Stripe is deferred).
  app.patch<{ Params: { orgId: string } }>("/v1/admin/subscriptions/:orgId", async (req, reply) => {
    const parsed = updateSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid update." });
    const { planId, seats, autoRenew } = parsed.data;

    const sub = await prisma.subscription.findUnique({ where: { orgId: req.params.orgId }, include: { plan: true } });
    if (!sub) return reply.code(404).send({ message: "This organization has no subscription." });

    let target = sub.plan;
    if (planId && planId !== sub.planId) {
      const next = await prisma.plan.findUnique({ where: { id: planId } });
      if (!next) return reply.code(404).send({ message: `Plan "${planId}" not found.` });
      if (!next.isActive) return reply.code(409).send({ message: `Plan "${next.name}" is not active.` });
      if (next.seatLimit != null && (seats ?? sub.seats) > next.seatLimit) {
        return reply.code(409).send({ message: `${next.name} allows at most ${next.seatLimit} seats.` });
      }
      target = next;
    }

    const data: { planId?: string; seats?: number; activeSeats?: number; autoRenew?: boolean } = {};
    if (planId) data.planId = planId;
    if (seats !== undefined) {
      data.seats = seats;
      data.activeSeats = Math.min(sub.activeSeats, seats); // never exceed the licensed count
    }
    if (autoRenew !== undefined) data.autoRenew = autoRenew;

    const updated = await prisma.subscription.update({ where: { orgId: req.params.orgId }, data, include: { plan: true } });

    const changes: string[] = [];
    if (planId && planId !== sub.planId) changes.push(`plan ${sub.plan.name} → ${target.name}`);
    if (seats !== undefined && seats !== sub.seats) changes.push(`seats ${sub.seats} → ${seats}`);
    if (autoRenew !== undefined && autoRenew !== sub.autoRenew) changes.push(`auto-renew ${autoRenew ? "on" : "off"}`);
    if (changes.length > 0) {
      await prisma.billingEvent.create({
        data: {
          orgId: req.params.orgId,
          type: "subscription.plan_changed",
          summary: `Subscription updated: ${changes.join(", ")}`,
          planId: updated.planId,
          amountCents: updated.activeSeats * target.pricePerSeat,
        },
      });
    }

    return {
      orgId: updated.orgId,
      planId: updated.planId,
      planName: updated.plan.name,
      seats: updated.seats,
      activeSeats: updated.activeSeats,
      autoRenew: updated.autoRenew,
      mrr: updated.activeSeats * target.pricePerSeat,
    };
  });

  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "billing plan-admin API listening");
  return app;
}
