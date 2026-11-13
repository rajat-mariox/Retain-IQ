/**
 * Unit tests for the collector's queue discipline: the maxQueue backlog cap
 * (drop-oldest) and the flush batch-slicing. Both are pure array logic in
 * collector.ts; the collector itself is tied to Electron + api, so we mirror the
 * exact operations here and assert them, the same approach used for the focus
 * and SSE state machines.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// --- backlog cap: enqueue drops the oldest beyond maxQueue --------------
function enqueueWithCap(queue, event, maxQueue) {
  queue.push(event);
  if (queue.length > maxQueue) queue.splice(0, queue.length - maxQueue);
  return queue;
}

test("under the cap, nothing is dropped", () => {
  let q = [];
  for (let i = 0; i < 5; i++) enqueueWithCap(q, i, 10);
  assert.deepEqual(q, [0, 1, 2, 3, 4]);
});

test("at the cap, the oldest events fall off and newest are kept", () => {
  let q = [];
  for (let i = 0; i < 12; i++) enqueueWithCap(q, i, 10);
  assert.equal(q.length, 10, "capped at maxQueue");
  assert.equal(q[0], 2, "oldest two (0,1) dropped");
  assert.equal(q[q.length - 1], 11, "newest retained");
});

test("a huge burst still leaves exactly maxQueue newest events", () => {
  let q = [];
  for (let i = 0; i < 10_000; i++) enqueueWithCap(q, i, 100);
  assert.equal(q.length, 100);
  assert.equal(q[0], 9900);
  assert.equal(q[99], 9999);
});

// --- flush: upload a batch, then remove exactly that many on success -----
// Mirrors flush(): const batch = queue.slice(0, maxBatch); on ok →
// queue.splice(0, batch.length). On failure the queue is left intact.
function flushOnce(queue, maxBatch, uploadOk) {
  const batch = queue.slice(0, maxBatch);
  if (batch.length === 0) return { uploaded: 0, remaining: queue.length };
  if (uploadOk) queue.splice(0, batch.length);
  return { uploaded: uploadOk ? batch.length : 0, remaining: queue.length };
}

test("a successful flush removes exactly the batch it sent", () => {
  const q = [1, 2, 3, 4, 5];
  const r = flushOnce(q, 3, true);
  assert.equal(r.uploaded, 3);
  assert.deepEqual(q, [4, 5], "the sent batch is gone, the rest stays queued");
});

test("a failed flush leaves the whole queue for retry", () => {
  const q = [1, 2, 3, 4, 5];
  const r = flushOnce(q, 3, false);
  assert.equal(r.uploaded, 0);
  assert.deepEqual(q, [1, 2, 3, 4, 5], "nothing dropped on failure");
});

test("an empty queue flushes to a no-op", () => {
  const q = [];
  const r = flushOnce(q, 3, true);
  assert.equal(r.uploaded, 0);
  assert.equal(r.remaining, 0);
});

test("repeated successful flushes drain a backlog in batches", () => {
  const q = Array.from({ length: 250 }, (_, i) => i);
  let rounds = 0;
  while (q.length > 0) { flushOnce(q, 100, true); rounds++; }
  assert.equal(rounds, 3, "250 events / 100 per batch = 3 rounds");
});
