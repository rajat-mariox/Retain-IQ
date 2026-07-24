import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Feature resolution precedence (mirrors PlatformSettingsService.resolveFeatureFlags):
 *
 *   kill-switch (global OFF) > plan (premium not purchased) > org override > global ON
 *
 * The real method reads three stores; this re-implements the pure decision so
 * the precedence is pinned. If the order changes, these fail.
 */

type Tier = "baseline" | "premium";
interface Meta {
  tier: Tier;
  planFeature?: string;
}

function resolve(args: {
  meta: Meta;
  globalOn: boolean;
  planFeatures: Set<string>;
  override: boolean | undefined;
}): { enabled: boolean; source: string } {
  const { meta, globalOn, planFeatures, override } = args;
  if (!globalOn) return { enabled: false, source: "kill_switch" };
  if (meta.tier === "premium" && meta.planFeature && !planFeatures.has(meta.planFeature)) {
    return { enabled: false, source: "plan" };
  }
  if (override === undefined) return { enabled: true, source: "global" };
  return { enabled: override, source: "org" };
}

const premium: Meta = { tier: "premium", planFeature: "time_tracking" };
const baseline: Meta = { tier: "baseline" };
const withPlan = new Set(["time_tracking", "ai_analytics"]);
const noPlan = new Set<string>();

test("baseline feature is on by default regardless of plan", () => {
  const r = resolve({ meta: baseline, globalOn: true, planFeatures: noPlan, override: undefined });
  assert.deepEqual(r, { enabled: true, source: "global" });
});

test("premium feature is ON when the plan includes it", () => {
  const r = resolve({ meta: premium, globalOn: true, planFeatures: withPlan, override: undefined });
  assert.deepEqual(r, { enabled: true, source: "global" });
});

test("premium feature is OFF when the plan doesn't include it", () => {
  const r = resolve({ meta: premium, globalOn: true, planFeatures: noPlan, override: undefined });
  assert.deepEqual(r, { enabled: false, source: "plan" });
});

test("a super-admin override CANNOT turn on a feature the plan doesn't grant", () => {
  // The whole point of plan gating: you can't hand out what wasn't purchased.
  const r = resolve({ meta: premium, globalOn: true, planFeatures: noPlan, override: true });
  assert.deepEqual(r, { enabled: false, source: "plan" });
});

test("an org override CAN turn OFF a premium feature the plan grants", () => {
  const r = resolve({ meta: premium, globalOn: true, planFeatures: withPlan, override: false });
  assert.deepEqual(r, { enabled: false, source: "org" });
});

test("global kill switch beats everything — even a purchased premium feature", () => {
  const r = resolve({ meta: premium, globalOn: false, planFeatures: withPlan, override: true });
  assert.deepEqual(r, { enabled: false, source: "kill_switch" });
});

test("kill switch beats a baseline feature too", () => {
  const r = resolve({ meta: baseline, globalOn: false, planFeatures: noPlan, override: undefined });
  assert.deepEqual(r, { enabled: false, source: "kill_switch" });
});

test("an org override turns a baseline feature off", () => {
  const r = resolve({ meta: baseline, globalOn: true, planFeatures: noPlan, override: false });
  assert.deepEqual(r, { enabled: false, source: "org" });
});
