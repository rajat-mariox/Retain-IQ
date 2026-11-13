import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { OutboxService } from "../../common/outbox/outbox.service.js";
import { logger as log } from "../../common/observability/observability.js";
import { AttendanceService } from "../attendance/attendance.service.js";
import { toCsv, toXlsx, exportMeta, type ReportTable } from "../../common/reports/report-export.js";

const URL_TTL = 3600; // 1h download link
type Job = { id: string; orgId: string; requestedBy: string; kind: string; params: unknown; format: string };

/**
 * Asynchronous report generation. A request enqueues a PENDING ReportJob; a cron
 * sweep builds the report off the request path, renders it to CSV/xlsx, uploads
 * the file to S3, stamps the job DONE, and notifies the requester with a download
 * link. This keeps large exports from timing out the HTTP request, and is the
 * seam a future dedicated worker/queue can take over unchanged.
 */
@Injectable()
export class ReportJobsService {
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket = process.env.S3_BUCKET ?? "retainiq-screenshots";

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly attendance: AttendanceService,
  ) {
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? (endpoint ? "true" : "false")) === "true";
    const credentials =
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined;
    const region = process.env.S3_REGION ?? "us-east-1";
    this.s3 = new S3Client({ region, endpoint, forcePathStyle, credentials });
    this.presignS3 = new S3Client({ region, endpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint, forcePathStyle, credentials });
  }

  /** Queue a report to be built asynchronously. Returns the job id. */
  async enqueue(input: { kind: string; params: Record<string, unknown>; format?: string }) {
    const ctx = requireTenantContext();
    const format = input.format === "xlsx" ? "xlsx" : "csv";
    const job = await this.prisma.reportJob.create({
      data: { orgId: ctx.orgId, requestedBy: ctx.userId, kind: input.kind, params: input.params as object, format, status: "PENDING" },
      select: { id: true },
    });
    return { id: job.id, status: "PENDING" as const };
  }

  /** The caller's report jobs, newest first. */
  async list() {
    const ctx = requireTenantContext();
    const rows = await this.prisma.reportJob.findMany({ where: { orgId: ctx.orgId, requestedBy: ctx.userId }, orderBy: { createdAt: "desc" }, take: 50 });
    return rows.map((r) => ({
      id: r.id, kind: r.kind, format: r.format, status: r.status,
      fileName: r.fileName, rowCount: r.rowCount, error: r.error,
      createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null,
    }));
  }

  /** A short-lived presigned download URL for a completed job's file. */
  async downloadUrl(id: string) {
    const ctx = requireTenantContext();
    const job = await this.prisma.reportJob.findFirst({ where: { id, orgId: ctx.orgId, requestedBy: ctx.userId } });
    if (!job || job.status !== "DONE" || !job.fileKey) throw new NotFoundException("Report not ready.");
    const url = await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: job.fileKey }), { expiresIn: URL_TTL });
    return { url, fileName: job.fileName, expiresInSeconds: URL_TTL };
  }

  // ---- Worker: process PENDING jobs (called by the cron) ----

  async processPending(limit = 5): Promise<number> {
    const jobs = await this.prisma.reportJob.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: limit });
    let done = 0;
    for (const j of jobs) {
      // Claim the job (atomic guard against a second worker picking it up).
      const claimed = await this.prisma.reportJob.updateMany({ where: { id: j.id, status: "PENDING" }, data: { status: "RUNNING", startedAt: new Date() } });
      if (claimed.count === 0) continue;
      try {
        await this.run({ id: j.id, orgId: j.orgId, requestedBy: j.requestedBy, kind: j.kind, params: j.params, format: j.format });
        done += 1;
      } catch (err) {
        await this.prisma.reportJob.update({ where: { id: j.id }, data: { status: "FAILED", error: String(err).slice(0, 500), completedAt: new Date() } });
        log.warn({ err: String(err), jobId: j.id }, "report job failed");
      }
    }
    return done;
  }

  /** Build → render → upload → mark DONE → notify. Runs as the job's requester's org. */
  private async run(job: Job): Promise<void> {
    const table = await this.buildTable(job);
    const meta = exportMeta(`${job.kind}-report`, job.format === "xlsx" ? "xlsx" : "csv");
    const body = job.format === "xlsx" ? toXlsx(job.kind, table) : Buffer.from(String.fromCharCode(0xfeff) + toCsv(table), "utf8");
    const key = `reports/${job.orgId}/${randomUUID()}-${meta.filename}`;
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: meta.contentType }));

    await this.prisma.reportJob.update({
      where: { id: job.id },
      data: { status: "DONE", fileKey: key, fileName: meta.filename, rowCount: table.rows.length, completedAt: new Date() },
    });
    await this.prisma.$transaction(async (tx) => {
      await this.outbox.enqueue(tx, {
        eventType: "report.ready",
        aggregateType: "report",
        aggregateId: `reportjob:${job.id}`,
        orgId: job.orgId,
        payload: { requesterUserId: job.requestedBy, kind: job.kind, fileName: meta.filename, rows: table.rows.length, jobId: job.id, link: "/reports" },
      });
    });
    log.info({ jobId: job.id, rows: table.rows.length }, "report job completed");
  }

  /**
   * Build the table for a job. The job's params drive the same buildReport /
   * export methods the synchronous endpoints use, run as the requester so reach
   * is honoured. Only whitelisted kinds are accepted.
   */
  private async buildTable(job: Job): Promise<ReportTable> {
    const p = (job.params ?? {}) as Record<string, unknown>;
    const s = (v: unknown) => (typeof v === "string" ? v : undefined);
    if (job.kind === "attendance") {
      const report = await this.attendance.buildReport(
        { scope: s(p.scope), scopeId: s(p.scopeId) ?? null, period: s(p.period), from: s(p.from), to: s(p.to) },
        job.orgId,
        job.requestedBy,
      );
      const columns = typeof p.columns === "string" ? p.columns.split(",").map((c) => c.trim()).filter(Boolean) : undefined;
      const t = this.attendance.reportTable(report, columns);
      return { columns: t.columns, rows: t.rows };
    }
    throw new Error(`Unknown report kind: ${job.kind}`);
  }
}
