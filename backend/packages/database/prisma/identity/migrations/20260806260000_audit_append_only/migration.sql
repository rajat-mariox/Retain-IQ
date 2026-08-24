-- Enforce append-only on the audit log at the database level: once written, an
-- AuditEvent row can never be UPDATEd or DELETEd. This is defense-in-depth — the
-- application already never mutates audit rows, but a trigger makes tampering
-- impossible even via a direct connection or a future code bug.
CREATE OR REPLACE FUNCTION "audit_event_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEvent is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "audit_event_no_update" ON "AuditEvent";
CREATE TRIGGER "audit_event_no_update"
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();

DROP TRIGGER IF EXISTS "audit_event_no_delete" ON "AuditEvent";
CREATE TRIGGER "audit_event_no_delete"
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION "audit_event_append_only"();
