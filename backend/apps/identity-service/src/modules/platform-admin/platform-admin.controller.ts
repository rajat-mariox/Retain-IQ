import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { CurrentAdmin, PlatformAuthGuard } from "./platform-auth.guard.js";
import { PlatformAdminService } from "./platform-admin.service.js";
import {
  platformLoginSchema,
  platformLogoutSchema,
  platformRefreshSchema,
  platformResetPasswordSchema,
  platformForgotPasswordSchema,
  type PlatformLoginInput,
  type PlatformLogoutInput,
  type PlatformRefreshInput,
  type PlatformForgotPasswordInput,
  type PlatformResetPasswordInput,
} from "./dto.js";

@Controller("platform/auth")
export class PlatformAdminController {
  constructor(private readonly service: PlatformAdminService) {}

  @Post("login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  login(@Body(new ZodValidationPipe(platformLoginSchema)) body: PlatformLoginInput) {
    return this.service.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  refresh(@Body(new ZodValidationPipe(platformRefreshSchema)) body: PlatformRefreshInput) {
    return this.service.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  async logout(@Body(new ZodValidationPipe(platformLogoutSchema)) body: PlatformLogoutInput) {
    await this.service.logout(body.refreshToken);
  }

  @Post("forgot-password")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async forgotPassword(@Body(new ZodValidationPipe(platformForgotPasswordSchema)) body: PlatformForgotPasswordInput) {
    return this.service.requestPasswordReset(body);
  }

  @Post("reset-password")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async resetPassword(@Body(new ZodValidationPipe(platformResetPasswordSchema)) body: PlatformResetPasswordInput) {
    await this.service.resetPassword(body);
    return { ok: true };
  }

  @Get("me")
  @UseGuards(PlatformAuthGuard)
  me(@CurrentAdmin() admin: { id: string }) {
    return this.service.me(admin.id);
  }
}
