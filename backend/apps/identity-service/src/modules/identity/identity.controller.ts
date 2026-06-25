import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import {
  changePasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerOrgSchema,
  type ChangePasswordInput,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterOrgInput,
} from "@retainiq/contracts";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { IdentityService } from "./identity.service.js";

@Controller("auth")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post("register")
  @UseGuards(ThrottlerGuard)
  register(@Body(new ZodValidationPipe(registerOrgSchema)) body: RegisterOrgInput) {
    return this.identityService.register(body);
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.identityService.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.identityService.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutInput) {
    await this.identityService.logout(body.refreshToken);
  }

  /** Logout everywhere: revokes every active session for the authenticated user. */
  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logoutAll() {
    const context = requireTenantContext();
    await this.identityService.logoutAll(context.userId, context.orgId);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  me() {
    const context = requireTenantContext();
    return this.identityService.me(context.userId, context.membershipId);
  }

  @Post("change-password")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput) {
    await this.identityService.changePassword(requireTenantContext().userId, body);
  }
}
