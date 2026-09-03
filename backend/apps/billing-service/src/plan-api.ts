import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import type { PrismaClient, Plan } from "@retainiq/database/billing";
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

// An org-initiated change that needs platform approval before it is applied.
const createChangeRequestSchema = z
  .object({
    planId: z.string().min(1).max(40).optional(),
    seats: z.coerce.number().int().min(1).max(100000).optional(),
    autoRenew: z.boolean().optional(),
    requestedByUserId: z.string().uuid().optional(),
    requestedByEmail: z.string().email().max(200).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => v.planId !== undefined || v.seats !== undefined || v.autoRenew !== undefined, {
    message: "Provide at least one field to change.",
  });

const decisionSchema = z.object({
  decidedByName: z.string().max(120).optional(),
  decisionNote: z.string().max(500).optional(),
});

/** Seat policy check against a plan (pure). Returns an error, or null if OK. */
function validateSeats(target: Plan, nextSeats: number, subSeats: number, seatsProvided: boolean): { code: number; message: string } | null {
  const cap = target.maxSeats ?? target.seatLimit; // maxSeats supersedes legacy seatLimit
  if (!target.allowCustomSeats && seatsProvided && nextSeats !== target.includedSeats && nextSeats !== subSeats) {
    return { code: 409, message: `${target.name} does not allow custom seat quantities.` };
  }
  if (nextSeats < target.minSeats) {
    return { code: 409, message: `${target.name} requires at least ${target.minSeats} seat${target.minSeats === 1 ? "" : "s"}.` };
  }
  if (cap != null && nextSeats > cap) {
    return { code: 409, message: `${target.name} allows at most ${cap} seats. Upgrade to a higher plan for more.` };
  }
  return null;
}

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

  // Apply a subscription change (plan / seats / auto-renew) directly. The new rate
  // takes effect at the next renewal — no mid-cycle proration (Stripe is deferred).
  // Shared by the platform-admin PATCH, the approve endpoint, and autoRenew-only
  // org toggles. Returns a discriminated result the callers map to HTTP.
  type ApplyOk = {
    ok: true;
    result: {
      orgId: string; planId: string; planName: string; seats: number; activeSeats: number;
      autoRenew: boolean; mrr: number;
      pricing: { basePrice: number; includedSeats: number; additionalSeats: number; additionalSeatPrice: number; totalPrice: number };
    };
  };
  type ApplyErr = { ok: false; code: number; message: string };

  const applySubscriptionChange = async (orgId: string, input: { planId?: string; seats?: number; autoRenew?: boolean }): Promise<ApplyOk | ApplyErr> => {
    const { planId, seats, autoRenew } = input;
    const sub = await prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } });
    if (!sub) return { ok: false, code: 404, message: "This organization has no subscription." };

    let target = sub.plan;
    if (planId && planId !== sub.planId) {
      const next = await prisma.plan.findUnique({ where: { id: planId } });
      if (!next) return { ok: false, code: 404, message: `Plan "${planId}" not found.` };
      if (!next.isActive) return { ok: false, code: 409, message: `Plan "${next.name}" is not active.` };
      target = next;
    }

    const nextSeats = seats ?? sub.seats;
    const seatErr = validateSeats(target, nextSeats, sub.seats, seats !== undefined);
    if (seatErr) return { ok: false, ...seatErr };

    // Re-lock the rate at the new licensed seat quantity (historical rate for invoices/MRR).
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
    if (planId || seats !== undefined) {
      data.lockedBasePrice = pricing.basePrice;
      data.lockedAdditionalSeatPrice = pricing.additionalSeatPrice;
      data.lockedIncludedSeats = pricing.includedSeats;
      data.lockedTotalPrice = breakdown.totalPrice;
    }

    const updated = await prisma.subscription.update({ where: { orgId }, data, include: { plan: true } });

    const planChanged = Boolean(planId) && planId !== sub.planId;
    const seatsChanged = seats !== undefined && seats !== sub.seats;
    const renewalChanged = autoRenew !== undefined && autoRenew !== sub.autoRenew;
    const mrr = computePrice(pricing, updated.activeSeats).totalPrice;

    if (planChanged) {
      await prisma.billingEvent.create({ data: { orgId, type: "subscription.plan_changed", summary: `Plan changed: ${sub.plan.name} → ${target.name}`, planId: updated.planId, amountCents: mrr } });
    }
    if (seatsChanged) {
      await prisma.billingEvent.create({ data: { orgId, type: "subscription.seats_changed", summary: `Seats changed: ${sub.seats} → ${updated.seats}`, planId: updated.planId, amountCents: mrr } });
    }
    if (renewalChanged) {
      await prisma.billingEvent.create({ data: { orgId, type: "subscription.renewal_changed", summary: `Auto-renew turned ${updated.autoRenew ? "on" : "off"}`, planId: updated.planId } });
    }

    // Entitlements changed → tell identity to bust its plan cache. Best-effort.
    if ((planChanged || seatsChanged) && publishEvent) {
      try {
        await publishEvent("subscription.plan_changed", orgId, { orgId, planId: updated.planId });
      } catch (err) {
        logger.warn({ orgId, err: String(err) }, "failed to publish subscription.plan_changed domain event");
      }
    }

    return {
      ok: true,
      result: {
        orgId: updated.orgId, planId: updated.planId, planName: updated.plan.name,
        seats: updated.seats, activeSeats: updated.activeSeats, autoRenew: updated.autoRenew, mrr,
        pricing: {
          basePrice: breakdown.basePrice, includedSeats: breakdown.includedSeats,
          additionalSeats: breakdown.additionalSeats, additionalSeatPrice: breakdown.additionalSeatPrice, totalPrice: breakdown.totalPrice,
        },
      },
    };
  };

  // Platform-admin direct edit (EditSubscriptionButton) — applies immediately.
  app.patch<{ Params: { orgId: string } }>("/v1/admin/subscriptions/:orgId", async (req, reply) => {
    const parsed = updateSubscriptionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid update." });
    const r = await applySubscriptionChange(req.params.orgId, parsed.data);
    if (!r.ok) return reply.code(r.code).send({ message: r.message });
    return r.result;
  });

  // ---- Org-initiated change requests (platform approval flow) ----

  // An org asks to change its seats/plan. A seat or plan change is held as a PENDING
  // request for a platform super-admin to approve; an auto-renew-only change (no seat
  // or plan movement) needs no approval and is applied immediately.
  app.post<{ Params: { orgId: string } }>("/v1/admin/orgs/:orgId/change-requests", async (req, reply) => {
    const parsed = createChangeRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? "Invalid request." });
    const { planId, seats, autoRenew, requestedByUserId, requestedByEmail, note } = parsed.data;
    const orgId = req.params.orgId;

    const sub = await prisma.subscription.findUnique({ where: { orgId }, include: { plan: true } });
    if (!sub) return reply.code(404).send({ message: "This organization has no subscription." });

    const seatChange = seats !== undefined && seats !== sub.seats;
    const planChange = planId !== undefined && planId !== sub.planId;

    // No seat/plan movement (auto-renew toggle or no-op) → apply directly, no approval.
    if (!seatChange && !planChange) {
      const r = await applySubscriptionChange(orgId, { autoRenew });
      if (!r.ok) return reply.code(r.code).send({ message: r.message });
      return { applied: true, subscription: r.result };
    }

    // One pending request at a time.
    const pending = await prisma.subscriptionChangeRequest.findFirst({ where: { orgId, status: "PENDING" } });
    if (pending) return reply.code(409).send({ message: "A change request is already pending approval." });

    // Validate the target plan + seat policy up front so we never queue an impossible change.
    let target = sub.plan;
    if (planChange && planId) {
      const next = await prisma.plan.findUnique({ where: { id: planId } });
      if (!next) return reply.code(404).send({ message: `Plan "${planId}" not found.` });
      if (!next.isActive) return reply.code(409).send({ message: `Plan "${next.name}" is not active.` });
      target = next;
    }
    const toSeats = seats ?? sub.seats;
    const seatErr = validateSeats(target, toSeats, sub.seats, seats !== undefined);
    if (seatErr) return reply.code(seatErr.code).send({ message: seatErr.message });

    const toPrice = computePrice(planPricingOf(target), toSeats).totalPrice;
    const fromPrice = sub.lockedTotalPrice ?? computePrice(planPricingOf(sub.plan), sub.seats).totalPrice;

    const request = await prisma.subscriptionChangeRequest.create({
      data: {
        orgId, fromPlanId: sub.planId, toPlanId: target.id, fromSeats: sub.seats, toSeats,
        estimatedTotalPrice: toPrice, estimatedDeltaPrice: toPrice - fromPrice,
        requestedByUserId: requestedByUserId ?? null, requestedByEmail: requestedByEmail ?? null, note: note ?? null,
      },
    });
    await prisma.billingEvent.create({
      data: { orgId, type: "subscription.change_requested", summary: `Change requested: ${sub.plan.name}/${sub.seats} → ${target.name}/${toSeats} seats`, planId: target.id, amountCents: toPrice },
    });
    if (publishEvent) {
      await publishEvent("subscription.change_requested", orgId, { orgId, requestId: request.id, fromSeats: sub.seats, toSeats, toPlanId: target.id }).catch(() => {});
    }
    return reply.code(201).send({ requested: true, request });
  });

  // Platform admin approves a pending change → apply it now (re-lock the rate).
  app.post<{ Params: { id: string } }>("/v1/admin/change-requests/:id/approve", async (req, reply) => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid decision." });
    const cr = await prisma.subscriptionChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!cr) return reply.code(404).send({ message: "Change request not found." });
    if (cr.status !== "PENDING") return reply.code(409).send({ message: `This request is already ${cr.status.toLowerCase()}.` });

    const applied = await applySubscriptionChange(cr.orgId, { planId: cr.toPlanId, seats: cr.toSeats });
    if (!applied.ok) return reply.code(applied.code).send({ message: applied.message });

    const updated = await prisma.subscriptionChangeRequest.update({
      where: { id: cr.id },
      data: { status: "APPROVED", decidedByName: parsed.data.decidedByName ?? null, decisionNote: parsed.data.decisionNote ?? null, decidedAt: new Date() },
    });
    await prisma.billingEvent.create({
      data: { orgId: cr.orgId, type: "subscription.change_approved", summary: `Change approved: ${cr.fromSeats} → ${cr.toSeats} seats`, planId: cr.toPlanId, amountCents: cr.estimatedTotalPrice },
    });
    if (publishEvent) {
      await publishEvent("subscription.change_decided", cr.orgId, { orgId: cr.orgId, outcome: "approved", fromSeats: cr.fromSeats, toSeats: cr.toSeats, toPlanId: cr.toPlanId }).catch(() => {});
    }
    return { request: updated, subscription: applied.result };
  });

  // Platform admin rejects a pending change → nothing is applied.
  app.post<{ Params: { id: string } }>("/v1/admin/change-requests/:id/reject", async (req, reply) => {
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ message: "Invalid decision." });
    const cr = await prisma.subscriptionChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!cr) return reply.code(404).send({ message: "Change request not found." });
    if (cr.status !== "PENDING") return reply.code(409).send({ message: `This request is already ${cr.status.toLowerCase()}.` });

    const updated = await prisma.subscriptionChangeRequest.update({
      where: { id: cr.id },
      data: { status: "REJECTED", decidedByName: parsed.data.decidedByName ?? null, decisionNote: parsed.data.decisionNote ?? null, decidedAt: new Date() },
    });
    await prisma.billingEvent.create({
      data: { orgId: cr.orgId, type: "subscription.change_rejected", summary: `Change declined: ${cr.fromSeats} → ${cr.toSeats} seats`, planId: cr.toPlanId },
    });
    if (publishEvent) {
      await publishEvent("subscription.change_decided", cr.orgId, { orgId: cr.orgId, outcome: "rejected", fromSeats: cr.fromSeats, toSeats: cr.toSeats, toPlanId: cr.toPlanId }).catch(() => {});
    }
    return { request: updated };
  });

  // Org withdraws its own pending request.
  app.post<{ Params: { orgId: string; id: string } }>("/v1/admin/orgs/:orgId/change-requests/:id/cancel", async (req, reply) => {
    const cr = await prisma.subscriptionChangeRequest.findUnique({ where: { id: req.params.id } });
    if (!cr || cr.orgId !== req.params.orgId) return reply.code(404).send({ message: "Change request not found." });
    if (cr.status !== "PENDING") return reply.code(409).send({ message: `This request is already ${cr.status.toLowerCase()}.` });
    const updated = await prisma.subscriptionChangeRequest.update({ where: { id: cr.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    return { request: updated };
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
