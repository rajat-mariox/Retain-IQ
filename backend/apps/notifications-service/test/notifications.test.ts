import assert from "node:assert/strict";
import { test } from "node:test";
import { isQuietHour } from "../src/quiet-hours.ts";
import { rulesFor } from "../src/rules.ts";

test("isQuietHour handles wrap-around window (22->8)", () => {
  assert.equal(isQuietHour(23, 22, 8), true);
  assert.equal(isQuietHour(2, 22, 8), true);
  assert.equal(isQuietHour(8, 22, 8), false);
  assert.equal(isQuietHour(12, 22, 8), false);
});

test("isQuietHour handles same-day window (9->17)", () => {
  assert.equal(isQuietHour(10, 9, 17), true);
  assert.equal(isQuietHour(17, 9, 17), false);
  assert.equal(isQuietHour(8, 9, 17), false);
});

test("isQuietHour with start==end is never quiet", () => {
  assert.equal(isQuietHour(5, 0, 0), false);
});

test("rulesFor returns specs for known events", () => {
  const reg = rulesFor("org.registered");
  assert.equal(reg.length, 1);
  assert.deepEqual(reg[0].channels, ["IN_APP", "EMAIL"]);
  assert.equal(reg[0].audience, "owner");

  const emp = rulesFor("employee.created");
  assert.equal(emp[0].audience, "org-admins");
  assert.deepEqual(emp[0].channels, ["IN_APP"]);
});

test("rulesFor returns empty for unknown events", () => {
  assert.deepEqual(rulesFor("unknown.event"), []);
});

test("rule body interpolates payload", () => {
  const [spec] = rulesFor("employee.created");
  assert.match(spec.body({ firstName: "Ada", lastName: "Lovelace" }), /Ada Lovelace/);
});
