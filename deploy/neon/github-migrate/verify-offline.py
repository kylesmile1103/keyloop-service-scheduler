#!/usr/bin/env python3
"""Verify the compiled migration runner with synthetic credentials and fake children, never a database."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[3]
dll = Path(__file__).parent / "bin/Release/net10.0/Keyloop.GitHubMigrate.dll"
base = 'Host=fixture.neon.invalid;Database=fixture;Username=fixture_owner;Password="fixture;quoted";SSL Mode=VerifyFull;Channel Binding=Require'
env = {**os.environ, "NEON_OWNER_CONNECTION": base}


def run(arguments, extra=None, success=True):
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

scratch_root = root / "artifacts"
scratch_root.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="task-35-migrate-", dir=scratch_root) as directory:
    scratch = Path(directory)
    bundle = scratch / "efbundle"
    bundle.write_text(f"#!{sys.executable}\n" + '''import os, sys
assert sys.argv[1] == '--connection' and 'fixture;quoted' in sys.argv[2]
print('fixture-secret-child-output')
if os.environ.get('FAIL_BUNDLE'): sys.exit(2)
''')
    psql = scratch / "psql"
    psql.write_text(f"#!{sys.executable}\n" + '''import os, sys
from pathlib import Path
assert sys.argv[1:5] == ['--no-psqlrc', '--no-password', '-v', 'ON_ERROR_STOP=1']
assert sys.argv[5] == '-f' and sys.argv[6].endswith('deploy/neon/runtime-role.sql')
expected = {'PGHOST': 'fixture.neon.invalid', 'PGDATABASE': 'fixture', 'PGUSER': 'fixture_owner',
 'PGPASSWORD': 'fixture;quoted', 'PGPORT': '5432', 'PGSSLMODE': 'verify-full',
 'PGSSLROOTCERT': 'system', 'PGCHANNELBINDING': 'require'}
assert all(os.environ[k] == value for k, value in expected.items())
Path(os.environ['GRANTS_MARKER']).write_text('applied')
print('fixture-secret-child-output')
if os.environ.get('FAIL_GRANTS'): sys.exit(3)
''')
    bundle.chmod(0o700)
    psql.chmod(0o700)
    marker = scratch / "grants-applied"
    local = {"PATH": f"{scratch}:{os.environ['PATH']}", "GRANTS_MARKER": str(marker)}
    arguments = [str(bundle), str(root / "deploy/neon/runtime-role.sql")]
    for _ in range(2):
        output = run(arguments, local)
        assert marker.read_text() == "applied"
        assert "Migration bundle completed" in output and "grants applied and verified" in output
    marker.unlink()
    run(arguments, {**local, "FAIL_BUNDLE": "true"}, success=False)
    assert not marker.exists(), "Grants ran despite failed migration"
    run(arguments, {**local, "FAIL_GRANTS": "true"}, success=False)

print("PASS: Npgsql quoting, TLS/direct-host validation, two reruns, grant mapping and both child failures; no database accessed.")
