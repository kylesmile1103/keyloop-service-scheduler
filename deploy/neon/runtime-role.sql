-- DML-only grants for the API runtime role (scheduler_app).
-- Run as the table-owning migration role after applying the EF migration bundle:
--   psql "$KEYLOOP_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/neon/runtime-role.sql

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
  app oid := (SELECT oid FROM pg_roles WHERE rolname = 'scheduler_app');
BEGIN
  IF app IS NULL THEN
    RAISE EXCEPTION 'Role scheduler_app does not exist. Create it first with SQL: CREATE ROLE scheduler_app LOGIN; then \password scheduler_app';
  END IF;
  IF current_user = 'scheduler_app' THEN
    RAISE EXCEPTION 'Run this as the owner role that ran the migration bundle, not as scheduler_app';
  END IF;
  IF to_regclass('public."__EFMigrationsHistory"') IS NULL THEN
    RAISE EXCEPTION 'public."__EFMigrationsHistory" is missing: run the EF migration bundle as the owner first';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tableowner <> current_user) THEN
    RAISE EXCEPTION 'Some tables in schema public are not owned by %; run this as the role that ran the migration bundle', current_user;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE oid = app
             AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolcanlogin)) THEN
    RAISE EXCEPTION 'scheduler_app must be a plain LOGIN role without SUPERUSER, CREATEDB, CREATEROLE, REPLICATION or BYPASSRLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app) THEN
    RAISE EXCEPTION 'scheduler_app is a member of another role (a role created in the Neon Console joins neon_superuser). Drop it and create it with SQL instead';
  END IF;
END
$$;

-- Undo the old blanket grants as well as any direct excess privilege before rebuilding the matrix.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM scheduler_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM scheduler_app;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM scheduler_app;
GRANT USAGE ON SCHEMA public TO scheduler_app;

-- Public reads, booking snapshots, policy resolution, triage catalogue reads and startup seeding.
GRANT SELECT, INSERT ON public.dealerships, public.dealership_operating_hours, public.service_types TO scheduler_app;
-- Admin resource creation, edits, activity changes and HV confirmation (plus fresh startup seeds).
GRANT SELECT, INSERT, UPDATE ON public.service_bays, public.technicians TO scheduler_app;
-- Booking and cancellation. History and outbox staging share the appointment transaction.
GRANT SELECT, INSERT, UPDATE ON public.appointments TO scheduler_app;
GRANT SELECT, INSERT ON public.appointment_history, public.admin_changes TO scheduler_app;
-- Optional response memoisation and expired-key replacement; no in-place mutation.
GRANT SELECT, INSERT, DELETE ON public.idempotency_keys TO scheduler_app;
-- Claim, lease, retry, suppression, token-fenced acknowledgement and dead-letter state.
GRANT SELECT, INSERT, UPDATE ON public.notification_outbox TO scheduler_app;
-- Immutable publications, default-policy preservation and additive startup policy upgrades.
GRANT SELECT, INSERT ON public.requirement_rules, public.requirement_policy_versions TO scheduler_app;
GRANT SELECT ON public."__EFMigrationsHistory" TO scheduler_app;

-- Remove both global and schema-specific defaults. Schema REVOKE alone cannot undo a global GRANT.
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON TABLES FROM scheduler_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM scheduler_app;
ALTER DEFAULT PRIVILEGES REVOKE ALL PRIVILEGES ON SEQUENCES FROM scheduler_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM scheduler_app;

-- psql resolves this relative to the script, so it also works from a different working directory.
-- Verify in the same transaction; the migration runner also verifies independently after application.
\ir verify-runtime-role.sql

COMMIT;
