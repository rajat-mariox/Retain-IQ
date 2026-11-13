import { createHash } from "node:crypto";
import { ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../database/prisma.service.js";

const LOCK_MS = 30_000;
const RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Provides exactly-once semantics for client-retryable writes via the
 * IdempotencyRecord table, keyed by (orgId, Idempotency-Key).
 *
 * - First call for a key runs the operation and stores the response.
 * - Replays with the same key + payload return the stored response.
 * - Same key with a different payload is rejected (409).
 * - A concurrent in-flight call is rejected while the lock is held (409).
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  static hashRequest(payload: unknown): string {
    return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
  }

  async execute<T>(params: {
    orgId: string;
    key: string;
    requestHash: string;
    run: () => Promise<T>;
  }): Promise<T> {
    const { orgId, key, requestHash, run } = params;

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { orgId_key: { orgId, key } },
    });

    if (existing) {
      return this.handleExisting<T>(existing, requestHash, run, orgId, key);
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: {
          orgId,
          key,
          requestHash,
          status: "STARTED",
          lockedUntil: new Date(Date.now() + LOCK_MS),
          expiresAt: new Date(Date.now() + RECORD_TTL_MS),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // Lost a race to create the record — re-read and treat as a replay.
        const raced = await this.prisma.idempotencyRecord.findUnique({
          where: { orgId_key: { orgId, key } },
        });
        if (raced) {
          return this.handleExisting<T>(raced, requestHash, run, orgId, key);
        }
      }
      throw error;
    }

    return this.runAndStore<T>(orgId, key, run);
  }

  private async handleExisting<T>(
    record: {
      requestHash: string;
      status: "STARTED" | "COMPLETED" | "FAILED";
      lockedUntil: Date | null;
      responseBody: unknown;
    },
    requestHash: string,
    run: () => Promise<T>,
    orgId: string,
    key: string,
  ): Promise<T> {
    if (record.requestHash !== requestHash) {
      throw new ConflictException("Idempotency key was reused with a different request payload.");
    }

    if (record.status === "COMPLETED") {
      return record.responseBody as T;
    }

    if (record.status === "STARTED" && record.lockedUntil && record.lockedUntil > new Date()) {
      throw new ConflictException("A request with this idempotency key is already in progress.");
    }

    // STARTED-but-expired lock or a prior FAILED attempt: retry.
    return this.runAndStore<T>(orgId, key, run);
  }

  private async runAndStore<T>(orgId: string, key: string, run: () => Promise<T>): Promise<T> {
    try {
      const result = await run();
      await this.prisma.idempotencyRecord.update({
        where: { orgId_key: { orgId, key } },
        data: {
          status: "COMPLETED",
          responseCode: 201,
          responseBody: (result as object) ?? undefined,
          lockedUntil: null,
        },
      });
      return result;
    } catch (error) {
      await this.prisma.idempotencyRecord.update({
        where: { orgId_key: { orgId, key } },
        data: { status: "FAILED", lockedUntil: null },
      });
      throw error;
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
