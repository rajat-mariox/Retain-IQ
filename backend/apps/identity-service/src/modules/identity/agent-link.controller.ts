import { Body, Controller, Get, HttpCode, Post, UseGuards } from "@nestjs/common";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { z } from "zod";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PublicRoute } from "../../common/decorators/public-route.decorator.js";
import { AuthGuard } from "../../common/guards/auth.guard.js";
import { ZodValidationPipe } from "../../common/pipes/zod-validation.pipe.js";
import { AgentLinkService } from "./agent-link.service.js";

const exchangeSchema = z.object({ code: z.string().min(16).max(128) });
type ExchangeInput = z.infer<typeof exchangeSchema>;

/**
 * Desktop-agent sign-in from the web panel (see AgentLinkService). Each route
 * acts only on the caller's own membership, so none is permission-gated.
 */
@Controller("auth/agent")
export class AgentLinkController {
  constructor(private readonly agentLink: AgentLinkService) {}

  @Post("link-code")
  @HttpCode(200)
  @UseGuards(AuthGuard, ThrottlerGuard)
  @PublicRoute("the caller mints a one-time code for their own agent sign-in")
  linkCode() {
    const ctx = requireTenantContext();
    return this.agentLink.issueCode(ctx.userId, ctx.membershipId);
  }

  @Post("exchange")
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @PublicRoute("trade a one-time link code for an agent session — the code is the credential")
  exchange(@Body(new ZodValidationPipe(exchangeSchema)) body: ExchangeInput) {
    return this.agentLink.exchange(body.code);
  }

  @Post("heartbeat")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @PublicRoute("the caller's agent reports it is running")
  heartbeat() {
    return this.agentLink.heartbeat(requireTenantContext().membershipId);
  }

  @Get("status")
  @UseGuards(AuthGuard)
  @PublicRoute("the caller's own agent connection status")
  status() {
    const ctx = requireTenantContext();
    return this.agentLink.status(ctx.userId, ctx.membershipId);
  }
}
