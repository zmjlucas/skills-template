import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import YAML from "yaml";

async function readRequiredFile(path, label, errors) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error("not a file");
    return await readFile(path, "utf8");
  } catch {
    errors.push(`${label}: required file is missing`);
    return undefined;
  }
}

function parseMap(text, label, errors) {
  try {
    const value = YAML.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label}: YAML root must be a map`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`${label}: invalid YAML (${error.message})`);
    return undefined;
  }
}

function parseJsonObject(text, label, errors) {
  if (text === undefined) return undefined;
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${label}: JSON root must be an object`);
      return undefined;
    }
    return value;
  } catch (error) {
    errors.push(`${label}: invalid JSON (${error.message})`);
    return undefined;
  }
}

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSkillMetadata(text, label, errors) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(text);
  if (!match) {
    errors.push(`${label}: missing YAML frontmatter`);
    return undefined;
  }
  return parseMap(match[1], label, errors);
}

function exactSkillToken(prompt, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\$${escaped}(?![a-z0-9-])`).test(prompt);
}

export async function validateSkills(repoRoot) {
  const errors = [];
  const skillsRoot = join(repoRoot, "skills");
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch {
    return ["skills directory is missing or unreadable"];
  }

  const directories = entries.filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
  if (directories.length === 0) return ["no skills found in skills directory"];

  const declaredNames = new Map();
  for (const entry of directories) {
    const directory = entry.name;
    const skillRoot = join(skillsRoot, directory);
    const skillLabel = `${directory}/SKILL.md`;
    const agentLabel = `${directory}/agents/openai.yaml`;
    const skillText = await readRequiredFile(join(skillRoot, "SKILL.md"), skillLabel, errors);
    const agentText = await readRequiredFile(join(skillRoot, "agents", "openai.yaml"), agentLabel, errors);
    await readRequiredFile(join(skillRoot, "LICENSE"), `${directory}/LICENSE`, errors);
    const skillFiles = await readdir(skillRoot).catch(() => []);
    for (const releaseFile of ["version.txt", "CHANGELOG.md"]) {
      if (skillFiles.includes(releaseFile)) {
        errors.push(`${directory}/${releaseFile}: release metadata belongs at the repository root`);
      }
    }

    const metadata = skillText === undefined ? undefined : parseSkillMetadata(skillText, skillLabel, errors);
    let name;
    if (metadata) {
      name = metadata.name;
      if (typeof name !== "string" || name.trim().length === 0) {
        errors.push(`${skillLabel}: name must be a nonempty string`);
      } else {
        const prior = declaredNames.get(name);
        if (prior) errors.push(`${skillLabel}: duplicate skill name ${name} (also declared by ${prior})`);
        else declaredNames.set(name, skillLabel);
        if (name.length > 64) errors.push(`${skillLabel}: name must be at most 64 characters`);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
          errors.push(`${skillLabel}: name ${name} has invalid format`);
        }
        if (name !== directory) errors.push(`${skillLabel}: directory ${directory} must match name ${name}`);
      }

      const description = metadata.description;
      if (typeof description !== "string" || description.trim().length === 0) {
        errors.push(`${skillLabel}: description must be a nonempty string`);
      } else if (description.length > 1024) {
        errors.push(`${skillLabel}: description must be at most 1024 characters`);
      }
      if (metadata["disable-model-invocation"] !== true) {
        errors.push(`${skillLabel}: disable-model-invocation must be boolean true`);
      }
    }

    const agent = agentText === undefined ? undefined : parseMap(agentText, agentLabel, errors);
    if (agent) {
      if (agent.policy?.allow_implicit_invocation !== false) {
        errors.push(`${agentLabel}: policy.allow_implicit_invocation must be boolean false`);
      }
      const prompt = agent.interface?.default_prompt;
      if (typeof prompt !== "string") {
        errors.push(`${agentLabel}: interface.default_prompt must be a string`);
      } else if (typeof name === "string" && name.length > 0 && !exactSkillToken(prompt, name)) {
        errors.push(`${agentLabel}: interface.default_prompt must contain exact token $${name}`);
      }
    }
  }

  const versionText = await readRequiredFile(join(repoRoot, "version.txt"), "version.txt", errors);
  const changelogText = await readRequiredFile(join(repoRoot, "CHANGELOG.md"), "CHANGELOG.md", errors);
  let version;
  if (versionText !== undefined) {
    const value = versionText.trim();
    if (!SEMVER.test(value)) errors.push("version.txt: version must be valid SemVer");
    else version = value;
  }
  if (changelogText !== undefined && changelogText.trim().length === 0) {
    errors.push("CHANGELOG.md: changelog must be nonempty");
  }

  const configText = await readRequiredFile(join(repoRoot, "release-please-config.json"), "release-please-config.json", errors);
  const manifestText = await readRequiredFile(join(repoRoot, ".release-please-manifest.json"), ".release-please-manifest.json", errors);
  const config = parseJsonObject(configText, "release-please-config.json", errors);
  const manifest = parseJsonObject(manifestText, ".release-please-manifest.json", errors);

  if (config) {
    const packages = config.packages;
    if (packages === null || typeof packages !== "object" || Array.isArray(packages)) {
      errors.push("release-please-config.json: packages must be an object");
    } else {
      if (Object.keys(packages).length !== 1 || !Object.hasOwn(packages, ".")) {
        errors.push("release-please-config.json: packages must contain exactly one root package .");
      }
      if (Object.hasOwn(packages, ".")) {
        const rootPackage = packages["."];
        if (rootPackage === null || typeof rootPackage !== "object" || Array.isArray(rootPackage)) {
          errors.push("release-please-config.json: root package . must be an object");
        } else {
          const effective = { ...config, ...rootPackage };
          for (const [field, expected] of [
            ["release-type", "simple"],
            ["initial-version", "0.1.0"],
            ["include-component-in-tag", false],
            ["include-v-in-tag", true],
          ]) {
            if (effective[field] !== expected) {
              errors.push(`release-please-config.json: root package ${field} must be ${JSON.stringify(expected)}`);
            }
          }
          // Global PR orchestration is independent of per-package overrides.
          if ([config, rootPackage].some((settings) =>
            Object.hasOwn(settings, "separate-pull-requests") && settings["separate-pull-requests"] !== false)) {
            errors.push("release-please-config.json: separate-pull-requests must be false when configured globally or for the root package");
          }
          for (const [field, filename] of [["version-file", "version.txt"], ["changelog-path", "CHANGELOG.md"]]) {
            if (effective[field] !== undefined && effective[field] !== filename) {
              errors.push(`release-please-config.json: ${field} must use repository root ${filename}`);
            }
          }
        }
      }
    }
  }

  if (manifest) {
    for (const [packagePath, manifestVersion] of Object.entries(manifest)) {
      if (packagePath !== ".") {
        errors.push(`.release-please-manifest.json: entry ${packagePath} must name the repository root .`);
        continue;
      }
      if (typeof manifestVersion !== "string") {
        errors.push(".release-please-manifest.json: root entry . version must be a string");
      } else if (version !== undefined && manifestVersion !== version) {
        errors.push(`.release-please-manifest.json: root entry . version ${manifestVersion} does not match version.txt ${version}`);
      }
    }
    if (version !== undefined && version !== "0.0.0" && !Object.hasOwn(manifest, ".")) {
      errors.push(`.release-please-manifest.json: root at version ${version} requires a manifest entry .`);
    }
  }
  return errors;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const errors = await validateSkills(resolve(process.argv[2] ?? defaultRoot));
  if (errors.length > 0) {
    for (const error of errors) console.log(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log("Skill validation passed.");
  }
}
