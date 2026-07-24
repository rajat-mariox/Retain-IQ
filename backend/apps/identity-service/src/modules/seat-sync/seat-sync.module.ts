import { Module } from "@nestjs/common";
import { SeatSyncService } from "./seat-sync.service.js";
import { PlanCacheSyncService } from "./plan-cache-sync.service.js";

@Module({
  providers: [SeatSyncService, PlanCacheSyncService],
})
export class SeatSyncModule {}
