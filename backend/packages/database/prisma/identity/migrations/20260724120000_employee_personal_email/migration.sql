-- Separate the employee's personal contact email from their work (sign-in) email.
-- Employee.email stays the work email, kept in lockstep with User.email;
-- personalEmail is HR profile data only and never affects authentication.

ALTER TABLE "Employee"
  ADD COLUMN "personalEmail" TEXT;
