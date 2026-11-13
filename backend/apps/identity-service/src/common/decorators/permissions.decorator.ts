import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@retainiq/authz";

export const PERMISSIONS_KEY = "permissions";

export function RequirePermissions(...permissions: Permission[]) {
  return SetMetadata(PERMISSIONS_KEY, permissions);
}

