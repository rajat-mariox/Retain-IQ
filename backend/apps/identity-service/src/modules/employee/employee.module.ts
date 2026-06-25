import { Module } from "@nestjs/common";
import { EmployeeController } from "./employee.controller.js";
import { EmployeeRepository } from "./employee.repository.js";
import { EmployeeService } from "./employee.service.js";

@Module({
  controllers: [EmployeeController],
  providers: [EmployeeRepository, EmployeeService],
  exports: [EmployeeService],
})
export class EmployeeModule {}

