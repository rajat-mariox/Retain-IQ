import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const URL_TTL = 900;
const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Evidence on an incident (S3/MinIO presign, like ObservationEvidenceService).
 * Access is gated at the route by incident.manage, so this only confirms the
 * incident exists in the tenant.
 */
@Injectable()
export class IncidentEvidenceService {
  private readonly log = new Logger(IncidentEvidenceService.name);
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket = process.env.S3_BUCKET ?? "retainiq-screenshots";

  constructor(private readonly prisma: PrismaService) {
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

  private async assertIncident(orgId: string, incidentId: string) {
    const inc = await this.prisma.incident.findFirst({ where: { id: incidentId, orgId }, select: { id: true } });
    if (!inc) throw new NotFoundException("Incident not found.");
  }

  async createUpload(incidentId: string, input: { fileName: string; contentType: string; sizeBytes: number }) {
    const ctx = requireTenantContext();
    await this.assertIncident(ctx.orgId, incidentId);
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) throw new ForbiddenException(`Evidence must be between 1 byte and ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
    const safeName = input.fileName.replace(/[^\w.-]+/g, "_").slice(0, 160);
    const key = `incident/${ctx.orgId}/${incidentId}/${randomUUID()}-${safeName}`;
    const row = await this.prisma.incidentEvidence.create({
      data: { orgId: ctx.orgId, incidentId, fileName: input.fileName.slice(0, 200), key, sizeBytes: BigInt(input.sizeBytes), contentType: input.contentType, uploadedBy: ctx.userId },
      select: { id: true },
    });
    // Record it on the timeline for the audit trail.
    await this.prisma.incidentEvent.create({ data: { orgId: ctx.orgId, incidentId, kind: "EVIDENCE_ADDED", actorUserId: ctx.userId, note: input.fileName.slice(0, 200) } });
    const uploadUrl = await getSignedUrl(this.presignS3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }), { expiresIn: URL_TTL });
    return { id: row.id, key, uploadUrl, expiresInSeconds: URL_TTL };
  }

  async list(incidentId: string) {
    const ctx = requireTenantContext();
    await this.assertIncident(ctx.orgId, incidentId);
    const rows = await this.prisma.incidentEvidence.findMany({ where: { orgId: ctx.orgId, incidentId }, orderBy: { createdAt: "desc" } });
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

  async delete(incidentId: string, evidenceId: string) {
    const ctx = requireTenantContext();
    await this.assertIncident(ctx.orgId, incidentId);
    const row = await this.prisma.incidentEvidence.findFirst({ where: { id: evidenceId, orgId: ctx.orgId, incidentId }, select: { id: true, key: true } });
    if (!row) throw new NotFoundException("Evidence not found.");
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: row.key }));
    await this.prisma.incidentEvidence.delete({ where: { id: row.id } });
    this.log.log(`Deleted incident evidence ${evidenceId} for org ${ctx.orgId}`);
    return { id: evidenceId, deleted: true };
  }
}
