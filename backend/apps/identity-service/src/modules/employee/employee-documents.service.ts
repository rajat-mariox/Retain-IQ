import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";

const URL_TTL = 900;
const CATEGORIES = ["OFFER_LETTER", "CONTRACT", "ID_PROOF", "COMPLIANCE", "OTHER"] as const;

/** Employee documents (offer letters, contracts, ID proofs, compliance). Binaries in S3/MinIO. */
@Injectable()
export class EmployeeDocumentsService {
  private readonly log = new Logger(EmployeeDocumentsService.name);
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

  private async assertEmployee(orgId: string, employeeId: string) {
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
  }

  /** Record metadata + return a presigned PUT URL for the binary. */
  async createUpload(employeeId: string, input: { fileName: string; category: string; contentType: string; sizeBytes: number }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId);
    const category = (CATEGORIES as readonly string[]).includes(input.category) ? input.category : "OTHER";
    const safeName = input.fileName.replace(/[^\w.-]+/g, "_").slice(0, 160);
    const key = `documents/${ctx.orgId}/${employeeId}/${randomUUID()}-${safeName}`;

    const doc = await this.prisma.employeeDocument.create({
      data: { orgId: ctx.orgId, employeeId, category, fileName: input.fileName.slice(0, 200), key, sizeBytes: BigInt(input.sizeBytes), contentType: input.contentType, uploadedBy: ctx.userId },
      select: { id: true },
    });
    const uploadUrl = await getSignedUrl(this.presignS3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }), { expiresIn: URL_TTL });
    return { id: doc.id, key, uploadUrl, expiresInSeconds: URL_TTL };
  }

  /** List an employee's documents with short-lived view URLs. */
  async list(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId);
    const rows = await this.prisma.employeeDocument.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: { createdAt: "desc" } });
    return Promise.all(
      rows.map(async (d) => ({
        id: d.id,
        category: d.category,
        fileName: d.fileName,
        sizeBytes: Number(d.sizeBytes),
        contentType: d.contentType,
        createdAt: d.createdAt.toISOString(),
        viewUrl: await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: d.key }), { expiresIn: URL_TTL }),
      })),
    );
  }

  async delete(documentId: string) {
    const ctx = requireTenantContext();
    const doc = await this.prisma.employeeDocument.findFirst({ where: { id: documentId, orgId: ctx.orgId }, select: { id: true, key: true } });
    if (!doc) throw new NotFoundException("Document not found.");
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: doc.key }));
    await this.prisma.employeeDocument.delete({ where: { id: doc.id } });
    this.log.log(`Deleted employee document ${documentId} for org ${ctx.orgId}`);
    return { id: documentId, deleted: true };
  }
}
