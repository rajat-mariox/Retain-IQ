import assert from "node:assert/strict";
import { test } from "node:test";
import { allPermissions } from "@retainiq/authz";

/**
 * Guards for the custom-role feature (mirrors the rules in RbacService), driven
 * by the real-world scenarios they exist to prevent:
 *  - a role must grant real, known permissions (no invented access)
 *  - built-in roles can't be edited or deleted (org would break)
 *  - a role in use can't be deleted (people would silently lose access)
 */

const KNOWN = new Set<string>(allPermissions);

function validatePermissions(input: string[]): string[] {
  const cleaned = [...new Set(input)];
  if (cleaned.length === 0) throw new Error("empty");
  const unknown = cleaned.filter((p) => !KNOWN.has(p));
  if (unknown.length > 0) throw new Error(`unknown: ${unknown.join(",")}`);
  return cleaned;
}

// --- permission validation ------------------------------------------------

test("a role with a real permission is accepted and de-duplicated", () => {
  const out = validatePermissions(["payroll.read", "payroll.read", "employee.read"]);
  assert.deepEqual(out.sort(), ["employee.read", "payroll.read"]);
});

test("an empty permission set is rejected — a role must be able to do something", () => {
  assert.throws(() => validatePermissions([]), /empty/);
});

test("an invented permission is rejected — you can only pick from what exists", () => {
  assert.throws(() => validatePermissions(["payroll.read", "make.everyone.admin"]), /unknown/);
});

// --- built-in role protection --------------------------------------------

function assertEditable(role: { isSystem: boolean }) {
  if (role.isSystem) throw new Error("system role locked");
}

test("built-in (system) roles cannot be edited", () => {
  assert.throws(() => assertEditable({ isSystem: true }), /locked/);
});

test("custom roles can be edited", () => {
  assert.doesNotThrow(() => assertEditable({ isSystem: false }));
});

// --- safe delete ----------------------------------------------------------

function assertDeletable(role: { isSystem: boolean }, assignedCount: number) {
  if (role.isSystem) throw new Error("system role locked");
  if (assignedCount > 0) throw new Error(`in use by ${assignedCount}`);
}

test("a custom role nobody holds can be deleted", () => {
  assert.doesNotThrow(() => assertDeletable({ isSystem: false }, 0));
});

test("a role still assigned to people cannot be deleted", () => {
  assert.throws(() => assertDeletable({ isSystem: false }, 3), /in use by 3/);
});

test("a built-in role is never deletable even if unused", () => {
  assert.throws(() => assertDeletable({ isSystem: true }, 0), /locked/);
});

// --- the Finance-role scenario end to end (shape) -------------------------

test("a Finance role granting only payroll access is valid", () => {
  // The exact scenario the feature enables: pay is taken off Manager, and an
  // admin builds a role that sees only salaries.
  const perms = validatePermissions(["payroll.read"]);
  assert.deepEqual(perms, ["payroll.read"]);
  assert.ok(!perms.includes("employee.write"), "Finance sees pay, not the ability to edit people");
});
