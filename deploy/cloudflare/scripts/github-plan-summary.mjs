import { readFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

// A successful dry run validates these prebuilt files. Summarise only names/types and safe container policy fields;
// raw cf output and worker.config.json contain private text bindings and are never published.
export function planSummary(worker, container, dryRun, sha, tag) {
  assert.match(tag ?? "", /^[a-f0-9]{12}$/);
  assert.match(sha ?? "", /^[a-f0-9]{40}$/);
  assert.ok(sha.startsWith(tag));
  assert.equal(worker.name, "keyloop-scheduler");
  assert.equal(container.name, "keyloop-scheduler-api");
  const image = container.image?.reference ?? container.image;
  assert.ok(image.endsWith(`:${tag}`));
  assert.ok(dryRun.includes(`keyloop-scheduler-api (${image})`), "Container missing from dry run");
  const lines = [
    "### Production deployment plan", "",
    `Commit: \`${sha}\`; image tag: \`${tag}\`.`, "",
    "`cf deploy --prebuilt --provision=false --dry-run` succeeded. Its validated container and bindings:", "",
    `Container: keyloop-scheduler-api; image tag ${tag}; ${container.instanceType}; maxInstances=${container.maxInstances}; regions=${container.constraints.regions.join(",")}; schedulingPolicy=${container.schedulingPolicy}.`, "",
    "| Binding | Type |", "| --- | --- |",
  ];
  for (const [name, binding] of Object.entries(worker.env)) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/);
    assert.match(binding.type, /^[a-z0-9-]+$/);
    // Take the binding resource label from the dry run, omitting its value/description entirely.
    const match = dryRun.match(new RegExp(`env\\.${name}\\b.*?\\s{2,}([A-Za-z][A-Za-z0-9 ]+)\\s*$`, "m"));
    assert.ok(match, "Binding missing from dry run");
    lines.push(`| ${name} | ${match[1].trim()} (${binding.type}) |`);
  }
  lines.push("", "Review this plan before approving production. Private binding values and account/store identifiers are withheld.", "");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = new URL("../.cloudflare/output/v0/", import.meta.url);
  const worker = JSON.parse(await readFile(new URL("workers/default/worker.config.json", root), "utf8"));
  const container = JSON.parse(await readFile(new URL("containers/keyloop-scheduler-api/container.config.json", root), "utf8"));
  const dryRun = await readFile(new URL("../build/github-dry-run.log", import.meta.url), "utf8");
  await appendFile(process.env.GITHUB_STEP_SUMMARY,
    planSummary(worker, container, dryRun, process.env.DEPLOY_SHA, process.env.IMAGE_TAG));
}
