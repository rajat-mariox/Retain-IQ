import { Global, Module } from "@nestjs/common";
import { AccessScopeService } from "./access-scope.service.js";

// Global so any feature service can scope its queries (DatabaseModule, which it
// depends on, is also global).
@Global()
@Module({
  providers: [AccessScopeService],
  exports: [AccessScopeService],
})
export class AccessScopeModule {}
