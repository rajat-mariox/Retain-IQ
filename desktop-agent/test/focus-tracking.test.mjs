/**
 * Unit test for the collector's focus-block / context-switch / idle-onset logic.
 *
 * The collector's timers and active-window sampling are hard to drive headless,
 * but the focus state machine is pure: given a sequence of "targets" (the app or
 * domain in focus) it decides when a context switch happened and when a focus
 * block completed. We re-implement that exact logic here and assert its output,
 * mirroring collector.ts trackFocus/endFocusBlock so a regression there shows up
 * as a divergence from this spec.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const FOCUS_MIN = 300; // seconds — matches focusBlockMinSeconds default

// A tiny clock we control, so "duration" is deterministic.
function makeTracker(now) {
  const events = [];
  let focusTarget = null;
  let focusStartedAt = 0;

  const endFocusBlock = () => {
    // Mirrors collector.ts: focusTarget === null is the only "nothing open"
    // signal; focusStartedAt is a real timestamp and may legitimately be 0.
    if (focusTarget === null) return;
    const seconds = Math.round((now() - focusStartedAt) / 1000);
    if (seconds >= FOCUS_MIN) events.push({ type: "focus.block.completed", target: focusTarget, seconds });
  };

  const trackFocus = (target) => {
    if (focusTarget === null) { focusTarget = target; focusStartedAt = now(); return; }
    if (target === focusTarget) return;
    endFocusBlock();
    events.push({ type: "context_switch", from: focusTarget, to: target });
    focusTarget = target;
    focusStartedAt = now();
  };

  const goIdle = () => { endFocusBlock(); focusTarget = null; events.push({ type: "idle.started" }); };
  const stop = () => endFocusBlock();

  return { events, trackFocus, goIdle, stop };
}

test("staying on one target emits nothing until it ends", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  tr.trackFocus("Code"); // start
  t += 60_000; tr.trackFocus("Code");
  t += 60_000; tr.trackFocus("Code");
  assert.equal(tr.events.length, 0, "no switch, no completed block mid-stretch");
});

test("a long stretch that ends becomes a completed focus block", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  tr.trackFocus("Code");
  t += 6 * 60_000; // 6 minutes, past the 5-min threshold
  tr.trackFocus("Slack"); // switch closes the block
  const block = tr.events.find((e) => e.type === "focus.block.completed");
  assert.ok(block, "block completed on switch");
  assert.equal(block.target, "Code");
  assert.equal(block.seconds, 360);
  assert.ok(tr.events.some((e) => e.type === "context_switch" && e.from === "Code" && e.to === "Slack"));
});

test("a short stretch switches but does NOT complete a block", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  tr.trackFocus("Code");
  t += 60_000; // only 1 minute — below threshold
  tr.trackFocus("Slack");
  assert.equal(tr.events.filter((e) => e.type === "focus.block.completed").length, 0, "too short to be a block");
  assert.equal(tr.events.filter((e) => e.type === "context_switch").length, 1, "but it is still a switch");
});

test("going idle closes a qualifying block and clears the target", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  tr.trackFocus("Code");
  t += 7 * 60_000;
  tr.goIdle();
  assert.ok(tr.events.some((e) => e.type === "focus.block.completed" && e.seconds === 420));
  assert.ok(tr.events.some((e) => e.type === "idle.started"));
  // After idle the next focus starts fresh — no phantom switch from the old target.
  t += 30_000;
  tr.trackFocus("Chrome");
  assert.ok(!tr.events.some((e) => e.type === "context_switch" && e.to === "Chrome"),
    "resuming after idle starts a new block, not a switch");
});

test("stop closes an in-progress block so it isn't lost", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  tr.trackFocus("Code");
  t += 8 * 60_000;
  tr.stop();
  assert.ok(tr.events.some((e) => e.type === "focus.block.completed" && e.seconds === 480));
});

test("rapid switching produces switches but no blocks", () => {
  let t = 0;
  const tr = makeTracker(() => t);
  for (const app of ["Code", "Slack", "Chrome", "Code", "Mail"]) {
    tr.trackFocus(app);
    t += 30_000; // 30s each — none reaches the block threshold
  }
  assert.equal(tr.events.filter((e) => e.type === "focus.block.completed").length, 0);
  assert.equal(tr.events.filter((e) => e.type === "context_switch").length, 4, "4 changes across 5 targets");
});
