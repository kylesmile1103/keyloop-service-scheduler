import { expect, it } from "vitest";
import { planSummary } from "../scripts/github-plan-summary.mjs";

const tag = "0123456789ab";
const sha = `${tag}${"0".repeat(28)}`;
const account = "1".repeat(32);
const store = "2".repeat(32);
const role = "admin@fixture.example";
const image = `registry.cloudflare.com/${account}/keyloop-scheduler-api:${tag}`;
const container = { name: "keyloop-scheduler-api", image: { reference: image }, instanceType: "basic",
  maxInstances: 1, constraints: { regions: ["WEUR"] }, schedulingPolicy: "default" };
const worker = { name: "keyloop-scheduler", env: {
  AUTH_ADMIN: { type: "text", value: role }, DB_URL: { type: "secrets-store-secret", storeId: store },
  TRIAGE_IMAGES: { type: "r2", name: "fixture-bucket" },
} };
const dryRun = `│  env.AUTH_ADMIN ("${role}")      Environment Variable
│  env.DB_URL (${store}/keyloop_prod_db_url)      Secrets Store Secret
│  env.TRIAGE_IMAGES (fixture-bucket)      R2 Bucket
│  - keyloop-scheduler-api (${image})`;

it("uses actual dry-run binding labels while withholding role lists, store and account identifiers", () => {
  const summary = planSummary(worker, container, dryRun, sha, tag);
  expect(summary).toContain("AUTH_ADMIN | Environment Variable (text)");
  expect(summary).toContain("TRIAGE_IMAGES | R2 Bucket (r2)");
  expect(summary).toContain(tag);
  for (const value of [role, store, account, image]) expect(summary).not.toContain(value);
});

it("refuses a missing binding/container or a mismatched image tag", () => {
  expect(() => planSummary(worker, container, dryRun.replace("env.DB_URL", "env.OTHER"), sha, tag)).toThrow();
  expect(() => planSummary(worker, container, dryRun.replace("keyloop-scheduler-api (", "other-container ("), sha, tag)).toThrow();
  expect(() => planSummary(worker, { ...container, image: { reference: "old-image" } }, dryRun, sha, tag)).toThrow();
});
