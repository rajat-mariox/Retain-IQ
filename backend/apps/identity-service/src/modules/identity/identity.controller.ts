import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerOrgSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type LogoutInput,
  type RefreshInput,
  type RegisterOrgInput,
  type ResetPasswordInput,
} from "@retainiq/contracts";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { IdentityService } from "./identity.service.js";

// The auth controller: sign-up, sign-in and session/password management. None
// of these are permission-gated — you can't hold an org permission before you've
// authenticated. The ones that need a signed-in user carry AuthGuard; the rest
// are pre-auth by nature. @PublicRoute records that intent for the coverage
// check without changing any behaviour.
@Controller("auth")
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  // Register must signal a genuinely new account (a new org has to know sign-up
  // succeeded), so the 409 for a taken email is distinguishable from success and
  // the endpoint can't be made fully opaque like forgot/reset. To keep that from
  // being an email-enumeration oracle, hold register to a stricter per-IP budget
  // than the shared auth default — a handful of attempts per minute is plenty for
  // a real signup but makes probing the user table impractical.
  @Post("register")
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @PublicRoute("sign up a new organization — pre-auth")
  register(@Body(new ZodValidationPipe(registerOrgSchema)) body: RegisterOrgInput) {
    return this.identityService.register(body);
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @PublicRoute("sign in — pre-auth")
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginInput) {
    return this.identityService.login(body);
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @PublicRoute("exchange a refresh token — the token is the credential")
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: RefreshInput) {
    return this.identityService.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  @PublicRoute("end a session by its refresh token")
  async logout(@Body(new ZodValidationPipe(logoutSchema)) body: LogoutInput) {
    await this.identityService.logout(body.refreshToken);
  }

  /** Logout everywhere: revokes every active session for the authenticated user. */
  @Post("logout-all")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @PublicRoute("the caller ends their own sessions (AuthGuard identifies them)")
  async logoutAll() {
    const context = requireTenantContext();
    await this.identityService.logoutAll(context.userId, context.orgId);
  }

  @Get("me")
  @UseGuards(AuthGuard)
  @PublicRoute("the caller's own identity")
  me() {
    const context = requireTenantContext();
    return this.identityService.me(context.userId, context.membershipId);
  }

  @Post("change-password")
  @HttpCode(204)
  @UseGuards(AuthGuard)
  @PublicRoute("the caller changes their own password")
  async changePassword(@Body(new ZodValidationPipe(changePasswordSchema)) body: ChangePasswordInput) {
    await this.identityService.changePassword(requireTenantContext().userId, body);
  }

  @Post("forgot-password")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @PublicRoute("request a password reset — pre-auth")
  async forgotPassword(@Body(new ZodValidationPipe(forgotPasswordSchema)) body: ForgotPasswordInput) {
    return this.identityService.requestPasswordReset(body);
  }

  @Post("reset-password")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @PublicRoute("reset a password with a one-time token — the token is the credential")
  async resetPassword(@Body(new ZodValidationPipe(resetPasswordSchema)) body: ResetPasswordInput) {
    await this.identityService.resetPassword(body);
    return { ok: true };
  }
}
