import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { validateSkills } from "../scripts/validate-skills.mjs";

const execFileAsync = promisify(execFile);
const fixtures = new Set();

function releaseConfig(overrides = {}) {
  return {
    "release-type": "simple",
    "initial-version": "0.1.0",
    "include-component-in-tag": false,
    "include-v-in-tag": true,
    "separate-pull-requests": false,
    packages: { ".": {} },
    ...overrides,
  };
}

async function writeJson(root, name, value) {
  await writeFile(join(root, name), `${JSON.stringify(value, null, 2)}\n`);
}

async function makeRepo(version = "0.0.0") {
  const root = await mkdtemp(join(tmpdir(), "validate-skills-"));
  fixtures.add(root);
  await mkdir(join(root, "skills"));
  await writeFile(join(root, "version.txt"), `${version}\n`);
  await writeFile(join(root, "CHANGELOG.md"), "# Changelog\n\nRepository release history.\n");
  await writeJson(root, "release-please-config.json", releaseConfig());
  await writeJson(root, ".release-please-manifest.json", version === "0.0.0" ? {} : { ".": version });
  return root;
}

async function writeSkill(root, directory, overrides = {}) {
  const skillRoot = join(root, "skills", directory);
  await mkdir(join(skillRoot, "agents"), { recursive: true });
  const name = overrides.name ?? directory;
  const description = overrides.description ?? "A useful skill, including placeholders.";
  const disabled = overrides.disabled ?? true;
  const implicit = overrides.implicit ?? false;
  const prompt = overrides.prompt ?? `Use $${name} now.`;
  await writeFile(
    join(skillRoot, "SKILL.md"),
    overrides.skillText ??
      `---\nname: ${JSON.stringify(name)}\ndescription: ${JSON.stringify(description)}\ndisable-model-invocation: ${JSON.stringify(disabled)}\n---\n\n# Skill\n`,
  );
  await writeFile(
    join(skillRoot, "agents", "openai.yaml"),
    overrides.openaiText ??
      `interface:\n  default_prompt: ${JSON.stringify(prompt)}\npolicy:\n  allow_implicit_invocation: ${JSON.stringify(implicit)}\n`,
  );
  if (!overrides.noLicense) await writeFile(join(skillRoot, "LICENSE"), "MIT\n");
}

test.afterEach(async () => {
  await Promise.all([...fixtures].map((path) => rm(path, { recursive: true, force: true })));
  fixtures.clear();
});

test("accepts a valid intentionally placeholder skill", async () => {
  const root = await makeRepo();
  await writeSkill(root, "template-skill-zh");
  assert.deepEqual(await validateSkills(root), []);
});

test("accepts multiple skills sharing one published repository version", async () => {
  const root = await makeRepo("1.2.3");
  await writeSkill(root, "one");
  await writeSkill(root, "two");
  assert.deepEqual(await validateSkills(root), []);
});

test("accepts SemVer prerelease and build metadata for the repository", async () => {
  const root = await makeRepo("1.2.3-rc.1+build.5");
  await writeSkill(root, "one");
  assert.deepEqual(await validateSkills(root), []);
});

test("reports missing root release files", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await rm(join(root, "version.txt"));
  await rm(join(root, "CHANGELOG.md"));
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /(?:^|\n)version\.txt.*missing/i);
  assert.match(errors, /(?:^|\n)CHANGELOG\.md.*missing/i);
});

test("rejects invalid root versions and empty root changelogs", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeFile(join(root, "CHANGELOG.md"), "  \n");
  for (const version of ["v1.2.3", "1.2", "01.2.3", "1.2.3-01", ""]) {
    await writeFile(join(root, "version.txt"), version);
    const errors = (await validateSkills(root)).join("\n");
    assert.match(errors, /(?:^|\n)version\.txt.*SemVer/i, version);
    assert.match(errors, /(?:^|\n)CHANGELOG\.md.*nonempty/i);
  }
});

test("rejects stale skill-local release files", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeFile(join(root, "skills", "one", "version.txt"), "0.0.0\n");
  await writeFile(join(root, "skills", "one", "CHANGELOG.md"), "# Changelog\n");
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /one\/version\.txt.*repository root/i);
  assert.match(errors, /one\/CHANGELOG\.md.*repository root/i);
});

test("requires exactly one root release package", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  for (const packages of [{}, { "skills/one": {} }, { ".": {}, "skills/one": {} }]) {
    await writeJson(root, "release-please-config.json", releaseConfig({ packages }));
    assert.match((await validateSkills(root)).join("\n"), /packages.*exactly.*root|exactly.*root.*package/i);
  }
});

test("rejects non-object root package settings", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  for (const settings of [null, [], "simple"]) {
    await writeJson(root, "release-please-config.json", releaseConfig({ packages: { ".": settings } }));
    assert.match((await validateSkills(root)).join("\n"), /root package.*object|package \..*object/i);
  }
});

test("accepts release settings declared in the root package", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeJson(root, "release-please-config.json", {
    "separate-pull-requests": false,
    packages: {
      ".": {
        "release-type": "simple",
        "initial-version": "0.1.0",
        "include-component-in-tag": false,
        "include-v-in-tag": true,
        "separate-pull-requests": false,
      },
    },
  });
  assert.deepEqual(await validateSkills(root), []);
});

test("enforces effective root release settings across global and package overrides", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  for (const [field, invalidValue] of [
    ["release-type", "node"],
    ["initial-version", "1.0.0"],
    ["include-component-in-tag", true],
    ["include-v-in-tag", false],
    ["separate-pull-requests", true],
    ["include-component-in-tag", "false"],
    ["include-v-in-tag", "true"],
    ["separate-pull-requests", "false"],
  ]) {
    for (const config of [
      releaseConfig({ [field]: invalidValue }),
      releaseConfig({ packages: { ".": { [field]: invalidValue } } }),
    ]) {
      await writeJson(root, "release-please-config.json", config);
      assert.match((await validateSkills(root)).join("\n"), new RegExp(field), `${field}: ${invalidValue}`);
    }
  }
});

test("accepts omitted unified PR routing and rejects an explicit global split", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeJson(root, "release-please-config.json", releaseConfig({ "separate-pull-requests": undefined }));
  assert.deepEqual(await validateSkills(root), []);
  await writeJson(root, "release-please-config.json", releaseConfig({
    "separate-pull-requests": true,
    packages: { ".": { "separate-pull-requests": false } },
  }));
  assert.match((await validateSkills(root)).join("\n"), /separate-pull-requests.*false/i);
});

test("uses explicit package overrides instead of stale global release settings", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeJson(root, "release-please-config.json", releaseConfig({
    "release-type": "node",
    "initial-version": "1.0.0",
    "include-component-in-tag": true,
    "include-v-in-tag": false,
    packages: {
      ".": {
        "release-type": "simple",
        "initial-version": "0.1.0",
        "include-component-in-tag": false,
        "include-v-in-tag": true,
      },
    },
  }));
  assert.deepEqual(await validateSkills(root), []);
});

test("keeps configured release files at the repository root", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeJson(root, "release-please-config.json", releaseConfig({
    "version-file": "version.txt",
    packages: { ".": { "changelog-path": "CHANGELOG.md" } },
  }));
  assert.deepEqual(await validateSkills(root), []);
  for (const [field, path] of [["version-file", "skills/one/version.txt"], ["changelog-path", "skills/one/CHANGELOG.md"]]) {
    for (const config of [
      releaseConfig({ [field]: path }),
      releaseConfig({ packages: { ".": { [field]: path } } }),
    ]) {
      await writeJson(root, "release-please-config.json", config);
      assert.match((await validateSkills(root)).join("\n"), new RegExp(`${field}.*root`));
    }
  }
});

test("allows an empty manifest only for unpublished root version 0.0.0", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  assert.deepEqual(await validateSkills(root), []);
  await writeJson(root, ".release-please-manifest.json", { ".": "0.0.0" });
  assert.deepEqual(await validateSkills(root), []);
  await writeFile(join(root, "version.txt"), "1.2.3\n");
  await writeJson(root, ".release-please-manifest.json", {});
  assert.match((await validateSkills(root)).join("\n"), /root.*1\.2\.3.*manifest entry/i);
});

test("rejects non-root manifest keys and root version mismatches", async () => {
  const root = await makeRepo("1.2.3");
  await writeSkill(root, "one");
  await writeJson(root, ".release-please-manifest.json", { ".": "1.2.4", "skills/one": "1.2.3" });
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /manifest.*1\.2\.4.*1\.2\.3|manifest.*version.*mismatch/i);
  assert.match(errors, /manifest.*skills\/one.*root/i);
});

test("aggregates invalid release JSON documents and fields", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await writeFile(join(root, "release-please-config.json"), "{");
  await writeJson(root, ".release-please-manifest.json", []);
  let errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /release-please-config\.json.*invalid JSON/i);
  assert.match(errors, /release-please-manifest\.json.*object/i);

  await writeJson(root, "release-please-config.json", { packages: [] });
  await writeJson(root, ".release-please-manifest.json", { ".": 0 });
  errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /packages.*object/i);
  assert.match(errors, /manifest.*version.*string/i);
});

test("reports missing release documents and required package fields", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one");
  await rm(join(root, ".release-please-manifest.json"));
  await writeJson(root, "release-please-config.json", {});
  let errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /release-please-manifest\.json.*missing/i);
  assert.match(errors, /packages.*object/i);

  await rm(join(root, "release-please-config.json"));
  errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /release-please-config\.json.*missing/i);

  await writeJson(root, "release-please-config.json", { packages: { ".": {} } });
  errors = (await validateSkills(root)).join("\n");
  for (const field of ["release-type", "initial-version", "include-component-in-tag", "include-v-in-tag"]) {
    assert.match(errors, new RegExp(field));
  }
});

test("reports a missing or empty skills directory", async () => {
  const root = await makeRepo();
  assert.match((await validateSkills(root)).join("\n"), /no skills/i);
  await rm(join(root, "skills"), { recursive: true });
  assert.match((await validateSkills(root)).join("\n"), /skills directory/i);
});

test("aggregates missing required files and fields", async () => {
  const root = await makeRepo();
  await mkdir(join(root, "skills", "broken", "agents"), { recursive: true });
  await writeFile(join(root, "skills", "broken", "SKILL.md"), "---\n{}\n---\n");
  await writeFile(join(root, "skills", "broken", "agents", "openai.yaml"), "{}\n");
  const errors = (await validateSkills(root)).join("\n");
  for (const expected of ["name", "description", "disable-model-invocation", "allow_implicit_invocation", "default_prompt", "LICENSE"]) {
    assert.match(errors, new RegExp(expected));
  }
});

test("reports missing agent metadata and license files", async () => {
  const root = await makeRepo();
  await writeSkill(root, "incomplete");
  await rm(join(root, "skills", "incomplete", "agents", "openai.yaml"));
  await rm(join(root, "skills", "incomplete", "LICENSE"));
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /incomplete\/agents\/openai\.yaml.*missing/i);
  assert.match(errors, /incomplete\/LICENSE.*missing/i);
});

test("treats whitespace-only required metadata strings as empty", async () => {
  const root = await makeRepo();
  await writeSkill(root, "whitespace", { name: "   ", description: " \t " });
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /name must be a nonempty string/i);
  assert.match(errors, /description must be a nonempty string/i);
});

test("reports malformed YAML and non-map YAML in both metadata files", async () => {
  const root = await makeRepo();
  await writeSkill(root, "bad-skill", { skillText: "---\nname: [\n---\n", openaiText: "policy: [\n" });
  await writeSkill(root, "scalar-skill", { skillText: "---\nhello\n---\n", openaiText: "hello\n" });
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /bad-skill\/SKILL\.md.*YAML/i);
  assert.match(errors, /bad-skill\/agents\/openai\.yaml.*YAML/i);
  assert.match(errors, /scalar-skill\/SKILL\.md.*map/i);
  assert.match(errors, /scalar-skill\/agents\/openai\.yaml.*map/i);
});

test("validates name, description, directory match, and global uniqueness", async () => {
  const root = await makeRepo();
  await writeSkill(root, "one", { name: "shared" });
  await writeSkill(root, "two", { name: "shared", description: "" });
  await writeSkill(root, "three", { name: "Bad_Name" });
  await writeSkill(root, "four", { name: "a".repeat(65), description: "x".repeat(1025) });
  await writeSkill(root, "five", { name: 42, description: 9 });
  await writeSkill(root, "six", { name: "bad--name" });
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /duplicate.*shared/i);
  assert.match(errors, /directory.*shared|shared.*directory/i);
  assert.match(errors, /Bad_Name.*format|format.*Bad_Name/i);
  assert.match(errors, /65|64/);
  assert.match(errors, /description.*1024/i);
  assert.match(errors, /name.*string/i);
  assert.match(errors, /description.*string/i);
  assert.match(errors, /bad--name.*format|format.*bad--name/i);
});

test("requires strict invocation flags and an exact skill token in the prompt", async () => {
  const root = await makeRepo();
  await writeSkill(root, "missing", {
    skillText: "---\nname: missing\ndescription: Missing flags\n---\n",
    openaiText: "interface:\n  default_prompt: Use $missing-extra.\npolicy: {}\n",
  });
  await writeSkill(root, "inverted", { disabled: false, implicit: true, prompt: 12 });
  await writeSkill(root, "strings", { disabled: "true", implicit: "false", prompt: "Use $strings-extra." });
  const errors = (await validateSkills(root)).join("\n");
  assert.match(errors, /missing.*disable-model-invocation/i);
  assert.match(errors, /missing.*allow_implicit_invocation/i);
  assert.match(errors, /missing.*\$missing/i);
  assert.match(errors, /inverted.*disable-model-invocation/i);
  assert.match(errors, /inverted.*allow_implicit_invocation/i);
  assert.match(errors, /inverted.*default_prompt.*string/i);
  assert.match(errors, /strings.*disable-model-invocation/i);
  assert.match(errors, /strings.*allow_implicit_invocation/i);
  assert.match(errors, /strings.*\$strings/i);
});

test("CLI exits nonzero and prints all validation errors", async () => {
  const root = await makeRepo();
  await mkdir(join(root, "skills", "broken"));
  const script = fileURLToPath(new URL("../scripts/validate-skills.mjs", import.meta.url));
  await assert.rejects(execFileAsync(process.execPath, [script, root]), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /SKILL\.md/);
    assert.match(error.stdout, /LICENSE/);
    return true;
  });
});
