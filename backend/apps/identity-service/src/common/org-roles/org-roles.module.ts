import { Global, Module } from "@nestjs/common";
import { OrgRolesService } from "./org-roles.service.js";

/**
 * Global so any feature service can ask "who is the Owner here?" without
 * re-deriving it. Payroll, attendance, timesheets and leave all need the same
 * answer, and they must never disagree.
 */
@Global()
@Module({
  providers: [OrgRolesService],
  exports: [OrgRolesService],
})
export class OrgRolesModule {}
