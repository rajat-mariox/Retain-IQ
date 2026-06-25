import { Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { activityIngestBatchSchema, type ActivityIngestBatch } from "@retainiq/contracts";
import { IngestAuthGuard, OrgId } from "./auth.guard.js";
import { IngestionService } from "./ingestion.service.js";
import { ZodValidationPipe } from "./zod-validation.pipe.js";

@Controller("ingest")
@UseGuards(IngestAuthGuard)
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post("activity")
  @HttpCode(202)
  ingestActivity(
    @Body(new ZodValidationPipe(activityIngestBatchSchema)) body: ActivityIngestBatch,
    @OrgId() orgId: string,
  ) {
    return this.ingestionService.ingestActivity(orgId, body.events);
  }
}
