import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveDelta } from "../src/scoring.ts";
import score from "../src/score.task.ts";

test("deriveDelta counts productive app time", () => {
  const d = deriveDelta("activity.app.used", { app: "vscode", seconds: 1800 });
  assert.deepEqual(d, { activeSeconds: 1800, idleSeconds: 0, productiveSeconds: 1800, eventCount: 1 });
});

test("deriveDelta treats unproductive apps as active-but-not-productive", () => {
  const d = deriveDelta("activity.app.used", { app: "youtube", seconds: 600 });
  assert.equal(d.activeSeconds, 600);
  assert.equal(d.productiveSeconds, 0);
});

test("deriveDelta honors explicit productive flag over app name", () => {
  const d = deriveDelta("activity.app.used", { app: "youtube", seconds: 600, productive: true });
  assert.equal(d.productiveSeconds, 600);
});

test("deriveDelta maps idle events to idleSeconds", () => {
  const d = deriveDelta("activity.idle.started", { seconds: 300 });
  assert.equal(d.idleSeconds, 300);
  assert.equal(d.activeSeconds, 0);
});

test("deriveDelta ignores negative/garbage seconds", () => {
  const d = deriveDelta("activity.app.used", { app: "vscode", seconds: -5 });
  assert.equal(d.activeSeconds, 0);
});

test("score: productivity is share of active time in productive apps", () => {
  const s = score({ activeSeconds: 2400, idleSeconds: 300, productiveSeconds: 1800, eventCount: 3 });
  assert.equal(s.productivityScore, 75);
  assert.ok(s.focusScore > 0 && s.focusScore <= 100);
});

test("score: zero activity yields zero scores", () => {
  const s = score({ activeSeconds: 0, idleSeconds: 0, productiveSeconds: 0, eventCount: 0 });
  assert.equal(s.productivityScore, 0);
  assert.equal(s.focusScore, 0);
});

test("score: high event churn lowers focus", () => {
  const low = score({ activeSeconds: 3600, idleSeconds: 0, productiveSeconds: 3600, eventCount: 5 });
  const high = score({ activeSeconds: 3600, idleSeconds: 0, productiveSeconds: 3600, eventCount: 5000 });
  assert.ok(high.focusScore < low.focusScore);
});
