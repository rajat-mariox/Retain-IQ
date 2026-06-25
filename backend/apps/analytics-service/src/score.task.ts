import type { ScoreInput, ScoreOutput } from "./scoring.js";

/**
 * CPU-bound scoring, executed in a worker_threads pool (piscina) so it never
 * blocks the consumer's event loop. The formula here is intentionally simple;
 * this is the seam where heavier productivity/focus models or ML inference run.
 *
 * - productivityScore: share of active time spent in productive apps (0..100).
 * - focusScore: rewards sustained active time, penalizes idle fragmentation and
 *   high event churn (lots of short context switches).
 */
export default function score(input: ScoreInput): ScoreOutput {
  const active = Math.max(input.activeSeconds, 0);
  const idle = Math.max(input.idleSeconds, 0);
  const productive = Math.max(input.productiveSeconds, 0);
  const total = active + idle;

  const productivityScore = active > 0 ? clamp((productive / active) * 100) : 0;

  const activeRatio = total > 0 ? active / total : 0;
  // Event density per active minute — high churn signals fragmented focus.
  const churn = active > 0 ? input.eventCount / (active / 60) : 0;
  const churnPenalty = clamp01(churn / 20); // ~20 events/active-min => full penalty
  const focusScore = clamp(activeRatio * (1 - 0.5 * churnPenalty) * 100);

  return {
    productivityScore: round2(productivityScore),
    focusScore: round2(focusScore),
  };
}

function clamp(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
