import { Module } from "@nestjs/common";
import { SeatSyncService } from "./seat-sync.service.js";

@Module({
  providers: [SeatSyncService],
})
export class SeatSyncModule {}
