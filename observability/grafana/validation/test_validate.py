"""Self-tests for validate.py: each guard rejects the defect it exists for. Run by scripts/validate-dashboards.sh."""

import copy
import json
import tempfile
import unittest
from pathlib import Path

import validate as v

ROOT = v.ROOT


def load(kind, name):
    return v.read_yaml(ROOT / {"Dashboard": "dashboards", "AlertRule": "alertrules"}[kind] / f"{name}.yaml")


def panel(dashboard, panel_id):
    return next(p for p in dashboard["spec"]["panels"] if p["id"] == panel_id)


class Instruments(unittest.TestCase):
    def test_reads_generic_and_non_generic_declarations(self):
        code = '''
        public static readonly Counter<long> Deadlocks = Meter.CreateCounter<long>("scheduler.booking.deadlocks", "{event}");
        public static readonly ObservableGauge<long> NotificationsOutboxPending = Meter.CreateObservableGauge(
            "scheduler.notifications.outbox_pending", NotificationBacklogMonitor.ObservePending, "{notification}");
        public static readonly ObservableGauge<double> Age = Meter.CreateObservableGauge(
            "scheduler.notifications.oldest_pending_age", NotificationBacklogMonitor.ObserveOldestPendingAge, "s");
        '''
        found = v.instruments_in_code(code)
        self.assertEqual(found["scheduler.booking.deadlocks"][0], "Counter")
        self.assertEqual(found["scheduler.notifications.outbox_pending"][0], "ObservableGauge")
        self.assertTrue(v.unit_declared(found["scheduler.notifications.outbox_pending"][1], "{notification}"))
        self.assertTrue(v.unit_declared(found["scheduler.notifications.oldest_pending_age"][1], "s"))
        self.assertFalse(v.unit_declared(found["scheduler.notifications.oldest_pending_age"][1], "ms"))

    def test_unit_must_be_a_whole_argument(self):
        body = ', ObserveAge, "ms", "Age in s")'
        self.assertFalse(v.unit_declared(body, "s"))


class Labels(unittest.TestCase):
    series = {name: m for m in json.loads((ROOT / "validation/metrics.json").read_text()) for name in v.series_names(m)}

    def check(self, query):
        v.check_labels(query, "test", self.series)

    def test_accepts_catalogued_point_and_resource_labels(self):
        self.check('sum by (outcome) (rate(scheduler_booking_requests_total{job="x", deployment_environment_name="P", outcome="confirmed"}[5m]))')
        self.check('histogram_quantile(0.95, sum by (le, dealership_id) (rate(scheduler_booking_lock_wait_milliseconds_bucket{job="x"}[5m])))')
        self.check('count by (instance, service_version) (target_info{job="x", deployment_environment_name=~"P"})')

    def test_rejects_unknown_matcher_label(self):
        with self.assertRaisesRegex(ValueError, "outcomes"):
            self.check('sum(rate(scheduler_booking_requests_total{job="x", outcomes="confirmed"}[5m]))')
        with self.assertRaisesRegex(ValueError, "knd"):
            self.check('sum(rate(scheduler_notifications_sent_total{job="x", knd=~".*"}[5m]))')

    def test_rejects_unknown_grouping_label(self):
        with self.assertRaisesRegex(ValueError, "Grouping label kind"):
            self.check('sum by (kind) (rate(scheduler_booking_requests_total{job="x"}[5m]))')

    def test_quantiles_need_le(self):
        with self.assertRaisesRegex(ValueError, "le grouping"):
            self.check('histogram_quantile(0.95, sum by (outcome) (rate(scheduler_booking_duration_milliseconds_bucket{job="x"}[5m])))')
        with self.assertRaisesRegex(ValueError, "sum by"):
            self.check('histogram_quantile(0.95, sum(rate(scheduler_booking_duration_milliseconds_bucket{job="x"}[5m])))')

    def test_target_info_has_no_service_labels(self):
        with self.assertRaisesRegex(ValueError, "service_name"):
            self.check('target_info{service_namespace="n", service_name="api"}')

    def test_variable_label_must_exist_on_its_series(self):
        dashboard = load("Dashboard", "keyloop-api-health")
        for query, location in v.query_records(dashboard):
            self.check(query)
        env = next(x for x in dashboard["spec"]["templating"]["list"] if x["name"] == "env")
        env["query"]["query"] = env["definition"] = 'label_values(target_info{job="${namespace}/${service}"}, service_name)'
        with self.assertRaisesRegex(ValueError, "Grouping label service_name"):
            for query, location in v.query_records(dashboard):
                self.check(query)


class BornAware(unittest.TestCase):
    selector = 'scheduler_booking_deadlocks_total{job="x", deployment_environment_name="P"}'

    def test_plain_increase_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "first export"):
            v.require_born_aware(f"sum(increase({self.selector}[10m])) or vector(0)", "test", "10m")

    def test_form_and_window_are_enforced(self):
        good = f"sum({v.born_aware(self.selector, '10m')}) or vector(0)"
        v.require_born_aware(good, "test", "10m")
        with self.assertRaisesRegex(ValueError, "Window"):
            v.require_born_aware(good, "test", "15m")
        with self.assertRaisesRegex(ValueError, "zero fallback"):
            v.require_born_aware(good.removesuffix(" or vector(0)"), "test", "10m")


class Dashboards(unittest.TestCase):
    def setUp(self):
        self.dashboards = {name: load("Dashboard", name) for name in v.DASHBOARDS}

    def check(self, name):
        v.check_dashboard(name, self.dashboards[name], self.dashboards)

    def test_committed_dashboards_pass(self):
        for name in v.DASHBOARDS:
            self.check(name)

    def test_rejects_fixed_rate_window(self):
        target = panel(self.dashboards["keyloop-api-health"], 1)["targets"][0]
        target["expr"] = target["expr"].replace("[$__rate_interval]", "[5m]")
        with self.assertRaisesRegex(ValueError, r"Fixed range \[5m\]"):
            self.check("keyloop-api-health")

    def test_rejects_unscoped_selector(self):
        target = panel(self.dashboards["keyloop-booking-engine"], 7)["targets"][0]
        target["expr"] = target["expr"].replace(v.DASHBOARD_SCOPE, 'deployment_environment_name=~"${env:regex}"')
        with self.assertRaisesRegex(ValueError, "must start with"):
            self.check("keyloop-booking-engine")

    def test_rejects_target_info_variable_by_service_labels(self):
        env = next(x for x in self.dashboards["keyloop-notifications"]["spec"]["templating"]["list"] if x["name"] == "env")
        env["query"]["query"] = 'label_values(target_info{service_namespace="$namespace", service_name="$service"}, deployment_environment_name)'
        with self.assertRaisesRegex(ValueError, "target_info carries job"):
            self.check("keyloop-notifications")

    def test_rejects_must_be_zero_stat_without_first_export(self):
        target = panel(self.dashboards["keyloop-booking-engine"], 1)["targets"][0]
        target["expr"] = ('sum(increase(scheduler_booking_deadlocks_total{' + v.DASHBOARD_SCOPE + '}[$__range])) or vector(0)')
        with self.assertRaisesRegex(ValueError, "first export"):
            self.check("keyloop-booking-engine")

    def test_readiness_panel_counts_first_export_per_step(self):
        target = panel(self.dashboards["keyloop-api-health"], 11)["targets"][0]
        target["expr"] = ('sum by (http_route, http_response_status_code) (increase(http_server_request_duration_seconds_count{'
                          + v.DASHBOARD_SCOPE + ', http_route=~"/health|/alive"}[$__rate_interval]))')
        with self.assertRaisesRegex(ValueError, "first export"):
            self.check("keyloop-api-health")


class Alerts(unittest.TestCase):
    def setUp(self):
        self.dashboards = {name: load("Dashboard", name) for name in v.DASHBOARDS}
        self.runbooks = (ROOT / "runbooks.md").read_text()

    def check(self, alert):
        v.check_alert(alert, self.dashboards, self.runbooks)

    def test_committed_rules_pass(self):
        for name in v.ALERTS:
            self.check(load("AlertRule", name))

    def test_rejects_changed_threshold_and_pending_period(self):
        alert = load("AlertRule", "keyloop-api-5xx-ratio")
        alert["spec"]["expressions"]["C"]["model"]["conditions"][0]["evaluator"]["params"] = [0.1]
        with self.assertRaisesRegex(ValueError, "threshold"):
            self.check(alert)
        alert = load("AlertRule", "keyloop-api-5xx-ratio")
        alert["spec"]["for"] = "0s"
        with self.assertRaisesRegex(ValueError, "pending period"):
            self.check(alert)

    def test_rejects_changed_window_and_quantile_math(self):
        alert = load("AlertRule", "keyloop-booking-p95-latency")
        model = alert["spec"]["expressions"]["A"]["model"]
        model["expr"] = model["expr"].replace("[5m]", "[10m]")
        with self.assertRaisesRegex(ValueError, "range"):
            self.check(alert)
        alert = load("AlertRule", "keyloop-booking-p95-latency")
        alert["spec"]["expressions"]["C"]["model"]["expression"] = "$A > 300"
        with self.assertRaisesRegex(ValueError, "condition"):
            self.check(alert)

    def test_rejects_counter_rule_without_first_export(self):
        alert = load("AlertRule", "keyloop-booking-deadlocks")
        alert["spec"]["expressions"]["A"]["model"]["expr"] = (
            'sum(increase(scheduler_booking_deadlocks_total{job="${API_JOB}", deployment_environment_name="${ENVIRONMENT}"}[10m])) or vector(0)')
        with self.assertRaisesRegex(ValueError, "first export"):
            self.check(alert)

    def test_rejects_unscoped_selector(self):
        alert = load("AlertRule", "keyloop-notifications-outbox-age")
        model = alert["spec"]["expressions"]["A"]["model"]
        model["expr"] = model["expr"].replace('job="${API_JOB}", ', "")
        with self.assertRaisesRegex(ValueError, "unscoped"):
            self.check(alert)


class Loading(unittest.TestCase):
    def test_missing_folder_annotation_is_named(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for sub in ("folders", "dashboards", "alertrules", "validation"):
                (root / sub).mkdir()
            (root / "validation/resource.schema.json").write_text((ROOT / "validation/resource.schema.json").read_text())
            alert = load("AlertRule", "keyloop-notifications-dead-letters")
            del alert["metadata"]["annotations"]
            (root / "alertrules/rule.yaml").write_text(v.yaml.safe_dump(alert))
            with self.assertRaisesRegex(ValueError, "Missing folder on .*rule.yaml"):
                v.load_resources(root)


class PreparedRules(unittest.TestCase):
    def test_prepared_rule_must_equal_template_with_consistent_settings(self):
        template = load("AlertRule", "keyloop-booking-deadlocks")
        settings = {"METRICS_DATASOURCE_UID": "mimir", "ENVIRONMENT": "Production", "API_JOB": "keyloop-scheduler/api",
                    "ALERT_RECEIVER": "team", "RUNBOOK_BASE_URL": "https://example.invalid/runbooks.md"}
        text = json.dumps(template)
        for key, value in settings.items():
            text = text.replace("${" + key + "}", value)
        prepared = json.loads(text)
        found = {}
        v.conform(template, prepared, found, "rule")
        self.assertEqual(found, settings)
        drifted = copy.deepcopy(prepared)
        drifted["spec"]["for"] = "5m"
        with self.assertRaisesRegex(ValueError, "differs from template"):
            v.conform(template, drifted, {}, "rule")
        with self.assertRaisesRegex(ValueError, "does not match template"):
            v.conform(template, prepared, {"ENVIRONMENT": "Staging"}, "rule")


class Tooling(unittest.TestCase):
    def test_behaviour_tests_cover_every_must_be_zero_query(self):
        resources = [load("Dashboard", n) for n in v.DASHBOARDS] + [load("AlertRule", n) for n in v.ALERTS]
        spec = v.read_yaml(ROOT / "validation/behaviour-tests.yaml")
        tests, targets = v.behaviour_tests(spec, resources)
        self.assertEqual(targets, 9)
        spec["scenarios"] = [s for s in spec["scenarios"] if "alert/keyloop-api-readiness" not in s["expect"]]
        with self.assertRaisesRegex(ValueError, "keyloop-api-readiness"):
            v.behaviour_tests(spec, resources)

    def test_lint_copies_use_v1beta1_and_canary_breaks_each_rule(self):
        resources = [load("Dashboard", n) for n in sorted(v.DASHBOARDS)] + [load("AlertRule", n) for n in sorted(v.ALERTS)]
        templates = [r for r in resources if r["kind"] == "AlertRule"]
        with tempfile.TemporaryDirectory() as directory:
            lint, canary, queries = v.lint_artifacts(resources, templates, Path(directory))
            versions = {v.read_yaml(p)["apiVersion"] for p in lint.glob("*.yaml")}
            self.assertEqual(versions, {"dashboard.grafana.app/v1beta1"})
            self.assertEqual(queries, 8)
            broken = v.read_yaml(canary / "dashboard.yaml")
            original = panel(next(r for r in resources if r["metadata"]["name"] == "keyloop-booking-engine"), 1)
            self.assertTrue(broken["spec"]["editable"])
            self.assertEqual(broken["spec"]["panels"][0]["targets"][0]["expr"], "(" + original["targets"][0]["expr"])
            self.assertNotIn("summary", v.read_yaml(canary / "alert.yaml")["spec"]["annotations"])


if __name__ == "__main__":
    unittest.main()
