/**
 * Unit test for the SSE frame parsing in attendance-stream.ts.
 *
 * The stream reads a byte stream and must pull one callback per attendance
 * frame, ignoring pings / connected markers / partial frames split across
 * reads. That framing logic is pure, so we re-implement it exactly as the
 * consumer does and feed it chunk sequences, asserting how many attendance
 * events fall out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

/**
 * Mirrors the buffer/frame loop in attendance-stream.ts consume(): feed chunks,
 * collect the attendance hits. Frames are separated by a blank line; each has
 * one or more "data:" lines carrying JSON.
 */
function makeParser(onAttendance) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk;
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          if (data.type === "attendance") onAttendance();
        } catch {
          /* keep-alive / non-JSON — ignore */
        }
      }
    }
  };
}

test("an attendance frame fires the callback once", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  feed('data: {"type":"attendance"}\n\n');
  assert.equal(hits, 1);
});

test("pings and connected markers are ignored", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  feed('data: {"type":"connected"}\n\n');
  feed('data: {"type":"ping"}\n\n');
  feed('data: {"type":"notification","id":"x"}\n\n');
  assert.equal(hits, 0, "only attendance frames count");
});

test("a frame split across two reads still fires once", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  feed('data: {"type":"att'); // arrives mid-frame
  feed('endance"}\n\n'); // completes it
  assert.equal(hits, 1);
});

test("several frames in one chunk each fire", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  feed('data: {"type":"attendance"}\n\ndata: {"type":"ping"}\n\ndata: {"type":"attendance"}\n\n');
  assert.equal(hits, 2);
});

test("a partial trailing frame waits for the rest, not fired early", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  feed('data: {"type":"attendance"}\n\ndata: {"type":"atten'); // second frame incomplete
  assert.equal(hits, 1, "only the complete frame fired");
  feed('dance"}\n\n');
  assert.equal(hits, 2, "the rest completes the second frame");
});

test("malformed JSON in a frame is swallowed, not thrown", () => {
  let hits = 0;
  const feed = makeParser(() => hits++);
  assert.doesNotThrow(() => feed("data: not-json\n\n"));
  assert.equal(hits, 0);
});
