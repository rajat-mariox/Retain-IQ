import { Module } from "@nestjs/common";
import { InvoicesController } from "./invoices.controller.js";
import { InvoicesService } from "./invoices.service.js";
import { PayrollController } from "./payroll.controller.js";
import { PayrollService } from "./payroll.service.js";
import { RatesController } from "./rates.controller.js";
import { RatesService } from "./rates.service.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";

@Module({
  // ReportsController owns the bare /payroll routes (dashboard, reports,
  // export); the others own their own prefixes, so registration order is
  // irrelevant here.
  controllers: [RatesController, PayrollController, InvoicesController, ReportsController],
  providers: [RatesService, PayrollService, InvoicesService, ReportsService],
  exports: [RatesService, PayrollService, InvoicesService],
})
export class PayrollModule {}
