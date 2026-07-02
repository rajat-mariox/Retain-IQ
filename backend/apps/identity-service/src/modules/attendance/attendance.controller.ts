import { Controller, Get, HttpCode, Post, Query, UseGuards } from "@nestjs/common";
import { permissions } from "@retainiq/authz";
import { RequirePermissions } from "../../common/decorators/permissions.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { PermissionGuard } from "../../common/guards/permission.guard.js";
import { TenantGuard } from "../../common/guards/tenant.guard.js";
import { RequireFeature } from "../../common/settings/require-feature.decorator.js";
import { AttendanceService } from "./attendance.service.js";

@Controller("attendance")
@RequireFeature("attendance")
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

  /** Full per-employee attendance roster for today (admin view) — requires attendance.read. */
  @Get("roster")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.attendanceRead)
  roster() {
    return this.attendance.roster();
  }

  /** Daily Attendance report — per-employee for a given day (default today). */
  @Get("report/daily")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.attendanceRead)
  reportDaily(@Query("day") day?: string) {
    return this.attendance.reportDaily(day);
  }

  /** Monthly Attendance report — per-employee counts across the month (default current). */
  @Get("report/monthly")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.attendanceRead)
  reportMonthly(@Query("month") month?: string) {
    return this.attendance.reportMonthly(month);
  }

  /** Department Attendance report — grouped by department for a given day. */
  @Get("report/department")
  @UseGuards(PermissionGuard)
  @RequirePermissions(permissions.attendanceRead)
  reportDepartment(@Query("day") day?: string) {
    return this.attendance.reportDepartment(day);
  }
}
