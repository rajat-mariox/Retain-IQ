import { Global, Module } from "@nestjs/common";
import { SeatLimitService } from "./seat-limit.service.js";

// Global so both the employee and members add-paths can enforce seat limits
// without bespoke module wiring (DatabaseModule, which it depends on, is global).
@Global()
@Module({
  providers: [SeatLimitService],
  exports: [SeatLimitService],
})
export class SeatLimitModule {}
