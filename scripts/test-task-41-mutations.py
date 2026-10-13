#!/usr/bin/env python3
"""Verify customer-lookup name-key and HTTPS-policy mutations fail with assertion errors, then restore and verify."""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / 'src/Keyloop.ServiceScheduler.Infrastructure/Persistence/Migrations/20261013151319_CustomerLookupScopedNamePrefixes.cs'
PROGRAM = ROOT / 'src/Keyloop.ServiceScheduler.Api/Program.cs'
EVIDENCE = Path('/tmp/kl41')
EVIDENCE.mkdir(parents=True, exist_ok=True)
ENV = {**os.environ, 'TMPDIR': str(EVIDENCE)}
ORIGINALS = {path: path.read_bytes() for path in (MIGRATION, PROGRAM)}


def run(label, test_filter, expected_total, expected_failures):
    result = subprocess.run(
        ['dotnet', 'test', '--project', 'tests/Keyloop.ServiceScheduler.IntegrationTests', '--filter',
         'Category!=LiveAi&(' + test_filter + ')'], cwd=ROOT, env=ENV, text=True, capture_output=True)
    output = result.stdout + result.stderr
    log = EVIDENCE / f'{label}.log'
    log.write_text(output)
    summary = re.search(r'Test run summary: (Passed!|Failed!)\s+total: (\d+)\s+failed: (\d+)\s+succeeded: (\d+)', output)
    if not summary:
        raise RuntimeError(f'{label}: missing test summary; build/infrastructure failure. See {log}')
    total, failed, passed = map(int, summary.group(2, 3, 4))
    if (total, failed, passed) != (expected_total, expected_failures, expected_total - expected_failures):
        raise RuntimeError(f'{label}: unexpected result {passed}/{total} passed, {failed} failed. See {log}')
    if expected_failures:
        assertions = re.findall(r'^\s+Shouldly\.ShouldAssertException', output, re.MULTILINE)
        if result.returncode != 2 or len(assertions) < failed:
            raise RuntimeError(f'{label}: not killed by the expected assertions. See {log}')
        print(f'{label}: KILLED ({failed}/{total} assertion failures)', flush=True)
    elif result.returncode != 0:
        raise RuntimeError(f'{label}: restored verification failed. See {log}')
    else:
        print(f'{label}: PASS ({passed}/{total})', flush=True)


def mutate(path, old, new):
    source = ORIGINALS[path].decode('utf-8')
    if source.count(old) != 1:
        raise RuntimeError(f'{path.name}: expected exactly one mutation target')
    path.write_bytes(source.replace(old, new).encode('utf-8'))


try:
    # Drop the dealership from every stored GIN key, recreating fleet-wide posting lists.
    mutate(MIGRATION, "dealership::text || ':' || left(word, size)", 'left(word, size)')
    run('mutation-name-key', 'FullyQualifiedName~CustomerLookupScopedNameTests.Name_keys_qualify_every_literal_prefix_with_the_dealership', 1, 1)
    MIGRATION.write_bytes(ORIGINALS[MIGRATION])
    # Install redirects even when configuration disables them and supplies no HTTPS listener.
    mutate(PROGRAM, 'if (security.HttpsRedirection.Enabled)', 'if (true)')
    run('mutation-https-policy', 'FullyQualifiedName~HttpsRedirectionTests.Default_http_flow_does_not_redirect_or_log_an_unknown_https_port', 5, 5)
finally:
    for path, original in ORIGINALS.items():
        path.write_bytes(original)

run('mutation-restored', 'FullyQualifiedName~CustomerLookupScopedNameTests|FullyQualifiedName~HttpsRedirectionTests', 23, 0)
for path, original in ORIGINALS.items():
    if path.read_bytes() != original:
        raise RuntimeError(f'{path.name}: source bytes were not restored')
print('Both mutations reverted; original source bytes restored.', flush=True)
