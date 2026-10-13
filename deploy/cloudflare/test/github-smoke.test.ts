import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

it.each(["success", "schema-not-ready", "contract-drift", "unmasked", "cf-error"])("runs the smoke shell offline: %s", mode => {
  const directory = mkdtempSync(join(process.cwd(), "build/github-smoke-"));
  const bin = join(directory, "bin");
  const edge = join(directory, "deploy/cloudflare");
  const sha = "0123456789ab" + "0".repeat(28);
  const image = `registry.cloudflare.com/${"0".repeat(32)}/keyloop-scheduler-api:${sha.slice(0, 12)}`;
  try {
    writeFileSync(join(directory, "package.json"), '{"type":"commonjs"}');
    mkdirSync(bin);
    mkdirSync(join(edge, "scripts"), { recursive: true });
    mkdirSync(join(edge, "node_modules/.bin"), { recursive: true });
    mkdirSync(join(directory, "contracts/openapi"), { recursive: true });
    copyFileSync("scripts/github-verification.mjs", join(edge, "scripts/github-verification.mjs"));
    writeFileSync(join(directory, "contracts/openapi/v1.json"), '{"fixture":"contract"}');
    writeFileSync(join(bin, "git"), `#!/bin/sh\nprintf '%s\\n' '${sha}'\n`, { mode: 0o700 });
    writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
    writeFileSync(join(bin, "timeout"), "#!/bin/sh\ntest \"$1\" -gt 0 && test \"$1\" -le 360 || exit 1\nshift\nexec \"$@\"\n", { mode: 0o700 });
    writeFileSync(join(edge, "node_modules/.bin/cf"), `#!${process.execPath}\n` + `
      const fs = require('node:fs');
      const count = Number(fs.existsSync(process.env.MOCK_COUNT) ? fs.readFileSync(process.env.MOCK_COUNT,'utf8') : 0);
      fs.writeFileSync(process.env.MOCK_COUNT, String(count + 1));
      if (process.env.MOCK_MODE === 'cf-error') { console.error('fixture-private-response'); process.exit(1); }
      console.log(JSON.stringify([{ image: count === 0 ? 'old-image' : process.env.MOCK_IMAGE, status: {state:'running'} }]));
    `, { mode: 0o700 });
    writeFileSync(join(bin, "curl"), `#!${process.execPath}\n` + `
      const fs = require('node:fs');
      const args = process.argv.slice(2);
      const ua = args[args.indexOf('--user-agent') + 1];
      if (!ua.startsWith('Mozilla/5.0') || args.includes('--cookie')) process.exit(1);
      const seconds = Number(args[args.indexOf('--max-time') + 1]);
      if (!(seconds > 0 && seconds <= 80)) process.exit(1);
      const path = new URL(args.at(-1)).pathname;
      let data;
      if (path === '/') data = '<html>fixture</html>';
      else if (path === '/api/ready') data = '';
      else if (path === '/api/v1/dealerships') data = JSON.stringify([{name:'Keyloop Motors Reading',id:'00000000-0000-0000-0000-000000000001',timeZoneId:'Europe/London'}]);
      else if (path === '/api/v1/features') data = '{"vehicleAwareRequirements":false}';
      else if (path === '/openapi/v1.json') data = process.env.MOCK_MODE === 'contract-drift' ? '{"drift":true}' : '{"fixture":"contract"}';
      else if (path.endsWith('/schedule')) data = JSON.stringify({bays:[{appointments:[{customerName:process.env.MOCK_MODE==='unmasked'?'Alice Smith':'AS',vin:'***********123456',registration:'*******'}]}]});
      else process.exit(1);
      fs.writeFileSync(args[args.indexOf('--output') + 1], data);
      process.stdout.write(path === '/api/ready' && process.env.MOCK_MODE === 'schema-not-ready' ? '503' : '200');
    `, { mode: 0o700 });
    const result = spawnSync("/bin/bash", [join(process.cwd(), "scripts/verify-github-deploy.sh")], {
      cwd: directory, encoding: "utf8", timeout: 15_000,
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "0".repeat(32), KEYLOOP_CONTAINER_APPLICATION_ID: "fixture-app",
        EXPECTED_VEHICLE_AWARE_REQUIREMENTS: "false", PATH: `${bin}:${process.env.PATH}`,
        MOCK_MODE: mode, MOCK_IMAGE: image, MOCK_COUNT: join(directory, "instance-count") },
    });
    expect(result.stdout + result.stderr).not.toContain("fixture-private-response");
    expect(result.stdout + result.stderr).not.toContain("Alice Smith");
    if (mode === "success") {
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("PASS: image tag 0123456789ab");
      expect(Number(readFileSync(join(directory, "instance-count"), "utf8"))).toBe(2);
    } else {
      expect(result.status, result.stderr).toBe(1);
      expect(result.stdout).not.toContain("PASS:");
      const reason = mode === "contract-drift" ? "Deployed OpenAPI differs"
        : mode === "schema-not-ready" ? "schema readiness did not return 200"
        : mode === "unmasked" ? "Deployment response verification failed" : "Container instance inspection failed";
      expect(result.stderr).toContain(reason);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
