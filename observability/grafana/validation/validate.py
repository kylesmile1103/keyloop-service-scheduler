#!/usr/bin/env python3
"""Offline checks for the Grafana manifests. Never calls Grafana.

Stages: JSON Schema and structure; layout, datasource and scope variables; pinned alert contracts; metric
and label inventory against validation/metrics.json and the telemetry code; PromQL behaviour of the
must-be-zero counter queries (promtool); gcx lint of v1beta1 copies plus a canary that must fail.
"""

import argparse
import copy
import json
import os
import re
import shlex
import shutil
import subprocess
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError, best_match

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
# Each assembly declares the instruments it records (ADR-025): Api the booking, availability and cancellation
# instruments, Infrastructure the shared Meter and the notification instruments. Every folder is read.
TELEMETRY = (Path("src/Keyloop.ServiceScheduler.Api/Common/Telemetry"),
             Path("src/Keyloop.ServiceScheduler.Infrastructure/Telemetry"))
DASHBOARDS = {"keyloop-booking-engine", "keyloop-api-health", "keyloop-notifications", "keyloop-frontend"}
# Pinned from grafana-observability-plan.md section 5.2, ARCHITECTURE section 12.3 and the Task 23 scope
# (readiness). A changed threshold, pending period, window or severity must be a deliberate edit here.
ALERTS = {
    "keyloop-booking-deadlocks": dict(severity="page", pending="0s", window="10m", condition=("gt", 0),
                                      panel=("keyloop-booking-engine", 1)),
    "keyloop-booking-constraint-backstop": dict(severity="ticket", pending="0s", window="10m", condition=("gt", 0),
                                                panel=("keyloop-booking-engine", 2)),
    "keyloop-api-5xx-ratio": dict(severity="ticket", pending="5m", window="10m", condition=("gt", 0.001),
                                  panel=("keyloop-api-health", 2)),
    "keyloop-booking-p95-latency": dict(severity="page", pending="5m", window="5m",
                                        condition=("math", "$A > 300 && $B > 0.02"),
                                        panel=("keyloop-booking-engine", 10)),
    "keyloop-notifications-outbox-age": dict(severity="ticket", pending="10m", window="10m", condition=("gt", 300),
                                             panel=("keyloop-notifications", 6)),
    "keyloop-notifications-dead-letters": dict(severity="ticket", pending="0s", window="15m", condition=("gt", 0),
                                               panel=("keyloop-notifications", 1)),
    "keyloop-api-readiness": dict(severity="page", pending="0s", window="5m", condition=("gt", 0),
                                  panel=("keyloop-api-health", 11)),
}
# Panels whose counter windows must count a series' first export, with their window: the must-be-zero stats
# over the dashboard range, and the readiness rule's evidence panel per step (its failures and the Durable
# Object's start pings are rare series that are often born holding their only event). Every alert query that
# uses increase() is must-be-zero as well.
BORN_AWARE_PANELS = {("keyloop-booking-engine", 1): "$__range", ("keyloop-booking-engine", 2): "$__range",
                     ("keyloop-booking-engine", 6): "$__range", ("keyloop-notifications", 1): "$__range",
                     ("keyloop-api-health", 11): "$__rate_interval"}
# Promoted OTLP resource labels on every Mimir series. target_info keeps only job and instance of the
# identifying attributes (service.name/namespace/instance.id), unless the stack keeps them explicitly.
RESOURCE_LABELS = {"job", "instance", "service_name", "service_namespace", "service_version",
                   "deployment_environment_name"}
INFO_LABELS = {"job", "instance"}
# OTLP translation makes job = service.namespace/service.name, so dashboards derive it from the same variables
# their Loki and Tempo queries use rather than reading it back from target_info.
DASHBOARD_SCOPE = 'job="${namespace}/${service}", deployment_environment_name=~"${env:regex}"'
ALERT_SCOPE = re.compile(r'job="(?:\$\{API_JOB\}|[^"$]+)", deployment_environment_name="(?:\$\{ENVIRONMENT\}|[^"$]+)"')
LINT_RULES = {"target-valid-promql", "panel-title-description", "panel-units", "uneditable-dashboard",
              "alert-summary", "alert-runbook-link"}
# Values for behaviour tests. Alert placeholders and dashboard variables resolve to the same scope.
# $__rate_interval is at least four scrape intervals; OTLP exports every 60 seconds by default.
TEST_VALUES = {"${namespace}": "keyloop-scheduler", "${service}": "api", "${env:regex}": "Production",
               "${kind:regex}": ".*", "${route:regex}": ".*", "${API_JOB}": "keyloop-scheduler/api",
               "${ENVIRONMENT}": "Production", "$__rate_interval": "4m"}
STRING = r'"(?:\\.|[^"\\])*"'
SELECTOR = re.compile(r"([a-zA-Z_:][a-zA-Z0-9_:]*)\{((?:[^{}\"]|" + STRING + r")*)\}")
MATCHER = re.compile(r"([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:=~|!~|!=|=)\s*" + STRING)
INCREASE = re.compile(r"increase\(([a-zA-Z_:][a-zA-Z0-9_:]*\{(?:[^{}\"]|" + STRING + r")*\})\[([^\]]+)\]\)")


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


def born_aware(selector, window):
    """Counter increase that also counts a series first exported inside the window.

    OTel creates a counter series on its first Add, so the first exported sample already holds the event
    and increase() alone reads 0. Series present one window ago contribute increase(); series born in the
    window contribute their largest value, which is every event since the process created them.
    """
    return (f"(increase({selector}[{window}]) and {selector} offset {window}) or "
            f"(max_over_time({selector}[{window}]) unless {selector} offset {window})")


def metric_identifiers(query):
    # Remove strings, variables, selectors, ranges and label lists, leaving vector names.
    query = re.sub(STRING, '""', query)
    query = re.sub(r"\$\{[^}]*\}|\$\w+", "", query)
    query = re.sub(r"\{[^{}]*\}|\[[^\]]*\]", "", query)
    query = re.sub(r"\b(?:by|without|on|ignoring)\s*\([^)]*\)", "", query)
    query = re.sub(r"\b(?:group_left|group_right)\s*(?:\([^)]*\))?", "", query)
    tokens = set(re.findall(r"\b[a-zA-Z_:][a-zA-Z0-9_:]*\b", query))
    functions = set(re.findall(r"\b([a-zA-Z_][a-zA-Z0-9_]*)\s*\(", query))
    return tokens - functions - {"and", "or", "unless", "bool", "offset"}


def selectors(query):
    """(metric, [label names]) for every metric{...} selector in the query."""
    return [(name, MATCHER.findall(body)) for name, body in SELECTOR.findall(query)]


def grouping_labels(query):
    query = re.sub(STRING, '""', query)
    labels = set()
    for body in re.findall(r"\b(?:by|without|on|ignoring)\s*\(([^)]*)\)", query):
        labels |= {label.strip() for label in body.split(",") if label.strip()}
    return labels


def ranges(query):
    """Range selector durations, ignoring bracket expressions inside label strings."""
    return re.findall(r"\[([^\]]+)\]", re.sub(STRING, '""', query))


def instruments_in_code(code):
    # Generic Create*<T>("name", "unit") and non-generic CreateObservableGauge("name", callback, "unit").
    pattern = r'Create(Counter|Histogram|ObservableGauge|Gauge)(?:<[^>]+>)?\(\s*"([^"]+)"([^;]+);'
    return {name: (kind, body) for kind, name, body in re.findall(pattern, code)}


def telemetry_declarations(repo):
    """Instruments declared in every TELEMETRY folder. A missing or empty folder fails instead of reading less."""
    declarations = {}
    for folder in TELEMETRY:
        files = sorted((repo / folder).glob("*.cs"))
        require(files, f"No telemetry code in {folder}; update TELEMETRY in validate.py if it moved")
        for path in files:
            declarations.update(instruments_in_code(path.read_text()))
    return declarations


def unit_declared(body, unit):
    return re.search(r',\s*"' + re.escape(unit) + r'"\s*[,)]', body) is not None


def allowed_labels(name, metric):
    if metric["kind"] == "info":
        return INFO_LABELS | set(metric["labels"])
    labels = RESOURCE_LABELS | set(metric["labels"])
    return labels | {"le"} if name.endswith("_bucket") else labels


def check_labels(query, location, series):
    """Matchers and by/without/on/ignoring labels exist on the queried series; quantiles group by le."""
    union = set()
    for name in metric_identifiers(query):
        union |= allowed_labels(name, series[name])
    for name, labels in selectors(query):
        require(name in series, f"Unknown Mimir metric {name} at {location}")
        allowed = allowed_labels(name, series[name])
        for label in labels:
            require(label in allowed, f"Label {label} is not exported on {name} at {location}")
    for label in grouping_labels(query):
        require(label in union, f"Grouping label {label} is not exported by the queried series at {location}")
    if "histogram_quantile(" in query:
        groupings = re.findall(r"histogram_quantile\(\s*[0-9.]+\s*,\s*sum\s+by\s*\(([^)]*)\)", query)
        require(len(groupings) == query.count("histogram_quantile("),
                f"histogram_quantile must aggregate with sum by (le, ...) at {location}")
        require(all("le" in {g.strip() for g in groups.split(",")} for groups in groupings),
                f"histogram_quantile without le grouping at {location}")
        require(all(name.endswith("_bucket") for name, _ in selectors(query)),
                f"histogram_quantile over a non-bucket series at {location}")


def require_born_aware(query, location, window=None, zero_fallback=True):
    found = INCREASE.findall(query)
    require(found, f"Counter query without increase() at {location}")
    for selector, rng in found:
        require(window is None or rng == window, f"Window {rng} differs from {window} at {location}")
        require(born_aware(selector, rng) in query,
                f"Counter query at {location} misses a series' first export: use validate.born_aware()")
    if zero_fallback:
        require(re.search(r"or (?:on\(\) )?vector\(0\)$", query), f"Must-be-zero query without zero fallback at {location}")


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
                match = re.fullmatch(r"label_values\((.+),\s*([a-zA-Z_][a-zA-Z0-9_]*)\)", query)
                require(match, f"Unexpected variable query: {query}")
                require(variable["definition"] == query, f"Variable definition differs from query: {query}")
                # label_values(selector, label) lists what count by (label) (selector) groups by, so the label
                # is checked against the selector's series like any other grouping label.
                yield f"count by ({match[2]}) ({match[1]})", f"{resource['metadata']['name']} variable {variable['name']}"
    elif resource["kind"] == "AlertRule":
        for ref, expression in spec["expressions"].items():
            if "datasourceUID" in expression:
                yield expression["model"]["expr"], f"{resource['metadata']['name']} expression {ref}"


def check_dashboard(name, dashboard, dashboards):
    panels = dashboard["spec"]["panels"]
    require(len({p["id"] for p in panels}) == len(panels), f"Duplicate panel id in {name}")
    variables = dashboard["spec"]["templating"]["list"]
    var_names = {v["name"] for v in variables}
    require(len(var_names) == len(variables), f"Duplicate variable in {name}")
    require({"ds_metrics", "ds_logs", "ds_traces", "namespace", "service", "env"} <= var_names,
            f"Missing datasource or scope variables in {name}")
    linked = {link["url"].split("?", 1)[0].removeprefix("/d/") for link in dashboard["spec"]["links"]}
    require(linked == set(dashboards) - {name}, f"Broken dashboard navigation in {name}")
    for variable in variables:
        if "datasource" in variable:
            require(variable["datasource"]["uid"] == "${ds_metrics}", "Hard-coded variable datasource")
        if variable["type"] == "query":
            for metric, labels in selectors(variable["query"]["query"]):
                if metric == "target_info":
                    require(not {"service_name", "service_namespace", "service_instance_id"} & set(labels),
                            f"{name} variable {variable['name']}: target_info carries job and instance, not service_* labels")
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
        if panel["title"].endswith("must be 0"):
            require((name, panel["id"]) in BORN_AWARE_PANELS, f"Must-be-zero panel {name}/{panel['id']} is not registered")
        for target in panel["targets"]:
            require(target["datasource"] == panel["datasource"], "Panel/target datasource mismatch")
            query = target.get("expr", target.get("query", ""))
            location = f"{name}/{panel['id']}"
            require("${env:regex}" in query, f"Unscoped environment in {location}")
            if target["datasource"]["type"] == "prometheus":
                for metric, body in SELECTOR.findall(query):
                    require(body.startswith(DASHBOARD_SCOPE), f"Selector {metric} in {location} must start with {DASHBOARD_SCOPE}")
                for rng in ranges(query):
                    require(rng in {"$__rate_interval", "$__range"}, f"Fixed range [{rng}] in {location}")
                window = BORN_AWARE_PANELS.get((name, panel["id"]))
                if window == "$__range":
                    require(panel["type"] in {"stat", "bargauge"} and target.get("instant"),
                            f"Must-be-zero panel {location} must be an instant stat")
                    require_born_aware(query, location, window)
                elif window:
                    require(panel["type"] == "timeseries" and target.get("range"), f"Panel {location} must be a range time series")
                    require_born_aware(query, location, window, zero_fallback=False)
            if target["datasource"]["type"] == "tempo":
                require(target["queryType"] == "traceql" and target["filters"] == [], "Wrong Tempo model")
                if panel["type"] == "timeseries":
                    require(target.get("metricsQueryType") == "range", "TraceQL metrics need range model")
    for panel_ref in BORN_AWARE_PANELS:
        if panel_ref[0] == name:
            require(panel_ref[1] in {p["id"] for p in panels}, f"Registered must-be-zero panel {panel_ref} is missing")


def check_alert(alert, dashboards, runbooks):
    name = alert["metadata"]["name"]
    contract = ALERTS[name]
    spec = alert["spec"]
    require(spec["trigger"]["interval"] == "1m" and spec["noDataState"] == "Ok" and spec["execErrState"] == "Error",
            f"{name}: evaluation settings differ from the plan")
    require(spec["for"] == contract["pending"], f"{name}: pending period {spec['for']} is not {contract['pending']}")
    require(spec["labels"]["severity"] == contract["severity"], f"{name}: severity differs from the plan")
    require(spec["labels"]["service"] == "keyloop-scheduler-api", f"{name}: service label differs")
    source_refs = [ref for ref, expr in spec["expressions"].items() if expr.get("source")]
    require(source_refs == ["C"], f"{name}: exactly one final source expression C is required")
    ref = spec["panelRef"]
    require((ref["dashboardUID"], ref["panelID"]) == contract["panel"], f"{name}: panel link differs from the contract")
    require(spec["annotations"]["__dashboardUid__"] == ref["dashboardUID"] and
            spec["annotations"]["__panelId__"] == str(ref["panelID"]), f"{name}: alert link annotations differ")
    anchor = spec["annotations"]["runbook_url"].rsplit("#", 1)[-1]
    headings = {re.sub(r"[^a-z0-9 -]", "", h.lower()).replace(" ", "-")
                for h in re.findall(r"^## (.+)$", runbooks, re.MULTILINE)}
    require(anchor in headings, f"{name}: alert runbook anchor does not exist")
    require(ref["dashboardUID"] in dashboards, f"{name}: alert dashboard link does not exist")
    require(ref["panelID"] in {p["id"] for p in dashboards[ref["dashboardUID"]]["spec"]["panels"]},
            f"{name}: alert panel link does not exist")
    condition = spec["expressions"]["C"]["model"]
    kind, value = contract["condition"]
    if kind == "math":
        require(condition["type"] == "math" and condition["expression"] == value, f"{name}: condition differs")
    else:
        rule = condition["conditions"]
        require(condition["type"] == "threshold" and len(rule) == 1 and
                rule[0]["evaluator"] == {"type": kind, "params": [value]} and rule[0]["reducer"]["type"] == "last",
                f"{name}: threshold differs from {kind} {value}")
    for key, expr in spec["expressions"].items():
        model = expr["model"]
        require(key == model["refId"], f"{name}: expression key/refId mismatch")
        if "datasourceUID" in expr:
            query = model["expr"]
            require(model["instant"] and not model["range"], f"{name}: alert queries must be instant")
            require(model["datasource"]["uid"] == expr["datasourceUID"], f"{name}: alert datasource mismatch")
            require(expr["relativeTimeRange"]["from"] == contract["window"], f"{name}: query lookback differs")
            require(all(ALERT_SCOPE.match(body) for _, body in SELECTOR.findall(query)), f"{name}: unscoped alert selector")
            require(not re.search(r"\$__\w+|\$env|\$job|\$\{[a-z]", query), f"{name}: alert depends on dashboard interpolation")
            for rng in ranges(query):
                require(rng == contract["window"], f"{name}: range [{rng}] differs from window {contract['window']}")
            if "increase(" in query:
                require(kind == "gt" and value == 0, f"{name}: counter increases are must-be-zero rules")
                require_born_aware(query, f"alert {name}", contract["window"])
        elif model["type"] == "threshold":
            require(model["expression"] in spec["expressions"], f"{name}: broken threshold dependency")
        else:
            deps = set(re.findall(r"\$([A-Z])\b", model["expression"]))
            require(deps and deps < set(spec["expressions"]), f"{name}: broken math dependencies")


PLACEHOLDER = re.compile(r"\$\{([A-Z_]+)\}")


def conform(source, prepared, settings, where):
    """Prepared rules must equal the tested templates apart from consistent placeholder values."""
    if isinstance(source, dict):
        require(isinstance(prepared, dict) and source.keys() == prepared.keys(), f"{where}: fields differ from template")
        for key in source:
            conform(source[key], prepared[key], settings, f"{where}.{key}")
    elif isinstance(source, list):
        require(isinstance(prepared, list) and len(source) == len(prepared), f"{where}: list differs from template")
        for index, (item, other) in enumerate(zip(source, prepared)):
            conform(item, other, settings, f"{where}[{index}]")
    elif isinstance(source, str) and PLACEHOLDER.search(source):
        require(isinstance(prepared, str), f"{where}: expected text")
        seen, parts = set(), []
        for literal, name in re.findall(r"(.*?)(?:\$\{([A-Z_]+)\}|$)", source, re.DOTALL):
            parts.append(re.escape(literal))
            if name:
                parts.append(re.escape(settings[name]) if name in settings else
                             f"(?P={name})" if name in seen else f"(?P<{name}>.+?)")
                seen.add(name)
        match = re.fullmatch("".join(parts), prepared, re.DOTALL)
        require(match, f"{where}: prepared value does not match template")
        settings.update({k: v for k, v in match.groupdict().items()})
    else:
        require(source == prepared, f"{where}: prepared value differs from template")


def load_resources(root, alerts_dir=None):
    schema = json.loads((root / "validation/resource.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    checker = Draft202012Validator(schema)
    source_dirs = [root / "folders", root / "dashboards", alerts_dir or root / "alertrules"]
    paths = [p for directory in source_dirs for p in sorted(directory.glob("*.yaml"))]
    resources = [read_yaml(p) for p in paths]
    for path, resource in zip(paths, resources):
        # Report the failure inside the branch for this kind, not the opaque top-level oneOf message.
        branch = next((b for b in schema["oneOf"] if resource.get("kind") in b["properties"]["kind"]["enum"]), None)
        require(branch, f"{path}: unknown kind {resource.get('kind')}")
        error = best_match(Draft202012Validator(branch).iter_errors(resource))
        require(error is None, f"{path}: schema violation at /{'/'.join(map(str, error.absolute_path)) if error else ''}: "
                               f"{error.message[:300] if error else ''}")
        checker.validate(resource)
        require(chr(0x2014) not in path.read_text(), f"Forbidden punctuation in {path}")
        if resource["kind"] != "Folder":
            require((resource["metadata"].get("annotations") or {}).get("grafana.app/folder") == "keyloop-service-scheduler",
                    f"Missing folder on {path}")
    return paths, resources


def check_manifests(root=ROOT, repo=REPO, alerts_dir=None):
    """All static checks. Returns the loaded resources and the alert templates for the tool stages."""
    paths, resources = load_resources(root, alerts_dir)
    expected = 1 + len(DASHBOARDS) + len(ALERTS)
    require(len(resources) == expected, f"Expected one folder, {len(DASHBOARDS)} dashboards and {len(ALERTS)} alerts")
    names = [r["metadata"]["name"] for r in resources]
    require(len(set(names)) == len(names), "Duplicate resource UID")
    dashboards = {r["metadata"]["name"]: r for r in resources if r["kind"] == "Dashboard"}
    require(set(dashboards) == DASHBOARDS, "Dashboard set differs")
    alerts = [r for r in resources if r["kind"] == "AlertRule"]
    require({a["metadata"]["name"] for a in alerts} == set(ALERTS), "Alert set differs")
    templates = alerts
    if alerts_dir:
        templates = [read_yaml(p) for p in sorted((root / "alertrules").glob("*.yaml"))]
        by_name = {t["metadata"]["name"]: t for t in templates}
        settings = {}
        for alert in alerts:
            name = alert["metadata"]["name"]
            require(name in by_name, f"Prepared rule {name} has no template")
            conform(by_name[name], alert, settings, name)
        require(not any("${" in json.dumps(a) for a in alerts), "Prepared rules contain unresolved placeholders")
    runbooks = (root / "runbooks.md").read_text()
    panel_count = 0
    for name, dashboard in dashboards.items():
        panel_count += len(dashboard["spec"]["panels"])
        check_dashboard(name, dashboard, dashboards)
    for alert in alerts:
        check_alert(alert, dashboards, runbooks)
    print(f"PASS: JSON Schema and structure, {len(resources)} manifests, {panel_count} panels, {len(alerts)} alerts; "
          "no overlaps; alert thresholds, pending periods, windows and severities match the pinned contract.")
    if alerts_dir:
        print(f"PASS: {len(alerts)} prepared rules equal the tested templates apart from consistent settings.")

    metrics = json.loads((root / "validation/metrics.json").read_text())
    series = {name: m for m in metrics for name in series_names(m)}
    declarations = telemetry_declarations(repo)
    design = (repo / "docs/ARCHITECTURE.md").read_text().split("## 12. Observability", 1)[1].split("\n## 13.", 1)[0]
    defaults = (repo / "src/Keyloop.ServiceScheduler.ServiceDefaults/Extensions.cs").read_text()
    used, missing = set(), set()
    query_count = 0
    for resource in resources:
        for query, location in query_records(resource):
            query_count += 1
            for name in metric_identifiers(query):
                require(name in series, f"Unknown Mimir metric {name} at {location}")
            check_labels(query, location, series)
            for name in metric_identifiers(query):
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
                    require(unit_declared(body, metric["unit"]), f"Unit mismatch for {instrument}")
                    require(instrument in design, f"{instrument} missing from ARCHITECTURE section 12")
                else:
                    missing.add(instrument)
    if missing:
        raise ValueError("Instrument verification failed: " + ", ".join(sorted(missing)) +
                         " not declared in " + ", ".join(map(str, TELEMETRY)))
    print(f"PASS: metric and label inventory, {query_count} PromQL/variable queries, {len(used)} distinct Mimir series; "
          "custom kinds/units match code; histogram quantiles group by le.")
    print("Framework names: registered ASP.NET Core meters, source citations in validation/metrics.json.")
    print("target_info: generated by OTLP translation, not a custom code instrument.")
    return resources, templates


def expression_for(target, resources):
    """The committed query for alert/<name> (as A > threshold) or dashboard/<uid>/<panel id>."""
    kind, _, rest = target.partition("/")
    if kind == "alert":
        alert = next((r for r in resources if r["kind"] == "AlertRule" and r["metadata"]["name"] == rest), None)
        require(alert, f"Behaviour test target {target} does not exist")
        condition = alert["spec"]["expressions"]["C"]["model"]
        require(condition["type"] == "threshold", f"Behaviour test target {target} needs a threshold condition")
        evaluator = condition["conditions"][0]["evaluator"]
        require(evaluator["type"] == "gt", f"Behaviour test target {target} needs a gt threshold")
        query = alert["spec"]["expressions"][condition["expression"]]["model"]["expr"]
        return f"({query}) > bool {evaluator['params'][0]}"
    uid, _, panel_id = rest.partition("/")
    dashboard = next((r for r in resources if r["kind"] == "Dashboard" and r["metadata"]["name"] == uid), None)
    require(dashboard, f"Behaviour test target {target} does not exist")
    panel = next((p for p in dashboard["spec"]["panels"] if str(p["id"]) == panel_id), None)
    require(panel and len(panel["targets"]) == 1, f"Behaviour test target {target} needs one query")
    return panel["targets"][0]["expr"]


def resolve(query, window):
    for name, value in TEST_VALUES.items():
        query = query.replace(name, value)
    query = query.replace("$__range", window)
    require("$" not in query.replace("$A", ""), f"Unresolved variable in behaviour test query: {query}")
    return query


def series_line(key, defaults):
    match = re.fullmatch(r"([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?", key)
    require(match, f"Bad behaviour test series {key}")
    labels = dict(defaults)
    labels.update(dict(re.findall(r'([a-zA-Z_][a-zA-Z0-9_]*)="([^"]*)"', match[2] or "")))
    return match[1] + "{" + ", ".join(f'{k}="{v}"' for k, v in sorted(labels.items())) + "}"


def behaviour_tests(spec, resources):
    """Build a promtool test file from the scenario spec and the committed expressions."""
    required = {f"alert/{r['metadata']['name']}" for r in resources if r["kind"] == "AlertRule" and
                any("increase(" in e["model"].get("expr", "") for e in r["spec"]["expressions"].values())}
    required |= {f"dashboard/{uid}/{panel}" for uid, panel in BORN_AWARE_PANELS}
    covered, detected, groups = set(), set(), []
    for scenario in spec["scenarios"]:
        tests = []
        for target, expectations in scenario["expect"].items():
            covered.add(target)
            query = resolve(expression_for(target, resources), scenario["window"])
            for at, expected in expectations.items():
                samples = expected if isinstance(expected, dict) else {"{}": expected}
                if any(value > 0 for value in samples.values()):
                    detected.add(target)
                tests.append({"expr": query, "eval_time": at,
                              "exp_samples": [{"labels": labels, "value": value} for labels, value in samples.items()]})
        groups.append({"name": scenario["name"], "interval": "1m",
                       "input_series": [{"series": series_line(key, spec["labels"]), "values": values}
                                        for key, values in scenario["series"].items()],
                       "promql_expr_test": tests})
    require(required <= covered, "No behaviour test for: " + ", ".join(sorted(required - covered)))
    require(required <= detected, "No behaviour test shows detection for: " + ", ".join(sorted(required - detected)))
    return {"evaluation_interval": "1m", "tests": groups}, len(required)


def run(command):
    try:
        return subprocess.run(command, capture_output=True, text=True, check=False)
    except FileNotFoundError:
        raise ValueError(f"{command[0]} not found; see observability/grafana/README.md, Offline validation") from None


def run_promtool(resources, root, out, promtool):
    spec = read_yaml(root / "validation/behaviour-tests.yaml")
    tests, targets = behaviour_tests(spec, resources)
    test_file = out / "promtool/behaviour-tests.yaml"
    test_file.parent.mkdir(parents=True)
    test_file.write_text(yaml.safe_dump(tests, sort_keys=False, width=200))
    result = run(shlex.split(promtool) + ["test", "rules", str(test_file)])
    require(result.returncode == 0, "PromQL behaviour tests failed:\n" + result.stdout + result.stderr)
    checks = sum(len(group["promql_expr_test"]) for group in tests["tests"])
    print(f"PASS: promtool behaviour tests, {len(tests['tests'])} scenarios, {checks} evaluations; "
          f"{targets} counter queries count a series' first export.")


def lint_artifacts(resources, templates, out):
    """v1beta1 copies (gcx 1.3.0 applies its dashboard rules to v1beta1 only) and a canary that must fail."""
    lint, canary = out / "lint", out / "canary"
    lint.mkdir(parents=True)
    canary.mkdir()
    targets = []
    for resource in resources:
        if resource["kind"] == "Dashboard":
            beta = copy.deepcopy(resource)
            beta["apiVersion"] = "dashboard.grafana.app/v1beta1"
            (lint / f"{resource['metadata']['name']}.yaml").write_text(yaml.safe_dump(beta, sort_keys=False))
        elif resource["kind"] == "AlertRule":
            for query, _ in query_records(resource):
                targets.append({"refId": f"Q{len(targets)}", "expr": query,
                                "datasource": {"type": "prometheus", "uid": "${ds_metrics}"}})
    # gcx's PromQL rule inspects dashboard targets only, so alert queries ride in a synthetic dashboard.
    artifact = {"apiVersion": "dashboard.grafana.app/v1beta1", "kind": "Dashboard",
                "metadata": {"name": "keyloop-alert-query-lint"},
                "spec": {"title": "Local alert query lint", "editable": False,
                         "panels": [{"id": 1, "title": "Alert PromQL", "description": "Local syntax check only",
                                     "type": "timeseries", "datasource": {"type": "prometheus", "uid": "${ds_metrics}"},
                                     "fieldConfig": {"defaults": {"unit": "short"}}, "targets": targets}]}}
    (lint / "keyloop-alert-query-lint.yaml").write_text(yaml.safe_dump(artifact, sort_keys=False))
    dashboard = copy.deepcopy(next(r for r in resources if r["metadata"]["name"] == "keyloop-booking-engine"))
    dashboard["apiVersion"] = "dashboard.grafana.app/v1beta1"
    dashboard["spec"]["editable"] = True
    panels = dashboard["spec"]["panels"]
    panels[0]["targets"][0]["expr"] = "(" + panels[0]["targets"][0]["expr"]
    panels[1]["description"] = ""
    panels[2]["fieldConfig"]["defaults"]["unit"] = "not-a-unit"
    (canary / "dashboard.yaml").write_text(yaml.safe_dump(dashboard, sort_keys=False))
    alert = copy.deepcopy(templates[0])
    del alert["spec"]["annotations"]["summary"], alert["spec"]["annotations"]["runbook_url"]
    (canary / "alert.yaml").write_text(yaml.safe_dump(alert, sort_keys=False))
    return lint, canary, len(targets)


def gcx_lint(gcx, *paths):
    result = run([gcx, "dev", "lint", "run", *map(str, paths), "-o", "json"])
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError(f"gcx lint returned no JSON report (exit {result.returncode}): {result.stderr.strip()}") from None
    return result.returncode, report


def run_gcx(resources, templates, root, out, gcx, alerts_dir=None):
    listed = run([gcx, "dev", "lint", "list-rules", "-o", "json"])
    builtin = {rule["name"] for rule in json.loads(listed.stdout or "[]") if rule.get("builtin")}
    require(LINT_RULES <= builtin, "gcx no longer lists rules: " + ", ".join(sorted(LINT_RULES - builtin)))
    lint, canary, queries = lint_artifacts(resources, templates, out)
    code, report = gcx_lint(gcx, root / "folders", lint, alerts_dir or root / "alertrules")
    expected = 1 + len(DASHBOARDS) + 1 + len(ALERTS)
    summary = report["summary"]
    require(code == 0 and summary["num_violations"] == 0,
            "gcx lint violations:\n" + json.dumps(report.get("violations"), indent=2))
    require(summary["files_scanned"] == expected, f"gcx scanned {summary['files_scanned']} files, expected {expected}")
    print(f"PASS: gcx lint, {expected} files: folder, {len(DASHBOARDS)} dashboards as v1beta1 copies, "
          f"{queries} alert queries, {len(ALERTS)} {'prepared' if alerts_dir else 'template'} rules; no disabled rules.")
    code, report = gcx_lint(gcx, canary)
    fired = {violation["rule"] for violation in report.get("violations") or []}
    require(code != 0 and LINT_RULES <= fired,
            "gcx lint canary passed rules it must fail: " + ", ".join(sorted(LINT_RULES - fired)))
    print(f"PASS: gcx lint canary fails all {len(LINT_RULES)} rules ({', '.join(sorted(fired))}), so the gate is live.")
    if builtin - LINT_RULES:
        print("NOTE: gcx rules without a canary case: " + ", ".join(sorted(builtin - LINT_RULES)))


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--alerts-dir", type=Path, help="Validate and lint locally prepared rules in place of source templates")
    args = parser.parse_args()
    out = ROOT / ".validation"
    try:
        resources, templates = check_manifests(alerts_dir=args.alerts_dir and args.alerts_dir.resolve())
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir()
        # Behaviour tests always run on the templates; prepared rules were shown to equal them above.
        tested = [r for r in resources if r["kind"] != "AlertRule"] + templates
        run_promtool(tested, ROOT, out, os.environ.get("PROMTOOL", "promtool"))
        run_gcx(resources, templates, ROOT, out, os.environ.get("GCX", "gcx"),
                args.alerts_dir and args.alerts_dir.resolve())
    except (ValueError, KeyError, OSError, ValidationError, yaml.YAMLError) as error:
        parser.exit(1, f"FAIL: {error}\n")


if __name__ == "__main__":
    main()
