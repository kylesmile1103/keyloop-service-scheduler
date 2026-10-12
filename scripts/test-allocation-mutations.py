#!/usr/bin/env python3
"""Offline mutation probes for ADR-029. Restores source even on failure; serial execution only."""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "src/Keyloop.ServiceScheduler.Domain/Scheduling/AllocationPolicy.cs"
OUT = ROOT / "artifacts/allocation-mutations"
OUT.mkdir(parents=True, exist_ok=True)
original = SOURCE.read_text()
probes = [
    ("preferred", ".OrderBy(c => c.Id == preferred ? 0 : 1)", ".OrderBy(c => 0)"),
    ("surplus", ".ThenBy(surplus)", ""),
    ("load", ".ThenBy(c => load.GetValueOrDefault(c.Id))", ""),
    ("name", ".ThenBy(name, StringComparer.Ordinal)", ""),
    ("id", ".ThenBy(c => c.Id)", ""),
    ("only-qualified", "return (ordered.FirstOrDefault(), AllocationCriterion.OnlyQualifiedResource);",
        "return (ordered.FirstOrDefault(), AllocationCriterion.Name);"),
    ("hard-filter", "t.Satisfies(requirements, localDate) && !busyTechnicians.Contains(t.Id)", "!busyTechnicians.Contains(t.Id)"),
    ("hv-surplus", "+ t.EffectiveHvLevel(localDate) - requirements.MinimumHvLevel", ""),
]
env = dict(os.environ, TMPDIR="/tmp/klveh")
command = ["dotnet", "test", "--project", "tests/Keyloop.ServiceScheduler.UnitTests", "--filter", "FullyQualifiedName~VehicleAwareAllocationTests"]


def run(name):
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (OUT / f"{name}.log").write_text(result.stdout)
    match = re.search(r"^\s*failed:\s*(\d+)\s*$", result.stdout, re.M)
    if not match:
        raise RuntimeError(f"{name}: no completed test summary; inspect {OUT / (name + '.log')}")
    return result.returncode, int(match[1])


try:
    status, failures = run("baseline")
    if status != 0 or failures != 0:
        raise RuntimeError("Baseline failed; probes would be meaningless.")
    for name, before, after in probes:
        if before not in original:
            raise RuntimeError(f"{name}: mutation target missing.")
        SOURCE.write_text(original.replace(before, after, 1))
        status, failures = run(name)
        if status != 2 or failures == 0:
            raise RuntimeError(f"{name}: mutation survived or failed to execute tests ({status}, {failures}).")
        print(f"KILLED {name}: {failures} failing cases", flush=True)
        SOURCE.write_text(original)
finally:
    SOURCE.write_text(original)
status, failures = run("restored")
if status != 0 or failures != 0:
    raise RuntimeError("Restored baseline failed.")
print("PASS: eight mutants killed; restored 48-case domain suite is green.", flush=True)
