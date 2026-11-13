import { ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireTenantContext } from "../../common/context/request-context.store.js";
import { PrismaService } from "../../common/database/prisma.service.js";
import { ApprovalService } from "../../common/approval/approval.service.js";

const URL_TTL = 900; // 15 min presigned-URL lifetime
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB per attachment

/**
 * Supporting documents on a leave request (e.g. a medical certificate). Binaries
 * live in S3/MinIO; this service issues presigned PUT/GET URLs and records the
 * metadata. Modeled on EmployeeDocumentsService (same dual-S3-client setup), but
 * keyed by leaveRequestId. Access: the request's own employee, or an approver in
 * whose reach that employee falls.
 */
@Injectable()
export class LeaveAttachmentService {
  private readonly log = new Logger(LeaveAttachmentService.name);
  private readonly s3: S3Client;
  private readonly presignS3: S3Client;
  private readonly bucket = process.env.S3_BUCKET ?? "retainiq-screenshots";

  constructor(
    private readonly prisma: PrismaService,
    private readonly approval: ApprovalService,
  ) {
    const endpoint = process.env.S3_ENDPOINT?.trim() || undefined;
    const forcePathStyle = (process.env.S3_FORCE_PATH_STYLE ?? (endpoint ? "true" : "false")) === "true";
    const credentials =
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined;
    const region = process.env.S3_REGION ?? "us-east-1";
    // Server-side ops hit the internal endpoint; presigned URLs use the public one
    // the browser can reach (see EmployeeDocumentsService / StorageService rationale).
    this.s3 = new S3Client({ region, endpoint, forcePathStyle, credentials });
    this.presignS3 = new S3Client({ region, endpoint: process.env.S3_PUBLIC_ENDPOINT?.trim() || endpoint, forcePathStyle, credentials });
  }

  /** The caller's own employeeId (membership → employee). */
  private async callerEmployeeId(orgId: string): Promise<string> {
    const ctx = requireTenantContext();
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { orgId, userId: ctx.userId, status: "ACTIVE" },
      select: { employeeId: true },
    });
    if (!membership?.employeeId) throw new ForbiddenException("No employee profile for this account.");
    return membership.employeeId;
  }

  /**
   * Load the request + confirm the caller may act on its attachments: either it's
   * their own request, or they can approve for that employee. NotFound (not
   * Forbidden) when out of scope so a request's existence never leaks.
   */
  private async assertRequestAccess(orgId: string, leaveRequestId: string): Promise<{ employeeId: string }> {
    const req = await this.prisma.leaveRequest.findFirst({ where: { id: leaveRequestId, orgId }, select: { employeeId: true } });
    if (!req) throw new NotFoundException("Leave request not found.");
    const mine = await this.callerEmployeeId(orgId).catch(() => null);
    if (mine === req.employeeId) return req;
    // Not the owner — must be an approver whose reach includes this employee.
    const reach = await this.approval.approvableEmployeeIds(); // null = whole org
    if (reach === null || reach.includes(req.employeeId)) return req;
    throw new NotFoundException("Leave request not found.");
  }

  /** Record metadata + return a presigned PUT URL for the binary. */
  async createUpload(leaveRequestId: string, input: { fileName: string; contentType: string; sizeBytes: number }) {
    const ctx = requireTenantContext();
    await this.assertRequestAccess(ctx.orgId, leaveRequestId);
    if (input.sizeBytes <= 0 || input.sizeBytes > MAX_BYTES) {
      throw new ForbiddenException(`Attachment must be between 1 byte and ${Math.round(MAX_BYTES / 1024 / 1024)} MB.`);
    }
    const safeName = input.fileName.replace(/[^\w.-]+/g, "_").slice(0, 160);
    const key = `leave/${ctx.orgId}/${leaveRequestId}/${randomUUID()}-${safeName}`;

    const att = await this.prisma.leaveAttachment.create({
      data: {
        orgId: ctx.orgId,
        leaveRequestId,
        fileName: input.fileName.slice(0, 200),
        key,
        sizeBytes: BigInt(input.sizeBytes),
        contentType: input.contentType,
        uploadedBy: ctx.userId,
      },
      select: { id: true },
    });
    const uploadUrl = await getSignedUrl(this.presignS3, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: input.contentType }), { expiresIn: URL_TTL });
    return { id: att.id, key, uploadUrl, expiresInSeconds: URL_TTL };
  }

  /** List a request's attachments with short-lived view URLs. */
  async list(leaveRequestId: string) {
    const ctx = requireTenantContext();
    await this.assertRequestAccess(ctx.orgId, leaveRequestId);
    const rows = await this.prisma.leaveAttachment.findMany({ where: { orgId: ctx.orgId, leaveRequestId }, orderBy: { createdAt: "desc" } });
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

  /** Delete an attachment (from S3 + DB). Access checked via its parent request. */
  async delete(leaveRequestId: string, attachmentId: string) {
    const ctx = requireTenantContext();
    await this.assertRequestAccess(ctx.orgId, leaveRequestId);
    const att = await this.prisma.leaveAttachment.findFirst({ where: { id: attachmentId, orgId: ctx.orgId, leaveRequestId }, select: { id: true, key: true } });
    if (!att) throw new NotFoundException("Attachment not found.");
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: att.key }));
    await this.prisma.leaveAttachment.delete({ where: { id: att.id } });
    this.log.log(`Deleted leave attachment ${attachmentId} for org ${ctx.orgId}`);
    return { id: attachmentId, deleted: true };
  }
}
