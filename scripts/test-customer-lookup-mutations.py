#!/usr/bin/env python3
"""Two customer-lookup regression mutations, each must fail assertions rather than compilation. Never run LiveAi."""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
HANDLER = ROOT / 'src/Keyloop.ServiceScheduler.Api/Features/Customers/FindReturningCustomers/FindReturningCustomersHandler.cs'
LOG = ROOT / 'src/Keyloop.ServiceScheduler.Api/Common/Telemetry/CustomerLookupLog.cs'
ORIGINAL = {path: path.read_bytes() for path in (HANDLER, LOG)}
EVIDENCE = Path(os.environ.get('MUTATION_TMPDIR', '/tmp/kl39'))
EVIDENCE.mkdir(parents=True, exist_ok=True)
ENV = {**os.environ, 'TMPDIR': str(EVIDENCE)}


def restore():
    for path, data in ORIGINAL.items():
        path.write_bytes(data)


def run(label, test, expect_failure):
    result = subprocess.run(
        ['dotnet', 'test', '--project', 'tests/Keyloop.ServiceScheduler.IntegrationTests', '--filter',
         'FullyQualifiedName~' + test], cwd=ROOT, env=ENV, text=True, capture_output=True)
    output = result.stdout + result.stderr
    (EVIDENCE / f'{label}.log').write_text(output)
    summary = re.search(r'Test run summary: (Passed!|Failed!)\s+total: (\d+)\s+failed: (\d+)\s+succeeded: (\d+)', output)
    if not summary:
        raise RuntimeError(f'{label}: no test summary; build or infrastructure failed. See {EVIDENCE / (label + ".log")}')
    total, failed, passed = map(int, summary.group(2, 3, 4))
    if expect_failure:
        if result.returncode != 2 or failed != total or total == 0:
            raise RuntimeError(f'{label}: mutation survived or was not killed by assertions')
        print(f'{label}: KILLED ({failed}/{total} assertion failures)')
    else:
        if result.returncode != 0 or failed or passed != total or total == 0:
            raise RuntimeError(f'{label}: restored verification failed')
        print(f'{label}: PASS ({passed}/{total})')


try:
    restore()
    HANDLER.write_text(HANDLER.read_text().replace('WHERE dealership_id = @dealership AND ', 'WHERE '))
    run('customer-lookup-mutation-scope', 'CustomerLookupTests.Matching_latest_and_count_reads_stay_in_the_route_dealership', True)
    restore()
    HANDLER.write_text(HANDLER.read_text().replace(
        'SchedulerLog.CustomerLookupCompleted(logger, kind, results.Count);',
        'SchedulerLog.CustomerLookupCompleted(logger, kind, results.Count, query);'))
    LOG.write_text(LOG.read_text().replace('results {ResultCount}', 'results {ResultCount}, query {Query}')
                   .replace('int resultCount);', 'int resultCount, string query);'))
    run('customer-lookup-mutation-privacy', 'CustomerLookupTests.Query_and_returned_personal_data_never_reach_logs_or_activity_tags', True)
finally:
    restore()

run('customer-lookup-mutation-restored', 'CustomerLookupTests', False)
print('Both mutations reverted; original source bytes restored.')
