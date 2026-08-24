import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "@retainiq/database/billing";
import type { Logger } from "@retainiq/observability";
import { computePrice, planPricingOf } from "@retainiq/contracts";
import { z } from "zod";
import { cancelTrial, convertTrial, extendTrial } from "./trial.js";

// Built-in plans that must always exist. "free" is the fallback for orgs with no
// subscription (looked up by id in seat-limit + provisioning); the rest are the
// standard tiers. These can be edited/deactivated but never deleted.
const SYSTEM_PLAN_IDS = new Set(["free", "basic", "professional", "enterprise"]);

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB hex color");

const createPlanSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{1,38}[a-z0-9]$/, "lowercase slug (e.g. 'team')"),
  name: z.string().min(1).max(60),
  description: z.string().max(280).optional(),
  pricePerSeat: z.coerce.number().int().min(0), // USD cents (legacy flat)
  // Seat-based pricing: total = basePrice + max(0, seats - includedSeats) * additionalSeatPrice.
  basePrice: z.coerce.number().int().min(0).default(0),
  includedSeats: z.coerce.number().int().min(0).default(0),
  additionalSeatPrice: z.coerce.number().int().min(0).default(0),
  billingPeriod: z.enum(["monthly", "yearly"]).default("monthly"),
  seatLimit: z.coerce.number().int().min(1).nullable().optional(),
  minSeats: z.coerce.number().int().min(1).default(1),
  maxSeats: z.coerce.number().int().min(1).nullable().optional(),
  allowCustomSeats: z.boolean().default(true),
  trialEnabled: z.boolean().default(true),
  trialDays: z.coerce.number().int().min(0).max(365).default(14),
  storageLimitMb: z.coerce.number().int().min(0).nullable().optional(),
  features: z.array(z.string().min(1).max(40)).default([]),
  color: hex,
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

// Update: everything optional, id is immutable (path param).
const updatePlanSchema = createPlanSchema.partial().omit({ id: true });

// Per-plan feature limit (quota). featureCode matches Plan.features codes.
const featureLimitSchema = z.object({
  featureCode: z.string().min(1).max(60),
  limitValue: z.coerce.number().int().min(0).nullable().optional(),
  limitType: z.enum(["monthly", "daily", "total", "concurrent"]).nullable().optional(),
});

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
export async function startPlanApi(opts: {
  prisma: PrismaClient;
  port: number;
  jwtSecret: string;
  logger: Logger;
  /**
   * Publishes a domain event onto the shared stream so other services can react
   * (e.g. identity busts its plan cache). Best-effort: a publish failure must not
   * fail the HTTP write — the BillingEvent row is the durable record.
   */
  publishEvent?: (eventType: string, orgId: string, payload: Record<string, unknown>) => Promise<void>;
}): Promise<FastifyInstance> {
  const { prisma, port, jwtSecret, logger, publishEvent } = opts;
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
    // System plans are load-bearing and can't be deleted: "free" is the fallback
    // orgs without a subscription resolve to (seat-limit enforcement + provisioning
    // look it up by id), and the standard tiers back the pricing/feature model.
    if (SYSTEM_PLAN_IDS.has(req.params.id)) {
      return reply.code(409).send({ message: `"${req.params.id}" is a built-in plan and can't be deleted. You can deactivate it instead.` });
    }
    const inUse = await prisma.subscription.count({ where: { planId: req.params.id } });
    if (inUse > 0) return reply.code(409).send({ message: `Cannot delete: ${inUse} subscription(s) are on this plan.` });
    const deleted = await prisma.plan.deleteMany({ where: { id: req.params.id } });
    if (deleted.count === 0) return reply.code(404).send({ message: "Plan not found." });
    return { id: req.params.id, deleted: true };
  });

  // ---- Per-plan feature limits (quotas) ----
  app.get<{ Params: { id: string } }>("/v1/admin/plans/:id/features", async (req, reply) => {
    const exists = await prisma.plan.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: "Plan not found." });
    const items = await prisma.planFeature.findMany({ where: { planId: req.params.id }, orderBy: { featureCode: "asc" } });
    return { items };
  });

  // Upsert a feature limit on a plan (create or update by featureCode).
  app.put<{ Params: { id: string } }>("/v1/admin/plans/:id/features", async (req, reply) => {
    const parsed = featureLimitSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid feature limit." });
    const exists = await prisma.plan.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!exists) return reply.code(404).send({ message: "Plan not found." });
    const { featureCode, limitValue, limitType } = parsed.data;
    const row = await prisma.planFeature.upsert({
      where: { planId_featureCode: { planId: req.params.id, featureCode } },
      create: { planId: req.params.id, featureCode, limitValue: limitValue ?? null, limitType: limitType ?? null },
      update: { limitValue: limitValue ?? null, limitType: limitType ?? null },
    });
    return row;
  });

  app.delete<{ Params: { id: string; code: string } }>("/v1/admin/plans/:id/features/:code", async (req, reply) => {
    const deleted = await prisma.planFeature.deleteMany({ where: { planId: req.params.id, featureCode: req.params.code } });
    if (deleted.count === 0) return reply.code(404).send({ message: "No such feature limit on this plan." });
    return { planId: req.params.id, featureCode: req.params.code, deleted: true };
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
      target = next;
    }

    // Seat validation against the EFFECTIVE plan's policy — enforced whether the
    // plan is changing or the caller is only adjusting seats on the current plan.
    const nextSeats = seats ?? sub.seats;
    const cap = target.maxSeats ?? target.seatLimit; // maxSeats supersedes legacy seatLimit
    if (!target.allowCustomSeats && seats !== undefined && seats !== target.includedSeats && seats !== sub.seats) {
      return reply.code(409).send({ message: `${target.name} does not allow custom seat quantities.` });
    }
    if (nextSeats < target.minSeats) {
      return reply.code(409).send({ message: `${target.name} requires at least ${target.minSeats} seat${target.minSeats === 1 ? "" : "s"}.` });
    }
    if (cap != null && nextSeats > cap) {
      return reply.code(409).send({ message: `${target.name} allows at most ${cap} seats. Upgrade to a higher plan for more.` });
    }

    // Compute the new locked rate from the target plan's pricing model at the new
    // licensed seat quantity. This is the historical rate — invoices/MRR read it,
    // so a later plan-price edit never rewrites this subscription's bill.
    const pricing = planPricingOf(target);
    const breakdown = computePrice(pricing, nextSeats);

    const data: {
      planId?: string; seats?: number; activeSeats?: number; autoRenew?: boolean;
      lockedBasePrice?: number; lockedAdditionalSeatPrice?: number; lockedIncludedSeats?: number; lockedTotalPrice?: number;
    } = {};
    if (planId) data.planId = planId;
    if (seats !== undefined) {
      data.seats = seats;
      data.activeSeats = Math.min(sub.activeSeats, seats); // never exceed the licensed count
    }
    if (autoRenew !== undefined) data.autoRenew = autoRenew;
    // Re-lock the rate whenever the plan or seat quantity moves.
    if (planId || seats !== undefined) {
      data.lockedBasePrice = pricing.basePrice;
      data.lockedAdditionalSeatPrice = pricing.additionalSeatPrice;
      data.lockedIncludedSeats = pricing.includedSeats;
      data.lockedTotalPrice = breakdown.totalPrice;
    }

    const updated = await prisma.subscription.update({ where: { orgId: req.params.orgId }, data, include: { plan: true } });

    // Emit one BillingEvent per changed dimension (append-only model), each with
    // its own distinct type + targeted summary, so the activity feed and any
    // consumers can tell a plan change from a seat or renewal change.
    const planChanged = Boolean(planId) && planId !== sub.planId;
    const seatsChanged = seats !== undefined && seats !== sub.seats;
    const renewalChanged = autoRenew !== undefined && autoRenew !== sub.autoRenew;
    // MRR bills on ACTIVE seats at the locked rate (base counted once, extras per active seat).
    const mrr = computePrice(pricing, updated.activeSeats).totalPrice;

    if (planChanged) {
      await prisma.billingEvent.create({
        data: {
          orgId: req.params.orgId,
          type: "subscription.plan_changed",
          summary: `Plan changed: ${sub.plan.name} → ${target.name}`,
          planId: updated.planId,
          amountCents: mrr,
        },
      });
    }
    if (seatsChanged) {
      await prisma.billingEvent.create({
        data: {
          orgId: req.params.orgId,
          type: "subscription.seats_changed",
          summary: `Seats changed: ${sub.seats} → ${updated.seats}`,
          planId: updated.planId,
          amountCents: mrr,
        },
      });
    }
    if (renewalChanged) {
      await prisma.billingEvent.create({
        data: {
          orgId: req.params.orgId,
          type: "subscription.renewal_changed",
          summary: `Auto-renew turned ${updated.autoRenew ? "on" : "off"}`,
          planId: updated.planId,
        },
      });
    }

    // F1.2: a plan or seat change alters the org's entitlements, so publish a
    // domain event to the shared stream for identity to bust its plan cache.
    // Best-effort — the BillingEvent rows above are the durable source of truth.
    if ((planChanged || seatsChanged) && publishEvent) {
      try {
        await publishEvent("subscription.plan_changed", req.params.orgId, { orgId: req.params.orgId, planId: updated.planId });
      } catch (err) {
        logger.warn({ orgId: req.params.orgId, err: String(err) }, "failed to publish subscription.plan_changed domain event");
      }
    }

    return {
      orgId: updated.orgId,
      planId: updated.planId,
      planName: updated.plan.name,
      seats: updated.seats,
      activeSeats: updated.activeSeats,
      autoRenew: updated.autoRenew,
      mrr,
      // The itemised locked price at the licensed seat quantity (base + extra seats).
      pricing: {
        basePrice: breakdown.basePrice,
        includedSeats: breakdown.includedSeats,
        additionalSeats: breakdown.additionalSeats,
        additionalSeatPrice: breakdown.additionalSeatPrice,
        totalPrice: breakdown.totalPrice,
      },
    };
  });

  // ---- Trial actions (super-admin) ----
  app.post<{ Params: { orgId: string } }>("/v1/admin/subscriptions/:orgId/convert", async (req, reply) => {
    const r = await convertTrial({ prisma, orgId: req.params.orgId, logger });
    if (!r.ok) return reply.code(409).send({ message: r.message });
    if (publishEvent) await publishEvent("subscription.plan_changed", req.params.orgId, { orgId: req.params.orgId }).catch(() => {});
    return { ok: true };
  });

  app.post<{ Params: { orgId: string } }>("/v1/admin/subscriptions/:orgId/extend-trial", async (req, reply) => {
    const parsed = z.object({ days: z.coerce.number().int().min(1).max(365) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: "Provide days (1–365) to extend." });
    const r = await extendTrial({ prisma, orgId: req.params.orgId, days: parsed.data.days });
    if (!r.ok) return reply.code(409).send({ message: r.message });
    return { ok: true, trialEndsAt: r.trialEndsAt };
  });

  app.post<{ Params: { orgId: string } }>("/v1/admin/subscriptions/:orgId/cancel-trial", async (req, reply) => {
    const r = await cancelTrial({ prisma, orgId: req.params.orgId });
    if (!r.ok) return reply.code(409).send({ message: r.message });
    if (publishEvent) await publishEvent("subscription.plan_changed", req.params.orgId, { orgId: req.params.orgId }).catch(() => {});
    return { ok: true };
  });

  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "billing plan-admin API listening");
  return app;
}
