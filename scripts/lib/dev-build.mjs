import { execFile } from "node:child_process";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
export const manifestName = "dev-build.json";
export const owner = "skills-template/dev-deploy";

export function validateIdentity(skill, suffix) {
  if (typeof skill !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill)) {
    throw new Error("Skill must be a lowercase, hyphen-separated name.");
  }
  if (!["dev", "debug"].includes(suffix)) throw new Error("Suffix must be dev or debug.");
  const name = `${skill}-${suffix}`;
  if (name.length > 64) throw new Error("Development skill name must be at most 64 characters.");
  return name;
}

async function snapshot(root, prefix = "") {
  const files = [];
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await snapshot(root, path));
    else if (entry.isFile()) {
      files.push({ path, bytes: await readFile(join(root, path)), mode: (await lstat(join(root, path))).mode & 0o777 });
    } else throw new Error(`Skill payload must contain regular files and directories, not symlinks: ${path}`);
  }
  return files;
}

function parseMap(text, label) {
  const value = YAML.parse(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a YAML map.`);
  return value;
}

function renameInvocation(text, skill, name) {
  return text.replace(new RegExp(`\\$${skill}(?![a-z0-9-])`, "g"), () => `$${name}`);
}

export async function buildDev({ repoRoot, source, skill, suffix }) {
  const name = validateIdentity(skill, suffix);
  const files = await snapshot(source);
  const required = (path) => {
    const file = files.find((entry) => entry.path === path);
    if (!file) throw new Error(`Skill source is missing ${path}.`);
    return file;
  };
  if (files.some((file) => file.path === manifestName)) throw new Error(`${manifestName} is reserved for generated builds.`);
  required("LICENSE");
  const entry = required("SKILL.md");
  const agentFile = required("agents/openai.yaml");
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(entry.bytes.toString("utf8"));
  if (!match) throw new Error("SKILL.md is missing YAML frontmatter.");
  const metadata = parseMap(match[1], "SKILL.md");
  const agent = parseMap(agentFile.bytes.toString("utf8"), "agents/openai.yaml");
  if (metadata.name !== skill) throw new Error("Skill source name must match its directory.");
  if (metadata["disable-model-invocation"] !== true || agent.policy?.allow_implicit_invocation !== false) {
    throw new Error("Source invocation policy must require explicit user invocation.");
  }
  if (typeof metadata.description !== "string" || !metadata.description.trim()) throw new Error("Skill description must be nonempty.");
  if (typeof agent.interface?.default_prompt !== "string" || !new RegExp(`\\$${skill}(?![a-z0-9-])`).test(agent.interface.default_prompt)) {
    throw new Error("Source default_prompt must contain the explicit skill invocation.");
  }

  let commit = null;
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--verify", "HEAD"], { timeout: 5_000 });
    if (/^[a-f0-9]{40,64}$/.test(stdout.trim())) commit = stdout.trim();
  } catch { /* Source archives and initial checkouts may have no commit. */ }
  const buildId = commit ? commit.slice(0, 6) : "nogit";
  const footer = `*Note: This is the dev build ${buildId}. Do NOT use in production environment.*`;
  const body = renameInvocation(entry.bytes.toString("utf8").slice(match[0].length).trim(), skill, name);
  metadata.name = name;
  metadata.description = `[${suffix}] ${metadata.description}`;
  if (metadata.description.length > 1024) throw new Error("Development skill description exceeds 1024 characters.");
  entry.bytes = Buffer.from(`---\n${YAML.stringify(metadata).trimEnd()}\n---\n\n# Development build\n\nUse the workflow below as ${name}. Its exact-output, single-line, plain-text,\nno-additional-content, and stop rules apply to the business response only.\nThis development build also requires the final notice defined after the workflow.\nKeep that notice in the chat response, outside generated images or other artifacts.\n\n## Business workflow\n\n${body}\n\n## Development final response\n\nAfter the business response, append a blank line and this exact Markdown italic\nnotice once as the last paragraph, then stop. This is the development-build\nexception to any conflicting final-response restriction in the workflow above.\n\n${footer}\n`);
  agent.interface.display_name = `${agent.interface.display_name || skill} (${suffix})`;
  if (agent.interface.short_description) agent.interface.short_description = `[${suffix}] ${agent.interface.short_description}`;
  agent.interface.default_prompt = renameInvocation(agent.interface.default_prompt, skill, name);
  agentFile.bytes = Buffer.from(YAML.stringify(agent));
  const manifest = { schema: 1, owner, source, skill, suffix, name, buildId, commit, builtAt: new Date().toISOString() };
  files.push({ path: manifestName, mode: 0o644, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) });
  return { name, buildId, footer, files, manifest };
}
