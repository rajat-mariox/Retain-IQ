import { Module } from "@nestjs/common";
import { OutboxRelayService } from "./outbox-relay.service.js";

@Module({
  providers: [OutboxRelayService],
})
export class OutboxModule {}
