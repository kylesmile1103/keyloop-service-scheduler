-- Read-only postcondition, used within runtime-role.sql and independently by github-migrate.
\set ON_ERROR_STOP on

DO $$
DECLARE
  expected record;
  relation record;
  privilege text;
  allowed text[];
  app oid := (SELECT oid FROM pg_roles WHERE rolname = 'scheduler_app');
BEGIN
  IF app IS NULL OR EXISTS (SELECT 1 FROM pg_roles WHERE oid = app
      AND (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls OR NOT rolcanlogin))
      OR EXISTS (SELECT 1 FROM pg_auth_members WHERE member = app) THEN
    RAISE EXCEPTION 'scheduler_app must be a plain LOGIN role with no memberships';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('dealerships', ARRAY['SELECT','INSERT']),
    ('dealership_operating_hours', ARRAY['SELECT','INSERT']),
    ('service_types', ARRAY['SELECT','INSERT']),
    ('service_bays', ARRAY['SELECT','INSERT','UPDATE']),
    ('technicians', ARRAY['SELECT','INSERT','UPDATE']),
    ('appointments', ARRAY['SELECT','INSERT','UPDATE']),
    ('appointment_history', ARRAY['SELECT','INSERT']),
    ('admin_changes', ARRAY['SELECT','INSERT']),
    ('idempotency_keys', ARRAY['SELECT','INSERT','DELETE']),
    ('notification_outbox', ARRAY['SELECT','INSERT','UPDATE']),
    ('requirement_rules', ARRAY['SELECT','INSERT']),
    ('requirement_policy_versions', ARRAY['SELECT','INSERT']),
    ('__EFMigrationsHistory', ARRAY['SELECT'])
  ) AS matrix(table_name, privileges) LOOP
    IF to_regclass(format('public.%I', expected.table_name)) IS NULL THEN
      RAISE EXCEPTION 'Expected migrated table public.% is missing', expected.table_name;
    END IF;
    FOREACH privilege IN ARRAY expected.privileges LOOP
      IF NOT has_table_privilege('scheduler_app', format('public.%I', expected.table_name), privilege) THEN
        RAISE EXCEPTION 'scheduler_app lacks % on %', privilege, expected.table_name;
      END IF;
    END LOOP;
  END LOOP;

  -- Assert absence as well as presence, including effective privileges inherited from PUBLIC.
  -- An unreviewed future table/view has no runtime rights until explicitly added to the matrix.
  FOR relation IN SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') LOOP
    allowed := CASE relation.relname
      WHEN '__EFMigrationsHistory' THEN ARRAY['SELECT']
      WHEN 'idempotency_keys' THEN ARRAY['SELECT','INSERT','DELETE']
      WHEN 'appointments' THEN ARRAY['SELECT','INSERT','UPDATE']
      WHEN 'service_bays' THEN ARRAY['SELECT','INSERT','UPDATE']
      WHEN 'technicians' THEN ARRAY['SELECT','INSERT','UPDATE']
      WHEN 'notification_outbox' THEN ARRAY['SELECT','INSERT','UPDATE']
      WHEN 'dealerships' THEN ARRAY['SELECT','INSERT']
      WHEN 'dealership_operating_hours' THEN ARRAY['SELECT','INSERT']
      WHEN 'service_types' THEN ARRAY['SELECT','INSERT']
      WHEN 'appointment_history' THEN ARRAY['SELECT','INSERT']
      WHEN 'admin_changes' THEN ARRAY['SELECT','INSERT']
      WHEN 'requirement_rules' THEN ARRAY['SELECT','INSERT']
      WHEN 'requirement_policy_versions' THEN ARRAY['SELECT','INSERT']
      ELSE ARRAY[]::text[] END;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'] LOOP
      IF (NOT privilege = ANY(allowed) AND has_table_privilege('scheduler_app', relation.oid, privilege))
          OR has_table_privilege('scheduler_app', relation.oid, privilege || ' WITH GRANT OPTION') THEN
        RAISE EXCEPTION 'scheduler_app has forbidden % on % (or grant option)', privilege, relation.relname;
      END IF;
    END LOOP;
  END LOOP;

  -- Separate enumeration from the type-specific function: SQL AND evaluation order is not guaranteed.
  FOR relation IN SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'S' LOOP
    IF has_sequence_privilege('scheduler_app', relation.oid, 'USAGE,SELECT,UPDATE') THEN
      RAISE EXCEPTION 'scheduler_app has sequence privileges; current keys need none';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_default_acl d, LATERAL aclexplode(d.defaclacl) a
      WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = current_user)
        AND (d.defaclnamespace = 0 OR d.defaclnamespace = 'public'::regnamespace)
        AND d.defaclobjtype IN ('r','S') AND a.grantee IN (app, 0)) THEN
    RAISE EXCEPTION 'Future tables or sequences have automatic runtime/PUBLIC grants';
  END IF;
  IF NOT has_schema_privilege('scheduler_app', 'public', 'USAGE')
      OR has_schema_privilege('scheduler_app', 'public', 'CREATE')
      OR has_database_privilege('scheduler_app', current_database(), 'CREATE') THEN
    RAISE EXCEPTION 'scheduler_app needs schema USAGE only, with no schema/database CREATE (including through PUBLIC)';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relowner = app)
      OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspowner = app) THEN
    RAISE EXCEPTION 'scheduler_app owns a relation or schema, so it could alter or drop it';
  END IF;
  RAISE NOTICE 'scheduler_app: explicit runtime grants, append-only audits/policies, no appointment DELETE, no default grants or DDL';
END
$$;
