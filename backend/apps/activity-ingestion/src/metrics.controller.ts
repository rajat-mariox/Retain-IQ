import { Controller, Get, Header } from "@nestjs/common";
import { metrics } from "./observability.js";

@Controller("metrics")
export class MetricsController {
  @Get()
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  render(): Promise<string> {
    return metrics.render();
  }
}
