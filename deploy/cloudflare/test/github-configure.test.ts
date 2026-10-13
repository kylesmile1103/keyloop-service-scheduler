import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it("configures reviewers and sends secrets only through stdin, keeping the Neon owner environment-only", () => {
  const directory = mkdtempSync(join(process.cwd(), "build/github-configure-"));
  const log = join(directory, "calls.jsonl");
  const names = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "KEYLOOP_SECRETS_STORE_ID", "KEYLOOP_ACCESS_AUDIENCE",
    "KEYLOOP_ACCESS_ADMIN", "KEYLOOP_ACCESS_SERVICE_ADVISOR", "KEYLOOP_ACCESS_VIEWER", "KEYLOOP_TRIAGE_ACCOUNT_ID",
    "KEYLOOP_EMAIL_ACCOUNT_ID", "KEYLOOP_EMAIL_ALLOWED_ADDRESSES", "KEYLOOP_EMAIL_ALLOWED_DOMAINS", "NEON_OWNER_CONNECTION"];
  const secretEnv = Object.fromEntries(names.map(name => [name, `fixture-private-${name}`]));
  try {
    writeFileSync(join(directory, "gh"), `#!${process.execPath}\n` + `
      import fs from 'node:fs';
      const args = process.argv.slice(2);
      const body = args[0] === 'secret' || args[0] === 'variable' || args.includes('--input')
        ? fs.readFileSync(0, 'utf8') : '';
      fs.appendFileSync(process.env.MOCK_GH_LOG, JSON.stringify({args, body}) + '\\n');
      if (args[0] === 'api' && args[1].startsWith('users/')) console.log('123');
      if (args[0] === 'api' && args.includes('--paginate')) console.log('[{"branch_policies":[]}]');
    `, { mode: 0o700 });
    const result = spawnSync("/bin/bash", ["scripts/configure-github-environment.sh", "fixture/repo", "stakeholder"], {
      cwd: process.cwd(), encoding: "utf8", timeout: 15_000,
      env: { ...process.env, ...secretEnv, CLOUDFLARE_PLAN_API_TOKEN: "fixture-private-plan-token",
        KEYLOOP_ACCESS_TEAM_DOMAIN: "https://fixture.cloudflareaccess.com", KEYLOOP_CONTAINER_APPLICATION_ID: "fixture-app",
        PATH: `${directory}:${process.env.PATH}`, MOCK_GH_LOG: log },
    });
    expect(result.status, result.stderr).toBe(0);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as { args: string[]; body: string });
    const args = JSON.stringify(calls.map(call => call.args));
    for (const value of [...Object.values(secretEnv), "fixture-private-plan-token"]) {
      expect(args).not.toContain(value);
      expect(result.stdout + result.stderr).not.toContain(value);
    }
    const setup = calls.find(call => call.args.includes("PUT"))!;
    expect(JSON.parse(setup.body)).toMatchObject({ reviewers: [{ type: "User", id: 123 }], prevent_self_review: false,
      deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } });
    expect(calls.some(call => call.args.includes("name=main"))).toBe(true);
    const secrets = calls.filter(call => call.args[0] === "secret");
    expect(secrets.filter(call => call.args[2] === "NEON_OWNER_CONNECTION")).toEqual([
      expect.objectContaining({ args: expect.arrayContaining(["--env", "production"]), body: secretEnv.NEON_OWNER_CONNECTION }),
    ]);
    const tokens = secrets.filter(call => call.args[2] === "CLOUDFLARE_API_TOKEN");
    expect(tokens.find(call => call.args.includes("--env"))!.body).toBe(secretEnv.CLOUDFLARE_API_TOKEN);
    expect(tokens.find(call => !call.args.includes("--env"))!.body).toBe("fixture-private-plan-token");
    for (const name of names.filter(name => name !== "NEON_OWNER_CONNECTION" && name !== "CLOUDFLARE_API_TOKEN")) {
      expect(secrets.filter(call => call.args[2] === name)).toHaveLength(2);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
