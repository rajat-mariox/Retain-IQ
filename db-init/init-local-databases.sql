-- Local-dev database bootstrap for the CONSOLIDATED single Postgres instance
-- (docker-compose.local.yml). Runs ONCE, on first init of an empty data volume,
-- as the superuser (via /docker-entrypoint-initdb.d/).
--
-- Production keeps one Postgres instance PER service (docker-compose.yml). This
-- file recreates the same per-service databases + roles inside ONE instance, so
-- each service still owns its own logical database (database-per-service
-- isolation preserved — Postgres cannot join across databases). Every service's
-- DATABASE_URL is identical to prod EXCEPT the host (postgres-<svc> -> postgres).
--
-- Credentials mirror the per-service containers exactly, so no app env changes
-- beyond the host name.

-- identity
CREATE ROLE identity WITH LOGIN PASSWORD 'identity';
CREATE DATABASE "retainiq-identity" OWNER identity;

-- inbox (event-processor)
CREATE ROLE inbox WITH LOGIN PASSWORD 'inbox';
CREATE DATABASE "retainiq-inbox" OWNER inbox;

-- analytics
CREATE ROLE analytics WITH LOGIN PASSWORD 'analytics';
CREATE DATABASE "retainiq-analytics" OWNER analytics;

-- notifications
CREATE ROLE notifications WITH LOGIN PASSWORD 'notifications';
CREATE DATABASE "retainiq-notifications" OWNER notifications;

-- billing
CREATE ROLE billing WITH LOGIN PASSWORD 'billing';
CREATE DATABASE "retainiq-billing" OWNER billing;

