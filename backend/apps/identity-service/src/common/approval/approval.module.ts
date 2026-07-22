import { Global, Module } from "@nestjs/common";
import { ApprovalService } from "./approval.service.js";

/**
 * Global so leave, timesheet, and any future request-approval flow share one
 * definition of "who can approve whom" instead of each re-deriving the hierarchy.
 */
@Global()
@Module({
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
