import assert from "node:assert/strict";
import { test } from "node:test";
import { allPermissions, missingPermissions, permissions } from "@retainiq/authz";

test("missingPermissions returns empty when all required are granted", () => {
  const granted = [permissions.employeeRead, permissions.employeeWrite];
  assert.deepEqual(missingPermissions(granted, [permissions.employeeRead]), []);
});

test("missingPermissions reports the permissions that are absent", () => {
  const granted = [permissions.employeeRead];
  assert.deepEqual(missingPermissions(granted, [permissions.employeeWrite]), [
    permissions.employeeWrite,
  ]);
});

test("missingPermissions handles multiple required permissions", () => {
  const granted = [permissions.employeeRead];
  const missing = missingPermissions(granted, [
    permissions.employeeRead,
    permissions.employeeWrite,
    permissions.payrollApprove,
  ]);
  assert.deepEqual(missing, [permissions.employeeWrite, permissions.payrollApprove]);
});

test("the Owner bundle (allPermissions) satisfies every known permission", () => {
  assert.deepEqual(missingPermissions(allPermissions, allPermissions), []);
});
