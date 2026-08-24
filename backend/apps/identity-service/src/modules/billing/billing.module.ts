import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { BillingController } from "./billing.controller.js";
import { BillingService } from "./billing.service.js";

@Module({
  // JwtService is used only to mint a short-lived platform-scoped service token
  // for the server-to-server call to billing-service; the secret is passed per-sign.
  imports: [JwtModule.register({})],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
