import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { addMemberSchema, type AddMemberInput } from "./dto.js";
import { MembersService } from "./members.service.js";

@Controller("members")
@UseGuards(AuthGuard, TenantGuard, PermissionGuard)
export class MembersController {
  constructor(private readonly members: MembersService) {}

  /** Add a teammate (employee + login). Requires employee.write (Owner/Manager). */
  @Post()
  @RequirePermissions(permissions.employeeWrite)
  addMember(@Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput) {
    return this.members.addMember(body);
  }
}
