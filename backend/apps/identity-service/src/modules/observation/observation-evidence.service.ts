import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";

const URL_TTL = 900; // 15 min
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * Supporting evidence on an observation (screenshots, documents). Binaries live
 * in S3/MinIO; this issues presigned PUT/GET URLs and records metadata. Modeled
 * verbatim on LeaveAttachmentService (dual-S3-client), keyed by observationId.
 * Access follows the observation's reach (whoever can see the observation).
 */
@Injectable()
export class ObservationEvidenceService {
  private readonly log = new Logger(ObservationEvidenceService.name);
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket = process.env.S3_BUCKET ?? "retainiq-screenshots";

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessScope: AccessScopeService,
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

  /** Confirm the observation exists and the caller may see it (NotFound if out of reach). */
  private async assertObservationAccess(orgId: string, observationId: string) {
    const ctx = requireTenantContext();
    const obs = await this.prisma.observation.findFirst({ where: { id: observationId, orgId }, select: { employeeId: true } });
    if (!obs) throw new NotFoundException("Observation not found.");
    if (ctx.role === "Owner") return;
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permissions.observationRead);
    if (scope.tier === "org") return;
    const rows = await this.prisma.employee.findMany({ where: { orgId, ...this.accessScope.employeeWhere(scope) }, select: { id: true } });
    if (!rows.some((r) => r.id === obs.employeeId)) throw new NotFoundException("Observation not found.");
  }

  async createUpload(observationId: string, input: { fileName: string; contentType: string; sizeBytes: number }) {
    const ctx = requireTenantContext();
    await this.assertObservationAccess(ctx.orgId, observationId);
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
      throw new ForbiddenException(`Evidence must be between 1 byte and ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
    }
    const safeName = input.fileName.replace(/[^\w.-]+/g, "_").slice(0, 160);
    const key = `observation/${ctx.orgId}/${observationId}/${randomUUID()}-${safeName}`;
    const row = await this.prisma.observationEvidence.create({
      data: { orgId: ctx.orgId, observationId, fileName: input.fileName.slice(0, 200), key, sizeBytes: BigInt(input.sizeBytes), contentType: input.contentType, uploadedBy: ctx.userId },
      select: { id: true },
    });
    const uploadUrl = await getSignedUrl(this.presignS3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }), { expiresIn: URL_TTL });
    return { id: row.id, key, uploadUrl, expiresInSeconds: URL_TTL };
  }

  async list(observationId: string) {
    const ctx = requireTenantContext();
    await this.assertObservationAccess(ctx.orgId, observationId);
    const rows = await this.prisma.observationEvidence.findMany({ where: { orgId: ctx.orgId, observationId }, orderBy: { createdAt: "desc" } });
    return Promise.all(
      rows.map(async (a) => ({
        id: a.id,
        fileName: a.fileName,
        sizeBytes: Number(a.sizeBytes),
        contentType: a.contentType,
        createdAt: a.createdAt.toISOString(),
        viewUrl: await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: a.key }), { expiresIn: URL_TTL }),
      })),
    );
  }

  async delete(observationId: string, evidenceId: string) {
    const ctx = requireTenantContext();
    await this.assertObservationAccess(ctx.orgId, observationId);
    const row = await this.prisma.observationEvidence.findFirst({ where: { id: evidenceId, orgId: ctx.orgId, observationId }, select: { id: true, key: true } });
    if (!row) throw new NotFoundException("Evidence not found.");
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.key }));
    await this.prisma.observationEvidence.delete({ where: { id: row.id } });
    this.log.log(`Deleted observation evidence ${evidenceId} for org ${ctx.orgId}`);
    return { id: evidenceId, deleted: true };
  }
}
