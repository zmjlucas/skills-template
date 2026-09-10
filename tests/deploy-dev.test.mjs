import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));

async function fixture(t, skill = "template-skill-zh") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "dev-deploy-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repoRoot = join(root, "repo");
  const source = join(repoRoot, "skills", skill);
  await cp(join(repository, "skills", skill), source, { recursive: true });
  const target = join(root, "installed skills");
  const workspace = join(root, "empty workspace");
  return { root, repoRoot, source, target, workspace, skill };
}

async function deploy(options) {
  const { deployDev } = await import("../scripts/deploy-dev.mjs");
  return deployDev(options);
}

async function cliFixture(t) {
  const f = await fixture(t);
  await cp(join(repository, "skills"), join(f.repoRoot, "skills"), { recursive: true });
  await cp(join(repository, "scripts"), join(f.repoRoot, "scripts"), { recursive: true });
  await symlink(join(repository, "node_modules"), join(f.repoRoot, "node_modules"), "dir");
  f.run = (args = []) => execFileAsync(process.execPath, [
    join(f.repoRoot, "scripts", "deploy-dev.mjs"),
    "--target", f.target, "--workspace", f.workspace, ...args,
  ]);
  return f;
}

function frontmatter(text) {
  return YAML.parse(/^---\n([\s\S]*?)\n---\n/.exec(text)[1]);
}

for (const [skill, expectedPrompt] of [
  ["template-skill-zh", "使用 $template-skill-zh-dev。"],
  ["template-skill-en", "Use $template-skill-en-dev."],
]) {
  test(`deploys ${skill} while preserving production and binary payloads`, async (t) => {
    const f = await fixture(t, skill);
    const original = await readFile(join(f.source, "SKILL.md"));
    await mkdir(join(f.source, "assets"));
    const binary = Buffer.from([0, 255, 23, 128]);
    await writeFile(join(f.source, "assets", "sample.bin"), binary);
    await mkdir(join(f.source, "scripts"));
    await writeFile(join(f.source, "scripts", "run.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(f.source, "scripts", "run.sh"), 0o755);
    const result = await deploy(f);
    assert.equal(result.name, `${skill}-dev`);
    assert.equal(result.target, join(f.target, result.name));
    const text = await readFile(join(result.target, "SKILL.md"), "utf8");
    const metadata = frontmatter(text);
    assert.equal(metadata.name, result.name);
    assert.equal(metadata["disable-model-invocation"], true);
    assert.ok(text.includes(`*Note: This is the dev build ${result.buildId}. Do NOT use in production environment.*`));
    assert.match(text, /(?:exact|single)[\s\S]*business (?:response|content)/i);
    const agent = YAML.parse(await readFile(join(result.target, "agents", "openai.yaml"), "utf8"));
    assert.equal(agent.policy.allow_implicit_invocation, false);
    assert.match(agent.interface.display_name, /dev/i);
    assert.equal(agent.interface.default_prompt, expectedPrompt);
    assert.deepEqual(await readFile(join(f.source, "SKILL.md")), original);
    assert.deepEqual(await readFile(join(result.target, "LICENSE")), await readFile(join(f.source, "LICENSE")));
    assert.deepEqual(await readFile(join(result.target, "assets", "sample.bin")), binary);
    assert.equal((await stat(join(result.target, "scripts", "run.sh"))).mode & 0o111, 0o111);
    assert.deepEqual(await readdir(f.workspace), []);
  });
}

test("redeployment updates content without changing the build ID, removes stale files, and preserves workspace outputs", async (t) => {
  const f = await fixture(t);
  f.target = join(f.workspace, ".agents", "skills");
  await writeFile(join(f.source, "notes.md"), "old reference");
  const first = await deploy(f);
  const same = await deploy(f);
  assert.equal(same.buildId, first.buildId);
  await writeFile(join(f.workspace, "output.txt"), "keep me");
  await writeFile(join(f.source, "notes.md"), "new reference");
  const changed = await deploy(f);
  assert.equal(changed.buildId, first.buildId);
  assert.equal(await readFile(join(changed.target, "notes.md"), "utf8"), "new reference");
  await rm(join(f.source, "notes.md"));
  const removed = await deploy(f);
  assert.equal(removed.buildId, changed.buildId);
  assert.equal((await readdir(removed.target)).includes("notes.md"), false);
  assert.equal(await readFile(join(f.workspace, "output.txt"), "utf8"), "keep me");
  assert.deepEqual(await readdir(f.target), ["template-skill-zh-dev"]);
});

test("dev and debug builds coexist with a production installation", async (t) => {
  const f = await fixture(t);
  await cp(f.source, join(f.target, "template-skill-zh"), { recursive: true });
  const dev = await deploy(f);
  const debug = await deploy({ ...f, suffix: "debug" });
  assert.equal(debug.name, "template-skill-zh-debug");
  assert.equal(dev.buildId, debug.buildId);
  assert.equal(frontmatter(await readFile(join(f.target, "template-skill-zh", "SKILL.md"), "utf8")).name, "template-skill-zh");
  assert.deepEqual((await readdir(f.target)).sort(), ["template-skill-zh", "template-skill-zh-debug", "template-skill-zh-dev"]);
});

test("renames Codex invocations without breaking same-named reference or asset paths", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.source, "references"));
  await writeFile(join(f.source, "references", "template-skill-zh.md"), "Reference content");
  const source = await readFile(join(f.source, "SKILL.md"), "utf8");
  await writeFile(join(f.source, "SKILL.md"), `${source}\n[Guide](references/template-skill-zh.md)\nUse $template-skill-zh. Other skill: $template-skill-zh-other.\n`);
  const result = await deploy(f);
  const text = await readFile(join(result.target, "SKILL.md"), "utf8");
  assert.ok(text.includes("[Guide](references/template-skill-zh.md)"));
  assert.ok(text.includes("Use $template-skill-zh-dev. Other skill: $template-skill-zh-other."));
  assert.equal(await readFile(join(result.target, "references", "template-skill-zh.md"), "utf8"), "Reference content");
});

test("build identity works without Git and includes the commit when available", async (t) => {
  const f = await fixture(t);
  assert.equal((await deploy(f)).buildId, "nogit");
  await execFileAsync("git", ["init", "--quiet", f.repoRoot]);
  await execFileAsync("git", ["-C", f.repoRoot, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "test: fixture"]);
  const { stdout } = await execFileAsync("git", ["-C", f.repoRoot, "rev-parse", "HEAD"]);
  assert.equal((await deploy(f)).buildId, stdout.trim().slice(0, 6));
});

test("refuses to replace an unmanaged installation", async (t) => {
  const f = await fixture(t);
  const destination = join(f.target, "template-skill-zh-dev");
  await mkdir(destination, { recursive: true });
  await writeFile(join(destination, "keep.txt"), "user data");
  await assert.rejects(deploy(f), /unmanaged/i);
  assert.equal(await readFile(join(destination, "keep.txt"), "utf8"), "user data");
});

test("refuses a symlink destination without changing its target", async (t) => {
  const f = await fixture(t);
  await mkdir(f.target);
  const destination = join(f.target, "template-skill-zh-dev");
  await symlink(f.source, destination);
  const original = await readFile(join(f.source, "SKILL.md"));
  await assert.rejects(deploy(f), /symlink/i);
  assert.equal((await lstat(destination)).isSymbolicLink(), true);
  assert.deepEqual(await readFile(join(f.source, "SKILL.md")), original);
});

test("rejects source-tree destinations and workspaces, including paths through symlinks", async (t) => {
  const f = await fixture(t);
  await assert.rejects(deploy({ ...f, target: join(f.repoRoot, "skills") }), /source|skills/i);
  await assert.rejects(deploy({ ...f, workspace: join(f.repoRoot, "test-workspace") }), /workspace.*outside/i);
  const alias = join(f.root, "source-alias");
  await symlink(f.source, alias);
  await assert.rejects(deploy({ ...f, target: join(alias, "nested") }), /source|skills/i);
  assert.equal((await readdir(f.source)).includes("nested"), false);
});

test("rejects installation roots that equal or contain the workspace, including symlink aliases", async (t) => {
  const f = await fixture(t);
  await mkdir(f.workspace);
  await writeFile(join(f.workspace, "keep.txt"), "workspace output");
  const alias = join(f.root, "workspace-alias");
  await symlink(f.workspace, alias);
  for (const target of [f.workspace, f.root, alias]) {
    await assert.rejects(deploy({ ...f, target }), /workspace/i);
  }
  assert.equal(await readFile(join(f.workspace, "keep.txt"), "utf8"), "workspace output");
  assert.deepEqual(await readdir(f.workspace), ["keep.txt"]);
});

test("rejects a workspace-local installation root aliased to the source tree", async (t) => {
  const f = await fixture(t);
  await mkdir(join(f.workspace, ".agents"), { recursive: true });
  await symlink(join(f.repoRoot, "skills"), join(f.workspace, ".agents", "skills"));
  await assert.rejects(deploy({ ...f, target: join(f.workspace, ".agents", "skills") }), /source|skills/i);
  assert.deepEqual(await readdir(join(f.repoRoot, "skills")), [f.skill]);
});

test("rejects invalid names and suffixes before writing an installation", async (t) => {
  const f = await fixture(t);
  for (const suffix of ["", "release", "../bad"]) {
    await assert.rejects(deploy({ ...f, suffix }), /suffix/i);
  }
  await assert.rejects(deploy({ ...f, skill: "../outside" }), /skill/i);
  assert.equal((await readdir(f.root)).includes("installed skills"), false);
});

test("rejects symlink payloads and invalid source policy before replacing a valid build", async (t) => {
  const f = await fixture(t);
  const first = await deploy(f);
  const original = await readFile(join(first.target, "SKILL.md"));
  await symlink(join(f.root, "missing"), join(f.source, "linked"));
  await assert.rejects(deploy(f), /symlink|regular file/i);
  await rm(join(f.source, "linked"));
  const source = await readFile(join(f.source, "SKILL.md"), "utf8");
  await writeFile(join(f.source, "SKILL.md"), source.replace("disable-model-invocation: true", "disable-model-invocation: false"));
  await assert.rejects(deploy(f), /invocation|policy/i);
  assert.deepEqual(await readFile(join(first.target, "SKILL.md")), original);
});

test("default target follows the final workspace from defaults, config, or CLI", async (t) => {
  const f = await fixture(t);
  const { resolveOptions } = await import("../scripts/deploy-dev.mjs");
  const defaults = await resolveOptions([], f.repoRoot);
  assert.equal(defaults.workspace, join(tmpdir(), "skills-template-playground"));
  assert.equal(defaults.target, join(tmpdir(), "skills-template-playground", ".agents", "skills"));
  await writeFile(join(f.repoRoot, "dev-deploy.local.json"), JSON.stringify({ workspace: "../configured playground" }));
  const configured = await resolveOptions([], f.repoRoot);
  assert.equal(configured.target, join(f.root, "configured playground", ".agents", "skills"));
  const override = await resolveOptions(["--workspace", "../cli playground"], f.repoRoot);
  assert.equal(override.workspace, join(f.root, "cli playground"));
  assert.equal(override.target, join(f.root, "cli playground", ".agents", "skills"));
  const home = await resolveOptions(["--workspace", "~/test-playground"], f.repoRoot);
  assert.equal(home.target, join(homedir(), "test-playground", ".agents", "skills"));
});

test("direct API defaults to workspace-local installation without CLI resolution", async (t) => {
  const f = await fixture(t);
  const testHome = join(f.root, "test home");
  // A regressed global default must remain inside the fixture, even if only the API regresses.
  const { stdout } = await execFileAsync(process.execPath, ["--input-type=module", "-e", `
    const { moduleUrl, repoRoot, skill } = JSON.parse(process.argv[1]);
    const { deployDev } = await import(moduleUrl);
    const { workspace, target } = await deployDev({ repoRoot, skill, workspace: "../empty workspace" });
    console.log(JSON.stringify({ workspace, target }));
  `, JSON.stringify({ moduleUrl: new URL("../scripts/deploy-dev.mjs", import.meta.url).href, repoRoot: f.repoRoot, skill: f.skill })], {
    env: { ...process.env, HOME: testHome, USERPROFILE: testHome },
  });
  const result = JSON.parse(stdout);
  assert.equal(result.workspace, f.workspace);
  assert.equal(result.target, join(f.workspace, ".agents", "skills", "template-skill-zh-dev"));
  assert.equal(frontmatter(await readFile(join(result.target, "SKILL.md"), "utf8")).name, "template-skill-zh-dev");
  await assert.rejects(lstat(join(testHome, ".agents", "skills")), { code: "ENOENT" });
});

test("local config supplies paths and CLI arguments override it", async (t) => {
  const f = await fixture(t);
  await writeFile(join(f.repoRoot, "dev-deploy.local.json"), JSON.stringify({ target: "../configured", workspace: "../playground", suffix: "debug" }));
  const { resolveOptions } = await import("../scripts/deploy-dev.mjs");
  const configured = await resolveOptions([], f.repoRoot);
  assert.equal(configured.target, join(f.root, "configured"));
  assert.equal(configured.workspace, join(f.root, "playground"));
  assert.equal(configured.suffix, "debug");
  const workspaceOverride = await resolveOptions(["--workspace", f.workspace], f.repoRoot);
  assert.equal(workspaceOverride.target, join(f.root, "configured"));
  const override = await resolveOptions(["--target", f.target, "--suffix", "dev"], f.repoRoot);
  assert.equal(override.target, f.target);
  assert.equal(override.suffix, "dev");
  await assert.rejects(resolveOptions(["--unknown", "x"], f.repoRoot), /unknown/i);
  for (const target of [null, "", 42]) {
    await writeFile(join(f.repoRoot, "dev-deploy.local.json"), JSON.stringify({ target }));
    await assert.rejects(resolveOptions([], f.repoRoot), /paths.*nonempty strings/i);
  }
});

test("CLI deploys all skills inside the workspace when --target is omitted", async (t) => {
  const f = await cliFixture(t);
  const configPath = join(f.repoRoot, "dev-deploy.local.json");
  const config = { workspace: f.workspace, suffix: "dev" };
  await writeFile(configPath, JSON.stringify(config));
  const { resolveOptions } = await import("../scripts/deploy-dev.mjs");
  assert.equal((await resolveOptions([], f.repoRoot)).target, join(f.workspace, ".agents", "skills"));
  const { stdout } = await execFileAsync(process.execPath, [join(f.repoRoot, "scripts", "deploy-dev.mjs")]);
  const names = ["template-skill-en-dev", "template-skill-zh-dev"];
  assert.deepEqual((await readdir(join(f.workspace, ".agents", "skills"))).sort(), names);
  for (const name of names) assert.ok(stdout.includes(`Installed: ${join(f.workspace, ".agents", "skills", name)}`));
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), config);
});

test("CLI accepts custom paths with spaces and prints the invocation and build ID", async (t) => {
  const f = await fixture(t);
  const { stdout } = await execFileAsync(process.execPath, [join(repository, "scripts", "deploy-dev.mjs"), "--skill", f.skill, "--target", f.target, "--workspace", f.workspace, "--suffix", "debug"]);
  assert.match(stdout, /\$template-skill-zh-debug/);
  assert.ok(stdout.includes(f.workspace));
  const manifest = JSON.parse(await readFile(join(f.target, "template-skill-zh-debug", "dev-build.json"), "utf8"));
  assert.ok(stdout.includes(manifest.buildId));
});

test("CLI defaults to every discovered skill without creating a local config", async (t) => {
  const f = await cliFixture(t);
  const extra = join(f.repoRoot, "skills", "extra-skill");
  await cp(f.source, extra, { recursive: true });
  for (const file of ["SKILL.md", "agents/openai.yaml"]) {
    const path = join(extra, file);
    await writeFile(path, (await readFile(path, "utf8")).replaceAll(f.skill, "extra-skill"));
  }
  await writeFile(join(f.repoRoot, "skills", "README.md"), "Skill directory notes");
  const { stdout } = await f.run();
  const names = ["extra-skill-dev", "template-skill-en-dev", "template-skill-zh-dev"];
  assert.deepEqual((await readdir(f.target)).sort(), names);
  for (const name of names) {
    const manifest = JSON.parse(await readFile(join(f.target, name, "dev-build.json"), "utf8"));
    assert.ok(stdout.includes(`Installed: ${join(f.target, name)}`));
    assert.ok(stdout.includes(`Build: ${manifest.buildId}`));
    assert.ok(stdout.includes(`Invoke: $${name}`));
  }
  assert.equal((await readdir(f.repoRoot)).includes("dev-deploy.local.json"), false);
});

test("CLI deploys all skills with shared local settings when skill is omitted", async (t) => {
  const f = await cliFixture(t);
  const config = { suffix: "debug", target: f.target, workspace: f.workspace };
  const configPath = join(f.repoRoot, "dev-deploy.local.json");
  await writeFile(configPath, JSON.stringify(config));
  await f.run();
  assert.deepEqual((await readdir(f.target)).sort(), ["template-skill-en-debug", "template-skill-zh-debug"]);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), config);
});

test("CLI keeps single-skill configuration and lets --skill override it", async (t) => {
  const f = await cliFixture(t);
  await writeFile(join(f.repoRoot, "dev-deploy.local.json"), JSON.stringify({ skill: "template-skill-zh" }));
  await f.run();
  assert.deepEqual(await readdir(f.target), ["template-skill-zh-dev"]);
  await f.run(["--skill", "template-skill-en"]);
  assert.deepEqual((await readdir(f.target)).sort(), ["template-skill-en-dev", "template-skill-zh-dev"]);
});

test("CLI --skill selects only one source without a local config", async (t) => {
  const f = await cliFixture(t);
  await f.run(["--skill", "template-skill-en"]);
  assert.deepEqual(await readdir(f.target), ["template-skill-en-dev"]);
});

test("CLI reports an empty skills directory without creating outputs", async (t) => {
  const f = await cliFixture(t);
  await rm(join(f.repoRoot, "skills"), { recursive: true });
  await mkdir(join(f.repoRoot, "skills"));
  await assert.rejects(f.run(), (error) => {
    assert.match(error.stderr, /no skills found/i);
    assert.equal(error.code, 1);
    return true;
  });
  await assert.rejects(lstat(f.target), { code: "ENOENT" });
  await assert.rejects(lstat(f.workspace), { code: "ENOENT" });
});
