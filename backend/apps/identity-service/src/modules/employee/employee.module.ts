import { Module } from "@nestjs/common";
import { EmployeeController } from "./employee.controller.js";
import { EmployeeRepository } from "./employee.repository.js";
import { EmployeeService } from "./employee.service.js";
import { EmployeeDocumentsService } from "./employee-documents.service.js";

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeRepository, EmployeeService, EmployeeDocumentsService],
  exports: [EmployeeService],
})
export class EmployeeModule {}

