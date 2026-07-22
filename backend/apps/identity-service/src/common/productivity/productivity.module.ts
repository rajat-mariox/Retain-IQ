import { Global, Module } from "@nestjs/common";
import { ProductivityController } from "./productivity.controller.js";
import { ProductivitySettingsService } from "./productivity-settings.service.js";

// Global so insights & monitoring can inject the rules resolver without importing.
@Global()
@Module({
  controllers: [ProductivityController],
  providers: [ProductivitySettingsService],
  exports: [ProductivitySettingsService],
})
export class ProductivityModule {}
