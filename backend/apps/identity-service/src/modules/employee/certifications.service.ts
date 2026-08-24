import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { permissions } from "@retainiq/authz";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { AccessScopeService } from "../../common/access-scope/access-scope.service.js";

const URL_TTL = 900;
const EXPIRY_SOON_DAYS = 90; // within this many days of expiry → "Expiring soon"

export type CertExpiry = "VALID" | "EXPIRING_SOON" | "EXPIRED" | "NO_EXPIRY";

/** Days until expiry (negative = already expired), or null if the cert never expires. */
function daysUntil(expiresAt: Date | null): number | null {
  if (!expiresAt) return null;
  const today = new Date();
  const t0 = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const t1 = Date.UTC(expiresAt.getUTCFullYear(), expiresAt.getUTCMonth(), expiresAt.getUTCDate());
  return Math.round((t1 - t0) / 86_400_000);
}

function expiryStatus(expiresAt: Date | null): CertExpiry {
  const d = daysUntil(expiresAt);
  if (d === null) return "NO_EXPIRY";
  if (d < 0) return "EXPIRED";
  if (d <= EXPIRY_SOON_DAYS) return "EXPIRING_SOON";
  return "VALID";
}

/**
 * Employee certifications — structured (issuer, credential id, issue/expiry dates)
 * with a computed expiry status and an optional uploaded certificate file (same
 * presigned-S3 pattern as employee documents). Employee scoping reuses the ABAC
 * gate: read = employee.read, write = employee.write, within the caller's reach.
 */
@Injectable()
export class CertificationsService {
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

  private async assertEmployee(orgId: string, employeeId: string, permission: string) {
    const ctx = requireTenantContext();
    const e = await this.prisma.employee.findFirst({ where: { id: employeeId, orgId }, select: { id: true } });
    if (!e) throw new NotFoundException("Employee not found.");
    const scope = await this.accessScope.resolveScope(orgId, ctx.userId, permission);
    if (scope.tier === "org") return;
    const visible = await this.accessScope.visibleEmployeeIds(orgId, scope);
    if (visible !== null && !visible.includes(employeeId)) throw new NotFoundException("Employee not found.");
  }

  async listForEmployee(employeeId: string) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeRead);
    const rows = await this.prisma.employeeCertification.findMany({ where: { orgId: ctx.orgId, employeeId }, orderBy: [{ expiresAt: "asc" }, { name: "asc" }] });
    return Promise.all(rows.map(async (c) => ({
      id: c.id, name: c.name, issuer: c.issuer, credentialId: c.credentialId,
      issueDate: c.issueDate ? c.issueDate.toISOString().slice(0, 10) : null,
      expiresAt: c.expiresAt ? c.expiresAt.toISOString().slice(0, 10) : null,
      expiry: expiryStatus(c.expiresAt), daysUntilExpiry: daysUntil(c.expiresAt),
      verification: c.verification, verifiedAt: c.verifiedAt?.toISOString() ?? null,
      documentName: c.documentName,
      documentUrl: c.documentKey ? await getSignedUrl(this.presignS3, new GetObjectCommand({ Bucket: this.bucket, Key: c.documentKey }), { expiresIn: URL_TTL }) : null,
      createdAt: c.createdAt.toISOString(),
    })));
  }

  async addForEmployee(employeeId: string, input: { name: string; issuer?: string; credentialId?: string; issueDate?: string; expiresAt?: string }) {
    const ctx = requireTenantContext();
    await this.assertEmployee(ctx.orgId, employeeId, permissions.employeeWrite);
    const name = input.name.trim();
    if (!name) throw new BadRequestException("Certification name is required.");
    const row = await this.prisma.employeeCertification.create({
      data: {
        orgId: ctx.orgId, employeeId, name,
        issuer: input.issuer?.trim() || null,
        credentialId: input.credentialId?.trim() || null,
        issueDate: input.issueDate ? new Date(input.issueDate) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdBy: ctx.userId,
      },
      select: { id: true },
    });
    return { id: row.id };
  }

  async update(certId: string, input: { name?: string; issuer?: string | null; credentialId?: string | null; issueDate?: string | null; expiresAt?: string | null }) {
    const ctx = requireTenantContext();
    const cert = await this.prisma.employeeCertification.findFirst({ where: { id: certId, orgId: ctx.orgId } });
    if (!cert) throw new NotFoundException("Certification not found.");
    await this.assertEmployee(ctx.orgId, cert.employeeId, permissions.employeeWrite);
    const data: Record<string, unknown> = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.issuer !== undefined) data.issuer = input.issuer?.trim() || null;
    if (input.credentialId !== undefined) data.credentialId = input.credentialId?.trim() || null;
    if (input.issueDate !== undefined) data.issueDate = input.issueDate ? new Date(input.issueDate) : null;
    // Changing the expiry resets the reminder ledger so fresh warnings can fire.
    if (input.expiresAt !== undefined) { data.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null; data.lastRemindedDays = null; }
    return this.prisma.employeeCertification.update({ where: { id: cert.id }, data, select: { id: true } });
  }

  async verify(certId: string, approve: boolean) {
    const ctx = requireTenantContext();
    const cert = await this.prisma.employeeCertification.findFirst({ where: { id: certId, orgId: ctx.orgId } });
    if (!cert) throw new NotFoundException("Certification not found.");
    await this.assertEmployee(ctx.orgId, cert.employeeId, permissions.employeeWrite);
    return this.prisma.employeeCertification.update({
      where: { id: cert.id },
      data: { verification: approve ? "VERIFIED" : "REJECTED", verifiedBy: ctx.userId, verifiedAt: new Date() },
      select: { id: true, verification: true },
    });
  }

  /** Reserve a certificate-file upload → presigned PUT URL. */
  async createUpload(certId: string, input: { fileName: string; contentType: string }) {
    const ctx = requireTenantContext();
    const cert = await this.prisma.employeeCertification.findFirst({ where: { id: certId, orgId: ctx.orgId } });
    if (!cert) throw new NotFoundException("Certification not found.");
    await this.assertEmployee(ctx.orgId, cert.employeeId, permissions.employeeWrite);
    const safeName = input.fileName.replace(/[^\w.-]+/g, "_").slice(0, 160);
    const key = `certifications/${ctx.orgId}/${cert.employeeId}/${randomUUID()}-${safeName}`;
    await this.prisma.employeeCertification.update({ where: { id: cert.id }, data: { documentKey: key, documentName: input.fileName.slice(0, 200) } });
    const uploadUrl = await getSignedUrl(this.presignS3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }), { expiresIn: URL_TTL });
    return { uploadUrl, expiresInSeconds: URL_TTL };
  }

  async remove(certId: string) {
    const ctx = requireTenantContext();
    const cert = await this.prisma.employeeCertification.findFirst({ where: { id: certId, orgId: ctx.orgId } });
    if (!cert) throw new NotFoundException("Certification not found.");
    await this.assertEmployee(ctx.orgId, cert.employeeId, permissions.employeeWrite);
    if (cert.documentKey) await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: cert.documentKey })).catch(() => undefined);
    await this.prisma.employeeCertification.delete({ where: { id: cert.id } });
    return { ok: true };
  }
}
