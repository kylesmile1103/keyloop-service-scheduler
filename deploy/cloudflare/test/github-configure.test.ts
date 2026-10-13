import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

type Policy = { id: number; name: string; type: "branch" | "tag" };
type Call = { args: string[]; body: string };

it.each([
  { name: "new environments", policies: { plan: [], production: [] }, createsMain: true },
  { name: "existing main with extra branches and tags", policies: {
    plan: [{ id: 1, name: "main", type: "branch" }, { id: 2, name: "feature/*", type: "branch" }, { id: 3, name: "main", type: "tag" }],
    production: [{ id: 4, name: "main", type: "branch" }, { id: 5, name: "*", type: "tag" }, { id: 6, name: "release/*", type: "branch" }],
  }, createsMain: false },
  { name: "main tag without a main branch policy", policies: {
    plan: [{ id: 1, name: "main", type: "tag" }, { id: 2, name: "*", type: "branch" }],
    production: [{ id: 3, name: "release/*", type: "branch" }],
  }, createsMain: true },
])("configures main-only environments and stdin-only inputs idempotently: $name", ({ policies, createsMain }) => {
  const directory = mkdtempSync(join(process.cwd(), "build/github-configure-"));
  const log = join(directory, "calls.jsonl");
  const state = join(directory, "policies.json");
  const names = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "KEYLOOP_SECRETS_STORE_ID", "KEYLOOP_ACCESS_AUDIENCE",
    "KEYLOOP_ACCESS_ADMIN", "KEYLOOP_ACCESS_SERVICE_ADVISOR", "KEYLOOP_ACCESS_VIEWER", "KEYLOOP_TRIAGE_ACCOUNT_ID",
    "KEYLOOP_EMAIL_ACCOUNT_ID", "KEYLOOP_EMAIL_ALLOWED_ADDRESSES", "KEYLOOP_EMAIL_ALLOWED_DOMAINS", "NEON_OWNER_CONNECTION"];
  const secretEnv = Object.fromEntries(names.map(name => [name, `fixture-private-${name}`]));
  const variableValues: Record<string, string> = {
    KEYLOOP_ACCESS_TEAM_DOMAIN: "https://fixture.cloudflareaccess.com", KEYLOOP_CONTAINER_APPLICATION_ID: "fixture-app",
    KEYLOOP_TRIAGE_ENABLED: "false", KEYLOOP_TRIAGE_GATEWAY_ID: "keyloop-scheduler", KEYLOOP_TRIAGE_BUCKET: "keyloop-scheduler-triage",
    KEYLOOP_VEHICLE_AWARE_REQUIREMENTS: "false", KEYLOOP_API_OTLP_ENABLED: "false", KEYLOOP_GRAFANA_OTLP_ENDPOINT: "",
    KEYLOOP_GRAFANA_INSTANCE_ID: "", KEYLOOP_NOTIFICATIONS_ENABLED: "false", KEYLOOP_EMAIL_SENDING_ENABLED: "false",
    KEYLOOP_OTLP_RELAY_ENABLED: "false", KEYLOOP_EMAIL_TRANSPORT: "binding", KEYLOOP_EMAIL_MAX_PER_RECIPIENT_PER_DAY: "10",
    KEYLOOP_EMAIL_MAX_PER_DAY: "100",
  };
  try {
    writeFileSync(state, JSON.stringify(policies));
    writeFileSync(join(directory, "gh"), `#!${process.execPath}\n` + `
      import fs from 'node:fs';
      const args = process.argv.slice(2);
      const body = args[0] === 'secret' || args[0] === 'variable' || args.includes('--input')
        ? fs.readFileSync(0, 'utf8') : '';
      fs.appendFileSync(process.env.MOCK_GH_LOG, JSON.stringify({args, body}) + '\\n');
      if (args[0] === 'secret' || args[0] === 'variable') process.exit(0);
      if (args[0] !== 'api') throw new Error('Unexpected mock gh command');
      if (args[1].startsWith('users/')) { console.log('123'); process.exit(0); }
      const endpoint = args.find(arg => arg.startsWith('repos/'));
      const environment = endpoint.split('/')[4];
      const state = JSON.parse(fs.readFileSync(process.env.MOCK_GH_STATE, 'utf8'));
      if (args.includes('--paginate')) {
        const policies = state[environment];
        console.log(JSON.stringify([{branch_policies: policies.slice(0, 1)}, {branch_policies: policies.slice(1)}]));
      } else if (args.includes('POST')) {
        state[environment].push({id: 100, name: 'main', type: 'branch'});
        fs.writeFileSync(process.env.MOCK_GH_STATE, JSON.stringify(state));
      } else if (args.includes('DELETE')) {
        const id = Number(endpoint.split('/').at(-1));
        state[environment] = state[environment].filter(policy => policy.id !== id);
        fs.writeFileSync(process.env.MOCK_GH_STATE, JSON.stringify(state));
      } else if (!args.includes('PUT')) throw new Error('Unexpected mock gh API');
    `, { mode: 0o700 });
    const run = () => spawnSync("/bin/bash", ["scripts/configure-github-environment.sh", "fixture/repo", "stakeholder"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, ...secretEnv, ...variableValues, CLOUDFLARE_PLAN_API_TOKEN: "fixture-private-plan-token",
        PATH: `${directory}:${process.env.PATH}`, MOCK_GH_LOG: log, MOCK_GH_STATE: state },
    });
    const result = run();
    expect(result.status, result.stderr).toBe(0);
    const readCalls = (): Call[] => readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as Call);
    const calls = readCalls();
    const args = JSON.stringify(calls.map(call => call.args));
    for (const value of [...Object.values(secretEnv), "fixture-private-plan-token"]) {
      expect(args).not.toContain(value);
      expect(result.stdout + result.stderr).not.toContain(value);
    }
    const setup = calls.filter(call => call.args.includes("PUT"));
    expect(setup).toHaveLength(2);
    for (const environment of ["plan", "production"]) {
      const configure = setup.find(call => call.args.includes(`repos/fixture/repo/environments/${environment}`))!;
      expect(JSON.parse(configure.body)).toEqual({
        reviewers: environment === "production" ? [{ type: "User", id: 123 }] : [],
        wait_timer: 0, prevent_self_review: false,
        deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
      });
    }
    const created = calls.filter(call => call.args.includes("POST"));
    expect(created).toHaveLength(createsMain ? 2 : 0);
    for (const call of created) expect(call.args).toEqual(expect.arrayContaining(["name=main", "type=branch"]));
    const finalPolicies = JSON.parse(readFileSync(state, "utf8")) as Record<string, Policy[]>;
    for (const environment of ["plan", "production"]) {
      expect(finalPolicies[environment]).toEqual([expect.objectContaining({ name: "main", type: "branch" })]);
    }
    expect(calls.filter(call => call.args.includes("DELETE"))).toHaveLength(
      [...policies.plan, ...policies.production].filter(policy => policy.name !== "main" || policy.type !== "branch").length);
    const inputs = calls.filter(call => call.args[0] === "secret" || call.args[0] === "variable");
    for (const call of inputs) {
      expect(call.args).toEqual(expect.arrayContaining(["--repo", "fixture/repo", "--env"]));
      expect(["plan", "production"]).toContain(call.args[call.args.indexOf("--env") + 1]);
    }
    const secrets = calls.filter(call => call.args[0] === "secret");
    expect(secrets.filter(call => call.args[2] === "NEON_OWNER_CONNECTION")).toEqual([
      expect.objectContaining({ args: expect.arrayContaining(["--env", "production"]), body: secretEnv.NEON_OWNER_CONNECTION }),
    ]);
    const tokens = secrets.filter(call => call.args[2] === "CLOUDFLARE_API_TOKEN");
    expect(tokens).toHaveLength(2);
    expect(tokens.find(call => call.args.includes("production"))!.body).toBe(secretEnv.CLOUDFLARE_API_TOKEN);
    expect(tokens.find(call => call.args.includes("plan"))!.body).toBe("fixture-private-plan-token");
    for (const name of names.filter(name => name !== "NEON_OWNER_CONNECTION" && name !== "CLOUDFLARE_API_TOKEN")) {
      expect(secrets.filter(call => call.args[2] === name)).toEqual([
        expect.objectContaining({ args: expect.arrayContaining(["--env", "production"]), body: secretEnv[name] }),
        expect.objectContaining({ args: expect.arrayContaining(["--env", "plan"]), body: secretEnv[name] }),
      ]);
    }
    const variables = inputs.filter(call => call.args[0] === "variable");
    expect(variables).toHaveLength(Object.keys(variableValues).length * 2);
    for (const [name, value] of Object.entries(variableValues)) {
      expect(variables.filter(call => call.args[2] === name)).toEqual([
        expect.objectContaining({ args: expect.arrayContaining(["--env", "production"]), body: value }),
        expect.objectContaining({ args: expect.arrayContaining(["--env", "plan"]), body: value }),
      ]);
    }
    const rerun = run();
    expect(rerun.status, rerun.stderr).toBe(0);
    for (const value of [...Object.values(secretEnv), "fixture-private-plan-token"]) {
      expect(rerun.stdout + rerun.stderr).not.toContain(value);
    }
    expect(readCalls().slice(calls.length).filter(call => call.args.includes("POST") || call.args.includes("DELETE"))).toEqual([]);
    expect(JSON.parse(readFileSync(state, "utf8"))).toEqual(finalPolicies);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  // Two full runs of the setup script, each spawning a fake gh per call: about 3 s when idle, over the 5 s default on a loaded runner.
}, 30_000);
