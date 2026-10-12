#!/usr/bin/env python3
"""Offline mutation probes for ADR-029. Restores source even on failure; serial execution only.

Each probe rewrites exactly one occurrence in one domain source file, runs the vehicle-aware domain tests and requires at least one
failing test (a compile failure does not count). The probes cover the allocation criteria, the requirement resolver's safety
semantics (maximum, unions, heavy-vehicle and live conditions, legacy level-3 floor, rule order, Unknown inheritance), the
technician and bay qualification predicates, and the why-not reason codes.

Set MUTATION_TMPDIR to a short directory (default /tmp/keyloop-tests): Microsoft.Testing.Platform's pipe path must stay under 104 bytes.
"""
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parent.parent
DOMAIN = ROOT / "src/Keyloop.ServiceScheduler.Domain"
POLICY = DOMAIN / "Scheduling/AllocationPolicy.cs"
RESOLVER = DOMAIN / "Scheduling/RequirementResolver.cs"
TECHNICIAN = DOMAIN / "Resources/Technician.cs"
BAY = DOMAIN / "Resources/ServiceBay.cs"
OUT = ROOT / "artifacts/allocation-mutations"
OUT.mkdir(parents=True, exist_ok=True)
probes = [
    # Allocation criteria.
    ("preferred", POLICY, ".OrderBy(c => c.Id == preferred ? 0 : 1)", ".OrderBy(c => 0)"),
    ("surplus", POLICY, ".ThenBy(surplus)", ""),
    ("load", POLICY, ".ThenBy(c => load.GetValueOrDefault(c.Id))", ""),
    ("name", POLICY, ".ThenBy(name, StringComparer.Ordinal).ThenBy(c => c.Id).ToArray()", ".ThenBy(c => c.Id).ToArray()"),
    ("id", POLICY, ".ThenBy(name, StringComparer.Ordinal).ThenBy(c => c.Id).ToArray()", ".ThenBy(name, StringComparer.Ordinal).ToArray()"),
    ("only-qualified", POLICY, "return (ordered.FirstOrDefault(), AllocationCriterion.OnlyQualifiedResource);",
        "return (ordered.FirstOrDefault(), AllocationCriterion.Name);"),
    ("hard-filter", POLICY, "t.Satisfies(requirements, localDate) && !busyTechnicians.Contains(t.Id)", "!busyTechnicians.Contains(t.Id)"),
    ("hv-surplus", POLICY, "+ t.EffectiveHvLevel(localDate) - requirements.MinimumHvLevel", ""),
    ("bay-surplus", POLICY, "b => b.Capabilities.Count - requirements.BayCapabilities.Count", "b => 0"),
    ("reason-hv-expired", POLICY, '? "preferred-technician:hv-expired" : "preferred-technician:minimum-hv-level"',
        '? "preferred-technician:minimum-hv-level" : "preferred-technician:hv-expired"'),
    ("reason-busy", POLICY, ': "preferred-technician:busy");', ': "preferred-technician:inactive");'),
    ("reason-bay-capabilities", POLICY, '"preferred-bay:missing-capabilities" : "preferred-bay:busy"', '"preferred-bay:busy" : "preferred-bay:busy"'),
    # Requirement resolution.
    ("resolver-max", RESOLVER, "minimum = Math.Max(minimum, rule.MinimumHvLevel);", "minimum = rule.MinimumHvLevel;"),
    ("resolver-bay-union", RESOLVER, "bays.UnionWith(rule.BayCapabilities);", ""),
    ("resolver-certification-union", RESOLVER, "certifications.UnionWith(rule.Certifications);", ""),
    ("resolver-heavy-condition", RESOLVER, "RequirementCondition.VehicleClass => profile.VehicleClass == rule.VehicleClass,",
        "RequirementCondition.VehicleClass => false,"),
    ("resolver-live-condition", RESOLVER, "RequirementCondition.LiveDiagnosis => needsLiveDiagnosis,", "RequirementCondition.LiveDiagnosis => false,"),
    ("resolver-legacy-floor", RESOLVER, "var minimum = legacyComponentWork ? 3 : 0;", "var minimum = legacyComponentWork ? 0 : 0;"),
    ("resolver-legacy-explanation", RESOLVER, "legacyComponentWork ? new List<string> { LegacyHvComponentRule } : []", "new List<string>()"),
    ("resolver-order", RESOLVER, "rules.OrderBy(r => r.Order)", "rules.OrderByDescending(r => r.Order)"),
    ("resolver-unknown-inherits", RESOLVER, "|| (powertrain == Powertrain.Unknown && rule.Powertrains.Any(p => p != Powertrain.Ice))", ""),
    # Qualification predicates.
    ("technician-active", TECHNICIAN, "DateOnly localDate) => IsActive", "DateOnly localDate) => true"),
    ("technician-certifications", TECHNICIAN, "&& requirements.Certifications.IsSubsetOf(Certifications) &&", "&&"),
    ("technician-level", TECHNICIAN, "EffectiveHvLevel(localDate) >= requirements.MinimumHvLevel", "EffectiveHvLevel(localDate) + 1 >= requirements.MinimumHvLevel"),
    ("technician-expiry-inclusive", TECHNICIAN, "expiry < localDate ? 0", "expiry <= localDate ? 0"),
    ("technician-expiry-ignored", TECHNICIAN, "expiry < localDate ? 0 : HvLevel", "expiry < localDate ? HvLevel : HvLevel"),
    ("bay-active", BAY, "Satisfies(JobRequirements requirements) => IsActive && ", "Satisfies(JobRequirements requirements) => "),
    ("bay-capabilities", BAY, "IsActive && requirements.BayCapabilities.IsSubsetOf(Capabilities)", "IsActive"),
]
tmpdir = os.environ.get("MUTATION_TMPDIR", "/tmp/keyloop-tests")
os.makedirs(tmpdir, exist_ok=True)
env = dict(os.environ, TMPDIR=tmpdir)
command = ["dotnet", "test", "--project", "tests/Keyloop.ServiceScheduler.UnitTests", "--filter", "FullyQualifiedName~Domain.VehicleAware"]
originals = {path: path.read_text() for path in {probe[1] for probe in probes}}


def run(name):
    result = subprocess.run(command, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    (OUT / f"{name}.log").write_text(result.stdout)
    match = re.search(r"^\s*failed:\s*(\d+)\s*$", result.stdout, re.M)
    total = re.search(r"^\s*total:\s*(\d+)\s*$", result.stdout, re.M)
    if not match or not total:
        raise RuntimeError(f"{name}: no completed test summary; inspect {OUT / (name + '.log')}")
    return result.returncode, int(match[1]), int(total[1])


def restore():
    for path, text in originals.items():
        path.write_text(text)


try:
    status, failures, total = run("baseline")
    if status != 0 or failures != 0:
        raise RuntimeError("Baseline failed; probes would be meaningless.")
    for name, path, before, after in probes:
        count = originals[path].count(before)
        if count != 1:
            raise RuntimeError(f"{name}: mutation target found {count} times in {path.name}; expected exactly once.")
        path.write_text(originals[path].replace(before, after, 1))
        status, failures, _ = run(name)
        if status != 2 or failures == 0:
            raise RuntimeError(f"{name}: mutation survived or failed to execute tests ({status}, {failures}).")
        print(f"KILLED {name}: {failures} failing cases", flush=True)
        restore()
finally:
    restore()
status, failures, total = run("restored")
if status != 0 or failures != 0:
    raise RuntimeError("Restored baseline failed.")
print(f"PASS: {len(probes)} mutants killed; restored {total}-case domain suite is green.", flush=True)
