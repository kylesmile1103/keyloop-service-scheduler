-- DML-only grants for the API's runtime role (ARCHITECTURE §10 "DB role", ADR-007).
--
-- Run as the role that owns the migrated tables (the role that ran the EF migration bundle), connected to the scheduler database,
-- after the bundle has run:
--
--   psql "$KEYLOOP_OWNER_URL" -v ON_ERROR_STOP=1 -f deploy/neon/runtime-role.sql
--
-- The runtime role must already exist as a plain LOGIN role created with SQL (see deploy/cloudflare/DEPLOY-RUNBOOK.md). On Neon,
-- roles created in the Console, CLI or API become members of neon_superuser, which is not a DML-only role; the checks below refuse
-- such a role. This script never creates a role or handles a password, and it is safe to run again after every migration bundle.
--
-- It grants exactly: USAGE on schema public; SELECT, INSERT, UPDATE and DELETE on the application tables; SELECT only on the EF
-- migration history (the readiness check reads it, nothing at runtime writes it); USAGE on sequences; and default privileges so
-- tables and sequences that later migrations create (as this owner) receive the same DML grants. No DDL, TRUNCATE, REFERENCES or
-- TRIGGER privilege, no ownership and no role membership. Transaction-scoped advisory locks need no grant (PUBLIC may execute them).

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

GRANT USAGE ON SCHEMA public TO scheduler_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO scheduler_app;
REVOKE INSERT, UPDATE, DELETE ON public."__EFMigrationsHistory" FROM scheduler_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO scheduler_app;

-- Objects that future migration bundles create as this owner.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO scheduler_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO scheduler_app;

-- Verify the result before committing: DML everywhere it is needed, and no way to change the schema. Privileges are checked by
-- relation OID, so no name is resolved outside schema public.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '__EFMigrationsHistory'
    AND NOT (has_table_privilege('scheduler_app', c.oid, 'SELECT') AND has_table_privilege('scheduler_app', c.oid, 'INSERT')
         AND has_table_privilege('scheduler_app', c.oid, 'UPDATE') AND has_table_privilege('scheduler_app', c.oid, 'DELETE'));
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'scheduler_app lacks DML on: %', missing;
  END IF;
  IF NOT has_table_privilege('scheduler_app', 'public."__EFMigrationsHistory"', 'SELECT')
     OR has_table_privilege('scheduler_app', 'public."__EFMigrationsHistory"', 'INSERT')
     OR has_table_privilege('scheduler_app', 'public."__EFMigrationsHistory"', 'UPDATE')
     OR has_table_privilege('scheduler_app', 'public."__EFMigrationsHistory"', 'DELETE') THEN
    RAISE EXCEPTION 'scheduler_app must read, and only read, the migration history';
  END IF;
  SELECT string_agg(c.relname, ', ') INTO missing
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
    AND (has_table_privilege('scheduler_app', c.oid, 'TRUNCATE') OR has_table_privilege('scheduler_app', c.oid, 'REFERENCES')
      OR has_table_privilege('scheduler_app', c.oid, 'TRIGGER'));
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'scheduler_app has TRUNCATE, REFERENCES or TRIGGER on: %', missing;
  END IF;
  IF has_schema_privilege('scheduler_app', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'scheduler_app can CREATE in schema public (probably through PUBLIC). As the owner run: REVOKE CREATE ON SCHEMA public FROM PUBLIC';
  END IF;
  IF has_database_privilege('scheduler_app', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'scheduler_app can CREATE schemas in database %', current_database();
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner WHERE r.rolname = 'scheduler_app')
     OR EXISTS (SELECT 1 FROM pg_namespace n JOIN pg_roles r ON r.oid = n.nspowner WHERE r.rolname = 'scheduler_app') THEN
    RAISE EXCEPTION 'scheduler_app owns a relation or schema, so it could alter or drop it';
  END IF;
  RAISE NOTICE 'scheduler_app: DML on % application tables, read-only migration history, no DDL',
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> '__EFMigrationsHistory');
END
$$;

COMMIT;
