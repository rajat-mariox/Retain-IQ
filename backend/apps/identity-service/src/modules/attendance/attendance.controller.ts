import { Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { AttendanceService } from "./attendance.service.js";

@Controller("attendance")
@UseGuards(AuthGuard, TenantGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  /** Self check-in for the calling employee. */
  @Post("check-in")
  @HttpCode(200)
  checkIn() {
    return this.attendance.checkIn();
  }

  /** Self check-out. */
  @Post("check-out")
  @HttpCode(200)
  checkOut() {
    return this.attendance.checkOut();
  }

  /** The caller's own attendance (today + recent history). */
  @Get("me")
  me() {
    return this.attendance.me();
  }

  /** Org-wide attendance for today — requires attendance.read. */
  @Get("today")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.attendanceRead)
  today() {
    return this.attendance.today();
  }
}
