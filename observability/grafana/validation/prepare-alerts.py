#!/usr/bin/env python3
"""Materialize reviewed alert settings into local files. Never calls Grafana."""

import argparse
import re
from pathlib import Path
from urllib.parse import urlsplit

import yaml

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]


def substitute(value, settings):
    if isinstance(value, str):
        for name, replacement in settings.items():
            value = value.replace("${" + name + "}", replacement)
        if re.search(r"\$\{[^}]+\}", value):
            raise ValueError(f"Unresolved template in {value}")
        return value
    if isinstance(value, dict):
        return {key: substitute(item, settings) for key, item in value.items()}
    if isinstance(value, list):
        return [substitute(item, settings) for item in value]
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metrics-datasource-uid", required=True)
    parser.add_argument("--environment", required=True)
    parser.add_argument("--api-job", default="keyloop-scheduler/api")
    parser.add_argument("--receiver", required=True, help="Name of a reviewed existing contact point")
    parser.add_argument("--runbook-base-url", required=True, help="HTTPS URL of the published runbooks.md file, without a fragment")
    parser.add_argument("--output-dir", type=Path, default=ROOT / ".review/alertrules")
    args = parser.parse_args()
    settings = {"METRICS_DATASOURCE_UID": args.metrics_datasource_uid, "ENVIRONMENT": args.environment,
                "API_JOB": args.api_job, "ALERT_RECEIVER": args.receiver, "RUNBOOK_BASE_URL": args.runbook_base_url}
    try:
        for key in ("METRICS_DATASOURCE_UID", "ENVIRONMENT", "API_JOB"):
            if not re.fullmatch(r"[A-Za-z0-9_./-]+", settings[key]):
                raise ValueError(f"Unsafe {key}: expected a plain UID, environment or job name")
        if not re.fullmatch(r"[A-Za-z0-9 _.:-]+", args.receiver):
            raise ValueError("Receiver must be a plain contact point name")
        url = urlsplit(args.runbook_base_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.fragment or url.query:
            raise ValueError("Runbook URL must be HTTPS with a host, without credentials, query or fragment")
        output = args.output_dir.resolve()
        if not output.is_relative_to(REPO):
            raise ValueError("Output must stay inside this worktree")
        if output.exists():
            raise ValueError("Output directory already exists; choose a new review directory")
        prepared = [(path.name, substitute(yaml.safe_load(path.read_text()), settings))
                    for path in sorted((ROOT / "alertrules").glob("*.yaml"))]
        output.mkdir(parents=True)
        for name, resource in prepared:
            (output / name).write_text(yaml.safe_dump(resource, sort_keys=False, width=160))
        print(f"Prepared {len(prepared)} local alert manifests in {output}. No remote requests made.")
        print("Run scripts/validate-dashboards.sh --alerts-dir on this directory and review its diff before any push.")
    except ValueError as error:
        parser.exit(1, f"FAIL: {error}\n")


if __name__ == "__main__":
    main()
