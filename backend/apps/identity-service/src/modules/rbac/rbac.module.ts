import { Module } from "@nestjs/common";
import { RbacController } from "./rbac.controller.js";
import { RbacService } from "./rbac.service.js";

@Module({
  controllers: [RbacController],
  providers: [RbacService],
})
export class RbacModule {}
