#!/usr/bin/env python3
"""Task 39C: kill one mutation per matching rule with assertion failures. Never run LiveAi."""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HANDLER = ROOT / 'src/Keyloop.ServiceScheduler.Api/Features/Customers/FindReturningCustomers/FindReturningCustomersHandler.cs'
ORIGINAL = HANDLER.read_bytes()
EVIDENCE = Path('/tmp/kl39c')
EVIDENCE.mkdir(parents=True, exist_ok=True)
ENV = {**os.environ, 'TMPDIR': str(EVIDENCE)}


def run(label, test, expected_total, expected_failures):
    result = subprocess.run(
        ['dotnet', 'test', '--project', 'tests/Keyloop.ServiceScheduler.IntegrationTests', '--filter',
         'Category!=LiveAi&FullyQualifiedName~' + test], cwd=ROOT, env=ENV, text=True, capture_output=True)
    output = result.stdout + result.stderr
    log = EVIDENCE / f'{label}.log'
    log.write_text(output)
    summary = re.search(r'Test run summary: (Passed!|Failed!)\s+total: (\d+)\s+failed: (\d+)\s+succeeded: (\d+)', output)
    if not summary:
        raise RuntimeError(f'{label}: no test summary; build or infrastructure failed. See {log}')
    total, failed, passed = map(int, summary.group(2, 3, 4))
    if total != expected_total or failed != expected_failures or passed != total - failed:
        raise RuntimeError(f'{label}: unexpected result {passed}/{total} passed, {failed} failed. See {log}')
    if expected_failures:
        assertions = re.findall(r'^\s+Shouldly\.ShouldAssertException', output, re.MULTILINE)
        if result.returncode != 2 or len(assertions) < failed:
            raise RuntimeError(f'{label}: mutation was not killed by the expected assertions. See {log}')
        print(f'{label}: KILLED ({failed}/{total} assertion failures)', flush=True)
    elif result.returncode != 0:
        raise RuntimeError(f'{label}: restored verification failed. See {log}')
    else:
        print(f'{label}: PASS ({passed}/{total})', flush=True)


def mutate(old, new):
    source = ORIGINAL.decode('utf-8')
    if old not in source:
        raise RuntimeError('Mutation target is absent; update the runner for this handler.')
    HANDLER.write_text(source.replace(old, new))


try:
    mutate('@> ARRAY(SELECT lower(word)', '&& ARRAY(SELECT lower(word)')
    run('matching-mutation-names', 'CustomerLookupTests.Multi_word_names_require_every_long_word_prefix_in_any_order', 6, 6)
    HANDLER.write_bytes(ORIGINAL)
    # Keep stored normalization but remove query normalization, exposing drift between the two sides.
    mutate('public.customer_lookup_phone_key(@query)', "regexp_replace(@query, '[^0-9]', '', 'g')")
    run('matching-mutation-phones', 'CustomerLookupTests.Uk_and_german_national_and_international_phones_match_both_ways', 16, 14)
finally:
    HANDLER.write_bytes(ORIGINAL)

run('matching-mutation-restored', 'CustomerLookupTests', 86, 0)
print('Both matching mutations reverted; original handler bytes restored.', flush=True)
