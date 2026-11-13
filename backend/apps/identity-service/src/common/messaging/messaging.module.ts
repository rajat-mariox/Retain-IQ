import { Global, Module } from "@nestjs/common";
import { BrokerService } from "./broker.service.js";
import { OutboxService } from "../outbox/outbox.service.js";

/**
 * Provides the message broker (Redis Streams or Kafka, per BROKER_DRIVER) and
 * the transactional-outbox writer. Global so any module can publish/enqueue.
 */
@Global()
@Module({
  providers: [BrokerService, OutboxService],
  exports: [BrokerService, OutboxService],
})
export class MessagingModule {}
