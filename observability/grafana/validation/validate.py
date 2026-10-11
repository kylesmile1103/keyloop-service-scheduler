#!/usr/bin/env python3
"""Offline schema, layout, datasource, expression and instrument checks."""

import argparse
import json
import re
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
PLANNED = {
    "scheduler.notifications.outbox_pending",
    "scheduler.notifications.oldest_pending_age",
}
EXPECTED_ALERTS = {
    "keyloop-booking-deadlocks", "keyloop-booking-constraint-backstop",
    "keyloop-api-5xx-ratio", "keyloop-booking-p95-latency",
    "keyloop-notifications-outbox-age", "keyloop-api-readiness",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_yaml(path):
    class UniqueLoader(yaml.SafeLoader):
        pass

    def mapping(loader, node, deep=False):
        result = {}
        for key_node, value_node in node.value:
            key = loader.construct_object(key_node, deep=deep)
            require(key not in result, f"{path}: duplicate YAML key {key}")
            result[key] = loader.construct_object(value_node, deep=deep)
        return result

    UniqueLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, mapping)
    return yaml.load(path.read_text(), Loader=UniqueLoader)


def series_names(metric):
    base = metric["instrument"].replace(".", "_")
    base += {"ms": "_milliseconds", "s": "_seconds"}.get(metric["unit"], "")
    if metric["kind"] == "counter":
        return {base + "_total"}
    if metric["kind"] == "histogram":
        return {base + suffix for suffix in ("_bucket", "_sum", "_count")}
    return {base}


def metric_identifiers(query):
    # Remove strings, selectors, ranges, and label lists, leaving vector names.
    # gcx supplies the syntax parser; this only inventories this project's PromQL.
    query = re.sub(r'"(?:\\.|[^"\\])*"', '""', query)
    query = re.sub(r"\{[^{}]*\}|\[[^\]]*\]", "", query)
    query = re.sub(r"\b(?:by|without|on|ignoring)\s*\([^)]*\)", "", query)
    query = re.sub(r"\b(?:group_left|group_right)\s*(?:\([^)]*\))?", "", query)
    tokens = set(re.findall(r"\b[a-zA-Z_:][a-zA-Z0-9_:]*\b", query))
    functions = set(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", query))
    return tokens - functions - {"and", "or", "unless", "bool", "offset"}


def instruments_in_code(code):
    pattern = r'Create(Counter|Histogram|ObservableGauge|Gauge)<[^>]+>\(\s*"([^"]+)"([^;]+);'
    return {name: (kind, body) for kind, name, body in re.findall(pattern, code)}


def query_records(resource):
    spec = resource["spec"]
    if resource["kind"] == "Dashboard":
        for panel in spec["panels"]:
            for target in panel["targets"]:
                if target["datasource"]["type"] == "prometheus":
                    yield target["expr"], f"{resource['metadata']['name']} panel {panel['id']}"
        for variable in spec["templating"]["list"]:
            if variable["type"] == "query":
                query = variable["query"]["query"]
                match = re.fullmatch(r"label_values\((.+),\s*[a-zA-Z_][a-zA-Z0-9_]*\)", query)
                require(match, f"Unexpected variable query: {query}")
                yield match[1], f"{resource['metadata']['name']} variable {variable['name']}"
    elif resource["kind"] == "AlertRule":
        for ref, expression in spec["expressions"].items():
            if "datasourceUID" in expression:
                yield expression["model"]["expr"], f"{resource['metadata']['name']} expression {ref}"


def validate(notification_source=None, allow_planned_gauges=False, alerts_dir=None):
    schema = json.loads((ROOT / "validation/resource.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    checker = Draft202012Validator(schema)
    source_dirs = [ROOT / "folders", ROOT / "dashboards", alerts_dir or ROOT / "alertrules"]
    paths = [p for directory in source_dirs for p in sorted(directory.glob("*.yaml"))]
    resources = [read_yaml(p) for p in paths]
    require(len(resources) == 11, "Expected one folder, four dashboards and six alerts")
    names = [r["metadata"]["name"] for r in resources]
    require(len(set(names)) == len(names), "Duplicate resource UID")
    for path, resource in zip(paths, resources):
        checker.validate(resource)
        require(chr(0x2014) not in path.read_text(), f"Forbidden punctuation in {path}")
        if resource["kind"] != "Folder":
            require(resource["metadata"]["annotations"]["grafana.app/folder"] ==
                    "keyloop-service-scheduler", f"Missing folder on {path}")
    dashboards = {r["metadata"]["name"]: r for r in resources if r["kind"] == "Dashboard"}
    require(set(dashboards) == {"keyloop-booking-engine", "keyloop-api-health",
                                "keyloop-notifications", "keyloop-frontend"}, "Dashboard set differs")
    alerts = [r for r in resources if r["kind"] == "AlertRule"]
    require({a["metadata"]["name"] for a in alerts} == EXPECTED_ALERTS, "Alert set differs")
    panel_count = 0
    for name, dashboard in dashboards.items():
        panels = dashboard["spec"]["panels"]
        panel_count += len(panels)
        require(len({p["id"] for p in panels}) == len(panels), f"Duplicate panel id in {name}")
        variables = dashboard["spec"]["templating"]["list"]
        var_names = {v["name"] for v in variables}
        require(len(var_names) == len(variables), f"Duplicate variable in {name}")
        require({"ds_metrics", "ds_logs", "ds_traces", "service", "env"} <= var_names,
                f"Missing datasource or scope variables in {name}")
        linked = {link["url"].split("?", 1)[0].removeprefix("/d/")
                  for link in dashboard["spec"]["links"]}
        require(linked == set(dashboards) - {name}, f"Broken dashboard navigation in {name}")
        for variable in variables:
            if "datasource" in variable:
                require(variable["datasource"]["uid"] == "${ds_metrics}", "Hard-coded variable datasource")
        for i, panel in enumerate(panels):
            rect = panel["gridPos"]
            require(rect["x"] + rect["w"] <= 24, f"Panel {name}/{panel['id']} outside grid")
            for other in panels[i + 1:]:
                r = other["gridPos"]
                overlap = (rect["x"] < r["x"] + r["w"] and r["x"] < rect["x"] + rect["w"] and
                           rect["y"] < r["y"] + r["h"] and r["y"] < rect["y"] + rect["h"])
                require(not overlap, f"Overlapping panels in {name}: {panel['id']} and {other['id']}")
            require(panel["datasource"]["uid"] in {"${ds_metrics}", "${ds_logs}", "${ds_traces}"},
                    f"Hard-coded panel datasource in {name}")
            refs = [t["refId"] for t in panel["targets"]]
            require(len(set(refs)) == len(refs), f"Duplicate target reference in {name}/{panel['id']}")
            for target in panel["targets"]:
                require(target["datasource"] == panel["datasource"], "Panel/target datasource mismatch")
                query = target.get("expr", target.get("query", ""))
                require("${env:regex}" in query, f"Unscoped environment in {name}/{panel['id']}")
                if target["datasource"]["type"] == "prometheus":
                    require("${job:regex}" in query, f"Unscoped job in {name}/{panel['id']}")
                    if re.search(r"scheduler_booking_(?:deadlocks|constraint_backstop)_total", query):
                        require("or vector(0)" in query, "Must-be-zero counter missing zero fallback")
                if target["datasource"]["type"] == "tempo":
                    require(target["queryType"] == "traceql" and target["filters"] == [], "Wrong Tempo model")
                    if panel["type"] == "timeseries":
                        require(target.get("metricsQueryType") == "range", "TraceQL metrics need range model")
    for alert in alerts:
        spec = alert["spec"]
        source_refs = [ref for ref, expr in spec["expressions"].items() if expr.get("source")]
        require(source_refs == ["C"], "Exactly one final source expression C is required")
        ref = spec["panelRef"]
        require(spec["annotations"]["__dashboardUid__"] == ref["dashboardUID"] and
                spec["annotations"]["__panelId__"] == str(ref["panelID"]), "Alert link annotations differ")
        anchor = spec["annotations"]["runbook_url"].rsplit("#", 1)[-1]
        runbooks = (ROOT / "runbooks.md").read_text()
        headings = {re.sub(r"[^a-z0-9 -]", "", h.lower()).replace(" ", "-")
                    for h in re.findall(r"^## (.+)$", runbooks, re.MULTILINE)}
        require(anchor in headings, "Alert runbook anchor does not exist")
        require(ref["dashboardUID"] in dashboards, "Alert dashboard link does not exist")
        require(ref["panelID"] in {p["id"] for p in dashboards[ref["dashboardUID"]]["spec"]["panels"]},
                "Alert panel link does not exist")
        for key, expr in spec["expressions"].items():
            model = expr["model"]
            require(key == model["refId"], "Expression key/refId mismatch")
            if "datasourceUID" in expr:
                require(model["instant"] and not model["range"], "Alert queries must be instant")
                require(model["datasource"]["uid"] == expr["datasourceUID"], "Alert datasource mismatch")
                require("deployment_environment_name=" in model["expr"] and "job=" in model["expr"],
                        "Unscoped alert")
                require(not re.search(r"\$__(?:range|rate_interval)|\$env|\$job", model["expr"]),
                        "Alert depends on dashboard interpolation")
            elif model["type"] == "threshold":
                require(model["expression"] in spec["expressions"], "Broken threshold dependency")
            else:
                deps = set(re.findall(r"\$([A-Z])\b", model["expression"]))
                require(deps and deps < set(spec["expressions"]), "Broken math dependencies")
    print(f"PASS: JSON Schema and structure, {len(resources)} manifests, {panel_count} panels, 6 alerts; no overlaps.")

    metrics = json.loads((ROOT / "validation/metrics.json").read_text())
    series = {name: m for m in metrics for name in series_names(m)}
    code = "\n".join(p.read_text() for p in (REPO / "src/Keyloop.ServiceScheduler.Api/Common/Telemetry").glob("*.cs"))
    if notification_source:
        require((notification_source / "src/Keyloop.ServiceScheduler.Api/Common/Telemetry/SchedulerTelemetry.cs").is_file(),
                "--notification-source must point to a scheduler worktree")
        # Read only telemetry definitions; no checkout, build, or file writes in a sibling.
        extra_code = (notification_source / "src/Keyloop.ServiceScheduler.Api/Common/Telemetry/SchedulerTelemetry.cs").read_text()
        declarations = instruments_in_code(code)
        declarations.update({n: v for n, v in instruments_in_code(extra_code).items()
                             if n.startswith("scheduler.notifications.")})
    else:
        declarations = instruments_in_code(code)
    design = (REPO / "docs/SYSTEM_DESIGN.md").read_text().split("## 12. Observability", 1)[1].split("\n## 13.", 1)[0]
    defaults = (REPO / "src/Keyloop.ServiceScheduler.ServiceDefaults/Extensions.cs").read_text()
    used = set()
    query_count = 0
    missing = set()
    pending = set()
    lint_targets = []
    for resource in resources:
        for query, location in query_records(resource):
            query_count += 1
            for name in metric_identifiers(query):
                require(name in series, f"Unknown Mimir metric {name} at {location}")
                metric = series[name]
                used.add(name)
                instrument = metric["instrument"]
                if metric["source"] == "framework":
                    require(".AddAspNetCoreInstrumentation()" in defaults and "ASP.NET Core" in design,
                            f"Framework metrics not configured for {instrument}")
                elif metric["source"] == "otlp":
                    require("UseOtlpExporter()" in defaults and "ConfigureResource" in defaults,
                            "target_info requires OTLP resource export")
                elif instrument in declarations:
                    kind, body = declarations[instrument]
                    expected_kind = {"counter": "Counter", "histogram": "Histogram", "gauge": "ObservableGauge"}[metric["kind"]]
                    require(kind == expected_kind, f"Kind mismatch for {instrument}")
                    require('"' + metric["unit"] + '"' in body, f"Unit mismatch for {instrument}")
                    if metric["source"] == "scheduler":
                        require(instrument in design, f"{instrument} missing from SYSTEM_DESIGN section 12")
                elif instrument in PLANNED and allow_planned_gauges:
                    pending.add(instrument)
                else:
                    missing.add(instrument)
            if resource["kind"] == "AlertRule":
                lint_targets.append({"refId": chr(65 + len(lint_targets)), "expr": query,
                                     "datasource": {"type": "prometheus", "uid": "${ds_metrics}"}})
    if missing:
        raise ValueError("Instrument verification failed: " + ", ".join(sorted(missing)) +
                         ". Supply --notification-source before merge. Review-only --allow-planned-gauges permits exactly G2's two absent gauges.")
    print(f"PASS: metric inventory, {query_count} PromQL/variable queries, {len(used)} distinct Mimir series; implemented custom kinds/units match.")
    for name in sorted(pending):
        print(f"PENDING G2: {name} is not implemented; strict validation and deployment acceptance remain blocked.")
    print("Framework names: registered ASP.NET Core meters, source citations in validation/metrics.json.")
    print("target_info: generated by OTLP translation, not a custom code instrument.")
    artifact = {"apiVersion": "dashboard.grafana.app/v1", "kind": "Dashboard", "metadata": {"name": "keyloop-alert-query-lint"},
                "spec": {"title": "Local alert query lint", "editable": False,
                         "panels": [{"title": "Alert PromQL", "description": "Local syntax check only", "type": "timeseries",
                                     "datasource": {"type": "prometheus", "uid": "${ds_metrics}"},
                                     "fieldConfig": {"defaults": {"unit": "short"}}, "targets": lint_targets}]}}
    (ROOT / ".validation").mkdir(exist_ok=True)
    (ROOT / ".validation/alert-queries.yaml").write_text(yaml.safe_dump(artifact, sort_keys=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--notification-source", type=Path, help="Read-only worktree for unmerged Task 19 instruments")
    parser.add_argument("--allow-planned-gauges", action="store_true", help="Review only: report G2 gauges as pending")
    parser.add_argument("--alerts-dir", type=Path, help="Validate locally prepared rules in place of source templates")
    args = parser.parse_args()
    try:
        validate(**vars(args))
    except (ValueError, KeyError, OSError, ValidationError, yaml.YAMLError) as error:
        parser.exit(1, f"FAIL: {error}\n")


if __name__ == "__main__":
    main()
