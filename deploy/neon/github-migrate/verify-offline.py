#!/usr/bin/env python3
"""Verify the compiled migration runner with synthetic credentials and fake children, never a database."""
import os
import re
import shlex
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[3]
dll = Path(__file__).parent / "bin/Release/net10.0/Keyloop.GitHubMigrate.dll"
base = 'Host=fixture.neon.invalid;Database=fixture;Username=fixture_owner;Password="fixture;quoted";SSL Mode=VerifyFull;Channel Binding=Require'
env = {**os.environ, "NEON_OWNER_CONNECTION": base}
checks = 0

# Independent offline contract for direct grants. Real effective rights, PUBLIC/inheritance and reruns are exercised by
# RuntimeRoleTests using PostgreSQL and the actual psql scripts; a text check alone cannot prove those properties.
sql = (root / "deploy/neon/runtime-role.sql").read_text()
direct = {}
for privileges, tables in re.findall(r"^GRANT (.+?) ON (.+?) TO scheduler_app;$", sql, re.M):
    if tables == "SCHEMA public":
        assert privileges == "USAGE"
        continue
    for table in tables.split(", "):
        assert table.startswith("public."), "Blanket runtime table/sequence grants are forbidden"
        direct[table.removeprefix("public.").strip('"')] = set(privileges.split(", "))
append = {"SELECT", "INSERT"}
mutable = append | {"UPDATE"}
assert direct == {
    "dealerships": append, "dealership_operating_hours": append, "service_types": append,
    "service_bays": mutable, "technicians": mutable, "appointments": mutable,
    "appointment_history": append, "admin_changes": append,
    "idempotency_keys": append | {"DELETE"}, "notification_outbox": mutable,
    "requirement_rules": append, "requirement_policy_versions": append, "__EFMigrationsHistory": {"SELECT"},
}, "Runtime grants must match the write paths, with no audit UPDATE/DELETE or appointment DELETE"
assert not re.search(r"ALTER DEFAULT PRIVILEGES[^;]*\bGRANT\b", sql), "Future objects must not get automatic runtime grants"
assert "\\ir verify-runtime-role.sql" in sql, "Postcondition must run before the grant transaction commits"
checks += 1


def run(arguments, extra=None, success=True):
    global checks
    checks += 1
    result = subprocess.run(["dotnet", str(dll), *arguments], env={**env, **(extra or {})},
                            capture_output=True, text=True, timeout=20)
    output = result.stdout + result.stderr
    assert (result.returncode == 0) == success, output
    for secret in [base, "fixture;quoted", "fixture-secret-child-output"]:
        assert secret not in output, "Sensitive child output was exposed"
    return output


run(["--validate-only"])
for connection in ["", "postgresql://fixture_owner:fixture-secret@fixture.invalid/fixture",
                   base.replace("VerifyFull", "Require"), base.replace("Channel Binding=Require", "Channel Binding=Prefer"),
                   base.replace("fixture.neon.invalid", "fixture-pooler.neon.invalid")]:
    run(["--validate-only"], {"NEON_OWNER_CONNECTION": connection}, success=False)

with tempfile.TemporaryDirectory(prefix="keyloop-migrate-") as directory:
    scratch = Path(directory)
    bundle = scratch / "efbundle"
    bundle.write_text(f"#!{sys.executable}\n" + '''import os, sys
assert sys.argv[1] == '--connection' and 'fixture;quoted' in sys.argv[2]
print('fixture-secret-child-output')
if os.environ.get('FAIL_BUNDLE'): sys.exit(2)
''')
    psql = scratch / "psql"
    psql.write_text(f"#!{sys.executable}\n" + r'''import os, sys
from pathlib import Path
assert sys.argv[1:5] == ['--no-psqlrc', '--no-password', '-v', 'ON_ERROR_STOP=1']
assert sys.argv[5] == '-f' and Path(sys.argv[6]).name in ['runtime-role.sql', 'verify-runtime-role.sql']
expected = {'PGHOST': 'fixture.neon.invalid', 'PGDATABASE': 'fixture', 'PGUSER': 'fixture_owner',
 'PGPASSWORD': 'fixture;quoted', 'PGPORT': '5432', 'PGSSLMODE': 'verify-full',
 'PGSSLROOTCERT': 'system', 'PGCHANNELBINDING': 'require'}
assert all(os.environ[k] == value for k, value in expected.items())
marker = Path(os.environ['GRANTS_MARKER'])
with marker.open('a') as log: log.write(Path(sys.argv[6]).name + '\n')
print('fixture-secret-child-output')
if os.environ.get('FAIL_GRANTS') and Path(sys.argv[6]).name == 'runtime-role.sql': sys.exit(3)
if os.environ.get('FAIL_VERIFY') and Path(sys.argv[6]).name == 'verify-runtime-role.sql': sys.exit(4)
''')
    bundle.chmod(0o700)
    psql.chmod(0o700)
    marker = scratch / "grants-applied"
    local = {"PATH": f"{scratch}:{os.environ['PATH']}", "GRANTS_MARKER": str(marker)}
    arguments = [str(bundle), str(root / "deploy/neon/runtime-role.sql")]
    for _ in range(2):
        marker.unlink(missing_ok=True)
        output = run(arguments, local)
        assert marker.read_text().splitlines() == ["runtime-role.sql", "verify-runtime-role.sql"]
        assert "Migration bundle completed" in output and "grants applied and verified" in output
    marker.unlink()
    run(arguments, {**local, "FAIL_BUNDLE": "true"}, success=False)
    assert not marker.exists(), "Grants ran despite failed migration"
    run(arguments, {**local, "FAIL_GRANTS": "true"}, success=False)
    assert marker.read_text().splitlines() == ["runtime-role.sql"]
    marker.unlink()
    run(arguments, {**local, "FAIL_VERIFY": "true"}, success=False)
    assert marker.read_text().splitlines() == ["runtime-role.sql", "verify-runtime-role.sql"]

# Execute the runbook's offline inventory command against the same Release build as the pinned bundle.
# This prevents a return to hand-maintained empty/upgrade counts from silently passing the deployment checks.
runbook = (root / "deploy/cloudflare/DEPLOY-RUNBOOK.md").read_text()
commands = re.findall(r"```sh\n(dotnet ef migrations list --no-connect[^`]+)```", runbook)
assert len(commands) == 1, "Runbook must provide exactly one offline migration inventory command"
inventory = subprocess.run(shlex.split(commands[0].replace("\\\n", " ")), cwd=root,
                           capture_output=True, text=True, timeout=30, check=True)
assert "CustomerLookupScopedNamePrefixes" in inventory.stdout, "Runbook command did not list the pinned migration assembly"
assert not re.search(r"Expected: (?:six|6)|only `20261012204715_AdminEditing`", runbook), "Stale migration expectation"
checks += 1
print(f"PASS: {checks} offline checks, including runbook migration inventory.")
print("PASS: Npgsql quoting, TLS/direct-host validation, two reruns, grant mapping and all three child failures; no database accessed.")
