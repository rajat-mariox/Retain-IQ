/**
 * Headless test of the renderer's idle-warning flow — the reported "stuck" bug:
 * the countdown must appear, the "I'm still here" button must hide it AND call
 * idleStillHere(), and an idle:warn-clear must hide it.
 */
import { readFileSync } from "node:fs";

function makeEl(id) {
  const el = {
    id,
    _classes: new Set(id === "idleOverlay" ? ["hide"] : []),
    textContent: "",
    _click: null,
    classList: {
      add(c) { el._classes.add(c); },
      remove(c) { el._classes.delete(c); },
      contains(c) { return el._classes.has(c); },
      toggle(c, on) { if (on) el._classes.add(c); else el._classes.delete(c); },
    },
    addEventListener(ev, fn) { if (ev === "click") el._click = fn; },
    querySelectorAll() { return []; },
  };
  return el;
}

const els = {};
// Every id the renderer touches; unknown ids resolve to a fresh stub so nothing throws.
const known = new Set(["idleOverlay", "idleCount", "idleStayBtn"]);
globalThis.document = {
  getElementById: (id) => {
    if (!els[id]) els[id] = makeEl(id);
    known.add(id);
    return els[id];
  },
};

// Capture timers so we can drive the countdown deterministically.
let intervalFns = [];
globalThis.setInterval = (fn) => { intervalFns.push(fn); return intervalFns.length; };
globalThis.clearInterval = (h) => { if (h) intervalFns[h - 1] = null; };
globalThis.setTimeout = (fn) => { fn && fn(); return 0; };

// Capture the idle bridge handlers + record idleStillHere calls.
let onWarn = null, onClear = null, stillHereCalls = 0;
globalThis.window = {
  agent: {
    session: async () => null,
    status: async () => ({ running: false, idle: false, queued: 0, uploadedTotal: 0 }),
    attendance: async () => null,
    corrections: async () => [],
    onAttendanceChanged: () => {},
    onIdleWarn: (fn) => { onWarn = fn; },
    onIdleWarnClear: (fn) => { onClear = fn; },
    idleStillHere: () => { stillHereCalls++; },
    logout: async () => true,
  },
};

const code = readFileSync(new URL("../src/renderer/renderer.js", import.meta.url), "utf8");
new Function(code)();

let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`);
};
const hidden = () => els.idleOverlay._classes.has("hide");

console.log("idle-warning flow");

// 1) Warn arrives → overlay shows with the formatted total.
check("handlers wired", Boolean(onWarn && onClear), true);
onWarn(300);
check("overlay visible after warn", hidden(), false);
check("countdown shows 5:00", els.idleCount.textContent, "5:00");

// 2) Main drives the countdown by pushing the remaining seconds each second; the
// renderer just displays whatever it receives.
onWarn(299);
check("countdown updates to 4:59 from main's push", els.idleCount.textContent, "4:59");
onWarn(298);
check("countdown updates to 4:58 from main's push", els.idleCount.textContent, "4:58");

// 3) "I'm still here" hides the overlay AND tells main.
els.idleStayBtn._click();
check("overlay hidden after button", hidden(), true);
check("idleStillHere() called", stillHereCalls, 1);

// 4) A fresh warn re-shows, and idle:warn-clear (activity/checkout) hides it.
onWarn(120);
check("overlay visible after 2nd warn", hidden(), false);
check("countdown shows 2:00", els.idleCount.textContent, "2:00");
onClear();
check("overlay hidden after clear", hidden(), true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
