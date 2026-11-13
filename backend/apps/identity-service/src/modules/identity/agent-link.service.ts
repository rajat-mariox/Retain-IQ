import { ForbiddenException, Injectable, OnModuleDestroy, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { loadConfig } from "@retainiq/config";
import type { AuthTokens } from "@retainiq/contracts";
import { Redis } from "ioredis";
import { AuditService } from "../../common/audit/audit.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { RealtimePublisher } from "../../common/realtime/realtime-publisher.service.js";
import { OWNER_ROLE } from "../../common/security/roles.util.js";
import { IdentityService } from "./identity.service.js";

const config = loadConfig();

/** How long a link code is valid. Short: the browser hands it straight to the agent. */
const CODE_TTL_SECONDS = 60;
/** The agent pings every 60s; a little slack so one missed ping doesn't flip the status. */
const HEARTBEAT_TTL_SECONDS = 150;

const CODE_PREFIX = "agent:link:";
const SEEN_PREFIX = "agent:seen:";
const SIGNOUT_PREFIX = "agent:signout:";
/** How long a sign-out request waits for an agent that's offline (e.g. laptop shut). */
const SIGNOUT_TTL_SECONDS = 7 * 24 * 60 * 60;

type CodeRecord = { membershipId: string; userId: string; orgId: string };

/**
 * Signs the desktop agent in from the web panel without a second password entry.
 *
 * 1. The signed-in panel asks for a link code (`issueCode`). The code is random,
 *    single-use, lives 60s, and only its hash is stored, so a leaked Redis dump or
 *    log line can't be replayed.
 * 2. The panel opens `retainiq://login?code=…`; the agent trades the code for its
 *    OWN refresh session (`exchange`). The panel's token never leaves the browser.
 *
 * Only tracked staff can use the agent: the Owner runs the org and isn't
 * monitored, so both steps refuse an Owner membership.
 *
 * The agent also reports a heartbeat so the panel can show whether it's running.
 */
@Injectable()
export class AgentLinkService implements OnModuleDestroy {
  private readonly redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: true });

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimePublisher,
  ) {
    void this.redis.connect().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }

  /** Mint a one-time code for the caller's own membership. */
  async issueCode(userId: string, membershipId: string): Promise<{ code: string; expiresAt: string }> {
    const m = await this.activeMembership(membershipId, userId);
    this.assertTracked(m.roleName);
    const code = randomBytes(24).toString("base64url");
    const record: CodeRecord = { membershipId: m.id, userId: m.userId, orgId: m.orgId };
    try {
      await this.redis.set(CODE_PREFIX + hash(code), JSON.stringify(record), "EX", CODE_TTL_SECONDS);
    } catch {
      throw new ServiceUnavailableException("Couldn't prepare the agent sign-in. Please try again.");
    }
    return { code, expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString() };
  }

  /** Trade a code for a fresh agent session. Single use: the code is deleted as it's read. */
  async exchange(code: string): Promise<AuthTokens> {
    let raw: string | null = null;
    try {
      raw = await this.redis.getdel(CODE_PREFIX + hash(code));
    } catch {
      throw new ServiceUnavailableException("Couldn't verify the sign-in link. Please try again.");
    }
    if (!raw) throw new UnauthorizedException("This sign-in link has expired or was already used. Open the agent from the web panel again.");
    const record = JSON.parse(raw) as CodeRecord;

    // Re-check at exchange time: the person may have been deactivated or made Owner in the last minute.
    const m = await this.activeMembership(record.membershipId, record.userId);
    this.assertTracked(m.roleName);
    const tokens = await this.identity.issueForMembership(m.id);
    await this.audit.record({
      orgId: m.orgId,
      actorUserId: m.userId,
      action: "auth.agent.linked",
      resourceType: "user",
      resourceId: m.userId,
    });
    return tokens;
  }

  /**
   * The agent is alive for this membership. The reply carries the time of the
   * last web-panel logout, so an agent signed in BEFORE it signs itself out even
   * if it was offline when the live signal went out.
   */
  async heartbeat(membershipId: string): Promise<{ signOutBefore: string | null }> {
    try {
      await this.redis.set(SEEN_PREFIX + membershipId, new Date().toISOString(), "EX", HEARTBEAT_TTL_SECONDS);
      return { signOutBefore: await this.redis.get(SIGNOUT_PREFIX + membershipId) };
    } catch {
      // Best effort: the status just reads "not connected" until Redis is back.
      return { signOutBefore: null };
    }
  }

  /**
   * The person logged out of the web panel: their desktop agent should sign out
   * and close. Sent live on their realtime channel (instant if the agent is
   * running) and remembered for the heartbeat (if it's offline right now).
   * Agents signed in after this moment are unaffected.
   */
  async requestSignOut(userId: string, orgId: string): Promise<void> {
    const m = await this.prisma.organizationMembership.findFirst({ where: { userId, orgId }, select: { id: true } });
    if (!m) return;
    const at = new Date().toISOString();
    try {
      await this.redis.set(SIGNOUT_PREFIX + m.id, at, "EX", SIGNOUT_TTL_SECONDS);
      await this.redis.del(SEEN_PREFIX + m.id);
    } catch {
      // The live signal below still reaches a running agent.
    }
    await this.realtime.publishToUser(userId, { type: "agent.signout", at });
  }

  /** What the panel shows: is this person tracked, and is their agent running right now? */
  async status(userId: string, membershipId: string): Promise<{ tracked: boolean; connected: boolean; lastSeenAt: string | null }> {
    const m = await this.activeMembership(membershipId, userId);
    const tracked = m.roleName !== OWNER_ROLE;
    let lastSeenAt: string | null = null;
    if (tracked) {
      try {
        lastSeenAt = await this.redis.get(SEEN_PREFIX + membershipId);
      } catch {
        lastSeenAt = null;
      }
    }
    return { tracked, connected: Boolean(lastSeenAt), lastSeenAt };
  }

  private assertTracked(roleName: string): void {
    if (roleName === OWNER_ROLE) {
      throw new ForbiddenException("Owner accounts aren't tracked, so the desktop agent isn't used. Please use the web panel.");
    }
  }

  private async activeMembership(membershipId: string, userId: string) {
    const m = await this.prisma.organizationMembership.findFirst({
      where: { id: membershipId, userId, status: "ACTIVE", employeeId: { not: null }, org: { status: "ACTIVE" }, user: { status: "ACTIVE" } },
      select: { id: true, userId: true, orgId: true, role: { select: { name: true } } },
    });
    if (!m) throw new UnauthorizedException("Your account is no longer active.");
    return { id: m.id, userId: m.userId, orgId: m.orgId, roleName: m.role.name };
  }
}

function hash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}
