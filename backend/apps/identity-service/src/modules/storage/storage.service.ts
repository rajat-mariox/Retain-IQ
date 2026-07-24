import { Injectable, Logger, NotFoundException, PayloadTooLargeException, type OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { randomUUID } from "node:crypto";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { permissions } from "@retainiq/authz";
import type { Prisma } from "@retainiq/database/identity";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";
import { BillingReadPrismaService } from "../../common/database/billing-prisma.service.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const MB = 1024 * 1024;
const UPLOAD_URL_TTL_SECONDS = 900;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

export interface StorageUsage {
  usedBytes: number;
  limitBytes: number | null; // null = unlimited
  planId: string | null;
  planName: string | null;
}

/**
 * Employee-screenshot storage. Binaries go to S3 (MinIO locally, AWS S3 in prod);
 * we keep only metadata + size in identity-db. Quota comes from the org's Plan
 * (billing-db, read-only). Uploads are issued as presigned PUT URLs so the client
 * uploads directly to object storage.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly log = new Logger(StorageService.name);
  private readonly s3: S3Client; // server-side ops (internal endpoint)
  private readonly presignS3: S3Client; // presigned URLs the client consumes (public endpoint)
  private readonly bucket = process.env.S3_BUCKET ?? "retainiq-screenshots";

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingReadPrismaService,
    private readonly accessScope: AccessScopeService,
  ) {
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined; // unset → real AWS
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? (endpoint ? "true" : "false")) === "true";
    const credentials =
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined;
    const region = process.env.S3_REGION ?? "us-east-1";

    this.s3 = new S3Client({ region, endpoint, forcePathStyle, credentials });
    // Presigned URLs must point at a host the BROWSER/agent can reach. With MinIO
    // the server talks to http://minio:9000 but clients use http://localhost:9000.
    // In prod (real S3) S3_PUBLIC_ENDPOINT is unset → same as the default endpoint.
    const publicEndpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint;
    this.presignS3 = new S3Client({ region, endpoint: publicEndpoint, forcePathStyle, credentials });
  }

  async onModuleInit(): Promise<void> {
    // Best-effort bucket bootstrap (MinIO / dev). Never block startup on it.
    try {
      await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.log.log(`Created storage bucket "${this.bucket}"`);
      } catch (err) {
        this.log.warn(`Could not ensure storage bucket "${this.bucket}": ${String(err)}`);
      }
    }
  }

  /** Per-org screenshot bytes used (SUM of object sizes). */
  async usedBytes(orgId: string): Promise<number> {
    const agg = await this.prisma.screenshotObject.aggregate({ where: { orgId }, _sum: { sizeBytes: true } });
    return agg._sum.sizeBytes ? Number(agg._sum.sizeBytes) : 0;
  }

  /** The org's plan + storage quota (bytes; null = unlimited). Falls back to Free. */
  async planLimit(orgId: string): Promise<{ planId: string | null; planName: string | null; limitBytes: number | null }> {
    const sub = await this.billing.subscription.findUnique({ where: { orgId }, include: { plan: true } });
    const plan = sub?.plan ?? (await this.billing.plan.findUnique({ where: { id: "free" } }));
    return {
      planId: plan?.id ?? null,
      planName: plan?.name ?? null,
      limitBytes: plan?.storageLimitMb != null ? plan.storageLimitMb * MB : null,
    };
  }

  async usage(orgId: string): Promise<StorageUsage> {
    const [usedBytes, limit] = await Promise.all([this.usedBytes(orgId), this.planLimit(orgId)]);
    return { usedBytes, limitBytes: limit.limitBytes, planId: limit.planId, planName: limit.planName };
  }

  /** Reserve quota + record metadata, and return a presigned PUT URL for the binary. */
  async createUpload(input: {
    orgId: string;
    membershipId: string;
    contentType: string;
    sizeBytes: number;
    capturedAt: Date;
  }): Promise<{ key: string; uploadUrl: string; expiresInSeconds: number }> {
    // The screenshot is ALWAYS attributed to the caller's own membership — the
    // upload is issued to the authenticated employee's agent, so a client can't
    // attribute a capture to someone else. Derived from membershipId, never trusted
    // from the request body.
    const m = await this.prisma.organizationMembership.findUnique({
      where: { id: input.membershipId },
      select: { employeeId: true },
    });
    const employeeId = m?.employeeId ?? null;

    const [used, limit] = await Promise.all([this.usedBytes(input.orgId), this.planLimit(input.orgId)]);
    if (limit.limitBytes != null && used + input.sizeBytes > limit.limitBytes) {
      throw new PayloadTooLargeException(
        `Storage quota exceeded for the ${limit.planName ?? "current"} plan. Upgrade to add more storage.`,
      );
    }

    const ext = EXT[input.contentType] ?? "bin";
    const day = input.capturedAt.toISOString().slice(0, 10);
    const key = `screenshots/${input.orgId}/${employeeId ?? "org"}/${day}/${randomUUID()}.${ext}`;

    await this.prisma.screenshotObject.create({
      data: {
        orgId: input.orgId,
        employeeId,
        key,
        sizeBytes: BigInt(input.sizeBytes),
        contentType: input.contentType,
        capturedAt: input.capturedAt,
      },
    });

    const uploadUrl = await getSignedUrl(
      this.presignS3,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }),
      { expiresIn: UPLOAD_URL_TTL_SECONDS },
    );
    return { key, uploadUrl, expiresInSeconds: UPLOAD_URL_TTL_SECONDS };
  }

  /**
   * Screenshots grouped by employee (gallery folders). Visibility is DYNAMIC,
   * driven by the caller's role grants + scope (AccessScopeService): org-wide,
   * a set of departments/teams, or just their own — no hardcoded role names.
   */
  async screenshotsByEmployee(input: { orgId: string; userId: string }) {
    const scope = await this.accessScope.resolveScope(input.orgId, input.userId, permissions.screenshotsRead);
    const visible = await this.accessScope.visibleEmployeeIds(input.orgId, scope);
    const where: Prisma.ScreenshotObjectWhereInput = { orgId: input.orgId };
    if (visible !== null) where.employeeId = { in: visible };

    const groups = await this.prisma.screenshotObject.groupBy({
      by: ["employeeId"],
      where,
      _count: { _all: true },
      _sum: { sizeBytes: true },
      _max: { capturedAt: true },
    });
    const ids = groups.map((g) => g.employeeId).filter((x): x is string => Boolean(x));
    const emps = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true, title: true } });
    const byId = new Map(emps.map((e) => [e.id, e]));

    const items = groups
      .map((g) => {
        const e = g.employeeId ? byId.get(g.employeeId) : null;
        return {
          employeeId: g.employeeId,
          name: e ? `${e.firstName} ${e.lastName}`.trim() : "Unassigned",
          title: e?.title ?? null,
          count: g._count._all,
          totalBytes: g._sum.sizeBytes ? Number(g._sum.sizeBytes) : 0,
          lastCapturedAt: g._max.capturedAt ? g._max.capturedAt.toISOString() : null,
        };
      })
      .sort((a, b) => (b.lastCapturedAt ?? "").localeCompare(a.lastCapturedAt ?? ""));
    return { items };
  }

  /**
   * Paginated screenshot list, with presigned view URLs + employee names. Owners
   * and Managers see the whole org (optionally filtered to one employee); everyone
   * else sees only their own. RBAC enforced upstream.
   */
  async listScreenshots(input: { orgId: string; userId: string; employeeId?: string; page: number; pageSize: number }) {
    const scope = await this.accessScope.resolveScope(input.orgId, input.userId, permissions.screenshotsRead);
    const visible = await this.accessScope.visibleEmployeeIds(input.orgId, scope);
    const where: Prisma.ScreenshotObjectWhereInput = { orgId: input.orgId };
    if (visible === null) {
      // org tier: optionally narrow to a requested employee.
      if (input.employeeId) where.employeeId = input.employeeId;
    } else {
      // scoped/self: restrict to visible ids, honouring a requested employee if allowed.
      const allowed = input.employeeId && visible.includes(input.employeeId) ? [input.employeeId] : visible;
      where.employeeId = { in: allowed };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.screenshotObject.findMany({
        where,
        orderBy: { capturedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: { id: true, employeeId: true, key: true, sizeBytes: true, contentType: true, capturedAt: true },
      }),
      this.prisma.screenshotObject.count({ where }),
    ]);

    const ids = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => Boolean(x)))];
    const emps = await this.prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
    const nameById = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.lastName}`.trim()]));

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        employeeId: r.employeeId,
        employeeName: r.employeeId ? (nameById.get(r.employeeId) ?? "Unknown") : "Unassigned",
        sizeBytes: Number(r.sizeBytes),
        contentType: r.contentType,
        capturedAt: r.capturedAt.toISOString(),
        viewUrl: await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: r.key }), { expiresIn: UPLOAD_URL_TTL_SECONDS }),
      })),
    );
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  /**
   * A person's OWN screenshots — always hard-scoped to the caller's own employee
   * record (resolved from their membership), never a query param and never
   * anyone else's. This is the employee self-view: it needs no screenshots.read
   * permission (that permission is the manager/admin gallery), so an employee can
   * see their own captured activity for transparency without being able to browse
   * the surveillance gallery of the whole org.
   */
  async listOwnScreenshots(input: { orgId: string; membershipId: string; page: number; pageSize: number }) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { id: input.membershipId, orgId: input.orgId },
      select: { employeeId: true },
    });
    // No linked employee (e.g. an Owner-only account) has no personal captures.
    if (!membership?.employeeId) {
      return { items: [], total: 0, page: input.page, pageSize: input.pageSize };
    }
    const where: Prisma.ScreenshotObjectWhereInput = { orgId: input.orgId, employeeId: membership.employeeId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.screenshotObject.findMany({
        where,
        orderBy: { capturedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: { id: true, employeeId: true, key: true, sizeBytes: true, contentType: true, capturedAt: true },
      }),
      this.prisma.screenshotObject.count({ where }),
    ]);

    const items = await Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        employeeId: r.employeeId,
        sizeBytes: Number(r.sizeBytes),
        contentType: r.contentType,
        capturedAt: r.capturedAt.toISOString(),
        viewUrl: await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: r.key }), { expiresIn: UPLOAD_URL_TTL_SECONDS }),
      })),
    );
    return { items, total, page: input.page, pageSize: input.pageSize };
  }

  /**
   * Delete a screenshot from BOTH object storage and the database. Org-scoped;
   * permission (Owner-only by default) is enforced upstream.
   *
   * Storage is deleted FIRST: S3 DeleteObject is idempotent (no error if the key
   * is already gone), so a thrown error is a real failure — we let it propagate
   * and DON'T delete the metadata, rather than orphan the object in S3/MinIO.
   */
  async deleteScreenshot(orgId: string, id: string): Promise<{ id: string }> {
    const obj = await this.prisma.screenshotObject.findFirst({ where: { id, orgId }, select: { key: true } });
    if (!obj) {
      throw new NotFoundException("Screenshot not found.");
    }
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.key }));
    await this.prisma.screenshotObject.delete({ where: { id } });
    this.log.log(`Deleted screenshot ${id} (object + metadata) for org ${orgId}`);
    return { id };
  }

  /** Delete every screenshot older than the org's retention window (S3 + metadata). Returns the count. */
  async purgeOrgExpired(orgId: string, retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const expired = await this.prisma.screenshotObject.findMany({ where: { orgId, capturedAt: { lt: cutoff } }, select: { id: true, key: true } });
    let deleted = 0;
    for (const obj of expired) {
      try {
        await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: obj.key }));
        await this.prisma.screenshotObject.delete({ where: { id: obj.id } });
        deleted += 1;
      } catch (err) {
        this.log.warn(`Retention purge: failed to delete screenshot ${obj.id}: ${String(err)}`);
      }
    }
    if (deleted > 0) this.log.log(`Retention purge: removed ${deleted} screenshots for org ${orgId} (older than ${retentionDays}d)`);
    return deleted;
  }

  /** Purge the caller's org now, using its configured retention window (manual "purge now"). */
  async purgeRequestOrg(): Promise<{ deleted: number; retentionDays: number }> {
    const ctx = requireTenantContext();
    const policy = await this.prisma.monitoringPolicy.findUnique({ where: { orgId: ctx.orgId }, select: { screenshotRetentionDays: true } });
    const retentionDays = policy?.screenshotRetentionDays ?? 0;
    return { deleted: await this.purgeOrgExpired(ctx.orgId, retentionDays), retentionDays };
  }

  /** Daily auto-purge across every org that has a retention window configured. */
  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredScreenshots(): Promise<void> {
    const policies = await this.prisma.monitoringPolicy.findMany({
      where: { screenshotRetentionDays: { gt: 0 } },
      select: { orgId: true, screenshotRetentionDays: true },
    });
    let total = 0;
    for (const p of policies) total += await this.purgeOrgExpired(p.orgId, p.screenshotRetentionDays);
    if (total > 0) this.log.log(`Retention purge complete: ${total} screenshots across ${policies.length} org(s)`);
  }
}
